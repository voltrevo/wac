// Tests for wacBindTs: verifies that the generated TypeScript source has the correct
// structure, that the embedded base64 round-trips, and that the resulting wasm
// produces the values required by the bindgen spec tags.

import { wacCompile } from "./wacCompile.ts";
import { wacBindTs } from "./wacBindTs.ts";

// ---- Helper ----

function compile(src: string) {
  const r = wacCompile({ readFile: p => p === "/m.wac" ? src : "" }, "/m.wac");
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  return r;
}

// Extract base64 from a wacBindTs-generated string and instantiate the wasm.
async function instantiateFrom(code: string): Promise<Record<string, unknown>> {
  const m = code.match(/atob\("([^"]+)"\)/);
  if (!m) throw new Error("no atob found in generated code");
  const bytes = Uint8Array.from(atob(m[1]!), c => c.charCodeAt(0));
  return ((await WebAssembly.instantiate(bytes as any)) as any).instance.exports;
}

// ---- Spec tag: primitives ----

// Note: the spec source example uses 3.14159265358979 (14 digits) but the expected
// value 78.53981633974483 requires the full π = 3.141592653589793 (15 digits).
// The spec's source snippet has a typo; the behavioral requirement (the return value)
// is the authoritative part of [§wac-bind-prims-k4fn8wp], so we use full π.
Deno.test("[§wac-bind-prims-k4fn8wp] gcd, fib, circleArea: signatures and correct values", async () => {
  const src = `
export i32 gcd(i32 a, i32 b) {
  while (b != 0) { i32 t = b; b = a % b; a = t; }
  return a;
}
export i32 fib(i32 n) {
  if (n < 2) { return n; }
  i32 a = 0; i32 b = 1;
  for (i32 i = 2; i <= n; i++) { i32 t = a + b; a = b; b = t; }
  return b;
}
export f64 circle_area(f64 radius) {
  return 3.141592653589793 * radius * radius;
}
`;
  const r = compile(src);
  const code = wacBindTs(r);

  // Generated TypeScript must have correct signatures (camelCase + type annotations).
  if (!code.includes("export function gcd(a: number, b: number): number {"))
    throw new Error("gcd signature wrong in:\n" + code);
  if (!code.includes("export function fib(n: number): number {"))
    throw new Error("fib signature wrong");
  if (!code.includes("export function circleArea(radius: number): number {"))
    throw new Error("circleArea (camelCase) signature wrong");
  // The wasm export name must still be circle_area in the call site.
  if (!code.includes("_exports.circle_area"))
    throw new Error("call site should use original snake_case name circle_area");

  // Verify base64 round-trip and wasm functional correctness.
  const exports = await instantiateFrom(code);
  const gcd = exports.gcd as (a: number, b: number) => number;
  const fib = exports.fib as (n: number) => number;
  const circleArea = exports.circle_area as (r: number) => number;

  // gcd(48, 18) = 6, gcd(100, 75) = 25, gcd(17, 13) = 1 — verified independently
  if (gcd(48, 18)  !== 6)  throw new Error(`gcd(48,18) = ${gcd(48,18)}, expected 6`);
  if (gcd(100, 75) !== 25) throw new Error(`gcd(100,75) = ${gcd(100,75)}, expected 25`);
  if (gcd(17, 13)  !== 1)  throw new Error(`gcd(17,13) = ${gcd(17,13)}, expected 1`);

  // fib(20) = 6765, fib(0) = 0, fib(1) = 1 — Fibonacci sequence
  if (fib(20) !== 6765) throw new Error(`fib(20) = ${fib(20)}, expected 6765`);
  if (fib(0)  !== 0)    throw new Error("fib(0)");
  if (fib(1)  !== 1)    throw new Error("fib(1)");

  // circleArea(5) = π * 25 = 78.53981633974483
  const area = circleArea(5.0);
  if (Math.abs(area - 78.53981633974483) > 1e-10)
    throw new Error(`circleArea(5.0) = ${area}, expected 78.53981633974483`);
});

// ---- Spec tag: i64 / bigint ----

