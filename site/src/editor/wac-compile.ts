import {
  compileWithWacc,
  parseDiagnostics,
  type WaccDiagnostic,
  type WaccModule,
} from "./wacc-compile";
import { isArrayType, runHere, type RunReply, type RunRequest } from "./run.worker.ts";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../../../packages/wacc/tools/waccBindgen.ts";
import type { WacCompiled, WacExport } from "./wac-types.ts";
import type { FileMap } from "./file-store";

export type EditorCompileResult =
  | { ok: true; wasm: Uint8Array; exports: WacExport[]; compiled: WacCompiled; wire: string; sigs: string }
  | { ok: false; errors: string[] };

// ── Which compiler ───────────────────────────────────────────────────────────
//
// **wacc, once it has loaded; the reference until then.** `public/wacc-api.js` is wacc with its API
// bound — 389K, written by `site/tools/syncWacc.ts` — and fetching it is asynchronous while `compile`
// is called synchronously inside a `useMemo`. So the import starts when this module does, and the
// page uses whichever compiler it has: the reference is already bundled here for `Bootstrap.tsx`,
// which is the bootstrap and the one thing it is still for.
//
// A reader who types faster than the network gets the seed's answer for a moment and wacc's
// afterwards — the same program, and only a wacc-only feature reads differently, which is the case
// this exists to fix. `useWacc()` is what makes the second render happen.
// `issues/lang/0105`.

let wacc: WaccModule | null = null;
const listeners = new Set<() => void>();

/** Kicked off at module load, and deliberately not awaited by anything on the render path. */
export const waccReady: Promise<void> = (async () => {
  try {
    // The URL is a deploy-root path, like the demos': a page served from a sub-path still finds it.
    wacc = await import(/* @vite-ignore */ `${import.meta.env?.BASE_URL ?? "/"}wacc-api.js`) as WaccModule;
    for (const f of listeners) f();
  } catch {
    // Left null: the reference keeps answering, which is what happens today.
  }
})();

/** Subscribe to the moment wacc arrives; returns an unsubscribe. */
export function onWaccReady(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Whether the compiler answering right now is wacc. */
export function waccLoaded(): boolean {
  return wacc !== null;
}

/**
 * Whether wacc can compile this program at all.
 *
 * **wapy used to be the exception and is not any more.** `.wapy` is a second surface — indentation
 * where wac has braces — and until 2026-08-27 wacc had no reader for it, so a wapy entry, or a wac
 * entry importing one, went to the reference: not because the reference was the fallback but because
 * it was the only implementation of that language. The playground ships two wapy examples and
 * swapping everything to wacc turned them into `unexpected character`, which is what driving the
 * built page in a browser is for (`issues/lang/0105`).
 *
 * `packages/wacc/src/frontend.wac` dispatches on the extension now, and a wapy file compiles to the
 * same module its wac twin does — `issues/lang/0279a`, and
 * `packages/wacc/test/wac/wapylink_test.wac` is the byte comparison. So there is nothing left for
 * this to exclude.
 */
function waccCanCompile(files: FileMap, fileName: string): boolean {
  return fileName.endsWith(".wac") || fileName.endsWith(".wapy");
}

/**
 * The files wacc is handed: the ones it has a frontend for.
 *
 * **Both surfaces, since 2026-08-27.** This used to drop `.wapy`, because `diagnoseFiles` lexes
 * *every* file it is given rather than only the ones the entry imports — so an unrelated wapy
 * example sitting in the workspace made a perfectly good wac program report `unexpected character`
 * at somebody else's line 1. Found by driving the built page, where the playground's default set has
 * two. wacc reads them now, so dropping them would hide the examples from the compiler that is
 * supposed to build them.
 */
function waccFiles(files: FileMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    if (k.endsWith(".wac") || k.endsWith(".wapy")) out[k] = v;
  }
  return out;
}

/**
 * What the gutter underlines: wacc's diagnostics for the file being edited.
 *
 * **Separate from `compile` because it answers a different question.** `compile` wants a module or
 * a reason there is none; the linter wants every complaint, positioned. It also has to say nothing
 * rather than something wrong when there is no compiler yet — an empty gutter while `wacc-api.js`
 * is still arriving is right, and a red line from a compiler the page is not going to use is what
 * this replaced. `issues/lang/0105` is that mistake in the Run button; this was the same mistake in
 * the margin.
 */
export function diagnose(files: FileMap, fileName: string): WaccDiagnostic[] {
  if (wacc === null || !waccCanCompile(files, fileName)) return [];
  const only = waccFiles(files);
  const paths = Object.keys(only);
  return parseDiagnostics(wacc.diagnoseFiles(paths, paths.map((p) => only[p]), fileName));
}

