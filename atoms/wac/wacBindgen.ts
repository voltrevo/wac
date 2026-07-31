// wacBindgen — generates a self-contained TypeScript file from a compiled wac module.
//
// The generated file embeds the wasm binary as base64 and provides typed wrapper
// functions for each exported function.
//
// Type mapping:
//   i32, f32, f64, bool → number
//   i64                 → bigint
//   string              → string   (copied in/out via wasm helper exports)
//   u8[]                → Uint8Array      i8[]  → Int8Array
//   u16[]               → Uint16Array     i16[] → Int16Array
//   i32[]               → Int32Array      u32[] → Uint32Array
//   u64[]               → BigUint64Array
//   i64[]               → BigInt64Array
//   f32[]               → Float32Array
//   f64[]               → Float64Array
//
// Unsupported types (struct, nullable, funcref, nested arrays) cause the function
// to be omitted with a comment.

import type { WacCompiled, WacExport } from "./wacCompile.ts";

// ── Type mapping ──────────────────────────────────────────────────────────────

const PRIM_MAP: Record<string, string> = {
  i32: "number", i8: "number", i16: "number", u32: "number",
  f32: "number", f64: "number",
  bool: "boolean",
  i64: "bigint", u64: "bigint",
  void: "void",
  string: "string",
};

const ARRAY_MAP: Record<string, string> = {
  // i8/i16 sign-extend on read and u8/u16 zero-extend, so each maps to the
  // typed array with matching semantics. Byte data is u8[] -> Uint8Array.
  "u8[]":  "Uint8Array",
  "i8[]":  "Int8Array",
  "u16[]": "Uint16Array",
  "i16[]": "Int16Array",
  "i32[]": "Int32Array",
  "u32[]": "Uint32Array",
  "i64[]": "BigInt64Array",
  "u64[]": "BigUint64Array",
  "f32[]": "Float32Array",
  "f64[]": "Float64Array",
};

const ARRAY_ELEM_WIDTH: Record<string, number> = {
  "u8[]": 1, "i8[]": 1, "u16[]": 2, "i16[]": 2,
  "i32[]": 4, "u32[]": 4, "i64[]": 8, "u64[]": 8, "f32[]": 4, "f64[]": 8,
};

const ARRAY_ELEM_PREFIX: Record<string, string> = {
  "u8[]":  "__bind_arr_u8",
  "i8[]":  "__bind_arr_i8",
  "u16[]": "__bind_arr_u16",
  "i16[]": "__bind_arr_i16",
  "i32[]": "__bind_arr_i32",
  "u32[]": "__bind_arr_u32",
  "i64[]": "__bind_arr_i64",
  "u64[]": "__bind_arr_u64",
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
  const isBigInt = elemType === "i64[]" || elemType === "u64[]";
  const convert = isBigInt ? "" : "";
  void convert;
  const width = ARRAY_ELEM_WIDTH[elemType];
  return `function _arrayToWasm_${elemType.replace("[]", "")}(js: ${jsType}): unknown {
  const n = js.length;
  // One bulk write into the staging buffer, then one call to copy it into a GC
  // array wasm-side. The old per-element loop cost n calls across the boundary.
  _memEnsure(n * ${width});
  new ${jsType}(_memBuffer(), 0, n).set(js);
  return (_exports.${prefix}_from_mem as CallableFunction)(n);
}`;
}

function arrayFromWasmHelper(elemType: string, jsType: string): string {
  const prefix = ARRAY_ELEM_PREFIX[elemType];
  const isBigInt = elemType === "i64[]" || elemType === "u64[]";
  const elemCast = isBigInt ? " as bigint" : " as number";
  const elemBase = elemType.replace("[]", "");
  void elemCast;
  const width = ARRAY_ELEM_WIDTH[elemType];
  return `function _arrayFromWasm_${elemBase}(wa: unknown): ${jsType} {
  const n = (_exports.${prefix}_len as CallableFunction)(wa) as number;
  _memEnsure(n * ${width});
  (_exports.${prefix}_to_mem as CallableFunction)(wa);
  // slice() rather than a view: the caller keeps this, and the next transfer
  // overwrites the buffer.
  return new ${jsType}(_memBuffer(), 0, n).slice();
}`;
}

// ── String helpers ────────────────────────────────────────────────────────────

// Staging-buffer access. Growing the memory detaches the old ArrayBuffer, so
// `_memBuffer()` is re-read after every `_memEnsure` rather than cached.
const MEM_ACCESS = `const _mem = _exports.__bind_mem as WebAssembly.Memory;

function _memEnsure(bytes: number): void {
  const have = (_exports.__bind_mem_ensure as CallableFunction)(bytes) as number;
  if (have < bytes) {
    throw new Error(\`wac: could not grow the transfer buffer to \${bytes} bytes\`);
  }
}

function _memBuffer(): ArrayBuffer {
  return _mem.buffer as ArrayBuffer;
}`;

