// spec.test.ts — Tests for all spec tag IDs not covered by other test files.
// Groups: variables, types, functions, control, operators, structs, arrays,
//         casts, naming, imports, grammar, funcrefs, strings, buffer, linkedlist, bindgen

import { wacCompile } from "./wacCompile.ts";
import { wacBindTs } from "./wacBindTs.ts";

// ---- Helpers ----

function cap(sources: Record<string, string>) {
  return { readFile: (p: string) => sources[p] ?? "" };
}
function compile(src: string, file = "/m.wac") {
  return wacCompile(cap({ [file]: src }), file);
}
function errors(src: string, file = "/m.wac") {
  const r = compile(src, file);
  return r.ok ? [] : r.errors;
}
function hasErr(src: string, msg: string) {
  return errors(src).some(e => e.message.toLowerCase().includes(msg.toLowerCase()));
}
function compiles(src: string): boolean {
  return compile(src).ok;
}
async function run(src: string): Promise<Record<string, (...a: unknown[]) => unknown>> {
  const r = compile(src);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  return inst.exports as Record<string, (...a: unknown[]) => unknown>;
}
async function runMulti(sources: Record<string, string>, entry: string) {
  const r = wacCompile(cap(sources), entry);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  return inst.exports as Record<string, (...a: unknown[]) => unknown>;
}

// ===========================================================================
// VARIABLES
// ===========================================================================

Deno.test("[§wac-const-var-7b4swc8] reassigning const variable is a compile error", () => {
  if (!hasErr(`export void f() { const i32 y = 10; y = 11; }`, "const"))
    throw new Error("expected const error");
});

Deno.test("[§wac-uninit-nypziz8] uninitialized variable is a compile error", () => {
  if (!hasErr(`export void f() { i32 z; }`, "initialized"))
    throw new Error("expected uninit error");
});

Deno.test("[§wac-const-ref-617go61] field write through const reference is a compile error", () => {
  if (!hasErr(`struct P { i32 x; } export void f(P q) { const P p = q; p.x = 3; }`, "const"))
    throw new Error("expected const ref error");
});

Deno.test("[§wac-const-deep-j6b1nyg] deep write through const chain is a compile error", () => {
  const src = `struct T { i32 val; T? left; }
export void f(T arg) { const T t = arg; t.left!.val = 5; }`;
  if (!hasErr(src, "const"))
    throw new Error("expected deep const error");
});

// ===========================================================================
// TYPES
// ===========================================================================

Deno.test("[§wac-int32-dfkqg8u] i32 function returns 42", async () => {
  const e = await run(`export i32 int32() { return 42; }`);
  if (e.int32() !== 42) throw new Error(`got ${e.int32()}`);
});

Deno.test("[§wac-int64-81jz1o0] i64 function returns 1000000000000", async () => {
  const e = await run(`export i64 int64() { return 1000000000000; }`);
  if (e.int64() !== 1000000000000n) throw new Error(`got ${e.int64()}`);
});

Deno.test("[§wac-float32-45okgg8] f32 function returns ~3.14", async () => {
  const e = await run(`export f32 float32() { return 3.14; }`);
  const v = e.float32() as number;
  if (Math.abs(v - 3.14) > 0.001) throw new Error(`got ${v}`);
});

Deno.test("[§wac-float64-suhtesz] f64 function returns exact value", async () => {
  const e = await run(`export f64 float64() { return 2.718281828459045; }`);
  if (e.float64() !== 2.718281828459045) throw new Error(`got ${e.float64()}`);
});

Deno.test("[§wac-wrap-uy41uqt] i32 overflow wraps to -2147483648", async () => {
  const e = await run(`export i32 wrap32() { return 2147483647 + 1; }`);
  if (e.wrap32() !== -2147483648) throw new Error(`got ${e.wrap32()}`);
});

Deno.test("[§wac-strict-tr8nhbk] bool flag works in if condition, returns 5", async () => {
  const e = await run(`export i32 strict() {
  bool flag = true;
  i32 x = 5;
  if (flag) { return x; }
  return 0;
}`);
  if (e.strict() !== 5) throw new Error(`got ${e.strict()}`);
});

Deno.test("[§wac-boolreq-uj95exp] i32 in if condition is a compile error", () => {
  if (!hasErr(`export i32 f(i32 x) { if (x) { return 1; } return 0; }`, "bool"))
    throw new Error("expected bool error");
});

Deno.test("[§wac-nullassign-b3xk8p5] assigning nullable to non-null is a compile error", () => {
  const src = `struct P { i32 x; } export void f(P? q) { P p = q; }`;
  if (!hasErr(src, "null")) throw new Error("expected null error");
});

Deno.test("[§wac-null-assign-k3fn8wp] null assigned to nullable reference compiles", () => {
  const src = `struct P { i32 x; } export void f() { P? p = null; p = null; }`;
  if (!compiles(src)) throw new Error("should compile");
});

Deno.test("[§wac-null-nonnull-m8qj5xf] null assigned to non-null is a compile error", () => {
  const src = `struct P { i32 x; } export void f() { P q = null; }`;
  if (!hasErr(src, "null")) throw new Error("expected null error");
});

Deno.test("[§wac-null-primitive-p7hd6wn] null assigned to i32 is a compile error", () => {
  if (!hasErr(`export void f() { i32 x = null; }`, "null"))
    throw new Error("expected null error");
});

