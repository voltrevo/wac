// Tests for wacInstance: compiles wac source, instantiates wasm, verifies
// that exported functions return the right JS-typed values.

import { wacCompile } from "./wacCompile.ts";
import { wacInstance, type WacInstance } from "./wacInstance.ts";

// ---- Helpers ----

const runtimeCap = {
  WebAssembly: {
    instantiate: (bytes: Uint8Array) =>
      (WebAssembly.instantiate(bytes as any) as any) as Promise<{
        instance: { exports: Record<string, unknown> };
      }>,
  },
};

async function make(src: string): Promise<WacInstance> {
  const r = wacCompile({ readFile: (p) => (p === "/m.wac" ? src : "") }, "/m.wac");
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  return wacInstance(runtimeCap, r);
}

// ---- i32 ----

Deno.test("wacInstance: i32 add returns correct number", async () => {
  const inst = await make(`export i32 add(i32 a, i32 b) { return a + b; }`);
  if (inst.add!(3, 4) !== 7) throw new Error("add(3,4) != 7");
  if (inst.add!(-5, 5) !== 0) throw new Error("add(-5,5) != 0");
  if (inst.add!(0, 0) !== 0) throw new Error("add(0,0) != 0");
});

Deno.test("wacInstance: i32 recursive factorial", async () => {
  const inst = await make(`export i32 fact(i32 n) {
  if (n <= 1) { return 1; }
  return n * fact(n - 1);
}`);
  // 10! = 3628800, verified independently
  if (inst.fact!(10) !== 3628800) throw new Error(`fact(10) = ${inst.fact!(10)}, expected 3628800`);
  if (inst.fact!(0) !== 1) throw new Error("fact(0)");
  if (inst.fact!(1) !== 1) throw new Error("fact(1)");
});

Deno.test("wacInstance: i32 gcd via iterative algorithm", async () => {
  const inst = await make(`export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}`);
  // Verified: gcd(48,18) = 6, gcd(100,75) = 25, gcd(17,13) = 1
  if (inst.gcd!(48, 18) !== 6)  throw new Error("gcd(48,18)");
  if (inst.gcd!(100, 75) !== 25) throw new Error("gcd(100,75)");
  if (inst.gcd!(17, 13) !== 1)  throw new Error("gcd(17,13)");
});

// ---- i64 ----

Deno.test("wacInstance: i64 add passes bigint and returns bigint", async () => {
  const inst = await make(`export i64 add64(i64 a, i64 b) { return a + b; }`);
  const result = inst.add64!(100n, 200n);
  if (result !== 300n) throw new Error(`add64(100n,200n) = ${result}, expected 300n`);
  // Large values beyond i32 range
  if (inst.add64!(2_000_000_000n, 2_000_000_000n) !== 4_000_000_000n) {
    throw new Error("large add64 failed");
  }
});

// ---- f64 ----

Deno.test("wacInstance: f64 multiply returns correct float", async () => {
  const inst = await make(`export f64 mul(f64 a, f64 b) { return a * b; }`);
  if (inst.mul!(1.5, 2.0) !== 3.0) throw new Error("mul(1.5,2.0)");
  // circleArea with 3.141592653589793 * 5 * 5 = 78.53981633974483
  const areaInst = await make(
    `export f64 area(f64 r) { return 3.141592653589793 * r * r; }`
  );
  const area = areaInst.area!(5.0) as number;
  // Tolerance due to f64 representation
  if (Math.abs(area - 78.53981633974483) > 1e-9) {
    throw new Error(`area(5.0) = ${area}, expected ~78.539816...`);
  }
});

// ---- f32 ----

Deno.test("wacInstance: f32 result is a JS number", async () => {
  const inst = await make(`export f32 half(f32 x) { return x * 0.5; }`);
  const r = inst.half!(7.0) as number;
  // f32 precision: 3.5 should be exact
  if (r !== 3.5) throw new Error(`half(7.0) = ${r}, expected 3.5`);
});

// ---- bool ----

Deno.test("wacInstance: bool return is converted to JS boolean", async () => {
  const inst = await make(`export bool isPos(i32 n) { return n > 0; }`);
  if (inst.isPos!(5) !== true)  throw new Error("isPos(5) should be true");
  if (inst.isPos!(-1) !== false) throw new Error("isPos(-1) should be false");
  if (inst.isPos!(0) !== false)  throw new Error("isPos(0) should be false");
  if (typeof inst.isPos!(1) !== "boolean") throw new Error("should be boolean type");
});

Deno.test("wacInstance: bool param converts JS boolean to wasm i32", async () => {
  const inst = await make(`export i32 boolToInt(bool b) { if (b) { return 1; } return 0; }`);
  if (inst.boolToInt!(true) !== 1)  throw new Error("boolToInt(true)");
  if (inst.boolToInt!(false) !== 0) throw new Error("boolToInt(false)");
});

