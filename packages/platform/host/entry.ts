// The two halves of a bundled application: the launcher, and the worker it launches.
//
// A built program carries the worker's *source* as a string and spawns it from a blob
// URL. The obvious alternative — `new Worker(import.meta.url)`, the file spawning itself —
// works, but needs `--allow-read` on the file, which put a permission in every program's
// shebang that had nothing to do with what the program could do. A blob URL needs none,
// so the shebang is now exactly the capabilities the build granted, and a program granted
// nothing asks for nothing.
//
// Worker detection is still `WorkerGlobalScope` rather than `import.meta.main`, which is
// true in both — the worker bundle has its own entry now, but the check guards the
// message handler below and getting it wrong would fail silently.

import { type Bridge, bridgeOf, newBridge } from "./layout.ts";
import { serveHostCalls } from "./respond.ts";
import { denoWorld } from "./deno.ts";
import { mainArgs, WacExit } from "./provider.ts";

/**
 * The generated module of an application.
 *
 * `main` answering an `i32` is the whole contract, called with the value `__wacHost` answers when the
 * program takes one (design/system/0013 step 6) and with nothing when it declared nothing. Answers
 * reach it through `__wacAnswered`. Anything else a bundle exports is the program's own.
 *
 * A worker calls `main` repeatedly (wac-mono 0076). wac has no module-level variables, so nothing
 * survives one call into the next; what repeated calls need is on this side — see `runAsWorker`, which
 * builds the host once because the funcref table cannot afford a second set.
 */
export type AppModule = {
  main: (...host: unknown[]) => number;
  __wacHost?: (...calls: unknown[]) => unknown;
  __wacAnswered?: (...answer: unknown[]) => void;
};

type Start = { sab: SharedArrayBuffer; child?: boolean };
type Result = { ok: true; code: number } | { ok: false; error: string };

const onWorker = (): boolean =>
  typeof (globalThis as Record<string, unknown>).WorkerGlobalScope !== "undefined";

// ── The handler is installed on import, not inside `runBundled` ───────────────
// The module bindgen generates has a top-level `await WebAssembly.instantiate`, so a
// worker's evaluation *suspends* there — and a `postMessage` arriving in that window is
// dropped, leaving the launcher waiting for a reply that never comes.
//
// `packages/stream` documents this exact hazard and it still caught this file out, because
// the offending await is in an imported module rather than in this one. It showed up as a
// binary that worked one run in three, which is the worst way to be told.
//
// So the handler goes in at module scope, and the generated entry imports this module
// *before* the application: this side effect runs first and buffers whatever arrives while
// the application is still starting.
let buffered: Start | null = null;
let deliver: ((s: Start) => void) | null = null;

if (onWorker()) {
  (self as unknown as { onmessage: ((e: MessageEvent) => void) | null }).onmessage = (e) => {
    const s = e.data as Start;
    // Cleared as it fires: a resolver that has already run cannot answer the *next* wait, and a
    // looping worker has a next wait.
    if (deliver !== null) { const d = deliver; deliver = null; d(s); }
    else buffered = s;
  };
  // "This bundle parsed and evaluated." Sent before the application has done anything, and before
  // the bridge has even arrived, because that is the one fact a parent cannot otherwise learn: a
  // source that is not JavaScript fails at load, and until this existed the failure reached the
  // parent as its own uncaught error and killed it. `children.ts` waits for either this or the
  // load error before answering `spawn`. wac-mono issue 0021.
  (self as unknown as { postMessage(m: unknown): void }).postMessage({ ready: true });
}

/**
 * The next start message, which is usually the only one.
 *
 * **Usually, not always.** A worker ran `main` once and returned, so anything that wanted to run a
 * program twice paid a whole new worker — a new bundle parse and a new wasm compile, 41ms a run for
 * `packages/sh` and 67ms for `packages/box`, times every case in a differential (issue 0076).
 * Waiting for another message costs nothing when none comes, and a parent finished with a worker
 * terminates it exactly as before.
 *
 * `buffered` is cleared as it is taken, or a second call answers with the first run's bridge.
 */
function nextMessage(): Promise<Start> {
  if (buffered !== null) {
    const s = buffered;
    buffered = null;
    return Promise.resolve(s);
  }
  return new Promise<Start>((res) => { deliver = res; });
}

