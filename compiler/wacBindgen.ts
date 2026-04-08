// wacBindgen — generates a self-contained TypeScript file from a compiled wac module.
//
// The generated file embeds the wasm binary as base64 and provides typed wrapper
// functions for each exported function.
//
// Type mapping:
//   i32, f32, f64, bool → number
//   i64                 → bigint
//   string              → string   (copied in/out via wasm helper exports)
//   i8[]                → Uint8Array
//   i16[]               → Int16Array
//   i32[]               → Int32Array
//   i64[]               → BigInt64Array
//   f32[]               → Float32Array
//   f64[]               → Float64Array
//
// Unsupported types (struct, nullable, funcref, nested arrays) cause the function
// to be omitted with a comment.

import type { WacCompiled, WacExport } from "./wacCompile.ts";

// ── Type mapping ──────────────────────────────────────────────────────────────

const PRIM_MAP: Record<string, string> = {
  i32: "number", i8: "number", i16: "number",
  f32: "number", f64: "number",
  bool: "boolean",
  i64: "bigint",
  void: "void",
  string: "string",
};

const ARRAY_MAP: Record<string, string> = {
  "i8[]":  "Uint8Array",
  "i16[]": "Int16Array",
  "i32[]": "Int32Array",
  "i64[]": "BigInt64Array",
  "f32[]": "Float32Array",
  "f64[]": "Float64Array",
};

const ARRAY_ELEM_PREFIX: Record<string, string> = {
  "i8[]":  "__bind_arr_i8",
  "i16[]": "__bind_arr_i16",
  "i32[]": "__bind_arr_i32",
  "i64[]": "__bind_arr_i64",
  "f32[]": "__bind_arr_f32",
  "f64[]": "__bind_arr_f64",
};

function tsType(wacType: string): string | null {
  if (PRIM_MAP[wacType]) return PRIM_MAP[wacType];
  if (ARRAY_MAP[wacType]) return ARRAY_MAP[wacType];
  return null; // unsupported
}

function isSupported(wacType: string): boolean {
  return tsType(wacType) !== null;
}

// ── Array helpers ─────────────────────────────────────────────────────────────

function arrayToWasmHelper(elemType: string, jsType: string): string {
  const prefix = ARRAY_ELEM_PREFIX[elemType];
  const isBigInt = elemType === "i64[]";
  const convert = isBigInt ? "" : "";
  void convert;
  return `function _arrayToWasm_${elemType.replace("[]", "")}(js: ${jsType}): unknown {
  const n = js.length;
  const wa = (_exports.${prefix}_new as CallableFunction)(n);
  for (let i = 0; i < n; i++) {
    (_exports.${prefix}_set as CallableFunction)(wa, i, js[i]);
  }
  return wa;
}`;
}

function arrayFromWasmHelper(elemType: string, jsType: string): string {
  const prefix = ARRAY_ELEM_PREFIX[elemType];
  const isBigInt = elemType === "i64[]";
  const elemCast = isBigInt ? " as bigint" : " as number";
  const elemBase = elemType.replace("[]", "");
  return `function _arrayFromWasm_${elemBase}(wa: unknown): ${jsType} {
  const n = (_exports.${prefix}_len as CallableFunction)(wa) as number;
  const js = new ${jsType}(n);
  for (let i = 0; i < n; i++) {
    js[i] = (_exports.${prefix}_get as CallableFunction)(wa, i)${elemCast};
  }
  return js;
}`;
}

// ── String helpers ────────────────────────────────────────────────────────────

const STRING_TO_WASM = `function _stringToWasm(s: string): unknown {
  const bytes = new TextEncoder().encode(s);
  const wa = (_exports.__bind_str_new as CallableFunction)(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    (_exports.__bind_str_set as CallableFunction)(wa, i, bytes[i]);
  }
  return wa;
}`;

const STRING_FROM_WASM = `function _stringFromWasm(wa: unknown): string {
  const n = (_exports.__bind_str_len as CallableFunction)(wa) as number;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    bytes[i] = (_exports.__bind_str_get as CallableFunction)(wa, i) as number;
  }
  return new TextDecoder().decode(bytes);
}`;

// ── Function wrapper generation ───────────────────────────────────────────────

type WrapperResult =
  | { skip: false; code: string }
  | { skip: true; reason: string };