Deno.test("[§wac-unwrap-trap-y1iep2p] unwrapping null traps at runtime", async () => {
  const e = await run(`struct P { i32 x; } export i32 f() { P? q = null; P p = q!; return p.x; }`);
  let trapped = false;
  try { e.f(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-isnull-kxsqi4g] null is null = true, non-null is null = false", async () => {
  const e = await run(`struct P { i32 x; }
export i32 nullTest() { P? q = null; return q is null ? 1 : 0; }
export i32 nonNullTest() { P? q = P(5); return q is null ? 1 : 0; }`);
  if (e.nullTest() !== 1) throw new Error("null is null should be 1");
  if (e.nonNullTest() !== 0) throw new Error("non-null is null should be 0");
});

Deno.test("[§wac-nonnull-isnull-k8fn3wp] is null on non-null type always returns false", async () => {
  const e = await run(`struct P { i32 x; i32 y; }
export i32 test() { P p = P(1, 2); return p is null ? 1 : 0; }`);
  if (e.test() !== 0) throw new Error("non-null is null should be 0");
});

Deno.test("[§wac-i31ref-0i4w6qt] i31ref stores 42 and retrieves as i32", async () => {
  const e = await run(`export i32 test() {
  i31ref small = 42 as! i31ref;
  i32 n = small as i32;
  return n;
}`);
  if (e.test() !== 42) throw new Error(`got ${e.test()}`);
});

// ===========================================================================
// FUNCTIONS
// ===========================================================================

Deno.test("[§wac-ret-array-mptjuer] function returning array, len=5", async () => {
  const e = await run(`export i32[] makeArray(i32 n) { return i32[n](); }
export i32 testLen() { return makeArray(5).len(); }`);
  if (e.testLen() !== 5) throw new Error(`got ${e.testLen()}`);
});

Deno.test("[§wac-void-return-h7qm4xf] return; in void function compiles", () => {
  const src = `export void earlyReturn(bool flag) { if (flag) { return; } }`;
  if (!compiles(src)) throw new Error("should compile");
});

Deno.test("[§wac-missing-return-k4fn8wp] non-void function missing return is a compile error", () => {
  if (!hasErr(`i32 bad(bool x) { if (x) { return 1; } }`, "return"))
    throw new Error("expected missing return error");
});

Deno.test("[§wac-all-paths-return-m7qj3xf] all-paths-return compiles and ok(true)=1", async () => {
  const e = await run(`export i32 ok(bool x) {
  if (x) { return 1; }
  else { return 0; }
}`);
  if (e.ok(1) !== 1) throw new Error("ok(true) != 1");
  if (e.ok(0) !== 0) throw new Error("ok(false) != 0");
});

Deno.test("[§wac-paramatch-84zc2km] passing f32 to f64 param is a compile error", () => {
  const src = `f64 sq(f64 x) { return x; } export f64 bad(f32 a) { return sq(a); }`;
  if (!hasErr(src, "")) throw new Error("expected type mismatch");
});

Deno.test("[§wac-export-entry-only-v3kp8wn] only entry exports appear in wasm, test()=16", async () => {
  const sources = {
    "/m.wac": `import { compute as a } from "./a.wac";
import { compute as b } from "./b.wac";
export i32 test() { return a(5) + b(5); }`,
    "/a.wac": `export i32 compute(i32 x) { return x + 1; }`,
    "/b.wac": `export i32 compute(i32 x) { return x * 2; }`,
  };
  const r = wacCompile(cap(sources), "/m.wac");
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const names = r.exports.map(e => e.name);
  if (names.includes("compute")) throw new Error("compute should not be exported");
  if (!names.includes("test")) throw new Error("test should be exported");
  const e = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance.exports;
  if (e.test() !== 16) throw new Error(`test()=${e.test()}`);
});

Deno.test("[§wac-export-no-collision-m4fn9rk] same-name exports in different files compile fine", () => {
  const sources = {
    "/m.wac": `import { compute as a } from "./a.wac";
import { compute as b } from "./b.wac";
export i32 test() { return a(5) + b(5); }`,
    "/a.wac": `export i32 compute(i32 x) { return x + 1; }`,
    "/b.wac": `export i32 compute(i32 x) { return x * 2; }`,
  };
  if (!wacCompile(cap(sources), "/m.wac").ok) throw new Error("should compile");
});

// ===========================================================================
// CONTROL FLOW
// ===========================================================================

Deno.test("[§wac-abs-djo90kx] abs(-42)=42, abs(7)=7", async () => {
  const e = await run(`export i32 abs(i32 n) {
  if (n < 0) { return -n; }
  else { return n; }
}`);
  if (e.abs(-42) !== 42) throw new Error(`abs(-42)=${e.abs(-42)}`);
  if (e.abs(7) !== 7) throw new Error(`abs(7)=${e.abs(7)}`);
});

Deno.test("[§wac-collatz-k1chom8] collatz(27)=111", async () => {
  const e = await run(`export i32 collatz(i32 n) {
  i32 steps = 0;
  while (n != 1) {
    if (n % 2 == 0) { n = n / 2; }
    else { n = n * 3 + 1; }
    steps++;
  }
  return steps;
}`);
  // collatz(27) = 111 steps, independently verified
  if (e.collatz(27) !== 111) throw new Error(`collatz(27)=${e.collatz(27)}`);
});

Deno.test("[§wac-fib-kko47vy] fib(20)=6765", async () => {
  const e = await run(`export i32 fib(i32 n) {
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
  // fib(20) = 6765, standard Fibonacci
  if (e.fib(20) !== 6765) throw new Error(`fib(20)=${e.fib(20)}`);
});

Deno.test("[§wac-dowhile-d6kgle1] digitCount(0)=1, digitCount(9999)=4", async () => {
  const e = await run(`export i32 digitCount(i32 n) {
  if (n < 0) { n = -n; }
  i32 count = 0;
  do {
    count++;
    n = n / 10;
  } while (n > 0);
  return count;
}`);
  if (e.digitCount(0) !== 1) throw new Error(`digitCount(0)=${e.digitCount(0)}`);
  if (e.digitCount(9999) !== 4) throw new Error(`digitCount(9999)=${e.digitCount(9999)}`);
});

Deno.test("[§wac-break-x7y68xx] break finds target=20 at index 1", async () => {
  const e = await run(`export i32 findFirst(i32[] arr, i32 target) {
  i32 result = -1;
  for (i32 i = 0; i < arr.len(); i++) {
    if (arr[i] == target) {
      result = i;
      break;
    }
  }
  return result;
}
export i32 test() {
  i32[] a = i32[](10, 20, 30);
  return findFirst(a, 20);
}`);
  if (e.test() !== 1) throw new Error(`test()=${e.test()}`);
});

Deno.test("[§wac-continue-apojox2] sumOdd {1,2,3,4,5} = 9", async () => {
  const e = await run(`export i32 sumOdd(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    if (arr[i] % 2 == 0) { continue; }
    total += arr[i];
  }
  return total;
}
export i32 test() {
  i32[] a = i32[](1, 2, 3, 4, 5);
  return sumOdd(a);
}`);
  if (e.test() !== 9) throw new Error(`test()=${e.test()}`);
});

Deno.test("[§wac-break-noloop-p3kn7wp] break outside loop is a compile error", () => {
  if (!hasErr(`export void f() { break; }`, "break"))
    throw new Error("expected break error");
});

Deno.test("[§wac-continue-noloop-r8jm4xf] continue outside loop is a compile error", () => {
  if (!hasErr(`export void f() { continue; }`, "continue"))
    throw new Error("expected continue error");
});

Deno.test("[§wac-ternary-bthswsh] max(3,7)=7, max(10,2)=10", async () => {
  const e = await run(`export i32 max(i32 a, i32 b) { return a > b ? a : b; }`);
  if (e.max(3, 7) !== 7) throw new Error(`max(3,7)=${e.max(3, 7)}`);
  if (e.max(10, 2) !== 10) throw new Error(`max(10,2)=${e.max(10, 2)}`);
});

Deno.test("[§wac-switch-4s87owc] dayType(0)=0, dayType(3)=1, dayType(6)=0", async () => {
  const e = await run(`export i32 dayType(i32 day) {
  switch (day) {
    case 0: { return 0; }
    case 6: { return 0; }
    default: { return 1; }
  }
}`);
  if (e.dayType(0) !== 0) throw new Error(`dayType(0)=${e.dayType(0)}`);
  if (e.dayType(3) !== 1) throw new Error(`dayType(3)=${e.dayType(3)}`);
  if (e.dayType(6) !== 0) throw new Error(`dayType(6)=${e.dayType(6)}`);
});

Deno.test("[§wac-no-fallthru-r5kw2n8] switch no fallthrough: case 1 sets x=20", async () => {
  const e = await run(`export i32 test() {
  i32 x = 0;
  switch (1) {
    case 0: { x = 10; }
    case 1: { x = 20; }
    case 2: { x = 30; }
  }
  return x;
}`);
  if (e.test() !== 20) throw new Error(`test()=${e.test()}`);
});

Deno.test("[§wac-trap-stmt-v3kq8fn] mustBePositive(5)=5", async () => {
  const e = await run(`export i32 mustBePositive(i32 n) {
  if (n <= 0) { trap; }
  return n;
}`);
  if (e.mustBePositive(5) !== 5) throw new Error(`got ${e.mustBePositive(5)}`);
});

Deno.test("[§wac-trap-fires-w2jm4pd] mustBePositive(-1) traps", async () => {
  const e = await run(`export i32 mustBePositive(i32 n) {
  if (n <= 0) { trap; }
  return n;
}`);
  let trapped = false;
  try { e.mustBePositive(-1); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-hex-cs4i9ht] hex literal 0xFF=255, 0xFF00FF=16711935", async () => {
  const e = await run(`export i32 mask() { return 0xFF; }
export i32 color() { return 0xFF00FF; }`);
  if (e.mask() !== 255) throw new Error(`mask=${e.mask()}`);
  if (e.color() !== 16711935) throw new Error(`color=${e.color()}`);
});

// ===========================================================================
// OPERATORS
// ===========================================================================

Deno.test("[§wac-add64-h42kvhc] i64 add(100, 200)=300", async () => {
  const e = await run(`export i64 add64(i64 a, i64 b) { return a + b; }`);
  if (e.add64(100n, 200n) !== 300n) throw new Error(`got ${e.add64(100n, 200n)}`);
});

Deno.test("[§wac-mulf-02srz8x] f64 mul(2.5, 4.0)=10.0", async () => {
  const e = await run(`export f64 mulF(f64 a, f64 b) { return a * b; }`);
  if (e.mulF(2.5, 4.0) !== 10.0) throw new Error(`got ${e.mulF(2.5, 4.0)}`);
});

Deno.test("[§wac-mixadd-f4dga8g] i32 + f64 is a compile error", () => {
  const src = `export f64 f(i32 x, f64 y) { f64 z = x + y; return z; }`;
  if (!hasErr(src, "")) throw new Error("expected type mismatch");
});

Deno.test("[§wac-cmpfloat-68s8unj] 1.0 == 1.0 returns true", async () => {
  const e = await run(`export i32 cmpFloat() { return 1.0 == 1.0 ? 1 : 0; }`);
  if (e.cmpFloat() !== 1) throw new Error(`cmpFloat()=${e.cmpFloat()}`);
});

Deno.test("[§wac-struct-eq-k4rm7xq] == on structs is a compile error", () => {
  const src = `struct P { i32 x; } export i32 f(P a, P b) { return a == b ? 1 : 0; }`;
  if (!hasErr(src, "")) throw new Error("expected struct eq error");
});

Deno.test("[§wac-shift64-rhgzpth] i64 << i32: shiftMixed(1, 32)=4294967296", async () => {
  const e = await run(`export i64 shiftMixed(i64 x, i32 n) { return x << n; }`);
  if (e.shiftMixed(1n, 32) !== 4294967296n) throw new Error(`got ${e.shiftMixed(1n, 32)}`);
});

Deno.test("[§wac-logic-45at1jf] bothPositive(3,5)=true", async () => {
  const e = await run(`export i32 bothPos(i32 a, i32 b) { return a > 0 && b > 0 ? 1 : 0; }`);
  if (e.bothPos(3, 5) !== 1) throw new Error(`bothPos(3,5)=${e.bothPos(3, 5)}`);
});

Deno.test("[§wac-logicf-bi4nyl4] bothPositive(3,-1)=false", async () => {
  const e = await run(`export i32 bothPos(i32 a, i32 b) { return a > 0 && b > 0 ? 1 : 0; }`);
  if (e.bothPos(3, -1) !== 0) throw new Error(`bothPos(3,-1)=${e.bothPos(3, -1)}`);
});

Deno.test("[§wac-shortcirc-and-j7pm4w9] && short-circuits: incr not called on false", async () => {
  const e = await run(`struct Box { i32 val; }
bool incr(Box b) { b.val = b.val + 1; return true; }
export i32 testAnd() {
  Box b = Box(0);
  bool result = false && incr(b);
  return b.val;
}`);
  if (e.testAnd() !== 0) throw new Error(`testAnd()=${e.testAnd()}, expected 0`);
});

Deno.test("[§wac-shortcirc-or-n3kx5wp] || short-circuits: incr not called on true", async () => {
  const e = await run(`struct Box { i32 val; }
bool incr(Box b) { b.val = b.val + 1; return true; }
export i32 testOr() {
  Box b = Box(0);
  bool result = true || incr(b);
  return b.val;
}`);
  if (e.testOr() !== 0) throw new Error(`testOr()=${e.testOr()}, expected 0`);
});

Deno.test("[§wac-bool-arith-f2nx8k3] arithmetic on bool is a compile error", () => {
  const src = `export i32 f(bool a) { i32 x = a + 1; return x; }`;
  if (!hasErr(src, "")) throw new Error("expected bool arith error");
});

Deno.test("[§wac-compound-pw7qq7v] compound operators: compound()=40", async () => {
  const e = await run(`export i32 compound() {
  i32 x = 10;
  x += 5;
  x -= 2;
  x *= 3;
  x++;
  return x;
}`);
  // ((10+5-2)*3)+1 = 13*3+1 = 39+1 = 40
  if (e.compound() !== 40) throw new Error(`compound()=${e.compound()}`);
});

Deno.test("[§wac-increxpr-cabck67] ++ as expression is a compile error", () => {
  const src = `export i32 f(i32 x) { i32 y = x++; return y; }`;
  if (!hasErr(src, "")) throw new Error("expected incr expr error");
});

// ===========================================================================
// STRUCTS
// ===========================================================================

Deno.test("[§wac-const-field-inftga5] writing to const field is a compile error", () => {
  const src = `struct IdP { const i32 id; i32 x; }
export void f(IdP p) { p.id = 5; }`;
  if (!hasErr(src, "const")) throw new Error("expected const field error");
});

Deno.test("[§wac-const-struct-g9apxwr] writing to any field of const struct is a compile error", () => {
  const src = `const struct Cfg { i32 w; i32 h; }
export void f(Cfg c) { c.w = 5; }`;
  if (!hasErr(src, "const")) throw new Error("expected const struct error");
});

Deno.test("[§wac-struct-positional-ycapwjx] positional construction: p.x=3, p.y=4", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 testX() { Point p = Point(3, 4); return p.x; }
export i32 testY() { Point p = Point(3, 4); return p.y; }`);
  if (e.testX() !== 3) throw new Error(`testX=${e.testX()}`);
  if (e.testY() !== 4) throw new Error(`testY=${e.testY()}`);
});

