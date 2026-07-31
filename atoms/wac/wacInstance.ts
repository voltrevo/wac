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
/**
 * `object` and `null` are here because a reference is a legitimate argument: a value returned
 * from one export can be passed to another, which is the only way a host can carry a struct or a
 * boxed `i32?` around. Coercion leaves those alone — `Number()` on a wasm reference throws.
 */
export type WacArg = number | bigint | boolean | null | object;

/** Return value types from wac function calls. */
export type WacVal =
  | number | bigint | boolean | null | void
  // A `string` return is decoded to a JS string, and an array return to a plain JS array of
  // its elements. Before this, both fell through to `Number()` and threw "Cannot convert
  // object to primitive value" [issue 0021].
  | string
  | (number | bigint)[];

// ── Instantiation ─────────────────────────────────────────────────────────────

/**
 * Instantiate a compiled wac module.
 * Returns a WacInst with raw exports and a typed call helper.
 */
export async function wacInstance(compiled: WacCompiled): Promise<WacInst> {
  const { instance } = await WebAssembly.instantiate(compiled.wasm as BufferSource, {});
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
    // A reference return needs the module's own accessors to read, so it is decoded here
    // rather than in `coerceResult`, which sees only the value.
    if (meta.ret === "string") return decodeString(rawExports, result);
    const elem = ARRAY_ELEM[meta.ret];
    if (elem !== undefined) return decodeArray(rawExports, result, elem);
    return coerceResult(result, meta.ret);
  }

  return { rawExports, exports: compiled.exports, call };
}

// ── Reference returns ─────────────────────────────────────────────────────────
//
// `string` and array returns are references; nothing about the value itself says how to read
// one, so decoding goes through the per-module accessors that `wasmBuildBin` emits into every
// module. Three separate workarounds existed for this before it was fixed — a spec-test helper
// that compared strings *inside* wac, a hand-rolled decoder in wac-mono's test harness, and
// going through bindgen instead [issue 0021].
//
// The per-element accessors are used rather than the bulk memory path: this is a harness for
// tests and probes, and one call per element is simpler than plumbing the staging buffer for no
// benefit at these sizes.

/** wac array return types, mapped to the accessor suffix and whether elements are i64-width. */
const ARRAY_ELEM: Record<string, { suffix: string; big: boolean }> = {
  "u8[]":  { suffix: "u8",  big: false },
  "i8[]":  { suffix: "i8",  big: false },
  "u16[]": { suffix: "u16", big: false },
  "i16[]": { suffix: "i16", big: false },
  "i32[]": { suffix: "i32", big: false },
  "u32[]": { suffix: "u32", big: false },
  "i64[]": { suffix: "i64", big: true },
  "u64[]": { suffix: "u64", big: true },
  "f32[]": { suffix: "f32", big: false },
  "f64[]": { suffix: "f64", big: false },
};

function decodeString(ex: Record<string, unknown>, v: unknown): string {
  const len = ex.__bind_str_len as ((s: unknown) => number) | undefined;
  const get = ex.__bind_str_get as ((s: unknown, i: number) => number) | undefined;
  if (!len || !get) {
    throw new Error(
      "wac: this module has no string accessors, so a string return cannot be decoded");
  }
  const n = len(v);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = get(v, i);
  // The bytes are the string's UTF-8, which may be invalid — `string.fromBytes` does not
  // validate [see strings.md]. Decoding leniently keeps a test able to report what it got.
  return new TextDecoder().decode(bytes);
}

function decodeArray(
  ex: Record<string, unknown>, v: unknown, elem: { suffix: string; big: boolean },
): (number | bigint)[] {
  const len = ex[`__bind_arr_${elem.suffix}_len`] as ((a: unknown) => number) | undefined;
  const get = ex[`__bind_arr_${elem.suffix}_get`] as
    ((a: unknown, i: number) => number | bigint) | undefined;
  if (!len || !get) {
    throw new Error(
      `wac: this module has no ${elem.suffix}[] accessors, so that array cannot be decoded`);
  }
  const n = len(v);
  const out: (number | bigint)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const raw = get(v, i);
    // u32 and u64 elements come back through a signed wasm type, exactly as returns do.
    out[i] = elem.suffix === "u32" ? (raw as number) >>> 0
           : elem.suffix === "u64" ? BigInt.asUintN(64, raw as bigint)
           : raw;
  }
  return out;
}

// ── Type coercion helpers ─────────────────────────────────────────────────────

/** Coerce a JS value to the wasm type expected for a parameter. */
/** Does this exported type cross the boundary as an opaque wasm reference? */
function isRefTypeStr(t: string): boolean {
  // A nullable of anything, and any name that is not a primitive: a struct, an enum, an array of
  // a non-numeric element. The numeric and string cases are all named explicitly below.
  return t.endsWith("?") || t.startsWith("fn[") ||
    !["i32", "i64", "u32", "u64", "i8", "i16", "u8", "u16", "f32", "f64", "bool", "void",
      "string"].includes(t) && !t.endsWith("[]");
}

function coerceArg(v: WacArg, t: string): unknown {
  // A reference goes through untouched. Anything else would be `Number()` of an object, which
  // throws, and there is nothing to convert: the value came out of wasm in the first place.
  if (isRefTypeStr(t) || v === null || typeof v === "object") return v;
  // u64 shares i64's wasm type; wrap into the low 64 bits so a JS value above
  // i64::MAX (which a u64 legitimately reaches) is accepted rather than thrown
  // on by BigInt conversion at the boundary.
  if (t === "i64") return BigInt(v);
  if (t === "u64") return BigInt.asIntN(64, BigInt(v));
  if (t === "bool") return v ? 1 : 0;
  if (t === "f32" || t === "f64") return Number(v);
  if (t === "u32") return Number(v) | 0;   // reinterpret into i32's range
  return Number(v); // i32, i8, i16, etc.
}

/** Coerce a wasm return value to the appropriate JS type. */
function coerceResult(v: unknown, t: string): WacVal {
  if (v === undefined || v === null) return null;
  // A reference is handed back as it is. `Number()` of one throws, which is how a nullable
  // primitive returned to the host used to fail [issue 0045].
  if (isRefTypeStr(t)) return v as WacVal;
  if (t === "i64") return BigInt(v as bigint | number);
  // The wasm value is the raw 64 or 32 bits; read it back as unsigned.
  if (t === "u64") return BigInt.asUintN(64, BigInt(v as bigint | number));
  if (t === "u32") return (v as number) >>> 0;
  if (t === "bool") return (v as number) !== 0;
  if (t === "void") return undefined;
  return Number(v as number | bigint);
}
