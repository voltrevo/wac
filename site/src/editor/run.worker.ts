// A wac export, run somewhere it can be stopped.
//
// The Run buttons used to call into wasm on the main thread, which is fine until a program does
// not come back: the Collatz example loops forever on 0, and 0 is what an empty box means, so
// clicking Run without typing froze the tab. There is no way to interrupt a running wasm
// function — no timeout, no signal, nothing the host can do from inside the same thread — so the
// only real fix is to run it somewhere terminable. `runIsolated` in `wac-compile.ts` records what
// "terminable" is worth in each runtime; in a browser, which is where this runs, the kill is
// real.
//
// This worker instantiates and calls; the main thread holds a timer and terminates it. The
// caller is `runFunction` in `wac-compile.ts`.
//
// It receives the *compiled* module rather than the source, because the page already compiled it
// for the export list and the diagnostics, and `WacCompiled` is plain data that clones.

import type { WacCompiled } from "../../../compiler/wacCompile.ts";
import { wacInstance, type WacArg, type WacVal } from "../../../compiler/wacInstance.ts";

export type RunRequest = {
  compiled: WacCompiled;
  funcName: string;
  /** Exactly what was typed into each box, in parameter order. */
  argStrings: string[];
};

export type RunReply = { success: boolean; output: string };

/** Array element types a box can be parsed into, and how. */
const ARRAY_ELEM: Record<string, "int" | "big" | "float"> = {
  "u8[]": "int", "i8[]": "int", "u16[]": "int", "i16[]": "int",
  "i32[]": "int", "u32[]": "int", "i64[]": "big", "u64[]": "big",
  "f32[]": "float", "f64[]": "float",
};

/**
 * Whether a box can be parsed into an array of this type.
 *
 * Lives beside `parseArg` because it is the same question — which types this understands — and
 * the panel's placeholder text and its `runnable` check both have to agree with the parser.
 */
export function isArrayType(t: string): boolean {
  return t in ARRAY_ELEM;
}

/** One text box, as the value its parameter wants. */
export function parseArg(text: string, type: string): WacArg {
  const a = text.trim();
  if (type === "string") return a;
  const kind = ARRAY_ELEM[type];
  if (kind !== undefined) {
    // A leading `[` is what people type; accept it rather than making them not.
    const inner = a.replace(/^\[/, "").replace(/\]$/, "");
    return inner.split(",").map((x) => x.trim()).filter(Boolean).map((x) =>
      kind === "big" ? BigInt(x) : kind === "float" ? parseFloat(x) : parseInt(x, 10)
    );
  }
  if (type === "bool") return a === "true";
  if (type === "i64" || type === "u64") return BigInt(a || "0");
  if (type === "f32" || type === "f64") return parseFloat(a || "0");
  return parseInt(a || "0", 10);
}

/** The answer, as the panel shows it. */
export function show(v: WacVal, type: string): string {
  if (type === "void" || v === undefined) return "(void)";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (v === null) return "null";
  return String(v);
}

/**
 * Instantiate and call.
 *
 * Exported so the same path can be exercised without a worker at all — see
 * `tools/site.test.ts`, which needs to know that a failure is the program's and not the
 * plumbing's.
 */
export async function runHere(req: RunRequest): Promise<RunReply> {
  const meta = req.compiled.exports.find((e) => e.name === req.funcName);
  if (!meta) return { success: false, output: `No export named '${req.funcName}'` };

  let inst;
  try {
    inst = await wacInstance(req.compiled);
  } catch (e) {
    return { success: false, output: `Instantiation error: ${(e as Error).message}` };
  }

  try {
    const args = meta.params.map((p, i) => parseArg(req.argStrings[i] ?? "", p.type));
    return { success: true, output: show(inst.call(req.funcName, args), meta.ret) };
  } catch (e) {
    return { success: false, output: `Runtime error: ${(e as Error).message}` };
  }
}

/** The subset of a worker's global scope this uses, so `self` need not be typed as one. */
type WorkerScope = {
  onmessage: ((e: MessageEvent<RunRequest>) => void) | null;
  postMessage: (m: RunReply) => void;
};

/**
 * This scope, if it is a worker's.
 *
 * The module is also imported by the main thread — for `runHere`, `parseArg` and `isArrayType` —
 * and installing an `onmessage` handler there would intercept every `postMessage` the page
 * receives. `WorkerGlobalScope` is defined only inside a worker, in both browsers and Deno, so it
 * is the honest test. Checking `"postMessage" in self` is not: a window has one too.
 */
function workerScope(): WorkerScope | null {
  const g = globalThis as { WorkerGlobalScope?: abstract new () => unknown };
  if (typeof g.WorkerGlobalScope !== "function") return null;
  if (!(globalThis instanceof g.WorkerGlobalScope)) return null;
  return globalThis as unknown as WorkerScope;
}

const scope = workerScope();
if (scope) {
  scope.onmessage = async (e) => scope.postMessage(await runHere(e.data));
}
