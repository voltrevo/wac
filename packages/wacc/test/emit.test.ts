// Rung 4's oracle, first slice: **run what both compilers emit and compare the answers.**
//
// The README argues at length that byte identity is the wrong oracle for this rung — it pins the type
// section's dedup order, index assignment, LEB widths and a name section, none of which is the
// language, and the reference emitter changed emitted bytes several times in the week that argument
// was written. What it proposes instead is the oracle already sitting in this repository for nothing:
// compile a program and *run* it.
//
// So this asks each program of both compilers, instantiates both modules, calls the export with the
// same arguments, and compares what comes back. Nothing here asserts an expected answer: a hand-written
// `5` would be a third opinion, and the point of a differential test is that there are only two.
//
// It is a fraction of the language — an exported `i32` function whose body is one `return` over
// literals, parameters and arithmetic — and the fraction is not the point. The point is that the shape
// is end to end, so the next rule the emitter learns is measured by running it.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emit = mod.emit as (src: Uint8Array) => Uint8Array;
const enc = new TextEncoder();

/** The exports of a module wacc emitted for this source. */
function ours(src: string): Record<string, unknown> {
  const bytes = Uint8Array.from(emit(enc.encode(src)) as unknown as number[]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
}

/** The exports of a module the reference emitted for the same source. */
function reference(src: string): Record<string, unknown> {
  const result = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
  if (!result.ok) {
    throw new Error(`the reference will not compile it: ` +
      result.diagnostics.map((d) => d.message).join("; "));
  }
  // Copied into a fresh array: the compiler's buffer is typed against its own ArrayBuffer.
  return new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(result.compiled.wasm)),
    {},
  ).exports;
}

// `bigint` because an `i64` crosses the boundary as one, in both directions.
type Call = { name: string; args: (number | bigint)[] };

