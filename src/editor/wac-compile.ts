import { wacCompile, type CompileResult, type WacExport, type WacCompiled } from "../../atoms/wac/wacCompile.ts";
import { isArrayType, runHere, type RunReply, type RunRequest } from "./run.worker.ts";
import { wacBindgen } from "../../atoms/wac/wacBindgen.ts";
import { wacDiag } from "../../atoms/wac/wacDiag.ts";
import type { FileMap } from "./file-store";

export type EditorCompileResult =
  | { ok: true; wasm: Uint8Array; exports: WacExport[]; compiled: WacCompiled }
  | { ok: false; errors: string[] };

export function compile(files: FileMap, fileName: string): EditorCompileResult {
  const fileMap = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) fileMap.set(k, v);

  const result: CompileResult = wacCompile(fileMap, fileName);
  if (!result.ok) {
    const sources = new Map<string, string>();
    for (const [k, v] of Object.entries(files)) sources.set(k, v);
    return {
      ok: false,
      errors: [wacDiag(result.diagnostics, sources)],
    };
  }
  return { ok: true, wasm: result.compiled.wasm, exports: result.compiled.exports, compiled: result.compiled };
}

export function wasmHex(wasm: Uint8Array): string {
  return Array.from(wasm).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateBindgen(compiled: WacCompiled): string {
  return wacBindgen(compiled);
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
  const result = wacCompile(new Map(Object.entries(files)), fileName);
  if (!result.ok) {
    return { success: false, output: result.diagnostics.map((e) => e.message).join("\n") };
  }
  const req: RunRequest = { compiled: result.compiled, funcName, argStrings };
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
 * here is temporary: `tools/site.test.ts` checks the deadline in a subprocess it can SIGKILL,
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