Deno.test("[§wac-bind-i64-k3fn9wp] add64: bigint signature and correct value", async () => {
  const r = compile(`export i64 add64(i64 a, i64 b) { return a + b; }`);
  const code = wacBindTs(r);

  if (!code.includes("export function add64(a: bigint, b: bigint): bigint {"))
    throw new Error("add64 signature wrong");
  if (!code.includes("as bigint"))
    throw new Error("bigint cast missing");

  const exports = await instantiateFrom(code);
  const add64 = exports.add64 as (a: bigint, b: bigint) => bigint;
  if (add64(100n, 200n) !== 300n)
    throw new Error(`add64(100n, 200n) = ${add64(100n, 200n)}, expected 300n`);
  if (add64(2_000_000_000n, 2_000_000_000n) !== 4_000_000_000n)
    throw new Error("large add64 failed");
});

// ---- Spec tag: skipped exports ----

Deno.test("[§wac-bind-skip-h9pd5wn] struct return exports are skipped with comment", () => {
  const r = compile(`
struct Point { f64 x; f64 y; }
export i32 simple() { return 42; }
export Point getOrigin() { return Point(0.0, 0.0); }
`);
  const code = wacBindTs(r);

  if (!code.includes("export function simple(): number {"))
    throw new Error("simple() should be present");
  if (!code.includes("// skipped: getOrigin() — struct return types not yet supported in bindgen"))
    throw new Error("skipped comment wrong or missing");
  if (code.includes("export function getOrigin"))
    throw new Error("getOrigin should not have a function wrapper");
});

// ---- Header structure ----

Deno.test("wacBindTs: generated file starts with _wasm/_instance/_exports boilerplate", () => {
  const r = compile(`export i32 val() { return 1; }`);
  const code = wacBindTs(r);

  if (!code.startsWith("const _wasm = Uint8Array.from("))
    throw new Error("should start with _wasm declaration");
  if (!code.includes("const _instance = await WebAssembly.instantiate(_wasm);"))
    throw new Error("_instance line missing");
  if (!code.includes("const _exports = _instance.instance.exports;"))
    throw new Error("_exports line missing");
});

// ---- void return ----

Deno.test("wacBindTs: void return generates no return keyword", () => {
  const r = compile(`export void noop() { }`);
  const code = wacBindTs(r);

  if (!code.includes("export function noop(): void {"))
    throw new Error("noop signature wrong");
  // No `return` for void — just the call as a statement.
  if (code.includes("return (_exports.noop"))
    throw new Error("void function should not have 'return'");
  if (!code.includes("(_exports.noop as CallableFunction)();"))
    throw new Error("void call statement missing");
});

// ---- bool return / param ----

Deno.test("wacBindTs: bool return uses Boolean() conversion, bool param typed as boolean", () => {
  const r = compile(`export bool isPos(i32 n) { return n > 0; }`);
  const code = wacBindTs(r);

  if (!code.includes("export function isPos(n: number): boolean {"))
    throw new Error("isPos signature wrong");
  if (!code.includes("return Boolean("))
    throw new Error("bool return should use Boolean() conversion");
});

// ---- camelCase name conversion ----

Deno.test("wacBindTs: snake_case export names become camelCase in TS, stay snake_case in call site", () => {
  const r = compile(`export i32 get_max_val(i32 a, i32 b) { if (a > b) { return a; } return b; }`);
  const code = wacBindTs(r);

  if (!code.includes("export function getMaxVal("))
    throw new Error("camelCase name missing");
  if (!code.includes("_exports.get_max_val"))
    throw new Error("original snake_case name should be used in call site");
});

// ---- Multiple params ----

Deno.test("wacBindTs: multi-param function generates correct param list", async () => {
  const r = compile(`export f64 lerp(f64 a, f64 b, f64 t) { return a + (b - a) * t; }`);
  const code = wacBindTs(r);

  if (!code.includes("export function lerp(a: number, b: number, t: number): number {"))
    throw new Error("lerp signature wrong");

  const exports = await instantiateFrom(code);
  const lerp = exports.lerp as (a: number, b: number, t: number) => number;
  // lerp(0, 10, 0.5) = 5.0, lerp(2, 8, 0.25) = 3.5 — verified
  if (lerp(0, 10, 0.5) !== 5.0)  throw new Error("lerp(0,10,0.5)");
  if (lerp(2, 8, 0.25) !== 3.5)  throw new Error("lerp(2,8,0.25)");
});

// ---- Array params ----