/**
 * What the build granted this application. Baked in, not parsed from the command line.
 *
 * A built program should look like any other program: `./wc README.md`, not
 * `./wc --allow-read -- README.md`. Deciding at build is also the more honest place —
 * whoever packages the thing chooses what it may do, and the person running it cannot
 * quietly widen that.
 */
/**
 * What the launcher was granted, which is a **second** declaration of `build.ts`'s `Grants` and has to
 * agree with it: this file is a host module, not part of the build's type graph, so it cannot import
 * that one.
 *
 * `run` was missing here while the line that reads it was already written — `issues/system/0165` is
 * exactly this drift, and its fix added the grant to `Grants`, to the capability and to `binary.ts` "and
 * to none of the seams between them". This was one more seam. `test/grants.test.ts` now asserts the two
 * declarations carry the same fields, so the next one fails to compile rather than to run.
 */
export type Grants = {
  read?: boolean;
  write?: boolean;
  env?: boolean;
  net?: boolean;
  run?: boolean;
};

/**
 * The worker half: wait for the bridge, make the host, run `main`.
 *
 * CallResult by the generated worker entry, which imports this module *before* the
 * application so the handler above is installed first.
 */
export async function runAsWorkerEntry(app: AppModule, cov?: Coverage): Promise<void> {
  await runAsWorker(app, cov);
}

/**
 * Where to dump counters, and what each one means — baked into a coverage build by `build.ts`.
 *
 * `lines` is `file:line` per counter index, resolved at build time, so a dump carries lines rather
 * than indices and whoever reads it needs no copy of the table.
 */
export type Coverage = { dir: string; lines: string[] };

/**
 * Write what this program executed, for a parent that is profiling.
 *
 * wac-mono 0024. A test that builds a binary and runs it as a child cannot read the child's coverage
 * counters, so mutation testing could not tell which tests reach which lines for any subprocess-based
 * suite — `packages/sh` narrowed 0 of 117 mutants. This is the far end of that: the child says what it
 * touched, and `harness/wacProfile.ts` attributes it to whichever test was running.
 *
 * Failures here are swallowed on purpose. A program is not doing this for its own sake — a dump that
 * cannot be written must not change what the program does or what it exits with, or the profile run
 * stops being a measurement of the same thing.
 */
function dumpCoverage(app: AppModule, cov: Coverage): void {
  try {
    const len = (app as unknown as { __cov_len?: () => number }).__cov_len;
    const get = (app as unknown as { __cov_get?: (i: number) => number }).__cov_get;
    if (len === undefined || get === undefined) return;
    const hit: string[] = [];
    const seen = new Set<string>();
    const n = len();
    for (let i = 0; i < n; i++) {
      if (get(i) > 0 && !seen.has(cov.lines[i])) {
        seen.add(cov.lines[i]);
        hit.push(cov.lines[i]);
      }
    }
    Deno.mkdirSync(cov.dir, { recursive: true });
    // One file per run, named so that two children writing at once cannot collide: a shell under test
    // spawns its applets, and every one of them is a program dumping into the same directory.
    Deno.writeTextFileSync(
      `${cov.dir}/${crypto.randomUUID()}.json`,
      JSON.stringify({ all: [...new Set(cov.lines)].sort(), hit: hit.sort() }),
    );
  } catch {
    // See above: a program that cannot write its dump still runs.
  }
}

/**
 * The launcher half: serve the granted capabilities, spawn the worker, exit with its code.
 *
 * `workerSource` is the worker bundle, carried as a string and spawned from a blob URL so
 * the program needs no filesystem permission of its own. Every argument goes to the
 * application; the launcher takes none.
 */
export async function runLauncher(
  workerSource: string,
  grants: Grants = {},
  /**
   * The generic wasm-child entry, already bundled, so this program's `spawn` can start a **module**.
   *
   * Written by `build.ts`, for the same reason `workerSource` is: the build is the only thing that can
   * bundle it, and a built application has no source tree to find it in. Optional so that a launcher
   * built before this existed still runs — such a program refuses a module by name, which is what
   * every built application did until 2026-08-21. `issues/system/0144`.
   */
  moduleEntry?: string,
): Promise<void> {
  await runAsLauncher(workerSource, grants, moduleEntry);
}