export function compile(files: FileMap, fileName: string): EditorCompileResult {
  // **One compiler, and it says so when it cannot answer.** Both of these used to fall through to
  // the TypeScript reference, so the page could compile with something other than what it claims
  // to compile with — and did, in a published deploy, for as long as the wacc asset was missing
  // and nothing said so. `issues/system/0146`.
  if (wacc === null) {
    return { ok: false, errors: ["the compiler has not loaded yet — wacc-api.js did not arrive"] };
  }
  if (!waccCanCompile(files, fileName)) {
    return { ok: false, errors: [`${fileName}: not a wac or wapy file`] };
  }

  const r = compileWithWacc(wacc, waccFiles(files), fileName);
  if (!r.ok) {
    return { ok: false, errors: r.diagnostics.map((d) => `${d.file}:${d.line}:${d.col} ${d.message}`) };
  }
  return {
    ok: true,
    wasm: r.compiled.wasm,
    exports: r.compiled.exports,
    compiled: r.compiled,
    wire: r.wire,
    sigs: r.sigs,
  };
}

export function wasmHex(wasm: Uint8Array): string {
  return Array.from(wasm).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The glue for what was just compiled, from **wacc's own description of it** rather than from
 * `compiled`. It used to be the reference's `wacBindgen(compiled)`, which read five fields that
 * `wacc-compile.ts` leaves empty because nothing else reads them — so this tab showed glue with no
 * struct, enum or array helpers whenever wacc was the compiler, which is always.
 */
export function generateBindgen(r: Extract<EditorCompileResult, { ok: true }>): string {
  return generate(
    r.wasm,
    parseSigs(r.sigs),
    parseBindTypes(r.wire),
    parseCallbacks(r.wire),
    parseOutRefs(r.wire),
    parseAliases(r.wire),
  );
}

// ── Calling an export ────────────────────────────────────────────────────────
//
// Off the main thread, with a deadline. wasm cannot be interrupted once it is running — there is
// no timeout and no signal a host can raise from inside the same thread — so a program that does
// not terminate can only be dealt with by running it somewhere that can be thrown away. The
// worker is that somewhere; this holds the timer and terminates it.
//
// The marshalling itself is `wacInstance`'s, in the worker. It used to be duplicated here — a
// second copy of the accessor names, `__bind_str_len` against the emitter's `$bind$str_len` — and
// the copy was wrong, so *every* export returning a string or taking an array failed at run time
// with "not a function". The landing page's own hello-world demo was among them.

/** How long a Run may take before the worker running it is killed. */
export const RUN_TIMEOUT_MS = 5000;

export async function runFunction(
  files: FileMap,
  fileName: string,
  funcName: string,
  argStrings: string[],
  timeoutMs: number = RUN_TIMEOUT_MS,
): Promise<{ success: boolean; output: string }> {
  // **The same compiler the editor checked with.** This called `wacCompile` directly while
  // `compile` above prefers wacc, so the playground checked a snippet with one compiler and ran it
  // with the other: anything using a wacc-only feature — JSX, a component, the bit methods, an
  // omitted nullable field — compiled in the gutter and then failed to run, with a diagnostic from
  // a compiler the reader never asked for. `issues/lang/0105`, and the same shape as `0110`.
  const checked = compile(files, fileName);
  if (!checked.ok) return { success: false, output: checked.errors.join("\n") };
  const req: RunRequest = {
    wasm: checked.wasm,
    wire: checked.wire,
    sigs: checked.sigs,
    funcName,
    argStrings,
  };
  return await runIsolated(req, timeoutMs);
}

/**
 * Run `req` in a worker, killing it if it outstays `timeoutMs`.
 *
 * A worker per run, terminated either way. Reusing one would save the module load, and would
 * mean holding a live worker for the lifetime of the page and reasoning about what a timed-out
 * run left behind in it. The load is a cached chunk after the first Run — measured at 25ms cold
 * and 8ms warm.
 *
 * **What `terminate()` actually does, measured rather than assumed.** A wasm loop has no
 * interrupt point, so stopping a worker inside one is entirely up to the host, and the hosts
 * disagree:
 *
 * | runtime | a worker spinning in wasm, after `terminate()` |
 * | --- | --- |
 * | Chromium | killed — CPU stops at the call; the same page without the call keeps climbing |
 * | Node 22 `worker_threads` | killed — resolves in 2ms, no CPU after, process exits |
 * | Deno 2.9.1 | **not killed** — a full core keeps burning and the process never exits |
 *
 * Deno is the outlier, on the same V8 as Node, and it is a **known regression with a fix in
 * flight** — denoland/deno#35657 — rather than a design difference. So the one place it matters
 * here is temporary: `site/tools/site.test.ts` checks the deadline in a subprocess it can SIGKILL,
 * because otherwise `deno test` would never exit from the very test that proves the deadline
 * works. When that PR lands, the subprocess can go and the test can call `runIsolated` directly.
 *
 * The page runs in a browser, where the kill is real. What holds in all three is the part the
 * panel depends on: the promise resolves on time and the thread you are reading this on stays
 * responsive.
 *
 * If a worker cannot be started at all, the call is run in place. That is the honest fallback:
 * the answer is still right, and the only thing lost is the ability to stop it — better than a
 * Run button that reports a plumbing failure for a program that works.
 */
async function runIsolated(req: RunRequest, timeoutMs: number): Promise<RunReply> {
  const runner = createRunner();
  try {
    return await runner.run(req, timeoutMs);
  } finally {
    runner.dispose();
  }
}

/**
 * A worker held across several runs, for a caller making many of them.
 *
 * The page does not need this — one Run per click, and a fresh worker each time is 25ms nobody
 * notices. A test sweeping every export in every example does: each `new Worker` costs a fresh
 * type-check of the worker module under Deno, which took a bulk sweep from milliseconds to a
 * minute.
 *
 * A run that overstays its deadline takes the worker with it: it is still spinning, so it cannot
 * be handed the next request, and `run` builds a new one.
 */
export function createRunner(): {
  run(req: RunRequest, timeoutMs?: number): Promise<RunReply>;
  dispose(): void;
} {
  let worker: Worker | null = null;

  return {
    async run(req, timeoutMs = RUN_TIMEOUT_MS) {
      if (worker === null) {
        try {
          worker = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
        } catch {
          return await runHere(req);            // no workers here; the answer is still right
        }
      }
      const w = worker;
      const reply = await exchange(w, req, timeoutMs);
      if (reply.timedOut) {
        w.terminate();
        worker = null;
      }
      return reply.value;
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}

/** One request/response over `worker`, or the deadline, whichever comes first. */
function exchange(
  worker: Worker, req: RunRequest, timeoutMs: number,
): Promise<{ value: RunReply; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RunReply, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      resolve({ value, timedOut });
    };
    const timer = setTimeout(() => finish({
      success: false,
      output: `Stopped after ${timeoutMs / 1000}s. It was still running, so it was killed — ` +
        `check for a loop that never reaches its condition.`,
    }, true), timeoutMs);

    worker.onmessage = (e: MessageEvent<RunReply>) => finish(e.data);
    worker.onerror = (e: ErrorEvent) => finish({
      success: false,
      output: `Worker error: ${e.message || "the worker failed to start"}`,
    }, true);
    worker.postMessage(req);
  });
}

