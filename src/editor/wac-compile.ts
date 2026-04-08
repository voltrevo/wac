import { wacCompile, type CompileResult, type WacExport } from "../../atoms/wac/wacCompile.ts";
import { wacInstance, type WacVal } from "../../atoms/wac/wacInstance.ts";
import type { FileMap } from "./file-store";

export type EditorCompileResult =
  | { ok: true; wasm: Uint8Array; exports: WacExport[] }
  | { ok: false; errors: string[] };

export function compile(files: FileMap, fileName: string): EditorCompileResult {
  const fileMap = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) fileMap.set(k, v);

  const result: CompileResult = wacCompile(fileMap, fileName);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map(
        (e) => `${e.file}:${e.line}:${e.col} [${e.phase}] ${e.message}`,
      ),
    };
  }
  return { ok: true, wasm: result.compiled.wasm, exports: result.compiled.exports };
}

export function wasmHex(wasm: Uint8Array): string {
  return Array.from(wasm).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runFunction(
  files: FileMap,
  fileName: string,
  funcName: string,
  argStrings: string[],
): Promise<{ success: boolean; output: string }> {
  const fileMap = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) fileMap.set(k, v);

  const result = wacCompile(fileMap, fileName);
  if (!result.ok) {
    return { success: false, output: result.errors.map((e) => e.message).join("\n") };
  }

  const meta = result.compiled.exports.find((e) => e.name === funcName);
  if (!meta) return { success: false, output: `No export named '${funcName}'` };

  let inst;
  try {
    inst = await wacInstance(result.compiled);
  } catch (e) {
    return { success: false, output: `Instantiation error: ${(e as Error).message}` };
  }

  // Parse args
  const args = meta.params.map((p, i) => {
    const a = (argStrings[i] ?? "0").trim();
    if (p.type === "bool") return a === "true";
    if (p.type === "i64") return BigInt(a || "0");
    if (p.type === "f32" || p.type === "f64") return parseFloat(a || "0");
    return parseInt(a || "0", 10);
  });

  let val: WacVal;
  try {
    val = inst.call(funcName, args);
  } catch (e) {
    return { success: false, output: `Runtime error: ${(e as Error).message}` };
  }

  if (val === undefined || val === null) return { success: true, output: "(void)" };
  if (typeof val === "boolean") return { success: true, output: String(val) };
  return { success: true, output: String(val) };
}

export function placeholderFor(type: string): string {
  if (type === "bool") return "true / false";
  if (type === "f32" || type === "f64") return "0.0";
  if (type === "i64") return "0 (bigint)";
  return "0";
}
