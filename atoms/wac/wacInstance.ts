// wacInstance — instantiates a compiled wac module and exposes typed call wrappers.
//
// Handles basic type marshaling for primitive types. Array and string marshaling
// are handled by wacBindTs (which embeds marshal helpers in the wasm binary).

import type { WacCompiled, WacExport } from "./wacCompile.ts";

// ── Public types ──────────────────────────────────────────────────────────────

/** A live wac instance ready to call. */
export type WacInst = {
  /** The raw wasm exports (for direct access). */
  rawExports: WebAssembly.Exports;
  /** Metadata for exported functions. */
  exports: WacExport[];
  /**
   * Call an exported function with JS values.
   * Primitive type coercion: i64 <-> bigint, bool <-> boolean, others -> number.
   * Throws if `name` is not a known export.
   */
  call(name: string, args: WacArg[]): WacVal;
};

/** Acceptable JS argument types for wac function calls. */
export type WacArg = number | bigint | boolean;

/** Return value types from wac function calls. */
export type WacVal = number | bigint | boolean | null | void;

// ── Instantiation ─────────────────────────────────────────────────────────────

/**
 * Instantiate a compiled wac module.
 * Returns a WacInst with raw exports and a typed call helper.
 */
export async function wacInstance(compiled: WacCompiled): Promise<WacInst> {
  const { instance } = await WebAssembly.instantiate(compiled.wasm, {});
  const rawExports = instance.exports;

  // Build an index from export name to its metadata
  const exportMap = new Map<string, WacExport>();
  for (const e of compiled.exports) exportMap.set(e.name, e);

  function call(name: string, args: WacArg[]): WacVal {
    const meta = exportMap.get(name);
    if (!meta) throw new Error(`wac: no export named '${name}'`);

    const fn = rawExports[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof fn !== "function") throw new Error(`wac: export '${name}' is not a function`);

    // Coerce args to match expected wasm types
    const coercedArgs = args.map((a, i) => {
      const t = meta.params[i]?.type ?? "i32";
      return coerceArg(a, t);
    });

    const result = fn(...coercedArgs);

    if (meta.ret === "void") return undefined;
    return coerceResult(result, meta.ret);
  }

  return { rawExports, exports: compiled.exports, call };
}

// ── Type coercion helpers ─────────────────────────────────────────────────────

/** Coerce a JS value to the wasm type expected for a parameter. */
function coerceArg(v: WacArg, t: string): unknown {
  if (t === "i64") return BigInt(v);
  if (t === "bool") return v ? 1 : 0;
  if (t === "f32" || t === "f64") return Number(v);
  return Number(v); // i32, i8, i16, etc.
}

/** Coerce a wasm return value to the appropriate JS type. */
function coerceResult(v: unknown, t: string): WacVal {
  if (v === undefined || v === null) return null;
  if (t === "i64") return BigInt(v as bigint | number);
  if (t === "bool") return (v as number) !== 0;
  if (t === "void") return undefined;
  return Number(v as number | bigint);
}
