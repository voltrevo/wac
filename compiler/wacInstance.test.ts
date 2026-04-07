// Tests for wacInstance — instantiates a WacCompiled and provides typed call wrappers.

import { wacCompile } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function compile(src: string) {
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.errors.map(e => e.message).join("; ")}`);
  return wacInstance(r.compiled);
}

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${String(a)}, expected ${String(b)}`);
}

// ── Primitive call and return types ──────────────────────────────────────────

Deno.test("wacInstance: i32 call and return", async () => {
  const inst = await compile(`
    export i32 gcd(i32 a, i32 b) {
      while (b != 0) { i32 t = b; b = a % b; a = t; }
      return a;
    }
  `);
  eq(inst.call("gcd", [48, 18]), 6, "gcd(48,18)=6");
  eq(inst.call("gcd", [100, 75]), 25, "gcd(100,75)=25");
  eq(inst.call("gcd", [17, 13]), 1, "gcd(17,13)=1");
});

Deno.test("wacInstance: i64 call — bigint args and return", async () => {
  const inst = await compile(`
    export i64 add64(i64 a, i64 b) { return a + b; }
  `);
  eq(inst.call("add64", [100n, 200n]), 300n, "add64(100n,200n)=300n");
  eq(inst.call("add64", [0n, 999999999999n]), 999999999999n, "large bigint");
});

Deno.test("wacInstance: f64 call and return", async () => {
  const inst = await compile(`
    export f64 mul(f64 a, f64 b) { return a * b; }
  `);
  const result = inst.call("mul", [3.14, 2.0]) as number;
  if (Math.abs(result - 6.28) > 0.001) throw new Error(`mul(3.14,2)=${result}, expected ~6.28`);
});

Deno.test("wacInstance: bool return — JS boolean", async () => {
  const inst = await compile(`
    export bool isEven(i32 n) { return n % 2 == 0; }
  `);
  eq(inst.call("isEven", [4]), true,  "isEven(4)=true");
  eq(inst.call("isEven", [7]), false, "isEven(7)=false");
  eq(inst.call("isEven", [0]), true,  "isEven(0)=true");
});

Deno.test("wacInstance: void return — undefined", async () => {
  const inst = await compile(`export void noop() {}`);
  eq(inst.call("noop", []), undefined, "noop()=undefined");
});

Deno.test("wacInstance: bool arg coercion", async () => {
  const inst = await compile(`
    export i32 boolToInt(bool b) { return b ? 1 : 0; }
  `);
  eq(inst.call("boolToInt", [true]),  1, "true→1");
  eq(inst.call("boolToInt", [false]), 0, "false→0");
});

Deno.test("wacInstance: f32 return — number", async () => {
  const inst = await compile(`
    export f32 half(f32 x) { return x * 0.5 as~ f32; }
  `);
  const r = inst.call("half", [4.0]) as number;
  if (Math.abs(r - 2.0) > 0.001) throw new Error(`half(4)=${r}, expected 2.0`);
});

// ── rawExports and exports metadata ──────────────────────────────────────────

Deno.test("wacInstance: rawExports contains the functions", async () => {
  const inst = await compile(`
    export i32 add(i32 a, i32 b) { return a + b; }
    i32 priv(i32 x) { return x; }
  `);
  if (typeof inst.rawExports["add"] !== "function") throw new Error("add not in rawExports");
  // Private functions are NOT exported in wasm
  if ("priv" in inst.rawExports) throw new Error("priv should not be exported");
});

Deno.test("wacInstance: exports metadata", async () => {
  const inst = await compile(`
    export i32 mul(i32 a, i32 b) { return a * b; }
    export void clear() {}
  `);
  if (inst.exports.length !== 2) throw new Error(`expected 2 exports, got ${inst.exports.length}`);
  const mul = inst.exports.find(e => e.name === "mul")!;
  if (!mul) throw new Error("mul not found");
  if (mul.params.length !== 2) throw new Error("mul params count");
  if (mul.ret !== "i32") throw new Error("mul ret");
});

// ── Error on unknown export ───────────────────────────────────────────────────

Deno.test("wacInstance: throws on unknown export name", async () => {
  const inst = await compile(`export i32 f() { return 1; }`);
  let threw = false;
  try { inst.call("noSuchFn", []); } catch { threw = true; }
  if (!threw) throw new Error("expected throw on unknown export");
});

Deno.test("wacInstance: extra args beyond param count are coerced as i32", async () => {
  // Passing extra args (beyond declared params) — they're coerced as i32 fallback
  // but wasm ignores them; the function should still return the correct value
  const inst = await compile(`export i32 add(i32 a, i32 b) { return a + b; }`);
  // The extra arg 99 is coerced as i32 (the ?? "i32" branch), then ignored by wasm
  eq(inst.call("add", [3, 4, 99 as unknown as number]), 7, "add with extra arg = 7");
});

// ── Multi-function module ─────────────────────────────────────────────────────

Deno.test("wacInstance: multiple functions in one module", async () => {
  const inst = await compile(`
    export i32 add(i32 a, i32 b) { return a + b; }
    export i32 sub(i32 a, i32 b) { return a - b; }
    export i32 mul(i32 a, i32 b) { return a * b; }
  `);
  eq(inst.call("add", [3, 4]),  7,  "add(3,4)=7");
  eq(inst.call("sub", [10, 3]), 7,  "sub(10,3)=7");
  eq(inst.call("mul", [3, 7]),  21, "mul(3,7)=21");
});