const CASES: [string, Call[]][] = [
  ["export i32 answer() { return 42; }", [{ name: "answer", args: [] }]],
  ["export i32 add(i32 a, i32 b) { return a + b; }", [
    { name: "add", args: [2, 3] },
    { name: "add", args: [-1, 1] },
    // Wrapping is the language's own answer and not a special case, so it is asked rather than avoided.
    { name: "add", args: [2147483647, 1] },
  ]],
  ["export i32 sub(i32 a, i32 b) { return a - b; }", [{ name: "sub", args: [3, 10] }]],
  ["export i32 mul(i32 a, i32 b) { return a * b; }", [
    { name: "mul", args: [6, 7] },
    { name: "mul", args: [-3, 5] },
  ]],
  ["export i32 mix(i32 a, i32 b) { return a * 2 + b - 1; }", [{ name: "mix", args: [10, 4] }]],
  ["export i32 second(i32 a, i32 b) { return b; }", [{ name: "second", args: [8, 9] }]],
  // More than one function, so the index assignment and the export table have to line up.
  ["export i32 one() { return 1; } export i32 two(i32 a) { return a + a; }", [
    { name: "one", args: [] },
    { name: "two", args: [21] },
  ]],
  // A literal wide enough to need more than one LEB byte, in both signs.
  ["export i32 big() { return 100000; }", [{ name: "big", args: [] }]],
  ["export i32 neg() { return 0 - 100000; }", [{ name: "neg", args: [] }]],

  // ── Locals and assignment ──────────────────────────────────────────────────
  ["export i32 f(i32 a) { i32 x = a + 1; return x * x; }", [{ name: "f", args: [4] }]],
  ["export i32 f(i32 a) { i32 x = a; x = x + 10; x = x * 2; return x; }", [{ name: "f", args: [3] }]],
  ["export i32 f(i32 a) { i32 x = a; x += 5; x -= 2; x *= 3; return x; }", [{ name: "f", args: [1] }]],
  // Two locals, so the indices have to be assigned in declaration order after the parameters.
  ["export i32 f(i32 a, i32 b) { i32 x = a * 2; i32 y = b * 3; return x + y; }",
    [{ name: "f", args: [5, 7] }]],

  // ── The rest of the i32 operators, signedness included ──────────────────────
  ["export i32 f(i32 a, i32 b) { return a / b; }", [
    { name: "f", args: [7, 2] },
    // Signed division truncates toward zero, which is the half `i32.div_u` would get wrong.
    { name: "f", args: [-7, 2] },
  ]],
  ["export i32 f(i32 a, i32 b) { return a % b; }", [
    { name: "f", args: [7, 3] },
    { name: "f", args: [-7, 3] },
  ]],
  ["export i32 f(i32 a, i32 b) { return (a & b) + (a | b) + (a ^ b); }",
    [{ name: "f", args: [12, 10] }]],
  ["export i32 f(i32 a, i32 b) { return a << b; }", [{ name: "f", args: [1, 10] }]],
  // `>>` is arithmetic here because everything in this slice is `i32`. The logical twin needs an
  // unsigned operand to be reached at all, and an unsigned *type* is what this slice does not have —
  // so `>>>` is deliberately not exercised rather than exercised wrongly.
  ["export i32 f(i32 a) { return a >> 1; }", [{ name: "f", args: [-8] }]],
  ["export i32 f(i32 a) { return -a; }", [{ name: "f", args: [5] }]],
  ["export i32 f(i32 a) { return ~a; }", [{ name: "f", args: [5] }]],

  // ── Comparisons and the boolean operators ──────────────────────────────────
  ["export bool f(i32 a, i32 b) { return a < b; }", [
    { name: "f", args: [1, 2] },
    { name: "f", args: [2, 1] },
    // Signed comparison, which is the half `lt_u` would get wrong.
    { name: "f", args: [-1, 1] },
  ]],
  ["export bool f(i32 a, i32 b) { return a == b || a > b; }", [
    { name: "f", args: [3, 3] },
    { name: "f", args: [4, 3] },
    { name: "f", args: [2, 3] },
  ]],
  ["export bool f(i32 a, i32 b) { return a != b && a <= b; }", [
    { name: "f", args: [1, 2] },
    { name: "f", args: [2, 2] },
  ]],
  ["export bool f(bool a) { return !a; }", [{ name: "f", args: [1] }, { name: "f", args: [0] }]],
  // Short-circuit is observable: if `||` evaluated its right side, this would divide by zero and trap.
  ["export bool f(i32 a) { return a == 0 || 10 / a > 1; }", [{ name: "f", args: [0] }]],

  // ── Control flow ───────────────────────────────────────────────────────────
  ["export i32 f(i32 a) { if (a > 0) { return 1; } return 0; }", [
    { name: "f", args: [5] },
    { name: "f", args: [-5] },
  ]],
  ["export i32 f(i32 a) { if (a > 0) { return 1; } else { return 2; } }", [
    { name: "f", args: [1] },
    { name: "f", args: [-1] },
  ]],
  ["export i32 f(i32 n) { i32 total = 0; i32 i = 0; while (i < n) { total = total + i; i = i + 1; } return total; }",
    [{ name: "f", args: [5] }, { name: "f", args: [0] }, { name: "f", args: [100] }]],
  // A loop whose body has an `if` in it, so the labels have to nest correctly.
  ["export i32 f(i32 n) { i32 c = 0; i32 i = 0; while (i < n) { if (i % 2 == 0) { c = c + 1; } i = i + 1; } return c; }",
    [{ name: "f", args: [10] }]],
  ["export i32 f(bool c, i32 a, i32 b) { return c ? a : b; }", [
    { name: "f", args: [1, 7, 9] },
    { name: "f", args: [0, 7, 9] },
  ]],

  // ── Calls ──────────────────────────────────────────────────────────────────
  ["i32 twice(i32 a) { return a * 2; } export i32 f(i32 a) { return twice(a) + twice(1); }",
    [{ name: "f", args: [10] }]],
  // A call to something declared *after* it, which is why the names are collected in a pass of
  // their own.
  ["export i32 f(i32 a) { return later(a); } i32 later(i32 a) { return a + 100; }",
    [{ name: "f", args: [1] }]],
  // Recursion, which is a call that has to work before the function it is in is finished.
  ["export i32 fact(i32 n) { if (n <= 1) { return 1; } return n * fact(n - 1); }",
    [{ name: "fact", args: [1] }, { name: "fact", args: [5] }, { name: "fact", args: [10] }]],

  // ── Unsigned: the same 32 bits, and different opcodes to read them ──────────
  // Every one of these is the half a signed opcode gets wrong, so the earlier slice would have agreed
  // on small arguments and been silently wrong here.
  ["export u32 f(u32 a, u32 b) { return a / b; }", [{ name: "f", args: [4294967288, 2] }]],
  ["export u32 f(u32 a, u32 b) { return a % b; }", [{ name: "f", args: [4294967288, 3] }]],
  ["export u32 f(u32 a) { return a >> 1; }", [{ name: "f", args: [4294967288] }]],
  ["export bool f(u32 a, u32 b) { return a < b; }", [{ name: "f", args: [4294967288, 1] }]],
  ["export bool f(u32 a, u32 b) { return a >= b; }", [{ name: "f", args: [1, 4294967288] }]],

  // ── i64, a different opcode block entirely ─────────────────────────────────
  ["export i64 f(i64 a, i64 b) { return a + b; }", [{ name: "f", args: [2n, 3n] }]],
  ["export i64 f(i64 a, i64 b) { return a * b; }", [{ name: "f", args: [4294967296n, 3n] }]],
  ["export i64 f(i64 a, i64 b) { return a / b; }", [{ name: "f", args: [-9n, 2n] }]],
  ["export i64 f(i64 a) { return a << 40; }", [{ name: "f", args: [1n] }]],
  ["export i64 f(i64 a) { i64 x = a; x += 1; return x * 2; }", [{ name: "f", args: [10n] }]],
  ["export bool f(i64 a, i64 b) { return a < b; }", [{ name: "f", args: [-1n, 1n] }]],
  ["export u64 f(u64 a, u64 b) { return a / b; }", [{ name: "f", args: [18446744073709551608n, 2n] }]],
  ["export i64 f(i64 n) { i64 t = 0; i64 i = 0; while (i < n) { t = t + i; i = i + 1; } return t; }",
    [{ name: "f", args: [10n] }]],
  // A literal takes the other side's type, which is what makes this an i64 addition.
  ["export i64 f(i64 a) { return a + 1; }", [{ name: "f", args: [4294967295n] }]],

  // ── Floats, whose opcodes are a block of their own ─────────────────────────
  ["export f64 f(f64 a, f64 b) { return a + b; }", [{ name: "f", args: [1.5, 2.25] }]],
  ["export f64 f(f64 a, f64 b) { return a / b; }", [{ name: "f", args: [1.0, 3.0] }]],
  ["export f64 f(f64 a) { return -a; }", [{ name: "f", args: [2.5] }]],
  ["export bool f(f64 a, f64 b) { return a < b; }", [{ name: "f", args: [1.5, 2.5] }]],
  ["export f64 f() { f64 x = 1.5; return x * 2.0; }", [{ name: "f", args: [] }]],
  ["export f32 f(f32 a, f32 b) { return a * b; }", [{ name: "f", args: [1.5, 3.0] }]],
  ["export f64 f(f64 a) { f64 t = 0.0; i32 i = 0; while (i < 4) { t = t + a; i = i + 1; } return t; }",
    [{ name: "f", args: [0.25] }]],

  // ── Conversions, including the one that is nothing at all ──────────────────
  ["export u32 f(i32 a) { return a as@ u32; }", [{ name: "f", args: [-8] }]],
  ["export i32 f(u32 a) { return a as@ i32; }", [{ name: "f", args: [4294967288] }]],
  ["export i64 f(i32 a) { return a as i64; }", [{ name: "f", args: [-5] }]],
  ["export i64 f(u32 a) { return a as i64; }", [{ name: "f", args: [4294967288] }]],
  // `as~` from a wider integer **saturates**, so the out-of-range cases are the whole point: both
  // bounds, both directions, and the in-range value that must still pass straight through.
  ["export i32 f(i64 a) { return a as~ i32; }", [
    { name: "f", args: [7n] },
    { name: "f", args: [-7n] },
    { name: "f", args: [4294967303n] },
    { name: "f", args: [-4294967303n] },
    { name: "f", args: [2147483647n] },
    { name: "f", args: [-2147483648n] },
    { name: "f", args: [9223372036854775807n] },
    { name: "f", args: [-9223372036854775808n] },
  ]],
  ["export u32 f(i64 a) { return a as~ u32; }", [
    { name: "f", args: [7n] },
    { name: "f", args: [-7n] },
    { name: "f", args: [4294967295n] },
    { name: "f", args: [4294967296n] },
  ]],
  ["export u32 f(u64 a) { return a as~ u32; }", [
    { name: "f", args: [7n] },
    { name: "f", args: [18446744073709551615n] },
  ]],
  ["export f64 f(i32 a) { return a as f64; }", [{ name: "f", args: [-3] }]],
  ["export f64 f(u32 a) { return a as f64; }", [{ name: "f", args: [4294967288] }]],
  // Rounded, not truncated: `as~` reads like C's truncation and is not it. The ties are asked about
  // too, because half-to-even and half-away-from-zero differ exactly there and both are defensible.
  ["export i32 f(f64 a) { return a as~ i32; }", [
    { name: "f", args: [3.9] },
    { name: "f", args: [3.4] },
    { name: "f", args: [-3.9] },
    { name: "f", args: [2.5] },
    { name: "f", args: [3.5] },
  ]],
  ["export f64 f(f32 a) { return a as f64; }", [{ name: "f", args: [1.5] }]],
  ["export f32 f(f64 a) { return a as~ f32; }", [{ name: "f", args: [1.5] }]],

  // ── The rest of control flow, where a wrong label validates and jumps elsewhere ──
  ["export i32 f(i32 n) { i32 t = 0; for (i32 i = 0; i < n; i++) { t = t + i; } return t; }",
    [{ name: "f", args: [5] }, { name: "f", args: [0] }]],
  ["export i32 f(i32 n) { i32 t = 0; i32 i = 0; do { t = t + i; i = i + 1; } while (i < n); return t; }",
    // The body runs once even when the condition is false from the start, which is the whole
    // difference between the two loops and the only case that tells them apart.
    [{ name: "f", args: [5] }, { name: "f", args: [0] }]],
  ["export i32 f(i32 n) { i32 t = 0; i32 i = 0; while (true) { if (i >= n) { break; } t = t + i; i = i + 1; } return t; }",
    [{ name: "f", args: [5] }]],
  ["export i32 f(i32 n) { i32 t = 0; for (i32 i = 0; i < n; i++) { if (i % 2 == 0) { continue; } t = t + i; } return t; }",
    // `continue` in a `for` must reach the update, or this never terminates.
    [{ name: "f", args: [10] }]],
  // Nested loops: the inner `break` leaves the inner loop only, which is what the relative depth is.
  ["export i32 f(i32 n) { i32 t = 0; for (i32 i = 0; i < n; i++) { for (i32 j = 0; j < n; j++) { if (j > i) { break; } t = t + 1; } } return t; }",
    [{ name: "f", args: [4] }]],
  // A `break` under an `if` under a loop: one more label between it and what it means.
  ["export i32 f(i32 n) { i32 i = 0; while (i < n) { if (i == 3) { break; } i = i + 1; } return i; }",
    [{ name: "f", args: [10] }, { name: "f", args: [2] }]],
  ["export i32 f(i32 a) { switch (a) { case 1: { return 10; } case 2: { return 20; } default: { return 0; } } }",
    [{ name: "f", args: [1] }, { name: "f", args: [2] }, { name: "f", args: [7] }]],
  ["export i32 f(i32 a) { i32 r = 0; switch (a) { case 1: { r = 10; break; } case 2: { r = 20; break; } default: { r = -1; } } return r; }",
    [{ name: "f", args: [1] }, { name: "f", args: [2] }, { name: "f", args: [9] }]],

  // ── Arrays: the first wasm GC type ─────────────────────────────────────────
  ["export i32 f() { i32[] a = i32[3](); a[0] = 7; return a[0] + a.len(); }", [{ name: "f", args: [] }]],
  ["export i32 f() { i32[] a = i32[4](fill: 9); return a[2] + a.len(); }", [{ name: "f", args: [] }]],
  ["export i32 f() { i32[] a = i32[](4, 5, 6); return a[1] * a.len(); }", [{ name: "f", args: [] }]],
  // An array cannot cross the JS boundary as an argument — it is a reference — so the array is built
  // inside and the index is what comes in.
  ["i32 at(i32[] a, i32 i) { return a[i]; } export i32 f(i32 i) { return at(i32[](7, 8, 9), i); }",
    [{ name: "f", args: [0] }, { name: "f", args: [2] }]],
  ["export i32 f() { i32[] a = i32[5](); i32 t = 0; for (i32 i = 0; i < a.len(); i++) { a[i] = i * i; } for (i32 i = 0; i < a.len(); i++) { t = t + a[i]; } return t; }",
    [{ name: "f", args: [] }]],
  // A packed element: the getter has to zero-extend, which is the half a signed one gets wrong.
  ["export i32 f() { u8[] b = u8[3](); b[0] = 200; return b[0]; }", [{ name: "f", args: [] }]],
  ["export i32 f() { i8[] b = i8[3](); b[0] = 200; return b[0]; }", [{ name: "f", args: [] }]],
  ["export i32 f() { u8[] b = u8[](1, 2, 250); return b[2] + b.len(); }", [{ name: "f", args: [] }]],
  // Wider elements, so the array type's storage type is not always i32.
  ["export i64 f() { i64[] a = i64[2](); a[1] = 4294967296; return a[1]; }", [{ name: "f", args: [] }]],
  ["export f64 f() { f64[] a = f64[2](fill: 1.5); return a[0] + a[1]; }", [{ name: "f", args: [] }]],
  // Two array types in one module, so the indices have to be distinct and stable.
  ["export i32 f() { i32[] a = i32[2](fill: 3); u8[] b = u8[2](fill: 4); return a[0] + b[0]; }",
    [{ name: "f", args: [] }]],
  // An array through a call, which puts a reference type in a signature.
  ["i32 first(i32[] xs) { return xs[0]; } export i32 f() { return first(i32[](11, 22)); }",
    [{ name: "f", args: [] }]],

  // ── Structs: the second GC type ────────────────────────────────────────────
  ["struct P { i32 x; i32 y; } export i32 f() { P p = P(3, 4); return p.x + p.y; }",
    [{ name: "f", args: [] }]],
  ["struct P { i32 x; i32 y; } export i32 f() { P p = P(3, 4); p.x = 9; return p.x * p.y; }",
    [{ name: "f", args: [] }]],
  // A method: the receiver is the first parameter, which is the whole of what a method is here.
  ["struct P { i32 x; i32 dbl(const this) { return this.x * 2; } } export i32 f() { P p = P(5); return p.dbl(); }",
    [{ name: "f", args: [] }]],
  ["struct P { i32 x; i32 plus(const this, i32 n) { return this.x + n; } } export i32 f(i32 n) { P p = P(5); return p.plus(n); }",
    [{ name: "f", args: [7] }]],
  // A method that writes through `this`, so the receiver is not merely read.
  ["struct C { i32 n; void bump(this) { this.n = this.n + 1; } i32 get(const this) { return this.n; } } export i32 f() { C c = C(0); c.bump(); c.bump(); return c.get(); }",
    [{ name: "f", args: [] }]],
  // Fields of every width, so the struct's field types are not all i32.
  ["struct S { i64 a; f64 b; } export f64 f() { S s = S(4294967296, 1.5); return (s.a as~ f64) + s.b; }",
    [{ name: "f", args: [] }]],
  // A struct holding an array, and an array of a wider type beside it.
  ["struct S { i32[] xs; } export i32 f() { S s = S(i32[](7, 8)); return s.xs[1] + s.xs.len(); }",
    [{ name: "f", args: [] }]],
  // A struct crossing a call, and one nested in another.
  ["struct P { i32 x; } i32 take(P p) { return p.x; } export i32 f() { return take(P(11)); }",
    [{ name: "f", args: [] }]],
  ["struct Inner { i32 v; } struct Outer { Inner i; } export i32 f() { Outer o = Outer(Inner(6)); return o.i.v; }",
    [{ name: "f", args: [] }]],
  ["struct Inner { i32 v; } struct Outer { Inner i; } export i32 f() { Outer o = Outer(Inner(6)); o.i.v = 9; return o.i.v; }",
    [{ name: "f", args: [] }]],
  // Two structs, so the type indices have to be distinct and follow the arrays.
  ["struct A { i32 a; } struct B { i32 b; } export i32 f() { A x = A(2); B y = B(3); return x.a * y.b; }",
    [{ name: "f", args: [] }]],
  // A struct in a loop, mutated each time round.
  ["struct C { i32 n; } export i32 f(i32 k) { C c = C(0); for (i32 i = 0; i < k; i++) { c.n = c.n + i; } return c.n; }",
    [{ name: "f", args: [5] }]],

  // ── Module-level constants, inlined at each use ────────────────────────────
  ["const i32 K = 7; export i32 f() { return K; }", [{ name: "f", args: [] }]],
  ["const i32 K = 7; export i32 f(i32 n) { return K * n + K; }", [{ name: "f", args: [3] }]],
  // Arithmetic in the initialiser, which wasm would not accept as a constant expression and which
  // inlining makes ordinary — the substituted expression sits in a function body like any other.
  ["const i32 K = 3 * 4 + 1; export i32 f() { return K; }", [{ name: "f", args: [] }]],
  ["const i64 W = 4294967296; export i64 f() { return W + 1; }", [{ name: "f", args: [] }]],
  ["const f64 P = 1.5; export f64 f() { return P * 2.0; }", [{ name: "f", args: [] }]],
  ["const bool T = true; export bool f() { return !T; }", [{ name: "f", args: [] }]],
  // A local of the same name is nearer and wins.
  ["const i32 K = 7; export i32 f() { i32 K = 2; return K; }", [{ name: "f", args: [] }]],
  // Two constants, and one used inside a loop where it is substituted every time round.
  ["const i32 A = 2; const i32 B = 5; export i32 f() { i32 t = 0; for (i32 i = 0; i < B; i++) { t = t + A; } return t; }",
    [{ name: "f", args: [] }]],

  // ── Constants with identity, which live in a global ────────────────────────
  ["const i32[] T = i32[](4, 5, 6); export i32 f() { return T[1] + T.len(); }",
    [{ name: "f", args: [] }]],
  ["const u8[] B = u8[](1, 2, 250); export i32 f(i32 i) { return B[i]; }",
    [{ name: "f", args: [0] }, { name: "f", args: [2] }]],
  ["const i64[] W = i64[2](fill: 4294967296); export i64 f() { return W[0] + W[1]; }",
    [{ name: "f", args: [] }]],
  ["const i32[] Z = i32[4](); export i32 f() { return Z[3] + Z.len(); }", [{ name: "f", args: [] }]],
  // One array, not one per use: read twice in the same expression and once from a loop.
  ["const i32[] T = i32[](1, 2, 3); export i32 f() { i32 t = 0; for (i32 i = 0; i < T.len(); i++) { t = t + T[i]; } return t + T[0]; }",
    [{ name: "f", args: [] }]],
  // A struct constant, whose initialiser is `struct.new` — also a constant expression.
  ["struct P { i32 x; i32 y; } const P O = P(3, 4); export i32 f() { return O.x * O.y; }",
    [{ name: "f", args: [] }]],
  // Two of them, so the global indices have to be distinct and stable.
  ["const i32[] A = i32[](1, 2); const i32[] B = i32[](30, 40); export i32 f() { return A[1] + B[1]; }",
    [{ name: "f", args: [] }]],
  // A scalar beside an array, so the inlined and the global paths coexist.
  ["const i32 K = 5; const i32[] T = i32[](7, 8); export i32 f() { return K + T[0]; }",
    [{ name: "f", args: [] }]],

  // ── A ternary of two literals, which takes the slot's type ─────────────────
  ["export i32 f(bool c) { return c ? 1 : 2; }", [{ name: "f", args: [1] }, { name: "f", args: [0] }]],
  ["export i64 f(bool c) { return c ? 4294967296 : 1; }", [{ name: "f", args: [1] }, { name: "f", args: [0] }]],
  ["export f64 f(bool c) { return c ? 1.5 : 2.5; }", [{ name: "f", args: [1] }]],
  ["export i64 f(bool c) { i64 x = c ? 1 : 2; return x + 4294967296; }", [{ name: "f", args: [1] }]],
  // Nested, so the inner one has to take the outer's slot too.
  ["export i64 f(bool a, bool b) { return a ? (b ? 1 : 2) : 3; }",
    [{ name: "f", args: [1, 1] }, { name: "f", args: [1, 0] }, { name: "f", args: [0, 0] }]],

  // ── Static method calls, where the receiver names a type ───────────────────
  ["struct P { i32 x; P make(i32 v) { return P(v); } } export i32 f(i32 v) { return P.make(v).x; }",
    [{ name: "f", args: [9] }]],
  ["struct P { i32 x; i32 zero() { return 0; } } export i32 f() { return P.zero(); }",
    [{ name: "f", args: [] }]],
  // A static and an instance method of the same name on the same struct are different functions.
  ["struct P { i32 x; i32 get(const this) { return this.x; } P of(i32 v) { return P(v); } } export i32 f(i32 v) { return P.of(v).get(); }",
    [{ name: "f", args: [4] }]],
  // A local shadowing the struct's name makes the receiver a value again.
  ["struct P { i32 x; i32 get(const this) { return this.x; } } export i32 f() { P P2 = P(6); return P2.get(); }",
    [{ name: "f", args: [] }]],

  // ── Strings, which are an i8 array in the emitted module ───────────────────
  ['export i32 f() { string s = "hi"; return s.len(); }', [{ name: "f", args: [] }]],
  ['export i32 f() { return "hello".len(); }', [{ name: "f", args: [] }]],
  ['export i32 f() { string s = ""; return s.len(); }', [{ name: "f", args: [] }]],
  // Escapes, resolved the way the language resolves them — a wrong one would be a wrong string
  // rather than a missing feature, so an escape this cannot read declines the literal instead.
  ['export i32 f() { return "a\\nb".len(); }', [{ name: "f", args: [] }]],
  ['export i32 f() { return "a\\tb\\\\c".len(); }', [{ name: "f", args: [] }]],
  ['export i32 f() { return "say \\"hi\\"".len(); }', [{ name: "f", args: [] }]],
  // Multi-byte UTF-8: `.len()` is bytes, not characters, which is the whole reason it is an i8 array.
  ['export i32 f() { return "é".len(); }', [{ name: "f", args: [] }]],
  // A string crossing a call, and one in a struct field.
  ['i32 size(string s) { return s.len(); } export i32 f() { return size("abcd"); }',
    [{ name: "f", args: [] }]],
  ['struct S { string name; } export i32 f() { S s = S("wacc"); return s.name.len(); }',
    [{ name: "f", args: [] }]],
  // A string constant, which has identity and so lives in a global.
  ['const string G = "global"; export i32 f() { return G.len(); }', [{ name: "f", args: [] }]],
  // An array of strings, so the element type is itself a reference.
  ['export i32 f() { string[] xs = string[]("ab", "cde"); return xs[1].len() + xs.len(); }',
    [{ name: "f", args: [] }]],

  // ── String equality, which is a generated helper rather than an instruction ─
  ['export bool f() { return "abc" == "abc"; }', [{ name: "f", args: [] }]],
  ['export bool f() { return "abc" == "abd"; }', [{ name: "f", args: [] }]],
  ['export bool f() { return "abc" == "ab"; }', [{ name: "f", args: [] }]],
  ['export bool f() { return "" == ""; }', [{ name: "f", args: [] }]],
  ['export bool f() { return "abc" != "abd"; }', [{ name: "f", args: [] }]],
  ['export bool f(bool c) { string a = c ? "yes" : "no"; return a == "yes"; }',
    [{ name: "f", args: [1] }, { name: "f", args: [0] }]],
  // A difference in the last byte only, which a length check alone would miss.
  ['export bool f() { return "abcd" == "abce"; }', [{ name: "f", args: [] }]],
  // Multi-byte, where equality is over bytes and not characters.
  ['export bool f() { return "é" == "é"; }', [{ name: "f", args: [] }]],
  ['const string G = "wac"; export bool f() { return G == "wac"; }', [{ name: "f", args: [] }]],
];

