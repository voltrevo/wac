import { wacCompile, type CompileResult, type WacExport, type WacCompiled } from "../../atoms/wac/wacCompile.ts";
import { wacInstance, type WacArg, type WacVal } from "../../atoms/wac/wacInstance.ts";
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
// The marshalling is `wacInstance`'s, not this file's. It used to be duplicated here — a second
// copy of the accessor names, `__bind_str_len` against the emitter's `$bind$str_len` — and the
// copy was wrong, so *every* export returning a string or taking an array failed at run time
// with "not a function". The landing page's own hello-world demo was among them. There is one
// table now, in the atom that owns those exports.
//
// What is left here is the part that is genuinely the panel's: turning text typed into a box
// into a value of the parameter's type, and turning the answer back into text.

/** Array element types the panel can build from a comma-separated box. */
const ARRAY_ELEM: Record<string, "int" | "big" | "float"> = {
  "u8[]": "int", "i8[]": "int", "u16[]": "int", "i16[]": "int",
  "i32[]": "int", "u32[]": "int", "i64[]": "big", "u64[]": "big",
  "f32[]": "float", "f64[]": "float",
};

function isArrayType(t: string): boolean {
  return t in ARRAY_ELEM;
}

/** One text box, as the value its parameter wants. */
function parseArg(text: string, type: string): WacArg {
  const a = text.trim();
  if (type === "string") return a;
  if (isArrayType(type)) {
    const kind = ARRAY_ELEM[type];
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
function show(v: WacVal, type: string): string {
  if (type === "void" || v === undefined) return "(void)";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (v === null) return "null";
  return String(v);
}

export async function runFunction(
  files: FileMap,
  fileName: string,
  funcName: string,
  argStrings: string[],
): Promise<{ success: boolean; output: string }> {
  const result = wacCompile(new Map(Object.entries(files)), fileName);
  if (!result.ok) {
    return { success: false, output: result.diagnostics.map((e) => e.message).join("\n") };
  }

  const meta = result.compiled.exports.find((e) => e.name === funcName);
  if (!meta) return { success: false, output: `No export named '${funcName}'` };

  let inst;
  try {
    inst = await wacInstance(result.compiled);
  } catch (e) {
    return { success: false, output: `Instantiation error: ${(e as Error).message}` };
  }

  try {
    const args = meta.params.map((p, i) => parseArg(argStrings[i] ?? "", p.type));
    return { success: true, output: show(inst.call(funcName, args), meta.ret) };
  } catch (e) {
    return { success: false, output: `Runtime error: ${(e as Error).message}` };
  }
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