/**
 * Whether this export can be called from the panel, and why not if it cannot.
 *
 * The runner marshals primitives, strings and primitive arrays. A `fn[…]` parameter is a wasm
 * funcref, and there is nothing sensible to type into a text box for one — the playground would
 * have to let you write a JavaScript function, which is what bindgen is for. Before this, such an
 * export got a Run button that could only ever answer "type incompatibility when transforming
 * from/to JS", which reads as a compiler fault rather than a missing feature here.
 */
export function runnable(func: { params: { type: string }[]; ret: string }): string | null {
  const unsupported = (t: string) =>
    t.startsWith("fn[") || (!PRIMITIVES.has(t) && t !== "string" && !isArrayType(t));
  const bad = func.params.find((p) => unsupported(p.type));
  if (bad !== undefined) {
    return bad.type.startsWith("fn[")
      ? "takes a function — pass one from JavaScript through bindgen"
      : `takes a ${bad.type}, which this panel cannot build`;
  }
  if (unsupported(func.ret) && func.ret !== "void") {
    return `returns a ${func.ret}, which this panel cannot show`;
  }
  return null;
}

const PRIMITIVES = new Set(["i32", "i64", "f32", "f64", "bool", "void"]);

export function placeholderFor(type: string): string {
  if (type === "bool") return "true / false";
  if (type === "string") return "text";
  if (type === "f32" || type === "f64") return "0.0";
  if (type === "i64") return "0 (bigint)";
  if (isArrayType(type)) return "1, 2, 3 (comma-separated)";
  return "0";
}