Deno.test("rung 4: what wacc emits runs, and answers what the reference's does", () => {
  let calls = 0;
  for (const [src, invocations] of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    for (const { name, args } of invocations) {
      const a = theirs[name] as (...xs: (number | bigint)[]) => number | bigint;
      const b = mine[name] as (...xs: (number | bigint)[]) => number | bigint;
      if (typeof a !== "function") throw new Error(`the reference exports no ${name} for ${src}`);
      if (typeof b !== "function") throw new Error(`we export no ${name} for ${src}`);
      const want = a(...args);
      const got = b(...args);
      if (got !== want) {
        throw new Error(`${name}(${args.join(", ")}) is ${got} from us and ${want} from the ` +
          `reference, for ${JSON.stringify(src)}`);
      }
      calls++;
    }
  }
  // A differential harness that called nothing would report that everything agrees.
  if (calls < 10) throw new Error(`only ${calls} calls compared`);
  console.log(`    rung 4: ${CASES.length} programs, ${calls} calls, every answer agrees`);
});

Deno.test("rung 4: the module is well-formed on its own terms", () => {
  // `WebAssembly.validate` is a second opinion about the bytes that costs nothing and is not the
  // reference's — a module can run the one function a test calls and still be malformed elsewhere.
  for (const [src] of CASES) {
    const bytes = Uint8Array.from(emit(enc.encode(src)) as unknown as number[]);
    if (!WebAssembly.validate(bytes)) {
      throw new Error(`what we emit for ${JSON.stringify(src)} is not a valid module`);
    }
    // The magic and version, which every later section is written after.
    const head = [...bytes.slice(0, 8)];
    if (head.join(",") !== "0,97,115,109,1,0,0,0") {
      throw new Error(`the header is ${head.join(" ")}`);
    }
  }
});