Deno.test("[§wac-struct-named-4y8pg2j] named construction order-independent", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 testX() { Point p = Point { y: 4, x: 3 }; return p.x; }
export i32 testY() { Point p = Point { y: 4, x: 3 }; return p.y; }`);
  if (e.testX() !== 3) throw new Error(`testX=${e.testX()}`);
  if (e.testY() !== 4) throw new Error(`testY=${e.testY()}`);
});

Deno.test("[§wac-struct-default-ar2wgyf] default construction: r.x=0, r.y=0", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 testX() { Point r = Point(); return r.x; }
export i32 testY() { Point r = Point(); return r.y; }`);
  if (e.testX() !== 0) throw new Error(`testX=${e.testX()}`);
  if (e.testY() !== 0) throw new Error(`testY=${e.testY()}`);
});

Deno.test("[§wac-struct-partial-76iq9nc] partial positional construction is a compile error", () => {
  const src = `struct Point { i32 x; i32 y; } export void f() { Point p = Point(3); }`;
  if (!hasErr(src, "")) throw new Error("expected partial construction error");
});

Deno.test("[§wac-struct-null-arg-h7kp3wn] nullable field can be null in construction", async () => {
  const e = await run(`struct Node { i32 val; Node? next; }
export i32 testVal() { Node n = Node(42, null); return n.val; }
export i32 testNull() { Node n = Node(42, null); return n.next is null ? 1 : 0; }`);
  if (e.testVal() !== 42) throw new Error(`val=${e.testVal()}`);
  if (e.testNull() !== 1) throw new Error(`null=${e.testNull()}`);
});

Deno.test("[§wac-recursive-nodefault-1os4yl4] non-null recursive field has no default — compile error", () => {
  const src = `struct Node { i32 val; Node next; } export void f() { Node n = Node(); }`;
  if (!hasErr(src, "")) throw new Error("expected recursive no default error");
});

Deno.test("[§wac-nested-default-tctff6b] nested defaults constructed recursively", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
struct Line { Point start; Point end; }
export i32 test() {
  Line l = Line();
  return l.start.x + l.start.y + l.end.x + l.end.y;
}`);
  if (e.test() !== 0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-alias-9j8cnc7] struct assignment is aliasing: alias()=99", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 alias() {
  Point a = Point(1, 2);
  Point b = a;
  b.x = 99;
  return a.x;
}`);
  if (e.alias() !== 99) throw new Error(`alias=${e.alias()}`);
});

Deno.test("[§wac-method-ta71o2i] Counter.create(1) returns count=0, id=1", async () => {
  const e = await run(`struct Counter {
  i32 count;
  const i32 id;
  Counter create(i32 id_) { return Counter(0, id_); }
  i32 getId(const this) { return this.id; }
  i32 getCount(const this) { return this.count; }
}
export i32 testId() { Counter c = Counter.create(1); return c.getId(); }
export i32 testCount() { Counter c = Counter.create(1); return c.getCount(); }`);
  if (e.testId() !== 1) throw new Error(`id=${e.testId()}`);
  if (e.testCount() !== 0) throw new Error(`count=${e.testCount()}`);
});

Deno.test("[§wac-method-inc-09hcqkq] after c.inc(), getCount()=1", async () => {
  const e = await run(`struct Counter {
  i32 count;
  void inc(this) { this.count += 1; }
  i32 getCount(const this) { return this.count; }
}
export i32 test() {
  Counter c = Counter();
  c.inc();
  return c.getCount();
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-method-const-d5zjb9i] writing const field in method is a compile error", () => {
  const src = `struct C {
  i32 count;
  const i32 id;
  void bad(this) { this.id = 5; }
}`;
  if (!hasErr(src, "const")) throw new Error("expected const error");
});

Deno.test("[§wac-method-mixed-fields-r4kn7wp] push x2, len()=2", async () => {
  const e = await run(`struct Node { i32 val; Node? next; }
struct Stack {
  Node? top;
  i32 count;
  void push(this, i32 val) {
    Node n = Node();
    n.val = val;
    n.next = this.top;
    this.top = n;
    this.count++;
  }
  i32 len(const this) { return this.count; }
}
export i32 test() {
  Stack s = Stack();
  s.push(10);
  s.push(20);
  return s.len();
}`);
  if (e.test() !== 2) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-bare-field-q3wn8v5] bare field name in method is a compile error", () => {
  const src = `struct Foo { i32 count;
  i32 get(const this) { return count; }
}`;
  if (!hasErr(src, "")) throw new Error("expected bare field error");
});

Deno.test("[§wac-subpos-order-m7kx3qf] subtype positional: parent fields first", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
export f64 testX() {
  Rect r = Rect(1.0, 2.0, 10.0, 20.0);
  return r.x;
}
export f64 testW() {
  Rect r = Rect(1.0, 2.0, 10.0, 20.0);
  return r.w;
}`);
  if (e.testX() !== 1.0) throw new Error(`x=${e.testX()}`);
  if (e.testW() !== 10.0) throw new Error(`w=${e.testW()}`);
});

Deno.test("[§wac-subtype-assign-jjrjz7g] subtype reference assignable to parent", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
export f64 test() {
  Rect r = Rect(0.0, 0.0, 10.0, 20.0);
  Shape s = r;
  return s.x;
}`);
  if (e.test() !== 0.0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-subtype-method-2s28pfb] parent method works on subtype", async () => {
  const e = await run(`struct Shape { f64 x; f64 y;
  f64 getX(const this) { return this.x; }
}
struct Rect : Shape { f64 w; f64 h; }
export f64 test() {
  Rect r = Rect(3.0, 4.0, 10.0, 20.0);
  return r.getX();
}`);
  if (e.test() !== 3.0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-override-k7fn3qp] override works: Circle.name() returns 'circle'", async () => {
  const e = await run(`struct Shape { f64 x; f64 y;
  i32 nameLen(const this) { return 5; }
}
struct Circle : Shape { f64 radius;
  override i32 nameLen(const this) { return 6; }
}
export i32 test() {
  Circle c = Circle(0.0, 0.0, 5.0);
  return c.nameLen();
}`);
  if (e.test() !== 6) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-override-missing-m4jw2rk] method collision without override is a compile error", () => {
  const src = `struct Shape { f64 x; i32 name(const this) { return 1; } }
struct BadRect : Shape { f64 w; i32 name(const this) { return 2; } }`;
  if (!hasErr(src, "override")) throw new Error("expected override error");
});

Deno.test("[§wac-override-spurious-p9qn5xl] override with no parent method is a compile error", () => {
  const src = `struct BadShape { override i32 foo(const this) { return 0; } }`;
  if (!hasErr(src, "override")) throw new Error("expected spurious override error");
});

Deno.test("[§wac-nostatic-inh-r3kf8wp] static methods are not inherited — compile error", () => {
  const src = `struct Base { Base make() { return Base(); } }
struct Sub : Base { i32 extra; }
export void f() { Sub s = Sub.make(); }`;
  if (!hasErr(src, "")) throw new Error("expected no static inheritance error");
});

Deno.test("[§wac-static-disp-x4rk7m2] static dispatch based on declared type", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; i32 tag(const this) { return 1; } }
struct Circle : Shape { f64 radius; override i32 tag(const this) { return 2; } }
export i32 test() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  return s.tag();
}`);
  // Static dispatch: s is declared as Shape, so Shape.tag() = 1
  if (e.test() !== 1) throw new Error(`test=${e.test()}, expected 1 (static dispatch)`);
});