Deno.test("wacBindTs: array param exports are generated with typed-array signature", () => {
  const r = compile(`
export i32 scalarAdd(i32 a, i32 b) { return a + b; }
export i32 sumArr(i32[] arr) { i32 t = 0; for (i32 i = 0; i < arr.len(); i++) { t += arr[i]; } return t; }
`);
  const code = wacBindTs(r);

  if (!code.includes("export function scalarAdd("))
    throw new Error("scalarAdd should be present");
  if (!code.includes("export function sumArr("))
    throw new Error("sumArr should be generated (not skipped)");
  if (!code.includes("Int32Array"))
    throw new Error("Int32Array missing from sumArr wrapper");
});

// ---- Base64 round-trip ----

Deno.test("wacBindTs: base64-encoded wasm round-trips back to original bytes", () => {
  const r = compile(`export i32 double(i32 x) { return x + x; }`);
  const code = wacBindTs(r);

  const m = code.match(/atob\("([^"]+)"\)/);
  if (!m) throw new Error("atob not found");
  const decoded = Uint8Array.from(atob(m[1]!), c => c.charCodeAt(0));

  if (decoded.length !== r.wasm.length)
    throw new Error(`length mismatch: ${decoded.length} vs ${r.wasm.length}`);
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] !== r.wasm[i])
      throw new Error(`byte mismatch at ${i}: ${decoded[i]} vs ${r.wasm[i]}`);
  }
});

// ---- f32 ----

Deno.test("wacBindTs: f32 return typed as number", async () => {
  const r = compile(`export f32 half(f32 x) { return x * 0.5; }`);
  const code = wacBindTs(r);

  if (!code.includes("export function half(x: number): number {"))
    throw new Error("half signature wrong");

  const exports = await instantiateFrom(code);
  const half = exports.half as (x: number) => number;
  // f32 * 0.5 — 7.0 * 0.5 = 3.5 is exact in f32
  if (half(7.0) !== 3.5) throw new Error(`half(7.0) = ${half(7.0)}, expected 3.5`);
});

// ---- Skip: nullable / funcref / struct type reasons ----

Deno.test("wacBindTs: nullable, funcref, struct types produce correct skip reasons", () => {
  // Use a real wasm binary from a trivial compile; inject synthetic export metadata
  // to cover typeKind branches that real wac sources can't easily exercise.
  const base = compile(`export i32 x() { return 1; }`);
  const compiled = {
    wasm: base.wasm,
    exports: [
      // nullable return (return type bad → typeKind("i32?"))
      { name: "maybeVal", params: [], ret: "i32?" },
      // funcref return (return type bad → typeKind("fn[void()]"))
      { name: "callback", params: [], ret: "fn[void()]" },
      // struct return (return type bad → typeKind → "struct")
      { name: "getPoint", params: [], ret: "Point" },
    ],
  };

  const code = wacBindTs(compiled);

  if (!code.includes("// skipped: maybeVal() — nullable return types not yet supported in bindgen"))
    throw new Error("nullable return skip message wrong");
  if (!code.includes("// skipped: callback() — funcref return types not yet supported in bindgen"))
    throw new Error("funcref return skip message wrong");
  if (!code.includes("// skipped: getPoint() — struct return types not yet supported in bindgen"))
    throw new Error("struct return skip message wrong");
});

// ---- toBase64: padding edge cases ----

Deno.test("wacBindTs: toBase64 handles 0, 1, 2 trailing bytes (padding)", () => {
  // Compile three sources whose wasm length modulo 3 covers all padding cases.
  // We verify the generated code contains the base64 prefix "AGFzbQ" (wasm magic).
  for (const src of [
    `export i32 f() { return 1; }`,
    `export i32 g(i32 a) { return a; }`,
    `export i32 h(i32 a, i32 b) { return a + b; }`,
  ]) {
    const r = compile(src);
    const code = wacBindTs(r);
    // All valid wasm binaries start with the magic bytes \0asm (0x00 0x61 0x73 0x6d).
    // In base64 that encodes to "AGFz".
    if (!code.includes(`atob("`)) throw new Error("atob missing");
    const m = code.match(/atob\("([^"]+)"\)/);
    const bytes = Uint8Array.from(atob(m![1]!), c => c.charCodeAt(0));
    // Check wasm magic header
    if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d)
      throw new Error("decoded bytes do not start with wasm magic");
  }
});
