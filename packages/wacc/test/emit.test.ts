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

type Call = { name: string; args: number[] };

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
];

Deno.test("rung 4: what wacc emits runs, and answers what the reference's does", () => {
  let calls = 0;
  for (const [src, invocations] of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    for (const { name, args } of invocations) {
      const a = theirs[name] as (...xs: number[]) => number;
      const b = mine[name] as (...xs: number[]) => number;
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