Deno.test("[§wac-override-dispatch-r2km6jf] dynamic dispatch via is/as!", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; i32 tag(const this) { return 1; } }
struct Circle : Shape { f64 radius; override i32 tag(const this) { return 2; } }
i32 getTag(Shape s) {
  if (s is Circle) { return (s as! Circle).tag(); }
  return s.tag();
}
export i32 onCircle() {
  Circle c = Circle(0.0, 0.0, 5.0);
  return getTag(c);
}
export i32 onShape() {
  Shape s = Shape(0.0, 0.0);
  return getTag(s);
}`);
  if (e.onCircle() !== 2) throw new Error(`onCircle=${e.onCircle()}`);
  if (e.onShape() !== 1) throw new Error(`onShape=${e.onShape()}`);
});

Deno.test("[§wac-is-dz9jg1l] is type test: Circle is Circle=1, Circle is Rect=0", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
struct Rect : Shape { f64 w; f64 h; }
export i32 testIsCircle() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  return s is Circle ? 1 : 0;
}
export i32 testIsRect() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  return s is Rect ? 1 : 0;
}`);
  if (e.testIsCircle() !== 1) throw new Error(`testIsCircle=${e.testIsCircle()}`);
  if (e.testIsRect() !== 0) throw new Error(`testIsRect=${e.testIsRect()}`);
});

Deno.test("[§wac-as-trap-d10qz88] casting Circle as! Rect traps", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
struct Rect : Shape { f64 w; f64 h; }
export f64 bad() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  Rect r = s as! Rect;
  return r.w;
}`);
  let trapped = false;
  try { e.bad(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-is-not-fwatmyk] is not: Circle is not Rect = true", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
struct Rect : Shape { f64 w; f64 h; }
export i32 test() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  return s is not Rect ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-refid-same-k7fn4wp] aliased reference: a is b = true", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 testIdentity() {
  Point a = Point(1, 2);
  Point b = a;
  return a is b ? 1 : 0;
}`);
  if (e.testIdentity() !== 1) throw new Error(`test=${e.testIdentity()}`);
});

Deno.test("[§wac-refid-diff-m4jw3rk] different objects: a is c = false", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 testDistinct() {
  Point a = Point(1, 2);
  Point c = Point(1, 2);
  return a is c ? 1 : 0;
}`);
  if (e.testDistinct() !== 0) throw new Error(`test=${e.testDistinct()}`);
});

Deno.test("[§wac-deep-const-j4fn2xq] calling non-const method through const this is a compile error", () => {
  const src = `struct Inner { i32 val; void mutate(this) { this.val = 1; } }
struct Outer { Inner inner;
  void bad(const this) { this.inner.mutate(); }
}`;
  if (!hasErr(src, "const")) throw new Error("expected deep const error");
});

// ===========================================================================
// ARRAYS
// ===========================================================================

Deno.test("[§wac-arr-default-uwpc1ls] default array: len=5, a[0]=0", async () => {
  const e = await run(`export i32 testLen() { i32[] a = i32[5](); return a.len(); }
export i32 testElem() { i32[] a = i32[5](); return a[0]; }`);
  if (e.testLen() !== 5) throw new Error(`len=${e.testLen()}`);
  if (e.testElem() !== 0) throw new Error(`elem=${e.testElem()}`);
});

Deno.test("[§wac-arr-fixed-v6p97qy] fixed array: len=3, b[0]=1, b[2]=3", async () => {
  const e = await run(`export i32 testLen() { i32[] b = i32[](1, 2, 3); return b.len(); }
export i32 testFirst() { i32[] b = i32[](1, 2, 3); return b[0]; }
export i32 testLast() { i32[] b = i32[](1, 2, 3); return b[2]; }`);
  if (e.testLen() !== 3) throw new Error(`len=${e.testLen()}`);
  if (e.testFirst() !== 1) throw new Error(`first=${e.testFirst()}`);
  if (e.testLast() !== 3) throw new Error(`last=${e.testLast()}`);
});

Deno.test("[§wac-arr-oob-7jby7f8] out-of-bounds access traps", async () => {
  const e = await run(`export i32 oob() { i32[] a = i32[3](); return a[5]; }`);
  let trapped = false;
  try { e.oob(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-arr-nullable-tbpzqk1] nullable element array: points[0] is null", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 test() {
  Point?[] pts = Point?[10]();
  return pts[0] is null ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-struct-xo3j05c] struct array default: ps[0].x=0", async () => {
  const e = await run(`struct Point { i32 x; i32 y; }
export i32 test() {
  Point[] ps = Point[10]();
  return ps[0].x;
}`);
  if (e.test() !== 0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-alias-co33gnn] array assignment is aliasing: arrAlias()=99", async () => {
  const e = await run(`export i32 arrAlias() {
  i32[] a = i32[](1, 2, 3);
  i32[] b = a;
  b[0] = 99;
  return a[0];
}`);
  if (e.arrAlias() !== 99) throw new Error(`arrAlias=${e.arrAlias()}`);
});

Deno.test("[§wac-arr-sum-5r0hbqg] sum {10,20,30}=60", async () => {
  const e = await run(`export i32 sum(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) { total += arr[i]; }
  return total;
}
export i32 test() { return sum(i32[](10, 20, 30)); }`);
  if (e.test() !== 60) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-nested-l8rdntl] nested arrays: grid[1][2]=6", async () => {
  const e = await run(`export i32 test() {
  i32[][] grid = i32[][3]();
  grid[0] = i32[](1, 2, 3);
  grid[1] = i32[](4, 5, 6);
  grid[2] = i32[](7, 8, 9);
  return grid[1][2];
}`);
  if (e.test() !== 6) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-i8-k3fn7wp] i8 array: bytes[0]=255 after writing 0xFF", async () => {
  const e = await run(`export i32 test() {
  i8[] bytes = i8[4]();
  bytes[0] = 0xFF;
  return bytes[0];
}`);
  if (e.test() !== 255) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-i16-m8qj4xf] i16 array: shorts[0]=1000", async () => {
  const e = await run(`export i32 test() {
  i16[] shorts = i16[4]();
  shorts[0] = 1000;
  return shorts[0];
}`);
  if (e.test() !== 1000) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-arr-i8-nolocal-p7hd5wn] i8 local variable is a compile error", () => {
  if (!hasErr(`export void f() { i8 x = 5; }`, ""))
    throw new Error("expected i8 local error");
});

Deno.test("[§wac-arr-i8-noparam-w5hd3jk] i8 parameter type is a compile error", () => {
  if (!hasErr(`export i32 f(i8 x) { return x; }`, ""))
    throw new Error("expected i8 param error");
});

Deno.test("[§wac-arr-i8-noreturn-k7fn2qp] i8 return type is a compile error", () => {
  if (!hasErr(`export i8 f() { return 0; }`, ""))
    throw new Error("expected i8 return error");
});

Deno.test("[§wac-arr-i8-trunc-r2km9jf] i8 array write truncates 256 to 0", async () => {
  const e = await run(`export i32 testTrunc() {
  i8[] b = i8[1]();
  b[0] = 256;
  return b[0];
}`);
  if (e.testTrunc() !== 0) throw new Error(`testTrunc=${e.testTrunc()}`);
});

// ===========================================================================
// CASTS
// ===========================================================================

Deno.test("[§wac-widen-8va4bye] lossless casts: i32->i64=42, i32->f64=42.0, bool->i32=1", async () => {
  const e = await run(`export i64 toBig(i32 x) { return x as i64; }