function genWrapper(exp: WacExport): WrapperResult {
  // Check all types are supported
  for (const p of exp.params) {
    if (!isSupported(p.type)) {
      return { skip: true, reason: `${exp.name}() — parameter '${p.name}: ${p.type}' not yet supported in bindgen` };
    }
  }
  if (exp.ret !== "void" && !isSupported(exp.ret)) {
    return { skip: true, reason: `${exp.name}() — return type '${exp.ret}' not yet supported in bindgen` };
  }

  // JS wrapper name uses camelCase; wasm export name stays as-is
  const jsName = toCamelCase(exp.name);

  // Build TypeScript parameter list
  const tsParams = exp.params.map(p => `${p.name}: ${tsType(p.type)!}`).join(", ");
  const tsRet = tsType(exp.ret) ?? "void";

  // Build the body
  const lines: string[] = [];

  // Convert array/string params to wasm form
  const wasmArgs: string[] = [];
  for (const p of exp.params) {
    if (p.type === "string") {
      lines.push(`  const _w_${p.name} = _stringToWasm(${p.name});`);
      wasmArgs.push(`_w_${p.name}`);
    } else if (ARRAY_MAP[p.type]) {
      const elemBase = p.type.replace("[]", "");
      lines.push(`  const _w_${p.name} = _arrayToWasm_${elemBase}(${p.name});`);
      wasmArgs.push(`_w_${p.name}`);
    } else {
      wasmArgs.push(p.name);
    }
  }

  const callExpr = `(_exports.${exp.name} as CallableFunction)(${wasmArgs.join(", ")})`;

  if (exp.ret === "void") {
    lines.push(`  ${callExpr};`);
  } else if (exp.ret === "string") {
    lines.push(`  const _result = ${callExpr};`);
    lines.push(`  return _stringFromWasm(_result);`);
  } else if (ARRAY_MAP[exp.ret]) {
    const elemBase = exp.ret.replace("[]", "");
    lines.push(`  const _result = ${callExpr};`);
    lines.push(`  return _arrayFromWasm_${elemBase}(_result);`);
  } else if (exp.ret === "i64") {
    lines.push(`  return ${callExpr} as bigint;`);
  } else if (exp.ret === "bool") {
    lines.push(`  return Boolean(${callExpr});`);
  } else {
    lines.push(`  return ${callExpr} as number;`);
  }

  // Void-returning array functions: also return the mutated array copy
  const hasArrayParam = exp.params.some(p => ARRAY_MAP[p.type]);
  if (exp.ret === "void" && hasArrayParam) {
    // Return the first mutated array
    const firstArrParam = exp.params.find(p => ARRAY_MAP[p.type])!;
    const elemBase = firstArrParam.type.replace("[]", "");
    lines[lines.length - 1] = `  ${callExpr};`; // no return
    lines.push(`  return _arrayFromWasm_${elemBase}(_w_${firstArrParam.name});`);
    // Override return type
    const jsArrType = ARRAY_MAP[firstArrParam.type];
    return {
      skip: false,
      code: `export function ${jsName}(${tsParams}): ${jsArrType} {\n${lines.join("\n")}\n}`,
    };
  }

  return {
    skip: false,
    code: `export function ${jsName}(${tsParams}): ${tsRet} {\n${lines.join("\n")}\n}`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/** Convert a snake_case or kebab-case name to camelCase. */
function toCamelCase(name: string): string {
  return name.replace(/[_-]([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Generate a self-contained TypeScript file that wraps a compiled wac module.
 */
export function wacBindgen(compiled: WacCompiled): string {
  const base64 = btoa(String.fromCharCode(...compiled.wasm));

  // Determine which helpers are needed
  const allTypes = compiled.exports.flatMap(e => [
    ...e.params.map(p => p.type),
    e.ret,
  ]);
  const needsString = allTypes.some(t => t === "string");
  const usedArrayTypes = new Set(allTypes.filter(t => ARRAY_MAP[t]));

  const parts: string[] = [];

  // Header: wasm binary
  parts.push(
    `const _wasm = Uint8Array.from(\n  atob("${base64}"),\n  (c) => c.charCodeAt(0),\n);`,
  );
  parts.push(
    `const _instance = await WebAssembly.instantiate(_wasm);\nconst _exports = _instance.instance.exports;`,
  );

  // String helpers
  if (needsString) {
    parts.push(STRING_TO_WASM);
    parts.push(STRING_FROM_WASM);
  }

  // Array helpers
  for (const arrType of usedArrayTypes) {
    const jsType = ARRAY_MAP[arrType];
    parts.push(arrayToWasmHelper(arrType, jsType));
    parts.push(arrayFromWasmHelper(arrType, jsType));
  }

  // Function wrappers
  for (const exp of compiled.exports) {
    const result = genWrapper(exp);
    if (result.skip) {
      parts.push(`// skipped: ${result.reason}`);
    } else {
      parts.push(result.code);
    }
  }

  return parts.join("\n\n") + "\n";
}
