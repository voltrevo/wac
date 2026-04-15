// wacBindTs — generates a self-contained TypeScript file from a compiled wasm module.
//
// The output embeds the wasm binary as base64 and wraps each primitive-typed export
// as a typed function. Exports with unsupported types are omitted with a comment.
// Struct, nullable, and funcref types are not yet supported.

import type { WacCompiled, WacExport } from "./wasmBuildBin.ts";

// TypeScript type for each supported wac primitive.
const PRIM: Record<string, string> = {
  i32:  "number",
  f32:  "number",
  f64:  "number",
  i64:  "bigint",
  bool: "boolean",
  void: "void",
};

// Mapping from wac element type to TypeScript typed array name.
const ARRAY_TS_TYPE: Record<string, string> = {
  i8:  "Uint8Array",
  i16: "Int16Array",
  i32: "Int32Array",
  i64: "BigInt64Array",
  f32: "Float32Array",
  f64: "Float64Array",
};

// ---- Main export ----

export function wacBindTs(compiled: WacCompiled): string {
  const base64 = toBase64(compiled.wasm);

  const lines: string[] = [
    `const _wasm = Uint8Array.from(`,
    `  atob("${base64}"),`,
    `  (c) => c.charCodeAt(0),`,
    `);`,
    ``,
    `const _instance = await WebAssembly.instantiate(_wasm);`,
    `const _exports = _instance.instance.exports;`,
  ];

  for (const exp of compiled.exports) {
    lines.push("");
    const reason = skipReason(exp);
    if (reason) {
      lines.push(`// skipped: ${exp.name}() — ${reason}`);
    } else {
      lines.push(genFunc(exp));
    }
  }

  return lines.join("\n") + "\n";
}

// ---- Code generation ----

function genFunc(exp: WacExport): string {
  const hasArray = exp.params.some(p => isArrayType(p.type)) || isArrayType(exp.ret);
  const hasStr   = exp.params.some(p => p.type === "string") || exp.ret === "string";

  if (hasArray) return genArrayFunc(exp);
  if (hasStr)   return genStringFunc(exp);

  // Primitive-only path.
  const tsName  = camelCase(exp.name);
  const retType = PRIM[exp.ret]!;
  const params  = exp.params.map(p => `${p.name}: ${PRIM[p.type]}`).join(", ");
  const args    = exp.params.map(p => p.name).join(", ");
  const call    = `(_exports.${exp.name} as CallableFunction)(${args})`;
  const body    = buildRetExpr(exp.ret, call);
  return `export function ${tsName}(${params}): ${retType} {\n  ${body}\n}`;
}

function genArrayFunc(exp: WacExport): string {
  const tsName = camelCase(exp.name);
  const lines: string[] = [];

  // Parameter types — arrays use their typed-array name, others use primitive name.
  const paramSigs = exp.params.map(p => `${p.name}: ${tsType(p.type)}`).join(", ");

  // Return type: void wac functions that mutate an array param return that array on JS side.
  const firstArrParam = exp.params.find(p => isArrayType(p.type));
  const retTs =
    exp.ret === "void" && firstArrParam ? tsType(firstArrParam.type) : tsType(exp.ret);

  lines.push(`export function ${tsName}(${paramSigs}): ${retTs} {`);

  // Build call arguments, copying each array param into wasm.
  const callArgs: string[] = [];
  let wasmArrVar = "";
  let wasmArrElem = "";
  for (const p of exp.params) {
    if (isArrayType(p.type)) {
      const elem = p.type.slice(0, -2);
      wasmArrVar  = "wasmArr";
      wasmArrElem = elem;
      lines.push(`  const wasmArr = _arrayToWasm_${elem}(${p.name});`);
      callArgs.push("wasmArr");
    } else {
      callArgs.push(p.name);
    }
  }

  const call = `(_exports.${exp.name} as CallableFunction)(${callArgs.join(", ")})`;

  if (exp.ret === "void") {
    lines.push(`  ${call};`);
    if (wasmArrVar) {
      lines.push(`  return _arrayFromWasm_${wasmArrElem}(${wasmArrVar});`);
    }
  } else if (isArrayType(exp.ret)) {
    const elem = exp.ret.slice(0, -2);
    lines.push(`  return _arrayFromWasm_${elem}(${call});`);
  } else {
    lines.push(`  ${buildRetExpr(exp.ret, call)}`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

function genStringFunc(exp: WacExport): string {
  const tsName = camelCase(exp.name);
  const lines: string[] = [];

  const paramSigs = exp.params.map(p => `${p.name}: ${tsType(p.type)}`).join(", ");
  const retTs = tsType(exp.ret);

  lines.push(`export function ${tsName}(${paramSigs}): ${retTs} {`);

  const callArgs: string[] = [];
  for (const p of exp.params) {
    if (p.type === "string") {
      lines.push(`  const wasmStr = _stringToWasm(${p.name});`);
      callArgs.push("wasmStr");
    } else {
      callArgs.push(p.name);
    }
  }

  const call = `(_exports.${exp.name} as CallableFunction)(${callArgs.join(", ")})`;

  if (exp.ret === "string") {
    lines.push(`  const result = ${call};`);
    lines.push(`  return _stringFromWasm(result);`);
  } else {
    lines.push(`  ${buildRetExpr(exp.ret, call)}`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

// Build the return statement for a given wac return type.
function buildRetExpr(ret: string, call: string): string {
  if (ret === "void")  return `${call};`;
  if (ret === "bool")  return `return Boolean(${call});`;
  if (ret === "i64")   return `return ${call} as bigint;`;
  return `return ${call} as number;`;  // i32 / f32 / f64
}

// ---- Type helpers ----

function isArrayType(t: string): boolean {
  return t.endsWith("[]") && !!ARRAY_TS_TYPE[t.slice(0, -2)];
}

function tsType(t: string): string {
  if (PRIM[t])       return PRIM[t]!;
  if (t === "string") return "string";
  if (isArrayType(t)) return ARRAY_TS_TYPE[t.slice(0, -2)]!;
  return "unknown";
}

// ---- Skip detection ----

// Returns null if the export signature is supported, otherwise a human-readable reason.
function skipReason(exp: WacExport): string | null {
  if (!isSupportedType(exp.ret)) {
    return `${typeKind(exp.ret)} return types not yet supported in bindgen`;
  }
  const badParam = exp.params.find(p => !isSupportedType(p.type));
  if (badParam) {
    return `${typeKind(badParam.type)} param types not yet supported in bindgen`;
  }
  return null;
}

function isSupportedType(t: string): boolean {
  return !!PRIM[t] || t === "string" || isArrayType(t);
}

// Classify an unsupported type string for a human-readable skip reason.
function typeKind(t: string): string {
  if (t === "string")      return "string";
  if (t.endsWith("[]"))    return "array";
  if (t.endsWith("?"))     return "nullable";
  if (t.startsWith("fn[")) return "funcref";
  return "struct";
}

// ---- Utilities ----

// Convert snake_case to camelCase (only lowercased letters after underscores).
function camelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Encode bytes to base64 using only ECMA-standard string operations.
function toBase64(bytes: Uint8Array): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += table[b0 >> 2];
    out += table[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? table[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? table[b2 & 63] : "=";
  }
  return out;
}