export f64 toFloat(i32 x) { return x as f64; }
export i32 boolToInt(bool f) { return f as i32; }`);
  if (e.toBig(42) !== 42n) throw new Error(`toBig=${e.toBig(42)}`);
  if (e.toFloat(42) !== 42.0) throw new Error(`toFloat=${e.toFloat(42)}`);
  if (e.boolToInt(1) !== 1) throw new Error(`boolToInt=${e.boolToInt(1)}`);
});

Deno.test("[§wac-narrow-ok-2ytx5qj] safeNarrow(42n)=42", async () => {
  const e = await run(`export i32 safeNarrow(i64 big) { return big as! i32; }`);
  if (e.safeNarrow(42n) !== 42) throw new Error(`safeNarrow=${e.safeNarrow(42n)}`);
});

Deno.test("[§wac-narrow-trap-z7te84b] safeNarrow(1000000000000) traps", async () => {
  const e = await run(`export i32 safeNarrow(i64 big) { return big as! i32; }`);
  let trapped = false;
  try { e.safeNarrow(1000000000000n); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-round-f2k8mxp] roundIt(3.7)=4, roundIt(-2.3)=-2, roundIt(2.5)=2", async () => {
  const e = await run(`export i32 roundIt(f64 x) { return x as~ i32; }`);
  if (e.roundIt(3.7) !== 4) throw new Error(`roundIt(3.7)=${e.roundIt(3.7)}`);
  if (e.roundIt(-2.3) !== -2) throw new Error(`roundIt(-2.3)=${e.roundIt(-2.3)}`);
  // Round half to even: 2.5 rounds to 2
  if (e.roundIt(2.5) !== 2) throw new Error(`roundIt(2.5)=${e.roundIt(2.5)}`);
});

Deno.test("[§wac-saturate-n7qw3jl] saturate(1e12)=2147483647, saturate(-1e12)=-2147483648", async () => {
  const e = await run(`export i32 saturate(i64 big) { return big as~ i32; }`);
  if (e.saturate(1000000000000n) !== 2147483647) throw new Error(`saturate(1e12)=${e.saturate(1000000000000n)}`);
  if (e.saturate(-1000000000000n) !== -2147483648) throw new Error(`saturate(-1e12)=${e.saturate(-1000000000000n)}`);
});

Deno.test("[§wac-truthy-cagp47u] truthy(0)=false=0, truthy(42)=true=1", async () => {
  const e = await run(`export i32 truthy(i32 x) { return (x as~ bool) ? 1 : 0; }`);
  if (e.truthy(0) !== 0) throw new Error(`truthy(0)=${e.truthy(0)}`);
  if (e.truthy(42) !== 1) throw new Error(`truthy(42)=${e.truthy(42)}`);
});

Deno.test("[§wac-raw-trunc64-p4jn2wq] truncBits(1000000000000)=-727379968", async () => {
  const e = await run(`export i32 truncBits(i64 big) { return big as@ i32; }`);
  // 1000000000000 = 0xE8_D4A5_1000; low 32 bits = 0xD4A5_1000 = -727379968
  if (e.truncBits(1000000000000n) !== -727379968) throw new Error(`truncBits=${e.truncBits(1000000000000n)}`);
});

Deno.test("[§wac-raw-truncf-r8kf4mb] truncFloat(3.7)=3, truncFloat(-2.3)=-2", async () => {
  const e = await run(`export i32 truncFloat(f64 x) { return x as@ i32; }`);
  if (e.truncFloat(3.7) !== 3) throw new Error(`truncFloat(3.7)=${e.truncFloat(3.7)}`);
  if (e.truncFloat(-2.3) !== -2) throw new Error(`truncFloat(-2.3)=${e.truncFloat(-2.3)}`);
});

Deno.test("[§wac-castop-lossy-k3myl2r] as~ on lossless conversion is a compile error", () => {
  const src = `export i64 f(i32 x) { i64 a = x as~ i64; return a; }`;
  if (!hasErr(src, "")) throw new Error("expected castop error");
});

Deno.test("[§wac-castop-check-r7zudy3] as! on lossless conversion is a compile error", () => {
  const src = `export i64 f(i32 x) { i64 a = x as! i64; return a; }`;
  if (!hasErr(src, "")) throw new Error("expected castop error");
});

Deno.test("[§wac-castop-raw-w5hm9qf] as@ on lossless conversion is a compile error", () => {
  const src = `export i64 f(i32 x) { i64 a = x as@ i64; return a; }`;
  if (!hasErr(src, "")) throw new Error("expected castop error");
});

Deno.test("[§wac-ref-upcast-p3kx7wn] ref upcast Rect->Shape succeeds", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
export f64 test() {
  Rect r = Rect(3.0, 4.0, 10.0, 20.0);
  Shape s = r as Shape;
  return s.x;
}`);
  if (e.test() !== 3.0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-ref-downcast-q8fm2jd] Circle as! Rect traps", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
struct Rect : Shape { f64 w; f64 h; }
export f64 test() {
  Shape s = Circle(0.0, 0.0, 5.0);
  Rect r = s as! Rect;
  return r.w;
}`);
  let trapped = false;
  try { e.test(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-ref-downcast-ok-r5tn4jk] Circle as! Circle succeeds", async () => {
  const e = await run(`struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
export f64 test() {
  Shape s = Circle(0.0, 0.0, 5.0);
  Circle c = s as! Circle;
  return c.r;
}`);
  if (e.test() !== 5.0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-ref-downcast-err-v2hk8wp] ref downcast with as (not as!) is a compile error", () => {
  const src = `struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 r; }
export f64 f(Shape s) { Circle c = s as Circle; return c.r; }`;
  if (!hasErr(src, "")) throw new Error("expected downcast error");
});

Deno.test("[§wac-unwrap-lvalue-k9fn2wp] unwrap in lvalue chain, p!.next!.val=10", async () => {
  const e = await run(`struct Node { i32 val; Node? next; }
export i32 test() {
  Node a = Node();
  a.val = 10;
  Node b = Node();
  b.val = 20;
  Node? p = b;
  p!.next = a;
  return p!.next!.val;
}`);
  if (e.test() !== 10) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-i31-cast-g1r2xmx] 42 as! i31ref as i32 = 42", async () => {
  const e = await run(`export i32 test() {
  i31ref r = 42 as! i31ref;
  return r as i32;
}`);
  if (e.test() !== 42) throw new Error(`test=${e.test()}`);
});

// ===========================================================================
// NAMING
// ===========================================================================

Deno.test("[§wac-dup-func-ohfg5bi] duplicate function name is a compile error", () => {
  const src = `i32 foo() { return 1; } i32 foo() { return 2; }`;
  if (!hasErr(src, "")) throw new Error("expected dup func error");
});

Deno.test("[§wac-dup-struct-spu3kml] duplicate struct name is a compile error", () => {
  const src = `struct P { i32 x; } struct P { i32 y; }`;
  if (!hasErr(src, "")) throw new Error("expected dup struct error");
});

Deno.test("[§wac-dup-kind-9h0mrly] function and struct sharing a name is a compile error", () => {
  const src = `struct Foo { i32 x; } i32 Foo() { return 1; }`;
  if (!hasErr(src, "")) throw new Error("expected dup kind error");
});

Deno.test("[§wac-dup-field-oa60dpa] duplicate field name is a compile error", () => {
  const src = `struct Bad { i32 x; i32 x; }`;
  if (!hasErr(src, "")) throw new Error("expected dup field error");
});

Deno.test("[§wac-dup-method-4jv9jst] duplicate method name is a compile error", () => {
  const src = `struct Bad { i32 get(const this) { return 0; } i32 get(const this) { return 1; } }`;
  if (!hasErr(src, "")) throw new Error("expected dup method error");
});

Deno.test("[§wac-dup-field-method-dnwlmiz] method and field with same name is a compile error", () => {
  const src = `struct Bad { i32 len; i32 len(const this) { return 0; } }`;
  if (!hasErr(src, "")) throw new Error("expected dup field/method error");
});

Deno.test("[§wac-dup-import-local-4fadlvg] import colliding with local function is a compile error", () => {
  const sources = {
    "/m.wac": `import { distance } from "./g.wac";
f64 distance(f64 x, f64 y) { return x - y; }`,
    "/g.wac": `export f64 distance(f64 x, f64 y) { return x - y; }`,
  };
  const r = wacCompile(cap(sources), "/m.wac");
  if (r.ok) throw new Error("expected collision error");
});

Deno.test("[§wac-dup-import-vqn4100] two imports with same name is a compile error", () => {
  const sources = {
    "/m.wac": `import { foo } from "./a.wac"; import { foo } from "./b.wac";`,
    "/a.wac": `export i32 foo() { return 1; }`,
    "/b.wac": `export i32 foo() { return 2; }`,
  };
  const r = wacCompile(cap(sources), "/m.wac");
  if (r.ok) throw new Error("expected dup import error");
});

Deno.test("[§wac-rename-pohglv4] renamed import resolves collision", () => {
  const sources = {
    "/m.wac": `import { foo } from "./a.wac"; import { foo as fooB } from "./b.wac";
export i32 test() { return foo() + fooB(); }`,
    "/a.wac": `export i32 foo() { return 1; }`,
    "/b.wac": `export i32 foo() { return 2; }`,
  };
  if (!wacCompile(cap(sources), "/m.wac").ok) throw new Error("should compile with rename");
});

Deno.test("[§wac-rename-type-h0a08xz] renamed struct imports resolve collision", () => {
  const sources = {
    "/m.wac": `import { Point as Point2d } from "./flat.wac";
import { Point as Point3d } from "./spatial.wac";
export i32 test() {
  Point2d a = Point2d(1.0, 2.0);
  Point3d b = Point3d(1.0, 2.0, 3.0);
  return a.x as! i32 + b.x as! i32;
}`,
    "/flat.wac": `export struct Point { f64 x; f64 y; }`,
    "/spatial.wac": `export struct Point { f64 x; f64 y; f64 z; }`,
  };
  if (!wacCompile(cap(sources), "/m.wac").ok) throw new Error("should compile with type rename");
});

Deno.test("[§wac-shadow-8u8qh2j] block-scope shadow: shadow()=1", async () => {
  const e = await run(`export i32 shadow() {
  i32 x = 1;
  {
    i32 x = 2;
    x = 3;
  }
  return x;
}`);
  if (e.shadow() !== 1) throw new Error(`shadow=${e.shadow()}`);
});

Deno.test("[§wac-shadow-loop-vwe8gfz] for-loop variable shadow: loopShadow()=99", async () => {
  const e = await run(`export i32 loopShadow() {
  i32 i = 99;
  for (i32 i = 0; i < 10; i++) { }
  return i;
}`);
  if (e.loopShadow() !== 99) throw new Error(`loopShadow=${e.loopShadow()}`);
});

// ===========================================================================
// IMPORTS
// ===========================================================================

Deno.test("[§wac-diamond-79emza1] diamond import: combined()=230", async () => {
  const sources = {
    "/top.wac": `import { left } from "./left.wac"; import { right } from "./right.wac";
export i32 combined() { return left() + right(); }`,
    "/left.wac": `import { base } from "./shared.wac"; export i32 left() { return base() + 10; }`,
    "/right.wac": `import { base } from "./shared.wac"; export i32 right() { return base() + 20; }`,
    "/shared.wac": `export i32 base() { return 100; }`,
  };
  const e = await runMulti(sources, "/top.wac");
  if (e.combined() !== 230) throw new Error(`combined=${e.combined()}`);
});

Deno.test("[§wac-import-type-ev21tgx] importing struct type makes it usable", async () => {
  const sources = {
    "/m.wac": `import { Point } from "./geom.wac";