const STRING_TO_WASM = `function _stringToWasm(s: string): unknown {
  const bytes = new TextEncoder().encode(s);
  _memEnsure(bytes.length);
  new Uint8Array(_memBuffer(), 0, bytes.length).set(bytes);
  return (_exports.__bind_str_from_mem as CallableFunction)(bytes.length);
}`;

const STRING_FROM_WASM = `function _stringFromWasm(wa: unknown): string {
  const n = (_exports.__bind_str_len as CallableFunction)(wa) as number;
  _memEnsure(n);
  (_exports.__bind_str_to_mem as CallableFunction)(wa);
  return new TextDecoder().decode(new Uint8Array(_memBuffer(), 0, n));
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

  // JS wrapper name matches the wac export name verbatim (no renaming)
  const jsName = exp.name;

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
  } else if (exp.ret === "i64" || exp.ret === "u64") {
    lines.push(`  return ${callExpr} as bigint;`);
  } else if (exp.ret === "bool") {
    lines.push(`  return Boolean(${callExpr});`);
  } else {
    lines.push(`  return ${callExpr} as number;`);
  }

  // Arrays are strictly copy-in [§wac-bind-arr-copy-j4wk7pm]: a void function
  // stays void — mutations to the wasm-side copy are discarded, never
  // mirrored back to the caller's typed array.
  return {
    skip: false,
    code: `export function ${jsName}(${tsParams}): ${tsRet} {\n${lines.join("\n")}\n}`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
  // Copy-in helpers for array params, copy-out helpers only for array returns
  const paramArrayTypes = new Set(
    compiled.exports.flatMap(e => e.params.map(p => p.type)).filter(t => ARRAY_MAP[t]));
  const retArrayTypes = new Set(
    compiled.exports.map(e => e.ret).filter(t => ARRAY_MAP[t]));

  const parts: string[] = [];

  // Header: wasm binary
  parts.push(
    `const _wasm = Uint8Array.from(\n  atob("${base64}"),\n  (c) => c.charCodeAt(0),\n);`,
  );
  parts.push(
    `const _instance = await WebAssembly.instantiate(_wasm);\nconst _exports = _instance.instance.exports;`,
  );

  // Staging-buffer access, needed by every bulk path below.
  const needsBulk = needsString || paramArrayTypes.size > 0 || retArrayTypes.size > 0;
  if (needsBulk) parts.push(MEM_ACCESS);

  // String helpers
  if (needsString) {
    parts.push(STRING_TO_WASM);
    parts.push(STRING_FROM_WASM);
  }

  // Array helpers
  for (const arrType of paramArrayTypes) {
    parts.push(arrayToWasmHelper(arrType, ARRAY_MAP[arrType]));
  }
  for (const arrType of retArrayTypes) {
    parts.push(arrayFromWasmHelper(arrType, ARRAY_MAP[arrType]));
  }

  // Function wrappers
  const skipped: string[] = [];
  for (const exp of compiled.exports) {
    const result = genWrapper(exp);
    if (result.skip) {
      parts.push(`// skipped: ${result.reason}`);
      skipped.push(result.reason);
    } else {
      parts.push(result.code);
    }
  }

  // A skipped export is invisible to the caller: `mod.mk` is simply undefined, which
  // reads like a typo rather than a boundary the value cannot cross. The reason was
  // already recorded — as a comment in this file, which nobody reads while wondering
  // where their export went. Naming it as a real export puts it where the person
  // looking will find it, and a module whose every export was skipped stops looking
  // like a module that failed to build.
  if (skipped.length > 0) {
    const list = skipped.map((r) => `  ${JSON.stringify(r)},`).join("\n");
    parts.push(
      `/**
 * Exports that could not be given a JavaScript wrapper, and why.
 *
 * A struct or an enum is not a value JavaScript can hold, so a function taking or
 * returning one has no wrapper here. That is deliberate — inventing a representation
 * would be worse than omitting it — but it is easy to mistake for a build failure, so
 * the list is exported rather than left in a comment.
 */
export const __bindgenSkipped: readonly string[] = [
${list}
];`,
    );
  }

  // Coverage helpers, when the module was built with instrumentation. They are
  // part of an instrumented module's contract, so a wrapper that hid them would
  // make the instrumentation unusable from the generated module.
  if (compiled.coverage !== undefined) {
    parts.push(
      `/** Allocate (or reset) the branch-coverage counters. Call before running instrumented code. */
` +
      `export function __cov_init(): void {
` +
      `  (_exports.__cov_init as CallableFunction)();
}`,
    );
    parts.push(
      `/** Number of instrumented branch points. */
` +
      `export function __cov_len(): number {
` +
      `  return (_exports.__cov_len as CallableFunction)() as number;
}`,
    );
    parts.push(
      `/** Read one branch counter. Traps if __cov_init has not been called. */
` +
      `export function __cov_get(i: number): number {
` +
      `  return (_exports.__cov_get as CallableFunction)(i) as number;
}`,
    );
  }

  return parts.join("\n\n") + "\n";
}