async function runAsWorker(app: AppModule, cov?: Coverage): Promise<void> {
  const worker = self as unknown as { postMessage(m: Result): void };
  // **One bridge and one host for the life of this worker**, however many programs it runs. `main`
  // may be called more than once because wac has no module-level variables — a program's whole state
  // is reachable from its own frame and gone when it returns — but the host's calls must not be
  // rebuilt per run: the module registers one wasm function per host function and only sixteen per
  // signature can be live, so a fifth run used to fail with "at most 16 distinct fn[void(i32)]
  // functions can be passed to this module". So the bridge is re-pointed at each run's buffer
  // instead (`Bridge.rebind`), and the host is made once.
  let b: Bridge | undefined;
  let world: unknown[] | undefined;
  for (;;) {
    const start = await nextMessage();
    {
      if (b === undefined) b = bridgeOf(start.sab);
      else if (b.sab !== start.sab) b.rebind(start.sab);
      try {
        if (typeof app.main !== "function") {
          throw new Error("an application must export `main(__WacHost) -> i32`");
        }
        // The counter array is allocated by this call, not at instantiation: without it every
        // instrumented function traps on its first branch, and the message names the program under
        // test rather than the missing call. the deleted harness/wacCoverage.ts had learnt the same thing.
        if (cov !== undefined) (app as unknown as { __cov_init?: () => void }).__cov_init?.();
        // A host only for a program that takes one — `mainArgs` carries the reason.
        if (world === undefined) world = mainArgs(b, app as unknown as Record<string, unknown>);
        const code = app.main(...world);
        if (cov !== undefined) dumpCoverage(app, cov);
        worker.postMessage({ ok: true, code });
      } catch (err) {
        // Dumped for a failed run too: a mutant that makes a program *crash* is killed by whichever
        // test ran it, and that test is exactly the one the attribution needs to know about.
        if (cov !== undefined) dumpCoverage(app, cov);
        // `sys.exit`: the program ended itself, abandoning what was left — a status, not a failure.
        if (err instanceof WacExit) { worker.postMessage({ ok: true, code: err.code }); continue; }
        worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

async function runAsLauncher(
  workerSource: string,
  grants: Grants,
  moduleEntry?: string,
): Promise<void> {
  const bridge = newBridge();
  const responder = serveHostCalls(bridge, denoWorld({
    args: [...Deno.args],
    fs: { read: grants.read === true, write: grants.write === true },
    net: grants.net === true,
    // **Missing here, and that is why `exec` had never run on this host.** `run` was added to
    // `Grants`, to the capability and to `binary.ts`, and to none of the seams between them: the
    // launcher built a world with no `run` in it, so a program built with `--allow-run` was refused
    // by its own host. `issues/system/0165`.
    run: grants.run === true,
    env: grants.env === true ? (n) => Deno.env.get(n) : undefined,
    // The program's own bundle, so `spawnSelf` has something to run. The launcher is the only
    // place that has it: it is what started the program.
    selfSource: workerSource,
    // And the generic entry for a child that is a wasm module, for the same reason.
    ...(moduleEntry === undefined ? {} : { moduleEntry }),
  }));

  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  const finished = new Promise<number>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as Result | { ready: true };
      if ("ready" in m) return;    // the load notice; the launcher has nothing to do with it
      if (m.ok) resolve(m.code);
      else reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      // Contained, or Deno reports it a second time as *this* process's uncaught error — two
      // messages for one failure, the second naming the launcher rather than the program.
      e.preventDefault();
      reject(new Error(e.message));
    };
  });
  worker.postMessage({ sab: bridge.sab });

  // The code leaves the block rather than being exited with inside it, because `Deno.exit` does
  // not run `finally` — so this cleanup used to read as though it happened and never did. Here the
  // process was ending anyway and the operating system took care of it; the same spelling in
  // `app.ts` leaked a built executable per run until /tmp had 1.4GB of them.
  let code = 70;
  try {
    code = await finished;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    responder.stop();
    worker.terminate();
    URL.revokeObjectURL(url);
  }
  Deno.exit(code);
}