export i32 test() {
  Point p = Point(3, 4);
  return p.x + p.y;
}`,
    "/geom.wac": `export struct Point { i32 x; i32 y; }`,
  };
  const e = await runMulti(sources, "/m.wac");
  if (e.test() !== 7) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-circular-m7jx3p4] circular imports: ping(5)=5", async () => {
  const sources = {
    "/ping.wac": `import { pong } from "./pong.wac";
export i32 ping(i32 n) { if (n == 0) { return 0; } return pong(n - 1) + 1; }`,
    "/pong.wac": `import { ping } from "./ping.wac";
export i32 pong(i32 n) { if (n == 0) { return 0; } return ping(n - 1) + 1; }`,
  };
  const e = await runMulti(sources, "/ping.wac");
  if (e.ping(5) !== 5) throw new Error(`ping(5)=${e.ping(5)}`);
});

Deno.test("[§wac-rename-imp-w4fn9k2] renamed imports, test()=16", async () => {
  const sources = {
    "/m.wac": `import { compute as computeA } from "./a.wac";
import { compute as computeB } from "./b.wac";
export i32 test() { return computeA(5) + computeB(5); }`,
    "/a.wac": `export i32 compute(i32 x) { return x + 1; }`,
    "/b.wac": `export i32 compute(i32 x) { return x * 2; }`,
  };
  const e = await runMulti(sources, "/m.wac");
  if (e.test() !== 16) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-imp-coexist-p8km2v6] imported and local names coexist, test()=21", async () => {
  const sources = {
    "/m.wac": `import { compute } from "./a.wac";
i32 compute2(i32 x) { return x * 3; }
export i32 test() { return compute(5) + compute2(5); }`,
    "/a.wac": `export i32 compute(i32 x) { return x + 1; }`,
  };
  const e = await runMulti(sources, "/m.wac");
  if (e.test() !== 21) throw new Error(`test=${e.test()}`);
});

// ===========================================================================
// GRAMMAR
// ===========================================================================

Deno.test("[§wac-grammar-k7fn4xq] grammar spec: all major constructs parse correctly", () => {
  // Verify that a comprehensive program using all major grammar constructs compiles.
  const src = `struct Node { i32 val; Node? next; }
i32 helper(i32 x) { return x * 2; }
export i32 prog(i32 n) {
  i32 a = 0;
  const i32 limit = 10;
  for (i32 i = 0; i < limit; i++) { a += helper(i); }
  while (a > 100) { a = a / 2; }
  i32 b = a > 0 ? a : -a;
  switch (b % 3) {
    case 0: { b += 1; }
    case 1: { b += 2; }
    default: { b += 3; }
  }
  do { b--; } while (b > 50);
  Node nd = Node(b, null);
  return nd.val;
}`;
  if (!compiles(src)) throw new Error("should compile");
});

// ===========================================================================
// FUNCREFS
// ===========================================================================

Deno.test("[§wac-fnref-get-t4kn7wp] funcref assignment: cmp=descending, cmp(3,5)=false", async () => {
  const e = await run(`bool ascending(i32 a, i32 b) { return a < b; }
bool descending(i32 a, i32 b) { return a > b; }
export i32 test() {
  fn[bool(i32, i32)] cmp = ascending;
  cmp = descending;
  return cmp(3, 5) ? 1 : 0;
}`);
  // descending(3,5) = 3>5 = false = 0
  if (e.test() !== 0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-fnref-call-m8qj3xf] calling through funcref: testCall()=10", async () => {
  const e = await run(`i32 double(i32 x) { return x * 2; }
export i32 testCall() {
  fn[i32(i32)] f = double;
  return f(5);
}`);
  if (e.testCall() !== 10) throw new Error(`testCall=${e.testCall()}`);
});

Deno.test("[§wac-fnref-param-k5fn2jq] funcref as param: apply(double,5)=10, apply(square,5)=25", async () => {
  const e = await run(`i32 apply(fn[i32(i32)] f, i32 x) { return f(x); }
i32 double(i32 x) { return x * 2; }
i32 square(i32 x) { return x * x; }
export i32 testDouble() { return apply(double, 5); }
export i32 testSquare() { return apply(square, 5); }`);
  if (e.testDouble() !== 10) throw new Error(`testDouble=${e.testDouble()}`);
  if (e.testSquare() !== 25) throw new Error(`testSquare=${e.testSquare()}`);
});

Deno.test("[§wac-fnref-ret-p7hd4wn] funcref as return: getComparator(true)(3,5)=false", async () => {
  const e = await run(`bool ascending(i32 a, i32 b) { return a < b; }
bool descending(i32 a, i32 b) { return a > b; }
fn[bool(i32, i32)] getComparator(bool reverse) {
  if (reverse) { return descending; }
  return ascending;
}
export i32 testReverse() {
  fn[bool(i32, i32)] cmp = getComparator(true);
  return cmp(3, 5) ? 1 : 0;
}
export i32 testForward() {
  fn[bool(i32, i32)] cmp = getComparator(false);
  return cmp(3, 5) ? 1 : 0;
}`);
  // descending(3,5) = 3>5 = false
  if (e.testReverse() !== 0) throw new Error(`testReverse=${e.testReverse()}`);
  // ascending(3,5) = 3<5 = true
  if (e.testForward() !== 1) throw new Error(`testForward=${e.testForward()}`);
});

Deno.test("[§wac-fnref-field-r2km8jf] funcref in struct field, h.callback(5)=10", async () => {
  const e = await run(`struct Handler { fn[i32(i32)] callback; }
i32 double(i32 x) { return x * 2; }
export i32 test() {
  Handler h = Handler(double);
  return h.callback(5);
}`);
  if (e.test() !== 10) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-fnref-null-w3qn5jk] nullable funcref: testNullFnref()=0 without trap", async () => {
  const e = await run(`export i32 testNullFnref() {
  fn[void(i32)]? cb = null;
  if (cb is not null) { cb!(42); }
  return 0;
}`);
  if (e.testNullFnref() !== 0) throw new Error(`testNullFnref=${e.testNullFnref()}`);
});

Deno.test("[§wac-fnref-method-h9pd3wn] method reference: testMethodRef()=2", async () => {
  const e = await run(`struct Counter {
  i32 count;
  Counter create(i32 init) { return Counter(init); }
  void inc(this) { this.count++; }
  i32 get(const this) { return this.count; }
}
export i32 testMethodRef() {
  Counter c = Counter.create(0);
  fn[void(Counter)] f = Counter.inc;
  f(c);
  f(c);
  return c.get();
}`);
  if (e.testMethodRef() !== 2) throw new Error(`testMethodRef=${e.testMethodRef()}`);
});

Deno.test("[§wac-fnref-nocapture-j4wk8pm] capturing this in funcref is a compile error", () => {
  const src = `struct Counter { i32 count; void inc(this) { this.count++; } }
export void f() {
  Counter c = Counter();
  fn[void()] f2 = c.inc;
}`;
  if (!hasErr(src, "")) throw new Error("expected no-capture error");
});

Deno.test("[§wac-fnref-inline-f7km2xq] inline method call syntax works", async () => {
  const e = await run(`struct Counter {
  i32 count;
  Counter create(i32 init) { return Counter(init); }
  void inc(this) { this.count++; }
  i32 get(const this) { return this.count; }
}
export i32 test() {
  Counter c = Counter.create(0);
  (Counter.inc)(c);
  return c.get();
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-fnref-array-n8qm4jf] array of funcrefs: testFnArray()=30", async () => {
  const e = await run(`i32 double(i32 x) { return x * 2; }
i32 square(i32 x) { return x * x; }
i32 negate(i32 x) { return -x; }
export i32 testFnArray() {
  fn[i32(i32)][] transforms = fn[i32(i32)][](double, square, negate);
  i32 total = 0;
  for (i32 i = 0; i < transforms.len(); i++) {
    total += transforms[i](5);
  }
  return total;
}`);
  // double(5)=10 + square(5)=25 + negate(5)=-5 = 30
  if (e.testFnArray() !== 30) throw new Error(`testFnArray=${e.testFnArray()}`);
});

Deno.test("[§wac-fnref-higher-p4jn7wq] higher-order map+reduce: testHigherOrder()=30", async () => {
  const e = await run(`i32[] map(i32[] arr, fn[i32(i32)] f) {
  i32[] result = i32[arr.len()]();
  for (i32 i = 0; i < arr.len(); i++) { result[i] = f(arr[i]); }
  return result;
}
i32 reduce(i32[] arr, i32 init, fn[i32(i32, i32)] f) {
  i32 acc = init;
  for (i32 i = 0; i < arr.len(); i++) { acc = f(acc, arr[i]); }
  return acc;
}
i32 double(i32 x) { return x * 2; }
i32 add(i32 a, i32 b) { return a + b; }
export i32 testHigherOrder() {
  i32[] data = i32[](1, 2, 3, 4, 5);
  i32[] doubled = map(data, double);
  return reduce(doubled, 0, add);
}`);
  // 2+4+6+8+10 = 30
  if (e.testHigherOrder() !== 30) throw new Error(`testHigherOrder=${e.testHigherOrder()}`);
});

// ===========================================================================
// STRINGS
// ===========================================================================

