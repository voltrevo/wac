// wacInstance — instantiates a compiled wasm module and wraps its exports
// as typed JS functions.
//
// Supports primitive types: i32, i64, f32, f64, bool, void.
// Exports with string, array, struct, nullable, or funcref types are skipped.
// (Array/string support would require wasm-side marshal helpers.)

import type { WacCompiled, WacExport, WacParam } from "./wasmBuildBin.ts";

// ---- Exported types ----

// A single callable wac function. Args are JS primitives matching the wac type;
// returns a number (i32/f32/f64), bigint (i64), boolean (bool), or void.
export type WacFunc = (...args: (number | bigint | boolean)[]) => number | bigint | boolean | undefined;

// Live instance — record of callable exported functions (only primitive-typed ones).
export type WacInstance = {
  [name: string]: WacFunc;
};

export type Cap = {
  WebAssembly: {
    instantiate(bytes: Uint8Array): Promise<{ instance: { exports: Record<string, unknown> } }>;
  };
};

// ---- Main export ----

export async function wacInstance(cap: Cap, compiled: WacCompiled): Promise<WacInstance> {
  const { instance } = await cap.WebAssembly.instantiate(compiled.wasm);
  const rawExports = instance.exports;

  const wrapped: WacInstance = {};

  for (const exp of compiled.exports) {
    if (!isPrimitiveSig(exp)) continue;  // skip unsupported signatures

    const raw = rawExports[exp.name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof raw !== "function") continue;

    const { params, ret } = exp;
    wrapped[exp.name] = (...jsArgs: (number | bigint | boolean)[]) => {
      // Convert JS args to wasm-compatible values
      const wasmArgs = params.map((p, i) => jsToWasm(jsArgs[i], p.type));
      const rawResult = raw(...wasmArgs);
      return wasmToJs(rawResult, ret);
    };
  }

  return wrapped;
}

// ---- Helpers ----

// Primitive type set — all types wacInstance can handle.
const PRIMITIVES = new Set(["i32", "i64", "f32", "f64", "bool", "void"]);

function isPrimitiveSig(exp: WacExport): boolean {
  if (!PRIMITIVES.has(exp.ret)) return false;
  return exp.params.every(p => PRIMITIVES.has(p.type));
}

// Convert a JS value to the wasm argument for the given wac type.
function jsToWasm(val: number | bigint | boolean | undefined, type: string): unknown {
  if (type === "bool") {
    // Wasm booleans are i32 under the hood
    return val ? 1 : 0;
  }
  if (type === "i64") {
    // Ensure bigint is passed; coerce number if caller passes one
    if (typeof val === "number") return BigInt(Math.trunc(val));
    return val ?? 0n;
  }
  // i32 / f32 / f64: pass as-is (wasm coerces)
  return val ?? 0;
}

// Convert a wasm return value to a JS value for the given wac type.
function wasmToJs(val: unknown, type: string): number | bigint | boolean | undefined {
  if (type === "void")  return undefined;
  if (type === "bool")  return (val as number) !== 0;
  if (type === "i64")   return val as bigint;
  return val as number;     // i32 / f32 / f64
}
