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
// for the export list and the diagnostics — and what it receives is bytes and two strings, which
// clone without anyone having to check that they do.
//
// **It calls through wacc's own glue rather than a second marshalling layer.** This used the
// reference's `wacInstance`, 275 lines that converted JS values to wac values by reading the
// export metadata. But glue is exactly that layer, wacc emits it, and the editor already generates
// it to show in the Bindgen tab — so there were two implementations of one thing, and the one that
// ran was not the one on screen. Generating the module and importing it as a blob is what
// `Bootstrap.tsx` does to swap compiler stages, and it is a dozen lines.

import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../../../packages/wacc/tools/waccBindgen.ts";
import type { WacArg, WacVal } from "./wac-types.ts";

export type RunRequest = {
  wasm: Uint8Array;
  /** wacc's `bindTypes` description of the boundary — the `S`/`E`/`M`/`C`/`A` lines. */
  wire: string;
  /** wacc's `exportSigs` — `name\tret\tparams` per exported function. */
  sigs: string;
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

/**
 * The answer, as the panel shows it.
 *
 * **A typed array is an array here.** The reference's runner handed back a plain `Array`; wacc's
 * glue hands back the typed array the element type calls for — an `Int32Array` for `i32[]` — which
 * is the better answer and is not what `Array.isArray` reports. Missing that showed `i32[] double`
 * as `2,4,6` instead of `[2, 4, 6]`: still the right numbers, formatted as if it were a scalar.
 */
export function show(v: WacVal, type: string): string {
  if (type === "void" || v === undefined) return "(void)";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return `[${Array.from(v as unknown as ArrayLike<number | bigint>).join(", ")}]`;
  }
  if (v === null) return "null";
  return String(v);
}

/**
 * Instantiate and call.
 *
 * Exported so the same path can be exercised without a worker at all — see
 * `site/tools/site.test.ts`, which needs to know that a failure is the program's and not the
 * plumbing's.
 */
export async function runHere(req: RunRequest): Promise<RunReply> {
  const meta = parseSigs(req.sigs).find((e) => e.name === req.funcName);
  if (!meta) return { success: false, output: `No export named '${req.funcName}'` };

  // `lang: "js"`, because this is imported rather than read: a blob of TypeScript is not a module
  // any host can load. The Bindgen tab asks the same generator for `ts`, which is the difference
  // between glue to look at and glue to run.
  const js = generate(
    req.wasm,
    parseSigs(req.sigs),
    parseBindTypes(req.wire),
    parseCallbacks(req.wire),
    parseOutRefs(req.wire),
    parseAliases(req.wire),
    { lang: "js" },
  );

  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  let mod: Record<string, (...a: WacArg[]) => WacVal>;
  try {
    mod = await import(/* @vite-ignore */ url);
  } catch (e) {
    return { success: false, output: `Instantiation error: ${(e as Error).message}` };
  } finally {
    URL.revokeObjectURL(url);
  }

  const fn = mod[req.funcName];
  if (typeof fn !== "function") {
    return { success: false, output: `'${req.funcName}' is not callable through the generated glue` };
  }

  try {
    const args = meta.params.map((type, i) => parseArg(req.argStrings[i] ?? "", type));
    return { success: true, output: show(fn(...args), meta.ret) };
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