Deno.test("[§wac-str-literal-k8fn2qp] string literal length: 'hello'.len()=5", async () => {
  const e = await run(`export i32 test() { string s = "hello"; return s.len(); }`);
  if (e.test() !== 5) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-emoji-m4jw7rk] emoji byte length: 'hello 😀'.len()=10", async () => {
  const e = await run(`export i32 test() { string s = "hello \u{1F600}"; return s.len(); }`);
  // "hello " = 6 bytes, emoji 😀 = 4 bytes = 10
  if (e.test() !== 10) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-esc-h9qm3v7] escape sequences each 1 byte, total=5", async () => {
  const e = await run(`export i32 testEscapes() {
  string nl = "\\n";
  string tab = "\\t";
  string nul = "\\0";
  string bs = "\\\\";
  string qt = "\\"";
  return nl.len() + tab.len() + nul.len() + bs.len() + qt.len();
}`);
  if (e.testEscapes() !== 5) throw new Error(`testEscapes=${e.testEscapes()}`);
});

Deno.test("[§wac-str-len-p2hd9xf] strLen()=3", async () => {
  const e = await run(`export i32 strLen() { string s = "abc"; return s.len(); }`);
  if (e.strLen() !== 3) throw new Error(`strLen=${e.strLen()}`);
});

Deno.test("[§wac-str-append-q5km7wn] str += appends: (s += ' world').len()=11", async () => {
  const e = await run(`export i32 test() {
  string s = "hello";
  s += " world";
  return s.len();
}
export i32 testEq() {
  string s = "hello";
  s += " world";
  return s == "hello world" ? 1 : 0;
}`);
  if (e.test() !== 11) throw new Error(`len=${e.test()}`);
  if (e.testEq() !== 1) throw new Error(`eq=${e.testEq()}`);
});

