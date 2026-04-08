import { wacCompile, type CompileResult, type WacExport, type WacCompiled } from "../../atoms/wac/wacCompile.ts";
import { wacInstance } from "../../atoms/wac/wacInstance.ts";
import { wacBindgen } from "../../atoms/wac/wacBindgen.ts";
import type { FileMap } from "./file-store";

export type EditorCompileResult =
  | { ok: true; wasm: Uint8Array; exports: WacExport[]; compiled: WacCompiled }
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
  return { ok: true, wasm: result.compiled.wasm, exports: result.compiled.exports, compiled: result.compiled };
}

export function wasmHex(wasm: Uint8Array): string {
  return Array.from(wasm).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateBindgen(compiled: WacCompiled): string {
  return wacBindgen(compiled);
}

// Array type helpers
const ARRAY_BIND_PREFIX: Record<string, string> = {
  "i8[]": "__bind_arr_i8",
  "i16[]": "__bind_arr_i16",
  "i32[]": "__bind_arr_i32",
  "i64[]": "__bind_arr_i64",
  "f32[]": "__bind_arr_f32",
  "f64[]": "__bind_arr_f64",
};

function isArrayType(t: string): boolean {
  return t in ARRAY_BIND_PREFIX;
}

function parseArrayArg(s: string, elemType: string): number[] | bigint[] {
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (elemType === "i64[]") return parts.map((x) => BigInt(x || "0"));
  if (elemType === "f32[]" || elemType === "f64[]") return parts.map((x) => parseFloat(x || "0"));
  return parts.map((x) => parseInt(x || "0", 10));
}

function formatArrayResult(vals: (number | bigint)[]): string {
  return `[${vals.join(", ")}]`;
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

  const raw = inst.rawExports;
  const needsRaw = meta.params.some((p) => isArrayType(p.type) || p.type === "string")
    || isArrayType(meta.ret) || meta.ret === "string";

  // If no complex types involved, use the typed call() helper
  if (!needsRaw) {
    const args = meta.params.map((p, i) => {
      const a = (argStrings[i] ?? "0").trim();
      if (p.type === "bool") return a === "true";
      if (p.type === "i64") return BigInt(a || "0");
      if (p.type === "f32" || p.type === "f64") return parseFloat(a || "0");
      return parseInt(a || "0", 10);
    });

    try {
      const val = inst.call(funcName, args);
      if (val === undefined || val === null) return { success: true, output: "(void)" };
      if (typeof val === "boolean") return { success: true, output: String(val) };
      return { success: true, output: String(val) };
    } catch (e) {
      return { success: false, output: `Runtime error: ${(e as Error).message}` };
    }
  }

  // Array path: use rawExports directly
  try {
    const wasmArgs: unknown[] = [];
    for (let i = 0; i < meta.params.length; i++) {
      const p = meta.params[i];
      const a = (argStrings[i] ?? "").trim();

      if (p.type === "string") {
        const bytes = new TextEncoder().encode(a);
        const strNew = raw["__bind_str_new"] as (n: number) => unknown;
        const strSet = raw["__bind_str_set"] as (wa: unknown, i: number, v: number) => void;
        const wa = strNew(bytes.length);
        for (let j = 0; j < bytes.length; j++) strSet(wa, j, bytes[j]);
        wasmArgs.push(wa);
      } else if (isArrayType(p.type)) {
        const prefix = ARRAY_BIND_PREFIX[p.type];
        const newFn = raw[`${prefix}_new`] as (n: number) => unknown;
        const setFn = raw[`${prefix}_set`] as (wa: unknown, i: number, v: unknown) => void;
        const vals = parseArrayArg(a, p.type);
        const wa = newFn(vals.length);
        for (let j = 0; j < vals.length; j++) setFn(wa, j, vals[j]);
        wasmArgs.push(wa);
      } else if (p.type === "bool") {
        wasmArgs.push(a === "true" ? 1 : 0);
      } else if (p.type === "i64") {
        wasmArgs.push(BigInt(a || "0"));
      } else if (p.type === "f32" || p.type === "f64") {
        wasmArgs.push(parseFloat(a || "0"));
      } else {
        wasmArgs.push(parseInt(a || "0", 10));
      }
    }

    const fn = raw[funcName] as (...args: unknown[]) => unknown;
    const resultVal = fn(...wasmArgs);

    if (meta.ret === "void") return { success: true, output: "(void)" };

    if (meta.ret === "string") {
      const strLen = raw["__bind_str_len"] as (wa: unknown) => number;
      const strGet = raw["__bind_str_get"] as (wa: unknown, i: number) => number;
      const n = strLen(resultVal);
      const bytes = new Uint8Array(n);
      for (let j = 0; j < n; j++) bytes[j] = strGet(resultVal, j);
      return { success: true, output: new TextDecoder().decode(bytes) };
    }

    if (isArrayType(meta.ret)) {
      const prefix = ARRAY_BIND_PREFIX[meta.ret];
      const lenFn = raw[`${prefix}_len`] as (wa: unknown) => number;
      const getFn = raw[`${prefix}_get`] as (wa: unknown, i: number) => number | bigint;
      const n = lenFn(resultVal);
      const vals: (number | bigint)[] = [];
      for (let j = 0; j < n; j++) vals.push(getFn(resultVal, j));
      return { success: true, output: formatArrayResult(vals) };
    }

    if (meta.ret === "bool") return { success: true, output: String(resultVal !== 0) };
    return { success: true, output: String(resultVal) };
  } catch (e) {
    return { success: false, output: `Runtime error: ${(e as Error).message}` };
  }
}

export function placeholderFor(type: string): string {
  if (type === "bool") return "true / false";
  if (type === "string") return "text";
  if (type === "f32" || type === "f64") return "0.0";
  if (type === "i64") return "0 (bigint)";
  if (isArrayType(type)) return "1, 2, 3 (comma-separated)";
  return "0";
}