Deno.test("wacInstance: mutual recursion even/odd with bool", async () => {
  const inst = await make(`
export bool isEven(i32 n) { if (n == 0) { return true; } return isOdd(n - 1); }
export bool isOdd(i32 n) { if (n == 0) { return false; } return isEven(n - 1); }
`);
  if (inst.isEven!(4) !== true)  throw new Error("isEven(4)");
  if (inst.isEven!(7) !== false) throw new Error("isEven(7)");
  if (inst.isOdd!(7) !== true)   throw new Error("isOdd(7)");
  if (inst.isOdd!(4) !== false)  throw new Error("isOdd(4)");
});

// ---- void ----

Deno.test("wacInstance: void return gives undefined", async () => {
  const inst = await make(`export void noop() { }`);
  const r = inst.noop!();
  if (r !== undefined) throw new Error(`noop() returned ${r}, expected undefined`);
});

// ---- fib ----

Deno.test("wacInstance: iterative fib(20) = 6765", async () => {
  const inst = await make(`export i32 fib(i32 n) {
  if (n < 2) { return n; }
  i32 a = 0;
  i32 b = 1;
  for (i32 i = 2; i <= n; i++) {
    i32 t = a + b;
    a = b;
    b = t;
  }
  return b;
}`);
  // fib(20) = 6765, verified via Python: fibonacci sequence
  if (inst.fib!(20) !== 6765) throw new Error(`fib(20) = ${inst.fib!(20)}, expected 6765`);
  if (inst.fib!(0) !== 0) throw new Error("fib(0)");
  if (inst.fib!(1) !== 1) throw new Error("fib(1)");
});

// ---- Skipping unsupported signatures ----

Deno.test("wacInstance: exports with struct return types are skipped", async () => {
  const r = wacCompile({
    readFile: (p) => (p === "/m.wac" ? `
struct Point { i32 x; i32 y; }
export i32 simple() { return 42; }
export Point getPoint() { return Point(1, 2); }
` : ""),
  }, "/m.wac");
  if (!r.ok) throw new Error("compile failed");
  const inst = await wacInstance(runtimeCap, r);
  // Only "simple" should be present; "getPoint" has struct return
  if (!("simple" in inst)) throw new Error("simple missing");
  if ("getPoint" in inst) throw new Error("getPoint should be skipped");
  if (inst.simple!() !== 42) throw new Error("simple() != 42");
});

Deno.test("wacInstance: exports with array params are skipped", async () => {
  const r = wacCompile({
    readFile: (p) => (p === "/m.wac" ? `
export i32 scalarAdd(i32 a, i32 b) { return a + b; }
export i32 sumArr(i32[] arr) { return 0; }
` : ""),
  }, "/m.wac");
  if (!r.ok) throw new Error("compile failed");
  const inst = await wacInstance(runtimeCap, r);
  if (!("scalarAdd" in inst)) throw new Error("scalarAdd missing");
  if ("sumArr" in inst) throw new Error("sumArr should be skipped (array param)");
});

// ---- Cap injection ----

Deno.test("wacInstance: accepts injected WebAssembly cap for testability", async () => {
  // Build a fake that tracks calls
  let callCount = 0;
  const trackingCap = {
    WebAssembly: {
      instantiate: async (bytes: Uint8Array) => {
        callCount++;
        return (await WebAssembly.instantiate(bytes as any) as any);
      },
    },
  };

  const r = wacCompile({ readFile: (p) => (p === "/m.wac" ? `export i32 val() { return 7; }` : "") }, "/m.wac");
  if (!r.ok) throw new Error("compile failed");
  const inst = await wacInstance(trackingCap, r);
  if (callCount !== 1) throw new Error(`instantiate called ${callCount} times, expected 1`);
  if (inst.val!() !== 7) throw new Error("val() != 7");
});

// ---- Type coercion edge cases ----

Deno.test("wacInstance: JS number passed as i64 param is coerced to bigint", async () => {
  const inst = await make(`export i64 identity64(i64 n) { return n; }`);
  // Passing a JS number (not bigint) should be coerced automatically
  const r = inst.identity64!(42 as unknown as bigint);
  if (r !== 42n) throw new Error(`identity64(42 as number) = ${r}, expected 42n`);
});

// ---- Multi-export ----

Deno.test("wacInstance: all primitive-typed exports are accessible", async () => {
  const inst = await make(`
export i32 addI32(i32 a, i32 b) { return a + b; }
export f64 mulF64(f64 a, f64 b) { return a * b; }
export bool invert(bool b) { return !b; }
export i64 double64(i64 n) { return n + n; }
`);
  if (inst.addI32!(10, 20) !== 30)     throw new Error("addI32");
  if (inst.mulF64!(3.0, 4.0) !== 12.0) throw new Error("mulF64");
  if (inst.invert!(true) !== false)     throw new Error("invert(true)");
  if (inst.double64!(50n) !== 100n)     throw new Error("double64");
});