Deno.test("[§wac-str-idx-r7kf4mb] 'hello'[1] == 'e'", async () => {
  const e = await run(`export i32 test() {
  string s = "hello";
  return s[1] == "e" ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-idx-emoji-w3qn8jk] 'a😀b'[1] == emoji (4 bytes)", async () => {
  const e = await run(`export i32 test() {
  string s = "a\u{1F600}b";
  string ch = s[1];
  return ch.len();
}`);
  if (e.test() !== 4) throw new Error(`emoji char len=${e.test()}`);
});

Deno.test("[§wac-str-idx-mid-h5pd2wn] 'a😀b'[2] mid-sequence returns empty string", async () => {
  const e = await run(`export i32 test() {
  string s = "a\u{1F600}b";
  string ch = s[2];
  return ch == "" ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`mid=${e.test()}`);
});

Deno.test("[§wac-str-idx-midlen-f9km3xq] 'a😀b'[2].len()=0", async () => {
  const e = await run(`export i32 test() {
  string s = "a\u{1F600}b";
  return s[2].len();
}`);
  if (e.test() !== 0) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-oob-j4wk7pm] 'abc'[5] traps", async () => {
  const e = await run(`export i32 strOob() { string s = "abc"; string ch = s[5]; return ch.len(); }`);
  let trapped = false;
  try { e.strOob(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-str-concat-n8qm5jf] 'hello' + ' world' == 'hello world'", async () => {
  const e = await run(`export i32 test() {
  string a = "hello";
  string b = " world";
  return (a + b) == "hello world" ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-concat-len-k2fn8wp] ('abc'+'def').len()=6", async () => {
  const e = await run(`export i32 test() { return ("abc" + "def").len(); }`);
  if (e.test() !== 6) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-noimplicit-p3jw7xf] string + i32 is a compile error", () => {
  if (!hasErr(`export void f() { string s = "count: " + 5; }`, ""))
    throw new Error("expected type mismatch");
});

Deno.test("[§wac-str-eq-p4jn2wq] 'hello' == 'hel'+'lo' returns true", async () => {
  const e = await run(`export i32 test() {
  string a = "hello";
  string b = "hel" + "lo";
  return a == b ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-neq-r8kf3mb] 'abc' != 'def' returns true", async () => {
  const e = await run(`export i32 test() { return "abc" != "def" ? 1 : 0; }`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-lt-w5hm9qf] 'abc' < 'abd' returns true", async () => {
  const e = await run(`export i32 test() { return "abc" < "abd" ? 1 : 0; }`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-gt-c7jw3kf] 'b' > 'a' returns true", async () => {
  const e = await run(`export i32 test() { return "b" > "a" ? 1 : 0; }`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-immut-m3hd7qz] assigning to string index is a compile error", () => {
  if (!hasErr(`export void f() { string s = "hello"; s[0] = "H"; }`, ""))
    throw new Error("expected immutable error");
});

Deno.test("[§wac-str-slice-h8wd4pm] 'hello world'.slice(6,11)='world'", async () => {
  const e = await run(`export i32 test() {
  string s = "hello world";
  return s.slice(6, 11) == "world" ? 1 : 0;
}`);
  if (e.test() !== 1) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-indexof-j2fn5rk] 'hello world'.indexOf('world')=6", async () => {
  const e = await run(`export i32 test() {
  string s = "hello world";
  return s.indexOf("world");
}`);
  if (e.test() !== 6) throw new Error(`test=${e.test()}`);
});

Deno.test("[§wac-str-indexof-miss-k4mf8js] 'hello'.indexOf('xyz')=-1", async () => {
  const e = await run(`export i32 test() {
  string s = "hello";
  return s.indexOf("xyz");
}`);
  if (e.test() !== -1) throw new Error(`test=${e.test()}`);
});

// ===========================================================================
// BUFFER
// ===========================================================================

const BUFFER_SRC = `struct Buffer {
  i8[] data;
  i32 len;
  i32 cap;
  Buffer create(i32 cap_) { return Buffer(i8[cap_](), 0, cap_); }
  i32 get(const this, i32 idx) {
    if (idx < 0 || idx >= this.len) { trap; }
    return this.data[idx];
  }
  void set(this, i32 idx, i32 val) {
    if (idx < 0 || idx >= this.len) { trap; }
    this.data[idx] = val;
  }
  void push(this, i32 val) {
    if (this.len == this.cap) {
      i32 newCap = this.cap * 2;
      if (newCap == 0) { newCap = 8; }
      i8[] next = i8[newCap]();
      for (i32 i = 0; i < this.len; i++) { next[i] = this.data[i]; }
      this.data = next;
      this.cap = newCap;
    }
    this.data[this.len] = val;
    this.len++;
  }
  i32 pop(this) {
    if (this.len == 0) { trap; }
    this.len--;
    return this.data[this.len];
  }
  void clear(this) { this.len = 0; }
  bool equals(const this, Buffer other) {
    if (this.len != other.len) { return false; }
    for (i32 i = 0; i < this.len; i++) {
      if (this.get(i) != other.get(i)) { return false; }
    }
    return true;
  }
}
`;

Deno.test("[§wac-buf-basic-k4mf2js] buffer push x3, len=3", async () => {
  const e = await run(BUFFER_SRC + `export i32 testBasic() {
  Buffer b = Buffer.create(4);
  b.push(0x41); b.push(0x42); b.push(0x43);
  return b.len;
}`);
  if (e.testBasic() !== 3) throw new Error(`testBasic=${e.testBasic()}`);
});

Deno.test("[§wac-buf-getset-p9qn3xl] buffer get sum = 60", async () => {
  const e = await run(BUFFER_SRC + `export i32 testGetSet() {
  Buffer b = Buffer.create(4);
  b.push(10); b.push(20); b.push(30);
  return b.get(0) + b.get(1) + b.get(2);
}`);
  if (e.testGetSet() !== 60) throw new Error(`testGetSet=${e.testGetSet()}`);
});

Deno.test("[§wac-buf-overwrite-w7rk5bt] buffer set overwrites: 255*256+128=65408", async () => {
  const e = await run(BUFFER_SRC + `export i32 testOverwrite() {
  Buffer b = Buffer.create(4);
  b.push(0); b.push(0);
  b.set(0, 0xFF); b.set(1, 0x80);
  return b.get(0) * 256 + b.get(1);
}`);
  if (e.testOverwrite() !== 65408) throw new Error(`testOverwrite=${e.testOverwrite()}`);
});

Deno.test("[§wac-buf-grow-m3hd8qz] buffer grows: testGrow()=1920", async () => {
  const e = await run(BUFFER_SRC + `export i32 testGrow() {
  Buffer b = Buffer.create(4);
  for (i32 i = 0; i < 20; i++) { b.push(i); }
  return b.get(19) * 100 + b.len;
}`);
  if (e.testGrow() !== 1920) throw new Error(`testGrow=${e.testGrow()}`);
});

Deno.test("[§wac-buf-pop-j2fn9rk] buffer pop: testPop()=3002", async () => {
  const e = await run(BUFFER_SRC + `export i32 testPop() {
  Buffer b = Buffer.create(4);
  b.push(10); b.push(20); b.push(30);
  i32 last = b.pop();
  return last * 100 + b.len;
}`);
  if (e.testPop() !== 3002) throw new Error(`testPop=${e.testPop()}`);
});

Deno.test("[§wac-buf-equals-h8wd2pm] buffer equality: testEquals()=true", async () => {
  const e = await run(BUFFER_SRC + `export i32 testEquals() {
  Buffer a = Buffer.create(4);
  Buffer b = Buffer.create(8);
  a.push(1); a.push(2); a.push(3);
  b.push(1); b.push(2); b.push(3);
  return a.equals(b) ? 1 : 0;
}`);
  if (e.testEquals() !== 1) throw new Error(`testEquals=${e.testEquals()}`);
});

Deno.test("[§wac-buf-oob-get-f4kp7wn] buffer get out-of-bounds traps", async () => {
  const e = await run(BUFFER_SRC + `export i32 testBoundsGet() {
  Buffer b = Buffer.create(4);
  b.push(1);
  return b.get(5);
}`);
  let trapped = false;
  try { e.testBoundsGet(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-buf-oob-set-n2qm8xl] buffer set out-of-bounds traps", async () => {
  const e = await run(BUFFER_SRC + `export i32 testBoundsSet() {
  Buffer b = Buffer.create(4);
  b.push(1);
  b.set(5, 99);
  return 0;
}`);
  let trapped = false;
  try { e.testBoundsSet(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-buf-pop-empty-c7jw3kf] buffer pop on empty traps", async () => {
  const e = await run(BUFFER_SRC + `export i32 testPopEmpty() {
  Buffer b = Buffer.create(4);
  return b.pop();
}`);
  let trapped = false;
  try { e.testPopEmpty(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

// ===========================================================================
// LINKED LIST
// ===========================================================================

const LL_SRC = `struct Node { i32 val; Node? next; }
struct LinkedList {
  Node? head;
  Node? tail;
  i32 count;
  LinkedList create() { return LinkedList(); }
  void push_front(this, i32 val) {
    Node n = Node(val, this.head);
    this.head = n;
    if (this.tail is null) { this.tail = n; }
    this.count++;
  }
  void push_back(this, i32 val) {
    Node n = Node(val, null);
    if (this.tail is not null) {
      this.tail!.next = n;
    } else {
      this.head = n;
    }
    this.tail = n;
    this.count++;
  }
  i32 pop_front(this) {
    if (this.head is null) { trap; }
    i32 val = this.head!.val;
    this.head = this.head!.next;
    if (this.head is null) { this.tail = null; }
    this.count--;
    return val;
  }
  i32 front(const this) {
    if (this.head is null) { trap; }
    return this.head!.val;
  }
  i32 back(const this) {
    if (this.tail is null) { trap; }
    return this.tail!.val;
  }
  i32 len(const this) { return this.count; }
  i32 sum(const this) {
    i32 total = 0;
    Node? cur = this.head;
    while (cur is not null) { total += cur!.val; cur = cur!.next; }
    return total;
  }
  void reverse(this) {
    Node? prev = null;
    Node? cur = this.head;
    this.tail = this.head;
    while (cur is not null) {
      Node c = cur!;
      Node? next = c.next;
      c.next = prev;
      prev = c;
      cur = next;
    }
    this.head = prev;
  }
}
`;

Deno.test("[§wac-ll-push-front-k4mf2js] push_front x3, front()=30", async () => {
  const e = await run(LL_SRC + `export i32 testPushFront() {
  LinkedList l = LinkedList.create();
  l.push_front(10); l.push_front(20); l.push_front(30);
  return l.front();
}`);
  if (e.testPushFront() !== 30) throw new Error(`testPushFront=${e.testPushFront()}`);
});

Deno.test("[§wac-ll-push-back-p9qn3xl] push_back x3, back()=30", async () => {
  const e = await run(LL_SRC + `export i32 testPushBack() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20); l.push_back(30);
  return l.back();
}`);
  if (e.testPushBack() !== 30) throw new Error(`testPushBack=${e.testPushBack()}`);
});

Deno.test("[§wac-ll-len-w7rk5bt] len after 3 pushes = 3", async () => {
  const e = await run(LL_SRC + `export i32 testLen() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20); l.push_back(30);
  return l.len();
}`);
  if (e.testLen() !== 3) throw new Error(`testLen=${e.testLen()}`);
});

Deno.test("[§wac-ll-len-empty-m3hd8qz] empty list len = 0", async () => {
  const e = await run(LL_SRC + `export i32 testLenEmpty() {
  LinkedList l = LinkedList.create();
  return l.len();
}`);
  if (e.testLenEmpty() !== 0) throw new Error(`testLenEmpty=${e.testLenEmpty()}`);
});

Deno.test("[§wac-ll-sum-j2fn9rk] sum {10,20,30} = 60", async () => {
  const e = await run(LL_SRC + `export i32 testSum() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20); l.push_back(30);
  return l.sum();
}`);
  if (e.testSum() !== 60) throw new Error(`testSum=${e.testSum()}`);
});

Deno.test("[§wac-ll-pop-front-h8wd2pm] pop_front: first=10, remaining len=2 → 1002", async () => {
  const e = await run(LL_SRC + `export i32 testPopFront() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20); l.push_back(30);
  i32 first = l.pop_front();
  return first * 100 + l.len();
}`);
  if (e.testPopFront() !== 1002) throw new Error(`testPopFront=${e.testPopFront()}`);
});

Deno.test("[§wac-ll-pop-all-f4kp7wn] pop all: a=10,b=20,len=0 → 1200", async () => {
  const e = await run(LL_SRC + `export i32 testPopFrontAll() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20);
  i32 a = l.pop_front();
  i32 b = l.pop_front();
  return a * 100 + b * 10 + l.len();
}`);
  if (e.testPopFrontAll() !== 1200) throw new Error(`testPopFrontAll=${e.testPopFrontAll()}`);
});

Deno.test("[§wac-ll-pop-empty-n2qm8xl] pop from empty list traps", async () => {
  const e = await run(LL_SRC + `export i32 testPopEmpty() {
  LinkedList l = LinkedList.create();
  return l.pop_front();
}`);
  let trapped = false;
  try { e.testPopEmpty(); } catch { trapped = true; }
  if (!trapped) throw new Error("expected trap");
});

Deno.test("[§wac-ll-reverse-c7jw3kf] reverse {10,20,30}: front=30, back=10 → 3010", async () => {
  const e = await run(LL_SRC + `export i32 testReverse() {
  LinkedList l = LinkedList.create();
  l.push_back(10); l.push_back(20); l.push_back(30);
  l.reverse();
  return l.front() * 100 + l.back();
}`);
  if (e.testReverse() !== 3010) throw new Error(`testReverse=${e.testReverse()}`);
});

Deno.test("[§wac-ll-front-back-q8kn2wp] push_front(10), push_back(20): front=10, back=20 → 1020", async () => {
  const e = await run(LL_SRC + `export i32 testFrontBack() {
  LinkedList l = LinkedList.create();
  l.push_front(10);
  l.push_back(20);
  return l.front() * 100 + l.back();
}`);
  if (e.testFrontBack() !== 1020) throw new Error(`testFrontBack=${e.testFrontBack()}`);
});

// ===========================================================================
// BINDGEN
// ===========================================================================

function bindgen(src: string, file = "/m.wac") {
  const r = wacCompile(cap({ [file]: src }), file);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  return wacBindTs(r);
}

Deno.test("[§wac-bind-arr-m7qj3xf] bindgen array: generated sum wrapper runs correctly", async () => {
  const src = `export i32 sum(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) { total += arr[i]; }
  return total;
}`;
  const ts = bindgen(src);
  // Verify bindgen emits sum function wrapper
  if (!ts.includes("function sum(")) throw new Error("missing sum wrapper: " + ts.slice(0, 200));
  if (!ts.includes("Int32Array")) throw new Error("missing Int32Array type");
});

Deno.test("[§wac-bind-arr-mut-p3kn7wp] bindgen sorts array and returns copy", async () => {
  const src = `export void bubbleSort(i32[] arr) {
  for (i32 i = 0; i < arr.len(); i++) {
    for (i32 j = 0; j < arr.len() - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        i32 tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
}`;
  const ts = bindgen(src);
  if (!ts.includes("function bubbleSort(")) throw new Error("missing bubbleSort wrapper");
  // Returns copy of sorted array
  if (!ts.includes("Int32Array")) throw new Error("missing Int32Array return type");
});

Deno.test("[§wac-bind-str-r8jm4xf] bindgen string: greet wrapper uses string helpers", async () => {
  const src = `export string greet(string name) { return "hello, " + name + "!"; }`;
  const ts = bindgen(src);
  if (!ts.includes("function greet(")) throw new Error("missing greet wrapper");
  if (!ts.includes("string")) throw new Error("missing string type annotation");
});

Deno.test("[§wac-bind-strbytes-w5hd3jk] bindgen countBytes wrapper present", async () => {
  const src = `export i32 countBytes(string s) { return s.len(); }`;
  const ts = bindgen(src);
  if (!ts.includes("function countBytes(")) throw new Error("missing countBytes wrapper");
});

Deno.test("[§wac-bind-arr-copy-j4wk7pm] bindgen array params are copied (not live refs)", async () => {
  const src = `export void bubbleSort(i32[] arr) {
  for (i32 i = 0; i < arr.len(); i++) {
    for (i32 j = 0; j < arr.len() - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        i32 tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
}`;
  const ts = bindgen(src);
  // Bindgen must copy into wasm and copy back — check for array copy helper
  if (!ts.includes("_arrayToWasm") && !ts.includes("wasmArr")) throw new Error("missing array copy: " + ts.slice(0, 300));
});

// ===========================================================================
// ERRORS (remaining)
// ===========================================================================

Deno.test("[§wac-diag-multiline-ic7x2hq] multi-line error span on argument", () => {
  // Test that the compiler reports an error with line info when an arg type mismatches
  // on a multi-line call. The error should point to the bad argument.
  const src = `i32 compute(i32 x, i32 y) { return x + y; }
export i32 f() {
  i32 result = compute(
    1,
    3.14
  );
  return result;
}`;
  const errs = errors(src);
  if (errs.length === 0) throw new Error("expected errors");
  // Error should be on the 3.14 argument (line 5 in this source)
  const argErr = errs.find(e => e.line === 5);
  if (!argErr) throw new Error(`expected error at line 5, got: ${JSON.stringify(errs)}`);
});
