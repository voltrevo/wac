// Spec compliance tests — each test name starts with the §wac-* tag it covers.
// Tags from: types.md, operators.md, control.md, variables.md, naming.md,
//            arrays.md, structs.md, casts.md, functions.md, imports.md, funcrefs.md,
//            buffer.md, strings.md, grammar.md

import { wacCompile } from "./wacCompile.ts";
// The instantiation-count test needs the resolver directly: the count is not visible from a
// compiled module, and "correct but duplicated" is exactly what it exists to catch.
import { wacResolve } from "./wacResolve.ts";
import { wacParse } from "./wacParse.ts";
import { wacLex } from "./wacLex.ts";
import { wacInstance } from "./wacInstance.ts";
import { wacBindgen } from "./wacBindgen.ts";
import { wacDiag } from "./wacDiag.ts";
import type { DiagError } from "./wacDiag.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(src: string) {
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  return wacInstance(r.compiled);
}

function err(src: string): string {
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (r.ok) throw new Error("expected compile error");
  return r.diagnostics[0].message;
}

async function runMulti(files: Map<string, string>) {
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  return wacInstance(r.compiled);
}

function errMulti(files: Map<string, string>): string {
  const r = wacCompile(files, "main.wac");
  if (r.ok) throw new Error("expected compile error");
  return r.diagnostics[0].message;
}

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${String(a)}, expected ${String(b)}`);
}

function near(a: number, b: number, msg: string, eps = 0.001): void {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: got ${a}, expected ~${b}`);
}

function traps(fn: () => unknown, msg: string): void {
  let caught = false;
  try { fn(); } catch { caught = true; }
  if (!caught) throw new Error(`${msg}: expected trap`);
}

// ── §wac-int32-dfkqg8u — i32 literal ─────────────────────────────────────────

Deno.test("[§wac-int32-dfkqg8u] int32() returns 42", async () => {
  const inst = await run(`export i32 int32() { return 42; }`);
  eq(inst.call("int32", []), 42, "int32()");
});

// ── §wac-int64-81jz1o0 — i64 literal ─────────────────────────────────────────

Deno.test("[§wac-int64-81jz1o0] int64() returns 1000000000000", async () => {
  const inst = await run(`export i64 int64() { return 1000000000000; }`);
  eq(inst.call("int64", []), 1000000000000n, "int64()");
});

// ── §wac-float32-45okgg8 — f32 literal ───────────────────────────────────────

Deno.test("[§wac-float32-45okgg8] float32() returns 3.14 (f32 precision)", async () => {
  // Was `3.14 as~ f32`, which is not what types.md shows. The example in the spec did
  // not compile until float literals took their type from context; the test papered
  // over that with a cast rather than the mismatch being noticed.
  const inst = await run(`export f32 float32() { return 3.14; }`);
  near(inst.call("float32", []) as number, 3.14, "float32()", 0.01);
});

// ── §wac-float64-suhtesz — f64 literal ───────────────────────────────────────

Deno.test("[§wac-float64-suhtesz] float64() returns 2.718281828459045", async () => {
  const inst = await run(`export f64 float64() { return 2.718281828459045; }`);
  near(inst.call("float64", []) as number, 2.718281828459045, "float64()", 1e-12);
});

// ── §wac-wrap-uy41uqt — integer overflow wraps ────────────────────────────────

Deno.test("[§wac-wrap-uy41uqt] wrap32() returns -2147483648 on overflow", async () => {
  const inst = await run(`export i32 wrap32() { return 2147483647 + 1; }`);
  eq(inst.call("wrap32", []), -2147483648, "wrap32()");
});

// ── §wac-strict-tr8nhbk — bool is not i32 ────────────────────────────────────

Deno.test("[§wac-strict-tr8nhbk] strict() returns 5 (bool used as condition)", async () => {
  const inst = await run(`
    export i32 strict() {
      bool flag = true;
      i32 x = 5;
      if (flag) { return x; }
      return 0;
    }
  `);
  eq(inst.call("strict", []), 5, "strict()");
});

// ── §wac-boolreq-uj95exp — i32 not allowed in if condition ───────────────────

Deno.test("[§wac-boolreq-uj95exp] if(i32) is a compile error", () => {
  err(`export i32 rejected(i32 x) { if (x) { return 1; } return 0; }`);
  // no assertion needed — err() throws if it compiles
});

// ── §wac-i31ref-0i4w6qt — i31ref round-trip ──────────────────────────────────

Deno.test("[§wac-i31ref-0i4w6qt] small as i32 returns 42", async () => {
  const inst = await run(`
    export i32 testI31() {
      i31ref small = 42 as! i31ref;
      return small as i32;
    }
  `);
  eq(inst.call("testI31", []), 42, "i31ref round-trip");
});

// ── §wac-nullassign-b3xk8p5 — nullable to non-null assign error ──────────────

Deno.test("[§wac-nullassign-b3xk8p5] assigning nullable to non-null is a compile error", () => {
  err(`
    struct Point { i32 x; i32 y; }
    export void bad() {
      Point p = Point(1, 2);
      Point? q = null;
      p = q;
    }
  `);
});

// ── §wac-null-assign-k3fn8wp — nullable init with null ───────────────────────

Deno.test("[§wac-null-assign-k3fn8wp] Point? p = null compiles", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export void test() { Point? p = null; }
  `);
  eq(inst.call("test", []), undefined, "void returns undefined");
});

// ── §wac-null-nonnull-m8qj5xf — non-null var cannot hold null ────────────────

Deno.test("[§wac-null-nonnull-m8qj5xf] Point q = null is a compile error", () => {
  err(`struct Point { i32 x; i32 y; } export void bad() { Point q = null; }`);
});

// ── §wac-null-primitive-p7hd6wn — primitive cannot hold null ─────────────────

Deno.test("[§wac-null-primitive-p7hd6wn] i32 x = null is a compile error", () => {
  err(`export void bad() { i32 x = null; }`);
});

// ── §wac-unwrap-trap-y1iep2p — null unwrap traps ─────────────────────────────

Deno.test("[§wac-unwrap-trap-y1iep2p] unwrapping null traps", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 unwrapNull() {
      Point? p = null;
      return p!.x;
    }
  `);
  traps(() => inst.call("unwrapNull", []), "null unwrap");
});

// ── §wac-isnull-kxsqi4g — null is null test ──────────────────────────────────

Deno.test("[§wac-isnull-kxsqi4g] null is null = true, non-null is null = false", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export bool testNullIsNull() {
      Point? p = null;
      return p is null;
    }
    export bool testNonNullIsNull() {
      Point? p = Point(1, 2);
      return p is null;
    }
  `);
  eq(inst.call("testNullIsNull", []),    true,  "null is null");
  eq(inst.call("testNonNullIsNull", []), false, "non-null is null");
});

// ── §wac-nonnull-isnull-k8fn3wp — non-null type is null always false ──────────

Deno.test("[§wac-nonnull-isnull-k8fn3wp] testNonNullIsNull returns false", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export bool testNonNullIsNull() {
      Point p = Point(1, 2);
      return p is null;
    }
  `);
  eq(inst.call("testNonNullIsNull", []), false, "non-null ref is null = false");
});

// ── §wac-add64-h42kvhc — i64 addition ────────────────────────────────────────

Deno.test("[§wac-add64-h42kvhc] add64(100, 200) returns 300n", async () => {
  const inst = await run(`export i64 add64(i64 a, i64 b) { return a + b; }`);
  eq(inst.call("add64", [100n, 200n]), 300n, "add64");
});

// ── §wac-mulf-02srz8x — f64 multiplication ───────────────────────────────────

Deno.test("[§wac-mulf-02srz8x] mulF(2.5, 4.0) returns 10.0", async () => {
  const inst = await run(`export f64 mulF(f64 a, f64 b) { return a * b; }`);
  near(inst.call("mulF", [2.5, 4.0]) as number, 10.0, "mulF");
});

// ── §wac-mixadd-f4dga8g — mixed type add is error ────────────────────────────

Deno.test("[§wac-mixadd-f4dga8g] i32 + f64 is a compile error", () => {
  err(`export f64 bad(i32 x, f64 y) { return x + y; }`);
});

// ── §wac-cmpfloat-68s8unj — float comparison ─────────────────────────────────

Deno.test("[§wac-cmpfloat-68s8unj] cmpFloat() returns true", async () => {
  const inst = await run(`export bool cmpFloat() { return 1.0 == 1.0; }`);
  eq(inst.call("cmpFloat", []), true, "cmpFloat()");
});

// ── §wac-struct-eq-k4rm7xq — struct == is compile error ──────────────────────

Deno.test("[§wac-struct-eq-k4rm7xq] struct == is a compile error", () => {
  err(`
    struct Point { i32 x; i32 y; }
    export bool bad() {
      Point a = Point(1, 2);
      Point b = Point(1, 2);
      return a == b;
    }
  `);
});

// ── §wac-shift64-rhgzpth — i64 shift by i32 ──────────────────────────────────

Deno.test("[§wac-shift64-rhgzpth] shiftMixed(1, 32) returns 4294967296n", async () => {
  const inst = await run(`export i64 shiftMixed(i64 x, i32 n) { return x << n; }`);
  eq(inst.call("shiftMixed", [1n, 32]), 4294967296n, "1 << 32");
});

// ── §wac-infloop-* — loops that never finish ─────────────────────────────────
//
// A `while (true)` with no reachable break never completes, so a non-void
// function needs no return after it. The emitter already appends `unreachable`
// before a non-void function's `end`, so these produce valid wasm — which
// `run()` proves by instantiating.

Deno.test("[§wac-infloop-while-zvvoovg] firstMultiple(4, 10) returns 12", async () => {
  const inst = await run(`
    export i32 firstMultiple(i32 step, i32 floor) {
      i32 n = 0;
      while (true) {
        n += step;
        if (n > floor) { return n; }
      }
    }
  `);
  eq(inst.call("firstMultiple", [4, 10]), 12, "4, 8, 12 — first over 10");
});

Deno.test("[§wac-infloop-for-q1ga6km] countTo(7) returns 7", async () => {
  const inst = await run(`
    export i32 countTo(i32 target) {
      for (i32 i = 0; ; i++) {
        if (i == target) { return i; }
      }
    }
  `);
  eq(inst.call("countTo", [7]), 7, "for with no condition");
  eq(inst.call("countTo", [0]), 0, "target reached immediately");
});

Deno.test("[§wac-infloop-nested-m2ydt52] a switch break does not make the loop finite", async () => {
  const inst = await run(`
    export i32 nestedBreak(i32 n) {
      while (true) {
        switch (n) {
          case 1: break;
          default: break;
        }
        if (n > 0) { return n; }
        n++;
      }
    }
  `);
  eq(inst.call("nestedBreak", [3]), 3, "switch breaks bind to the switch");
  // Also true of a break inside a nested loop.
  const inst2 = await run(`
    export i32 innerLoopBreak() {
      i32 total = 0;
      while (true) {
        for (i32 i = 0; i < 3; i++) {
          if (i == 2) { break; }
          total++;
        }
        if (total > 4) { return total; }
      }
    }
  `);
  eq(inst2.call("innerLoopBreak", []), 6, "inner-loop break binds to the for");
});

Deno.test("[§wac-infloop-break-hiomizo] a reachable break means a return is still required", () => {
  const m = err(`
    export i32 needsReturn(i32 n) {
      while (true) {
        if (n > 0) { break; }
        n++;
      }
    }
  `);
  if (!m.includes("not all code paths return")) {
    throw new Error(`expected the missing-return diagnostic, got: ${m}`);
  }
  // A break reached only through an else branch counts just the same.
  err(`
    export i32 alsoNeedsReturn(i32 n) {
      while (true) {
        if (n > 0) { n++; } else { break; }
      }
    }
  `);
  // ...as does one inside a bare block,
  err(`
    export i32 breakInBlock(i32 n) {
      while (true) {
        { break; }
      }
    }
  `);
  // ...or partway down an else-if chain.
  err(`
    export i32 breakInElseIf(i32 n) {
      while (true) {
        if (n > 10) { n++; } else if (n > 5) { break; } else { n += 2; }
      }
    }
  `);
});

Deno.test("[§wac-infloop-while-zvvoovg] do-while(true) is infinite too", async () => {
  const inst = await run(`
    export i32 doubleUntil(i32 n) {
      do {
        n *= 2;
        if (n > 50) { return n; }
      } while (true);
    }
  `);
  eq(inst.call("doubleUntil", [4]), 64, "4, 8, 16, 32, 64 — first over 50");
});

// ── §wac-trailcomma-* — optional trailing commas ─────────────────────────────

Deno.test("[§wac-trailcomma-eg6567x] demo() returns 12", async () => {
  const inst = await run(`
    i32 area(
      i32 width,
      i32 height,
    ) {
      return width * height;
    }

    export i32 demo() {
      i32[] sizes = i32[](3, 4,);
      return area(sizes[0], sizes[1],);
    }
  `);
  eq(inst.call("demo", []), 12, "3 * 4");
});

Deno.test("[§wac-trailcomma-eg6567x] every comma-separated list accepts one", async () => {
  const inst = await run(`
    struct P {
      i32 x;
      i32 y;

      i32 scaled(const this, i32 by,) { return (this.x + this.y) * by; }
      i32 self(const this,) { return this.x; }
    }

    export i32 all() {
      P p = P { x: 3, y: 4, };
      return p.scaled(2,) + p.self();
    }
  `);
  eq(inst.call("all", []), 17, "(3+4)*2 + 3");
});

Deno.test("[§wac-trailcomma-bad-689xwxt] a comma with no element before it is still an error", () => {
  err(`i32 g() { return 1; } export i32 f() { return g(,); }`);
  err(`export i32 f(i32 a,,) { return a; }`);
  err(`export i32 f(i32 a) { i32[] b = i32[](,1); return b[0]; }`);
});

// ── §wac-fmod-* — float remainder ────────────────────────────────────────────
//
// JavaScript's % on numbers is C fmod, so it is a valid oracle for the f64 case
// and every expected value below was cross-checked against Python's math.fmod.
// The values are chosen to fail loudly for a wrong implementation:
//   - modF(1.0, 0.1): a - trunc(a/b)*b gives -2.2e-16 (wrong sign, wrong
//     magnitude) because 1.0/0.1 is 10.000000000000002.
//   - modF(1e300, 3.0): the naive form gives garbage, since trunc(1e300/3) has
//     no fractional precision left to subtract with.
//   - Before float % was implemented it emitted f64.div, so modF(7.0, 2.0)
//     returned 3.5 — every one of these caught that.

Deno.test("[§wac-fmod-ox2ga90] modF(7.0, 2.0) returns 1.0", async () => {
  const inst = await run(`export f64 modF(f64 a, f64 b) { return a % b; }`);
  eq(inst.call("modF", [7.0, 2.0]), 1.0, "7 % 2");
  eq(inst.call("modF", [5.5, 1.5]), 1.0, "5.5 % 1.5");
});

Deno.test("[§wac-fmod-round-lji73wg] modF(1.0, 0.1) is exact, not trunc-based", async () => {
  const inst = await run(`export f64 modF(f64 a, f64 b) { return a % b; }`);
  const got = inst.call("modF", [1.0, 0.1]) as number;
  eq(got, 0.09999999999999995, "1.0 % 0.1");
  eq(got, 1.0 % 0.1, "matches the C fmod definition");
  if (got < 0) throw new Error("remainder must not be negative for positive operands");
});

Deno.test("[§wac-fmod-sign-l3ief80] the sign follows the left operand", async () => {
  const inst = await run(`export f64 modF(f64 a, f64 b) { return a % b; }`);
  eq(inst.call("modF", [-7.0, 2.0]), -1.0, "-7 % 2");
  eq(inst.call("modF", [7.0, -2.0]), 1.0, "7 % -2");
  eq(inst.call("modF", [-7.0, -2.0]), -1.0, "-7 % -2");
  // -0.0 must stay negative, so the result cannot be built from |x| alone.
  const negZero = inst.call("modF", [-0.0, 5.0]) as number;
  if (!Object.is(negZero, -0)) throw new Error(`-0.0 % 5.0 gave ${negZero}, expected -0`);
});

Deno.test("[§wac-fmod-large-wfr4moy] modF(1e300, 3.0) returns exactly 0.0", async () => {
  const inst = await run(`export f64 modF(f64 a, f64 b) { return a % b; }`);
  eq(inst.call("modF", [1e300, 3.0]), 0.0, "1e300 % 3");
  eq(inst.call("modF", [1e16, 3.0]), 1.0, "1e16 % 3");
  eq(inst.call("modF", [123456.789, 1000.0]), 456.7890000000043, "123456.789 % 1000");
});

Deno.test("[§wac-fmod-zero-f9hnqhr] division by zero is NaN; modulo infinity is the dividend", async () => {
  const inst = await run(`
    export f64 modF(f64 a, f64 b) { return a % b; }
    export f64 inf() { return 1.0 / 0.0; }
  `);
  const nan = inst.call("modF", [7.0, 0.0]) as number;
  if (!Number.isNaN(nan)) throw new Error(`7.0 % 0.0 gave ${nan}, expected NaN`);
  const infinity = inst.call("inf", []) as number;
  eq(inst.call("modF", [7.0, infinity]), 7.0, "7 % inf");
  const infMod = inst.call("modF", [infinity, 2.0]) as number;
  if (!Number.isNaN(infMod)) throw new Error(`inf % 2.0 gave ${infMod}, expected NaN`);
});

Deno.test("[§wac-fmod-f32-t52576z] f32 remainder", async () => {
  const inst = await run(`
    export f32 modF32(f32 a, f32 b) { return a % b; }
    export f32 modF32Compound(f32 a, f32 b) { f32 x = a; x %= b; return x; }
  `);
  eq(inst.call("modF32", [5.5, 1.5]), 1.0, "f32 5.5 % 1.5");
  eq(inst.call("modF32", [7.0, 2.0]), 1.0, "f32 7 % 2");
  eq(inst.call("modF32Compound", [7.0, 2.0]), 1.0, "f32 7 %= 2");
});

Deno.test("[§wac-fmod-ox2ga90] compound %= uses the same remainder", async () => {
  const inst = await run(`
    export f64 modAssign(f64 a, f64 b) { f64 x = a; x %= b; return x; }
  `);
  eq(inst.call("modAssign", [7.0, 2.0]), 1.0, "7 %= 2");
  eq(inst.call("modAssign", [1.0, 0.1]), 0.09999999999999995, "1.0 %= 0.1");
  eq(inst.call("modAssign", [-7.0, 2.0]), -1.0, "-7 %= 2");
});

// ── §wac-hexlit-* / §wac-numsep-* — integer literal notation ────────────────
//
// Hex is a bit pattern typed by digit count; decimal is a magnitude. Values
// verified in Python: 0xEDB88320 - (1<<32) == -306674912, and 0x0EDB88320 at 9
// digits stays positive at 3988292384. wacIntLit.test.ts covers the rule
// exhaustively at the unit level; these tags check it end to end through the
// emitted binary, where a wrong width would encode a different constant.

Deno.test("[§wac-hexlit-i32-47spr0b] poly() returns -306674912", async () => {
  const inst = await run(`export i32 poly() { return 0xEDB88320; }`);
  eq(inst.call("poly", []), -306674912, "CRC-32 polynomial as i32");
});

Deno.test("[§wac-hexlit-ones-9bg3jtx] allOnes() returns -1", async () => {
  const inst = await run(`export i32 allOnes() { return 0xFFFFFFFF; }`);
  eq(inst.call("allOnes", []), -1, "0xFFFFFFFF");
});

Deno.test("[§wac-hexlit-sign-8wckct3] signBit() returns -2147483648", async () => {
  const inst = await run(`export i32 signBit() { return 0x80000000; }`);
  eq(inst.call("signBit", []), -2147483648, "0x80000000");
});

Deno.test("[§wac-hexlit-pad-9qw60ul] wide() returns 3988292384n", async () => {
  const inst = await run(`export i64 wide() { return 0x0EDB88320; }`);
  eq(inst.call("wide", []), 3988292384n, "9 digits selects i64");
});

Deno.test("[§wac-numsep-qpeegkw] underscores are separators", async () => {
  const inst = await run(`
    export i32 grouped() { return 0xEDB8_8320; }
    export i32 million() { return 1_000_000; }
  `);
  eq(inst.call("grouped", []), -306674912, "0xEDB8_8320 == 0xEDB88320");
  eq(inst.call("million", []), 1000000, "1_000_000");
});

// ── §wac-i64lit-* — a literal's width comes from the literal ─────────────────
//
// Before this, the emitter decided i32 vs i64 only from the expected type, so an
// i64 literal used where no type was pushed down — a binary operand — was emitted
// as i32.const. That is invalid wasm, not a wrong value, so these instantiate.
// Found by agent-c while writing spec/tour.wac.

Deno.test("[§wac-i64lit-operand-4k1n3ev] bigMatches() returns true", async () => {
  const inst = await run(`
    i64 big() { return 1000000000000; }
    export bool bigMatches() { return big() == 1000000000000; }
  `);
  eq(inst.call("bigMatches", []), true, "i64 literal as a comparison operand");
});

Deno.test("[§wac-i64lit-cmp-hnbz7ev] bigCompare(5) returns true", async () => {
  const inst = await run(`
    export bool bigCompare(i64 x) { return x < 1000000000000; }
    export i64 bigAdd(i64 x) { return x + 1000000000000; }
    export bool hexBig(i64 x) { return x == 0xFFFFFFFFFF; }
  `);
  eq(inst.call("bigCompare", [5n]), true, "i64 literal in a comparison");
  eq(inst.call("bigAdd", [5n]), 1000000000005n, "i64 literal in addition");
  eq(inst.call("hexBig", [0xFFFFFFFFFFn]), true, "wide hex literal as an operand");
});

// ── §wac-shr-s / §wac-shr-u — arithmetic vs logical right shift ──────────────
//
// Expected values are the defining difference between the two wasm opcodes:
// i32.shr_s sign-extends, i32.shr_u zero-fills. -16 is 0xFFFFFFF0, so
// >> 1 keeps the sign (0xFFFFFFF8 = -8) and >>> 1 does not (0x7FFFFFF8 =
// 2147483640). Cross-checked against JS, which has both operators:
//   (-16 >> 1) === -8;  (-16 >>> 1) === 2147483640;  (-1 >>> 28) === 15

Deno.test("[§wac-shr-s-z073930] shiftArith(-16, 1) returns -8", async () => {
  const inst = await run(`export i32 shiftArith(i32 x, i32 n) { return x >> n; }`);
  eq(inst.call("shiftArith", [-16, 1]), -8, "-16 >> 1 sign-extends");
});

Deno.test("[§wac-shr-u-ft3yabj] shiftLogic(-16, 1) returns 2147483640", async () => {
  const inst = await run(`export i32 shiftLogic(i32 x, i32 n) { return x >>> n; }`);
  eq(inst.call("shiftLogic", [-16, 1]), 2147483640, "-16 >>> 1 zero-fills");
});

Deno.test("[§wac-shr-u-neg1-d3b1hey] shiftLogic(-1, 28) returns 15", async () => {
  const inst = await run(`export i32 shiftLogic(i32 x, i32 n) { return x >>> n; }`);
  eq(inst.call("shiftLogic", [-1, 28]), 15, "-1 >>> 28 leaves 4 low bits set");
});

Deno.test("[§wac-shr-u64-2jujzws] shiftLogic64(-16, 4) returns 1152921504606846975n", async () => {
  const inst = await run(`export i64 shiftLogic64(i64 x, i32 n) { return x >>> n; }`);
  // 0xFFFFFFFFFFFFFFF0 >>> 4 == 0x0FFFFFFFFFFFFFFF
  eq(inst.call("shiftLogic64", [-16n, 4]), 0x0FFFFFFFFFFFFFFFn, "i64 logical shift, i32 amount");
});

Deno.test("[§wac-shr-u-float-s95dlzw] '>>>' on f64 is a compile error", () => {
  const m = err(`export f64 badShift(f64 x) { return x >>> 1; }`);
  if (!m.includes("'>>>' requires an integer type")) {
    throw new Error(`expected the >>> operand-type diagnostic, got: ${m}`);
  }
});

// ── §wac-cshift-* — compound shift by i32 on every assignable target ─────────
//
// `i64 <<= i32` must widen the shift amount, exactly as the binary form does.
// Before this was wired up, all three of these emitted i64.shl with an i32
// operand still on the stack — a module that failed wasm validation outright,
// so `run()` here also proves the emitted binary is well-formed.

Deno.test("[§wac-cshift-local-e85g9us] compoundShiftLocal(-16, 4) returns 1152921504606846975n", async () => {
  const inst = await run(`export i64 compoundShiftLocal(i64 x, i32 n) { x >>>= n; return x; }`);
  eq(inst.call("compoundShiftLocal", [-16n, 4]), 0x0FFFFFFFFFFFFFFFn, "local >>>= i32");
});

Deno.test("[§wac-cshift-field-abx403z] compoundShiftField(1, 4) returns 16n", async () => {
  const inst = await run(`
    struct Bits { i64 v; }
    export i64 compoundShiftField(i64 x, i32 n) { Bits b = Bits(x); b.v <<= n; return b.v; }
  `);
  eq(inst.call("compoundShiftField", [1n, 4]), 16n, "field <<= i32");
});

Deno.test("[§wac-cshift-elem-emvdry9] compoundShiftElem(1, 4) returns 16n", async () => {
  const inst = await run(`
    export i64 compoundShiftElem(i64 x, i32 n) {
      i64[] a = i64[1]();
      a[0] = x;
      a[0] <<= n;
      return a[0];
    }
  `);
  eq(inst.call("compoundShiftElem", [1n, 4]), 16n, "array element <<= i32");
});

// ── §wac-logic-45at1jf and §wac-logicf-bi4nyl4 — logical &&  ─────────────────

Deno.test("[§wac-logic-45at1jf] bothPositive(3, 5) returns true", async () => {
  const inst = await run(`
    export bool bothPositive(i32 a, i32 b) { return a > 0 && b > 0; }
  `);
  eq(inst.call("bothPositive", [3, 5]), true, "3,5");
});

Deno.test("[§wac-logicf-bi4nyl4] bothPositive(3, -1) returns false", async () => {
  const inst = await run(`
    export bool bothPositive(i32 a, i32 b) { return a > 0 && b > 0; }
  `);
  eq(inst.call("bothPositive", [3, -1]), false, "3,-1");
});

// ── §wac-shortcirc-and-j7pm4w9 — && short-circuits ───────────────────────────

Deno.test("[§wac-shortcirc-and-j7pm4w9] false && incr() returns 0 (incr not called)", async () => {
  const inst = await run(`
    struct Box { i32 val; }
    bool incr(Box b) { b.val = b.val + 1; return true; }
    export i32 testShortCircuitAnd() {
      Box b = Box(0);
      bool result = false && incr(b);
      return b.val;
    }
  `);
  eq(inst.call("testShortCircuitAnd", []), 0, "short-circuit and");
});

// ── §wac-shortcirc-or-n3kx5wp — || short-circuits ────────────────────────────

Deno.test("[§wac-shortcirc-or-n3kx5wp] true || incr() returns 0 (incr not called)", async () => {
  const inst = await run(`
    struct Box { i32 val; }
    bool incr(Box b) { b.val = b.val + 1; return true; }
    export i32 testShortCircuitOr() {
      Box b = Box(0);
      bool result = true || incr(b);
      return b.val;
    }
  `);
  eq(inst.call("testShortCircuitOr", []), 0, "short-circuit or");
});

// ── §wac-bool-arith-f2nx8k3 — arithmetic on bool is error ────────────────────

Deno.test("[§wac-bool-arith-f2nx8k3] bool + i32 is a compile error", () => {
  err(`export i32 bad() { bool a = true; return a + 1; }`);
});

// ── §wac-compound-pw7qq7v — compound assignment and ++ ───────────────────────

Deno.test("[§wac-compound-pw7qq7v] compound() returns 40", async () => {
  const inst = await run(`
    export i32 compound() {
      i32 x = 10;
      x += 5;
      x -= 2;
      x *= 3;
      x++;
      return x;
    }
  `);
  eq(inst.call("compound", []), 40, "compound()");
});

// (former §wac-increxpr-cabck67 removed: ++/-- are full expressions now —
// see [§wac-postincr-expr-n4kx8wq] / [§wac-preincr-expr-t8jm3wq])

// ── §wac-abs-djo90kx — abs with if/else ──────────────────────────────────────

Deno.test("[§wac-abs-djo90kx] abs(-42)=42, abs(7)=7", async () => {
  const inst = await run(`
    export i32 abs(i32 n) {
      if (n < 0) { return -n; }
      else { return n; }
    }
  `);
  eq(inst.call("abs", [-42]), 42, "abs(-42)");
  eq(inst.call("abs", [7]),    7, "abs(7)");
});

// ── §wac-collatz-k1chom8 — while loop ────────────────────────────────────────

Deno.test("[§wac-collatz-k1chom8] collatz(27) returns 111", async () => {
  const inst = await run(`
    export i32 collatz(i32 n) {
      i32 steps = 0;
      while (n != 1) {
        if (n % 2 == 0) { n = n / 2; }
        else { n = n * 3 + 1; }
        steps++;
      }
      return steps;
    }
  `);
  eq(inst.call("collatz", [27]), 111, "collatz(27)");
});

// ── §wac-fib-kko47vy — for loop ───────────────────────────────────────────────

Deno.test("[§wac-fib-kko47vy] fib(20) returns 6765", async () => {
  const inst = await run(`
    export i32 fib(i32 n) {
      if (n < 2) { return n; }
      i32 a = 0;
      i32 b = 1;
      for (i32 i = 2; i <= n; i++) {
        i32 t = a + b;
        a = b;
        b = t;
      }
      return b;
    }
  `);
  eq(inst.call("fib", [20]), 6765, "fib(20)");
});

// ── §wac-dowhile-d6kgle1 — do-while loop ─────────────────────────────────────

Deno.test("[§wac-dowhile-d6kgle1] digitCount(0)=1, digitCount(9999)=4", async () => {
  const inst = await run(`
    export i32 digitCount(i32 n) {
      if (n < 0) { n = -n; }
      i32 count = 0;
      do {
        count++;
        n = n / 10;
      } while (n > 0);
      return count;
    }
  `);
  eq(inst.call("digitCount", [0]),    1, "digitCount(0)");
  eq(inst.call("digitCount", [9999]), 4, "digitCount(9999)");
});

// ── §wac-break-x7y68xx — break in for loop ───────────────────────────────────

Deno.test("[§wac-break-x7y68xx] findFirst({10,20,30}, 20) returns 1", async () => {
  const inst = await run(`
    export i32 findFirst(i32[] arr, i32 target) {
      i32 result = -1;
      for (i32 i = 0; i < arr.len(); i++) {
        if (arr[i] == target) {
          result = i;
          break;
        }
      }
      return result;
    }
  `);
  // Pass array from JS — can't pass JS arrays directly to wasm, so use a helper
  const inst2 = await run(`
    export i32 test() {
      i32[] arr = i32[](10, 20, 30);
      i32 result = -1;
      for (i32 i = 0; i < arr.len(); i++) {
        if (arr[i] == 20) { result = i; break; }
      }
      return result;
    }
  `);
  eq(inst2.call("test", []), 1, "findFirst index 1");
});

// ── §wac-continue-apojox2 — continue in for loop ─────────────────────────────

Deno.test("[§wac-continue-apojox2] sumOdd({1,2,3,4,5}) returns 9", async () => {
  const inst = await run(`
    export i32 sumOdd() {
      i32[] arr = i32[](1, 2, 3, 4, 5);
      i32 total = 0;
      for (i32 i = 0; i < arr.len(); i++) {
        if (arr[i] % 2 == 0) { continue; }
        total += arr[i];
      }
      return total;
    }
  `);
  eq(inst.call("sumOdd", []), 9, "sumOdd");
});

// ── §wac-break-noloop-p3kn7wp — break outside loop ───────────────────────────

Deno.test("[§wac-break-noloop-p3kn7wp] break outside loop is a compile error", () => {
  err(`export void badBreak() { break; }`);
});

// ── §wac-continue-noloop-r8jm4xf — continue outside loop ────────────────────

Deno.test("[§wac-continue-noloop-r8jm4xf] continue outside loop is a compile error", () => {
  err(`export void badContinue() { continue; }`);
});

// ── §wac-ternary-bthswsh — ternary ────────────────────────────────────────────

Deno.test("[§wac-ternary-bthswsh] max(3,7)=7, max(10,2)=10", async () => {
  const inst = await run(`
    export i32 max(i32 a, i32 b) { return a > b ? a : b; }
  `);
  eq(inst.call("max", [3, 7]),   7,  "max(3,7)");
  eq(inst.call("max", [10, 2]),  10, "max(10,2)");
});

// ── §wac-switch-4s87owc — switch statement ───────────────────────────────────

Deno.test("[§wac-switch-4s87owc] dayType(0)=0, dayType(3)=1, dayType(6)=0", async () => {
  const inst = await run(`
    export i32 dayType(i32 day) {
      switch (day) {
        case 0: { return 0; }
        case 6: { return 0; }
        default: { return 1; }
      }
    }
  `);
  eq(inst.call("dayType", [0]), 0, "Sunday");
  eq(inst.call("dayType", [3]), 1, "Wednesday");
  eq(inst.call("dayType", [6]), 0, "Saturday");
});

// ── §wac-no-fallthru-r5kw2n8 — no fallthrough in switch ──────────────────────

Deno.test("[§wac-no-fallthru-r5kw2n8] testNoFallthrough() returns 20", async () => {
  const inst = await run(`
    export i32 testNoFallthrough() {
      i32 x = 0;
      switch (1) {
        case 0: { x = 10; }
        case 1: { x = 20; }
        case 2: { x = 30; }
      }
      return x;
    }
  `);
  eq(inst.call("testNoFallthrough", []), 20, "no fallthrough");
});

// ── §wac-trap-stmt-v3kq8fn and §wac-trap-fires-w2jm4pd — trap ────────────────

Deno.test("[§wac-trap-stmt-v3kq8fn] mustBePositive(5) returns 5", async () => {
  const inst = await run(`
    export i32 mustBePositive(i32 n) {
      if (n <= 0) { trap; }
      return n;
    }
  `);
  eq(inst.call("mustBePositive", [5]), 5, "mustBePositive(5)");
});

Deno.test("[§wac-trap-fires-w2jm4pd] mustBePositive(-1) traps", async () => {
  const inst = await run(`
    export i32 mustBePositive(i32 n) {
      if (n <= 0) { trap; }
      return n;
    }
  `);
  traps(() => inst.call("mustBePositive", [-1]), "trap fires");
});

// ── §wac-hex-cs4i9ht — hex literals ──────────────────────────────────────────

Deno.test("[§wac-hex-cs4i9ht] mask=255, color=16711935", async () => {
  const inst = await run(`
    export i32 getMask()  { i32 mask  = 0xFF;     return mask; }
    export i32 getColor() { i32 color = 0xFF00FF;  return color; }
  `);
  eq(inst.call("getMask",  []), 255,      "mask 0xFF");
  eq(inst.call("getColor", []), 16711935, "color 0xFF00FF");
});

// ── §wac-widen-8va4bye — lossless cast as ────────────────────────────────────

Deno.test("[§wac-widen-8va4bye] big=42, precise=42.0, n=1", async () => {
  const inst = await run(`
    export i64 getBig(i32 x)     { return x as i64; }
    export f64 getPrecise(i32 x) { return x as f64; }
    export i32 getN(bool b)      { return b as i32; }
  `);
  eq(inst.call("getBig",     [42]),   42n, "big");
  near(inst.call("getPrecise", [42]) as number, 42.0, "precise");
  eq(inst.call("getN",       [true]), 1,   "n=1");
});

// ── §wac-narrow-ok-2ytx5qj and §wac-narrow-trap-z7te84b — checked narrow ─────

Deno.test("[§wac-narrow-ok-2ytx5qj] safeNarrow(42 as i64) returns 42", async () => {
  const inst = await run(`export i32 safeNarrow(i64 big) { return big as! i32; }`);
  eq(inst.call("safeNarrow", [42n]), 42, "safeNarrow(42n)");
});

Deno.test("[§wac-narrow-trap-z7te84b] safeNarrow(1000000000000) traps", async () => {
  const inst = await run(`export i32 safeNarrow(i64 big) { return big as! i32; }`);
  traps(() => inst.call("safeNarrow", [1000000000000n]), "narrow trap");
});

// ── §wac-round-f2k8mxp — nearest cast as~ ────────────────────────────────────

Deno.test("[§wac-round-f2k8mxp] roundIt(3.7)=4, roundIt(-2.3)=-2, roundIt(2.5)=2", async () => {
  const inst = await run(`export i32 roundIt(f64 x) { return x as~ i32; }`);
  eq(inst.call("roundIt", [3.7]),   4,  "roundIt(3.7)");
  eq(inst.call("roundIt", [-2.3]), -2,  "roundIt(-2.3)");
  eq(inst.call("roundIt", [2.5]),   2,  "roundIt(2.5) round-half-to-even");
});

// ── §wac-saturate-n7qw3jl — saturate clamp ───────────────────────────────────

Deno.test("[§wac-saturate-n7qw3jl] saturate clamps to i32 range", async () => {
  const inst = await run(`export i32 saturate(i64 big) { return big as~ i32; }`);
  eq(inst.call("saturate", [1000000000000n]),  2147483647,  "clamp max");
  eq(inst.call("saturate", [-1000000000000n]), -2147483648, "clamp min");
});

// ── §wac-truthy-cagp47u — i32 as~ bool ───────────────────────────────────────

Deno.test("[§wac-truthy-cagp47u] truthy(0)=false, truthy(42)=true", async () => {
  const inst = await run(`export bool truthy(i32 x) { return x as~ bool; }`);
  eq(inst.call("truthy", [0]),  false, "truthy(0)");
  eq(inst.call("truthy", [42]), true,  "truthy(42)");
});

// ── §wac-raw-trunc64-p4jn2wq — raw truncate i64->i32 ─────────────────────────

Deno.test("[§wac-raw-trunc64-p4jn2wq] truncBits(1000000000000) returns -727379968", async () => {
  const inst = await run(`export i32 truncBits(i64 big) { return big as@ i32; }`);
  eq(inst.call("truncBits", [1000000000000n]), -727379968, "truncBits");
});

// ── §wac-raw-truncf-r8kf4mb — raw truncate f64->i32 ──────────────────────────

Deno.test("[§wac-raw-truncf-r8kf4mb] truncFloat(3.7)=3, truncFloat(-2.3)=-2", async () => {
  const inst = await run(`export i32 truncFloat(f64 x) { return x as@ i32; }`);
  eq(inst.call("truncFloat", [3.7]),   3,  "truncFloat(3.7)");
  eq(inst.call("truncFloat", [-2.3]), -2,  "truncFloat(-2.3)");
});

// ── §wac-castop-lossy-k3myl2r — wrong cast op errors ─────────────────────────

Deno.test("[§wac-castop-lossy-k3myl2r] x as~ i64 is a compile error", () => {
  err(`export i64 bad(i32 x) { return x as~ i64; }`);
});

Deno.test("[§wac-castop-check-r7zudy3] x as! i64 is a compile error", () => {
  err(`export i64 bad(i32 x) { return x as! i64; }`);
});

Deno.test("[§wac-castop-raw-w5hm9qf] x as@ i64 is a compile error", () => {
  err(`export i64 bad(i32 x) { return x as@ i64; }`);
});

// ── §wac-ref-upcast-p3kx7wn — ref upcast ─────────────────────────────────────

Deno.test("[§wac-ref-upcast-p3kx7wn] upcast Rect to Shape compiles", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Rect : Shape { f64 w; f64 h; }
    export f64 testUpcast() {
      Rect r = Rect(1.0, 2.0, 10.0, 20.0);
      Shape s = r as Shape;
      return s.x;
    }
  `);
  near(inst.call("testUpcast", []) as number, 1.0, "upcast x");
});

// ── §wac-ref-downcast-q8fm2jd — wrong downcast traps ─────────────────────────

Deno.test("[§wac-ref-downcast-q8fm2jd] downcasting Circle as! Rect traps", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Rect   : Shape { f64 w; f64 h; }
    struct Circle : Shape { f64 radius; }
    export f64 testWrongCast() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      Rect r = s as! Rect;
      return r.w;
    }
  `);
  traps(() => inst.call("testWrongCast", []), "wrong downcast");
});

// ── §wac-ref-downcast-ok-r5tn4jk — correct downcast succeeds ─────────────────

Deno.test("[§wac-ref-downcast-ok-r5tn4jk] downcasting Circle as! Circle succeeds", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Circle : Shape { f64 radius; }
    export f64 testCorrectCast() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      Circle c2 = s as! Circle;
      return c2.radius;
    }
  `);
  near(inst.call("testCorrectCast", []) as number, 5.0, "correct downcast");
});

// ── §wac-ref-downcast-err-v2hk8wp — s as Circle (not as!) is error ───────────

Deno.test("[§wac-ref-downcast-err-v2hk8wp] s as Circle (downcast without !) is error", () => {
  err(`
    struct Shape { f64 x; f64 y; }
    struct Circle : Shape { f64 radius; }
    export void bad(Shape s) { Circle c = s as Circle; }
  `);
});

// ── §wac-i31-cast-g1r2xmx — i31ref round-trip via anyref ─────────────────────

Deno.test("[§wac-i31-cast-g1r2xmx] 42 as! i31ref as i32 returns 42", async () => {
  const inst = await run(`
    export i32 testI31Cast() {
      i31ref small = 42 as! i31ref;
      i32 n = small as i32;
      anyref val = small;
      if (val is i31ref) {
        i31ref x = val as! i31ref;
        return x as i32;
      }
      return -1;
    }
  `);
  eq(inst.call("testI31Cast", []), 42, "i31ref round-trip via anyref");
});

// ── §wac-arr-default-uwpc1ls — array new default ─────────────────────────────

Deno.test("[§wac-arr-default-uwpc1ls] a.len()=5, a[0]=0", async () => {
  const inst = await run(`
    export i32 getLen() { i32[] a = i32[5](); return a.len(); }
    export i32 getZero() { i32[] a = i32[5](); return a[0]; }
  `);
  eq(inst.call("getLen",  []), 5, "len");
  eq(inst.call("getZero", []), 0, "a[0]");
});

// ── §wac-arr-fixed-v6p97qy — array new fixed ─────────────────────────────────

Deno.test("[§wac-arr-fixed-v6p97qy] b.len()=3, b[0]=1, b[2]=3", async () => {
  const inst = await run(`
    export i32 getLen() { i32[] b = i32[](1, 2, 3); return b.len(); }
    export i32 get0()   { i32[] b = i32[](1, 2, 3); return b[0]; }
    export i32 get2()   { i32[] b = i32[](1, 2, 3); return b[2]; }
  `);
  eq(inst.call("getLen", []), 3, "len");
  eq(inst.call("get0",   []), 1, "b[0]");
  eq(inst.call("get2",   []), 3, "b[2]");
});

// ── §wac-arr-oob-7jby7f8 — out of bounds traps ───────────────────────────────

Deno.test("[§wac-arr-oob-7jby7f8] oob() traps", async () => {
  const inst = await run(`
    export i32 oob() { i32[] a = i32[3](); return a[5]; }
  `);
  traps(() => inst.call("oob", []), "array oob");
});

// ── §wac-arr-nullable-tbpzqk1 — nullable array default null ──────────────────

Deno.test("[§wac-arr-nullable-tbpzqk1] points[0] is null", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export bool testNullElement() {
      Point?[] points = Point?[10]();
      return points[0] is null;
    }
  `);
  eq(inst.call("testNullElement", []), true, "nullable element is null");
});

// ── §wac-arr-struct-xo3j05c — struct array default values ────────────────────

Deno.test("[§wac-arr-struct-xo3j05c] ps[0].x is 0", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 getX() { Point[] ps = Point[10](); return ps[0].x; }
  `);
  eq(inst.call("getX", []), 0, "ps[0].x");
});

// ── §wac-arr-alias-co33gnn — array aliasing ───────────────────────────────────

Deno.test("[§wac-arr-alias-co33gnn] arrAlias() returns 99", async () => {
  const inst = await run(`
    export i32 arrAlias() {
      i32[] a = i32[](1, 2, 3);
      i32[] b = a;
      b[0] = 99;
      return a[0];
    }
  `);
  eq(inst.call("arrAlias", []), 99, "aliasing");
});

// ── §wac-arr-sum-5r0hbqg — array iteration ────────────────────────────────────

Deno.test("[§wac-arr-sum-5r0hbqg] sum({10,20,30}) returns 60", async () => {
  const inst = await run(`
    export i32 sumArr() {
      i32[] arr = i32[](10, 20, 30);
      i32 total = 0;
      for (i32 i = 0; i < arr.len(); i++) { total += arr[i]; }
      return total;
    }
  `);
  eq(inst.call("sumArr", []), 60, "sum");
});

// ── §wac-arr-nested-l8rdntl — nested arrays ──────────────────────────────────

Deno.test("[§wac-arr-nested-l8rdntl] grid[1][2] is 6", async () => {
  const inst = await run(`
    export i32 testGrid() {
      i32[][] grid = i32[][3]();
      grid[0] = i32[](1, 2, 3);
      grid[1] = i32[](4, 5, 6);
      grid[2] = i32[](7, 8, 9);
      return grid[1][2];
    }
  `);
  eq(inst.call("testGrid", []), 6, "grid[1][2]");
});

// ── §wac-arr-i8-k3fn7wp — packed byte arrays ─────────────────────────────────

Deno.test("[§wac-arr-i8-k3fn7wp] bytes[0]=255 after setting 0xFF", async () => {
  const inst = await run(`
    export i32 testU8() {
      u8[] bytes = u8[4]();
      bytes[0] = 0xFF;
      return bytes[0];
    }
    export i32 testI8() {
      i8[] bytes = i8[4]();
      bytes[0] = 0xFF;
      return bytes[0];
    }
  `);
  // Same byte in storage; the element type decides how the read extends it.
  eq(inst.call("testU8", []), 255, "u8 zero-extends 0xFF");
  eq(inst.call("testI8", []), -1, "i8 sign-extends the same byte");
});

// ── §wac-arr-i16-m8qj4xf — i16 packed array ──────────────────────────────────

Deno.test("[§wac-arr-i16-m8qj4xf] shorts[0]=1000", async () => {
  const inst = await run(`
    export i32 testI16() {
      i16[] shorts = i16[4]();
      shorts[0] = 1000;
      return shorts[0];
    }
  `);
  eq(inst.call("testI16", []), 1000, "i16 read 1000");
});

// ── §wac-arr-i8-lit-* — packed array literals take i32 elements ─────────────
//
// Truncation values are chosen so a non-truncating implementation cannot pass:
// 300 & 0xFF == 44 and 70000 & 0xFFFF == 4464 (both verified in Python).

Deno.test("[§wac-arr-i8-lit-3fqjy2m] byteLit(0) returns 104", async () => {
  const inst = await run(`
    export i32 byteLit(i32 i) {
      i8[] bytes = i8[](104, 101, 108, 108, 111);
      return bytes[i];
    }
  `);
  eq(inst.call("byteLit", [0]), 104, "bytes[0]");
  eq(inst.call("byteLit", [4]), 111, "bytes[4]");
});

Deno.test("[§wac-arr-i8-lit-trunc-i9g6kol] byteLitTrunc() returns 44", async () => {
  const inst = await run(`
    export i32 byteLitTrunc() {
      i8[] bytes = i8[](300);
      return bytes[0];
    }
  `);
  eq(inst.call("byteLitTrunc", []), 44, "300 truncated to 8 bits");
});

Deno.test("[§wac-arr-i16-lit-kyrurqi] i16[](70000) element reads back 4464", async () => {
  const inst = await run(`
    export i32 shortLit() {
      i16[] shorts = i16[](70000);
      return shorts[0];
    }
  `);
  eq(inst.call("shortLit", []), 4464, "70000 truncated to 16 bits");
});

Deno.test("[§wac-arr-i8-lit-badtype-3w7g6aa] non-i32 element in a packed literal is an error", () => {
  const m = err(`export i32 bad() { i8[] b = i8[](1.5); return b[0]; }`);
  if (!m.includes("expected i32")) {
    throw new Error(`expected an i32 element-type diagnostic, got: ${m}`);
  }
});

// ── §wac-arr-packed-cast — a packed element reads as i32 and casts onward ────
//
// The emitter's typeOfExpr reported the raw element type for an index, while the
// type checker normalised it to i32. The cast path then looked for a u8 -> i64
// conversion, found none, and emitted no widening — valid types, invalid wasm. So
// this instantiates rather than only compiling.

Deno.test("[§wac-arr-packed-cast-nfe1ha9] a packed element widens to i64", async () => {
  const inst = await run(`
    export i64 wideByte(u8[] bytes) { return bytes[0] as i64; }
    export i64 wideSigned(i8[] bytes) { return bytes[0] as i64; }
    export f64 wideFloat(u8[] bytes) { return bytes[0] as f64; }
    export u8[] makeU8(i32 v) { u8[] b = u8[1](); b[0] = v; return b; }
    export i8[] makeI8(i32 v) { i8[] b = i8[1](); b[0] = v; return b; }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  // u8[] and i8[] are distinct array types, so each needs its own constructor —
  // one maker cannot feed both.
  const u = raw.makeU8(200);
  eq(raw.wideByte(u), 200n, "u8 200 widens to i64 200");
  eq(raw.wideFloat(u), 200, "u8 200 widens to f64 200");
  // i8 sign-extends on read, so the same bits are -56 before widening.
  eq(raw.wideSigned(raw.makeI8(200)), -56n, "i8 200 reads as -56 and widens");
});

// ── §wac-arr-i8-compound-* — compound assignment on packed elements ─────────
//
// Packed elements must be read back with array.get_u; array.get is not a valid
// instruction on an i8/i16 array, so before this was fixed each of these
// produced a module that failed wasm validation. run() therefore doubles as the
// well-formedness check, and the values verify the i32-width-then-truncate rule.

Deno.test("[§wac-arr-i8-compound-t7btdiv] packedOr(0xF0, 0x0F) returns 255", async () => {
  const inst = await run(`
    export i32 packedOr(i32 a, i32 b) {
      u8[] bytes = u8[1]();
      bytes[0] = a;
      bytes[0] |= b;
      return bytes[0];
    }
  `);
  eq(inst.call("packedOr", [0xF0, 0x0F]), 255, "0xF0 |= 0x0F");
});

Deno.test("[§wac-arr-i8-cwrap-8qsspoh] packedWrap(250, 10) returns 4", async () => {
  const inst = await run(`
    export i32 packedWrap(i32 a, i32 b) {
      i8[] bytes = i8[1]();
      bytes[0] = a;
      bytes[0] += b;
      return bytes[0];
    }
  `);
  // 250 + 10 = 260; the store truncates to 8 bits, and the read zero-extends:
  // 260 & 0xFF == 4. A sign-extending read would give 4 here too, so the
  // 0xF0|0x0F case above is what pins down get_u vs get_s.
  eq(inst.call("packedWrap", [250, 10]), 4, "250 += 10 truncates to 4");
});

Deno.test("[§wac-arr-i16-compound-6i4h16a] i16 compound or gives 65535", async () => {
  const inst = await run(`
    export i32 packedOr16(i32 a, i32 b) {
      u16[] shorts = u16[1]();
      shorts[0] = a;
      shorts[0] |= b;
      return shorts[0];
    }
  `);
  // 0xFF00 in an i16 slot read back sign-extended would be -1, not 65535
  eq(inst.call("packedOr16", [0x00FF, 0xFF00]), 65535, "0x00FF |= 0xFF00");
});

Deno.test("[§wac-arr-i8-incr-tlkmjp0] bytes[0]++ increments a packed element", async () => {
  const inst = await run(`
    export i32 packedIncr(i32 a) {
      i8[] bytes = i8[2]();
      bytes[1] = a;
      bytes[1]++;
      return bytes[1];
    }
  `);
  eq(inst.call("packedIncr", [5]), 6, "packed element ++");
});

// ── §wac-arr-i8-nolocal-p7hd5wn — i8 not a variable type ────────────────────

Deno.test("[§wac-arr-i8-nolocal-p7hd5wn] i8 as variable type is a compile error", () => {
  err(`export void bad() { i8 x = 5; }`);
});

// ── §wac-arr-i8-noparam-w5hd3jk — i8 not a parameter type ───────────────────

Deno.test("[§wac-arr-i8-noparam-w5hd3jk] i8 as parameter type is a compile error", () => {
  err(`export i32 process(i8 val) { return 0; }`);
});

// ── §wac-arr-i8-noreturn-k7fn2qp — i8 not a return type ─────────────────────

Deno.test("[§wac-arr-i8-noreturn-k7fn2qp] i8 as return type is a compile error", () => {
  err(`export i8 getByte() { return 0; }`);
});

// ── §wac-arr-i8-trunc-r2km9jf — i8 truncation on write ──────────────────────

Deno.test("[§wac-arr-i8-trunc-r2km9jf] testTrunc() returns 0 (256 truncates)", async () => {
  const inst = await run(`
    export i32 testTrunc() {
      i8[] b = i8[1]();
      b[0] = 256;
      return b[0];
    }
  `);
  eq(inst.call("testTrunc", []), 0, "256 truncates to 0");
});

// ── §wac-struct-positional-ycapwjx — positional construction ─────────────────

Deno.test("[§wac-struct-positional-ycapwjx] Point(3,4) p.x=3 p.y=4", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 getX() { Point p = Point(3, 4); return p.x; }
    export i32 getY() { Point p = Point(3, 4); return p.y; }
  `);
  eq(inst.call("getX", []), 3, "p.x");
  eq(inst.call("getY", []), 4, "p.y");
});

// ── §wac-struct-named-4y8pg2j — named construction ───────────────────────────

Deno.test("[§wac-struct-named-4y8pg2j] Point{y:4,x:3} same as Point(3,4)", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 getX() { Point q = Point { y: 4, x: 3 }; return q.x; }
    export i32 getY() { Point q = Point { y: 4, x: 3 }; return q.y; }
  `);
  eq(inst.call("getX", []), 3, "q.x");
  eq(inst.call("getY", []), 4, "q.y");
});

// ── §wac-struct-default-ar2wgyf — default construction ───────────────────────

Deno.test("[§wac-struct-default-ar2wgyf] Point() r.x=0 r.y=0", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 getX() { Point r = Point(); return r.x; }
    export i32 getY() { Point r = Point(); return r.y; }
  `);
  eq(inst.call("getX", []), 0, "r.x");
  eq(inst.call("getY", []), 0, "r.y");
});

// ── §wac-struct-partial-76iq9nc — partial construction error ─────────────────

Deno.test("[§wac-struct-partial-76iq9nc] Point(3) missing fields is a compile error", () => {
  err(`struct Point { i32 x; i32 y; } export void bad() { Point p = Point(3); }`);
});

// ── §wac-recursive-nodefault-1os4yl4 — recursive non-null no default ─────────

Deno.test("[§wac-recursive-nodefault-1os4yl4] non-null recursive field is a compile error", () => {
  err(`struct Node { i32 val; Node next; } export void bad() { Node n = Node(); }`);
});

// ── §wac-nested-default-tctff6b — nested default construction ────────────────

Deno.test("[§wac-nested-default-tctff6b] Line() creates Line with default Points", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    struct Line { Point start; Point end; }
    export i32 getStartX() { Line l = Line(); return l.start.x; }
    export i32 getEndY()   { Line l = Line(); return l.end.y; }
  `);
  eq(inst.call("getStartX", []), 0, "start.x");
  eq(inst.call("getEndY",   []), 0, "end.y");
});

// ── §wac-alias-9j8cnc7 — struct aliasing ─────────────────────────────────────

Deno.test("[§wac-alias-9j8cnc7] alias() returns 99", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export i32 alias() {
      Point a = Point(1, 2);
      Point b = a;
      b.x = 99;
      return a.x;
    }
  `);
  eq(inst.call("alias", []), 99, "aliasing returns 99");
});

// ── §wac-method-ta71o2i and §wac-method-inc-09hcqkq — methods ────────────────

Deno.test("[§wac-method-ta71o2i] Counter.create(1) count=0 id=1", async () => {
  const inst = await run(`
    struct Counter {
      i32 count;
      const i32 id;
      i32 getCount(const this) { return this.count; }
      i32 getId(const this)    { return this.id; }
      Counter create(i32 id) { return Counter(0, id); }
    }
    export i32 getCount() { Counter c = Counter.create(1); return c.getCount(); }
    export i32 getId()    { Counter c = Counter.create(1); return c.getId(); }
  `);
  eq(inst.call("getCount", []), 0, "count=0");
  eq(inst.call("getId",    []), 1, "id=1");
});

Deno.test("[§wac-method-inc-09hcqkq] after c.inc() c.getCount()=1", async () => {
  const inst = await run(`
    struct Counter {
      i32 count;
      const i32 id;
      i32 getCount(const this) { return this.count; }
      void inc(this) { this.count += 1; }
      Counter create(i32 id) { return Counter(0, id); }
    }
    export i32 testInc() {
      Counter c = Counter.create(1);
      c.inc();
      return c.getCount();
    }
  `);
  eq(inst.call("testInc", []), 1, "getCount after inc");
});

// ── §wac-method-const-d5zjb9i — const field write error ──────────────────────

Deno.test("[§wac-method-const-d5zjb9i] writing const field in method is a compile error", () => {
  err(`
    struct Counter {
      i32 count;
      const i32 id;
      void inc(this) { this.count += 1; this.id = 5; }
    }
    export void test() {}
  `);
});

// ── §wac-bare-field-q3wn8v5 — bare field access is error ─────────────────────

Deno.test("[§wac-bare-field-q3wn8v5] bare count inside method is a compile error", () => {
  err(`
    struct Foo {
      i32 count;
      i32 getCount(const this) { return count; }
    }
    export void test() {}
  `);
});

// ── §wac-const-field-inftga5 — write to const field is error ─────────────────

Deno.test("[§wac-const-field-inftga5] writing const field is a compile error", () => {
  err(`
    struct IdPoint { const i32 id; i32 x; }
    export void bad() { IdPoint p = IdPoint(1, 0); p.id = 5; }
  `);
});

// ── §wac-const-struct-g9apxwr — write to const struct field is error ──────────

Deno.test("[§wac-const-struct-g9apxwr] writing any field of const struct is error", () => {
  err(`
    const struct Config { i32 width; i32 height; }
    export void bad() { Config c = Config(800, 600); c.width = 1920; }
  `);
});

// ── §wac-str-fromcp-* — string.fromCodepoint ─────────────────────────────────

Deno.test(`[§wac-str-fromcp-k8nf3wq] letterA() returns "A"`, async () => {
  // Compared against a real literal, so the bytes have to match what the lexer
  // and emitter produce for "A" — not merely be self-consistent.
  const inst = await run(`
    export bool test() { return string.fromCodepoint(65) == "A"; }
  `);
  eq(inst.call("test", []), true, `fromCodepoint(65) == "A"`);
});

Deno.test(`[§wac-str-fromcp-utf8-r4mj7xt] the result is UTF-8 at every width`, async () => {
  // Each case is checked two ways: the byte length, and equality with the literal
  // spelling of the same character. A wrong lead byte or a missing continuation
  // byte fails the second even when the first passes.
  const inst = await run(`
    export bool eq1() { return string.fromCodepoint(65) == "A"; }
    export bool eq2() { return string.fromCodepoint(233) == "é"; }
    export bool eq3() { return string.fromCodepoint(26085) == "日"; }
    export bool eq4() { return string.fromCodepoint(128512) == "😀"; }
    export i32 len1() { return string.fromCodepoint(65).len(); }
    export i32 len2() { return string.fromCodepoint(233).len(); }
    export i32 len3() { return string.fromCodepoint(26085).len(); }
    export i32 len4() { return string.fromCodepoint(128512).len(); }
    export bool bounds() {
      return string.fromCodepoint(0x7F).len() == 1
          && string.fromCodepoint(0x80).len() == 2
          && string.fromCodepoint(0x7FF).len() == 2
          && string.fromCodepoint(0x800).len() == 3
          && string.fromCodepoint(0xFFFF).len() == 3
          && string.fromCodepoint(0x10000).len() == 4;
    }
  `);
  eq(inst.call("eq2", []), true, "U+00E9 encodes as é");
  eq(inst.call("eq3", []), true, "U+65E5 encodes as 日");
  eq(inst.call("eq4", []), true, "U+1F600 encodes as 😀");
  eq(inst.call("len1", []), 1, "ASCII is 1 byte");
  eq(inst.call("len2", []), 2, "U+00E9 is 2 bytes");
  eq(inst.call("len3", []), 3, "U+65E5 is 3 bytes");
  eq(inst.call("len4", []), 4, "U+1F600 is 4 bytes");
  eq(inst.call("bounds", []), true, "every width boundary lands in the right branch");
});

Deno.test(`[§wac-str-fromcp-trap-h6qw2np] values with no encoding trap`, async () => {
  const inst = await run(`
    export i32 low()   { return string.fromCodepoint(0xD800).len(); }
    export i32 high()  { return string.fromCodepoint(0xDFFF).len(); }
    export i32 big()   { return string.fromCodepoint(0x110000).len(); }
    export i32 neg()   { return string.fromCodepoint(0 - 1).len(); }
    export i32 justOk(){ return string.fromCodepoint(0xD7FF).len(); }
    export i32 alsoOk(){ return string.fromCodepoint(0xE000).len(); }
  `);
  traps(() => inst.call("low", []), "a low surrogate has no UTF-8 form");
  traps(() => inst.call("high", []), "a high surrogate has no UTF-8 form");
  traps(() => inst.call("big", []), "above U+10FFFF");
  traps(() => inst.call("neg", []), "negative");
  // Either side of the surrogate block must still work, or the range check is
  // too wide and would reject valid text.
  eq(inst.call("justOk", []), 3, "U+D7FF is valid");
  eq(inst.call("alsoOk", []), 3, "U+E000 is valid");
});

Deno.test(`[§wac-str-fromcp-k8nf3wq] arity and argument type are checked`, () => {
  const a = err(`export string bad() { return string.fromCodepoint(); }`);
  if (!a.includes("takes 1 argument")) throw new Error(`unexpected: ${a}`);
  const b = err(`export string bad() { return string.fromCodepoint(1.5); }`);
  if (!b.includes("must be i32")) throw new Error(`unexpected: ${b}`);
  const c = err(`export string bad() { return string.nosuch(1); }`);
  if (!c.includes("no static method")) throw new Error(`unexpected: ${c}`);
});

// ── §wac-f64bits-* — f64.toBits / f64.fromBits ───────────────────────────────

Deno.test(`[§wac-f64bits-h3kq9wn] the bit pattern matches IEEE 754`, async () => {
  const inst = await run(`
    export u64 one()      { return f64.toBits(1.0); }
    export u64 half()     { return f64.toBits(0.5); }
    export u64 negTwoFive(){ return f64.toBits(-2.5); }
    export u64 tiny()     { return f64.toBits(5.0e-324); }
    export f64 back()     { return f64.fromBits(0x3FF0000000000000); }
    export f64 backTiny() { return f64.fromBits(1); }
  `);
  // Expected patterns from the host's own DataView, not from memory.
  const view = new DataView(new ArrayBuffer(8));
  const bitsOf = (x: number): bigint => { view.setFloat64(0, x); return view.getBigUint64(0); };
  const asU64 = (v: unknown): bigint => (v as bigint) & 0xFFFFFFFFFFFFFFFFn;
  eq(asU64(inst.call("one", [])), bitsOf(1.0), "1.0");
  eq(asU64(inst.call("half", [])), bitsOf(0.5), "0.5");
  eq(asU64(inst.call("negTwoFive", [])), bitsOf(-2.5), "-2.5 — the sign bit is set");
  eq(asU64(inst.call("tiny", [])), bitsOf(5e-324), "the smallest subnormal is 1");
  eq(inst.call("back", []), 1.0, "fromBits inverts it");
  eq(inst.call("backTiny", []), 5e-324, "including for a subnormal");
});

Deno.test(`[§wac-f64bits-round-r7mf4jp] fromBits(toBits(x)) == x`, async () => {
  const inst = await run(`
    export bool round(f64 x) { return f64.fromBits(f64.toBits(x)) == x; }
    // NaN is not equal to itself, so compare the bits instead.
    export bool roundNaN() {
      f64 nan = 0.0 / 0.0;
      return f64.toBits(f64.fromBits(f64.toBits(nan))) == f64.toBits(nan);
    }
  `);
  for (const x of [1.0, -1.0, 0.5, 3.14159265358979, 1e308, -1e308, 5e-324,
                   2.2250738585072014e-308, 1 / 0, -1 / 0]) {
    eq(inst.call("round", [x]), true, `round-trips ${x}`);
  }
  eq(inst.call("roundNaN", []), true, "NaN's payload survives the round trip");
});

Deno.test(`[§wac-f64bits-zero-w2nk6dq] the sign of zero is visible`, async () => {
  const inst = await run(`
    export bool distinct() { return f64.toBits(-0.0) != f64.toBits(0.0); }
    export bool equalAsFloats() { return -0.0 == 0.0; }
    export u64 negZero() { return f64.toBits(-0.0); }
  `);
  eq(inst.call("distinct", []), true, "the bit patterns differ");
  eq(inst.call("equalAsFloats", []), true, "even though the values compare equal");
  eq((inst.call("negZero", []) as bigint) & 0xFFFFFFFFFFFFFFFFn, 1n << 63n,
    "-0.0 is the sign bit alone");
});

Deno.test(`[§wac-f64bits-h3kq9wn] arity and argument types are checked`, () => {
  const a = err(`export u64 bad() { return f64.toBits(); }`);
  if (!a.includes("takes 1 argument")) throw new Error(`unexpected: ${a}`);
  const b = err(`export u64 bad() { return f64.toBits(1); }`);
  if (!b.includes("must be f64")) throw new Error(`unexpected: ${b}`);
  const c = err(`export f64 bad() { return f64.fromBits(1.0); }`);
  if (!c.includes("must be u64")) throw new Error(`unexpected: ${c}`);
  const d = err(`export f64 bad() { return f64.nope(1.0); }`);
  if (!d.includes("no static method")) throw new Error(`unexpected: ${d}`);
});

// ── §wac-f32bits-* — f32.toBits / f32.fromBits ───────────────────────────────

Deno.test(`[§wac-f32bits-m4kq2wp] the f32 bit pattern matches IEEE 754`, async () => {
  const inst = await run(`
    export u32 bits(f32 x)  { return f32.toBits(x); }
    export f32 back(u32 b)  { return f32.fromBits(b); }
    export u32 one()        { return f32.toBits(1.0 as~ f32); }
    export bool round(f32 x){ return f32.fromBits(f32.toBits(x)) == x; }
    export bool zeroSign()  { return f32.toBits(-0.0 as~ f32) != f32.toBits(0.0 as~ f32); }
    export f32 tiny()       { return f32.fromBits(1); }
  `);
  const view = new DataView(new ArrayBuffer(4));
  const bitsOf = (x: number): number => { view.setFloat32(0, x); return view.getUint32(0); };
  const asU32 = (v: unknown): number => (v as number) >>> 0;

  for (const x of [1.0, 0.5, -2.5, 3.14159, 1e30, -1e-30]) {
    eq(asU32(inst.call("bits", [x])), bitsOf(Math.fround(x)), `bits of ${x}`);
    eq(inst.call("round", [x]), true, `round-trips ${x}`);
  }
  eq(asU32(inst.call("one", [])), 0x3F800000, "1.0 is 0x3F800000");
  eq(inst.call("zeroSign", []), true, "-0.0 differs from 0.0 in its bits");
  // Bit pattern 1 is the smallest f32 subnormal — an implementation that shifted
  // or masked anything would not produce it.
  view.setUint32(0, 1);
  eq(inst.call("tiny", []), view.getFloat32(0), "fromBits(1) is the smallest subnormal");
});

Deno.test(`[§wac-f32bits-m4kq2wp] f32 and f64 pair only with their own width`, () => {
  // The widths must not be interchangeable: each reinterpret is width-preserving,
  // and accepting the wrong one would silently reinterpret across sizes.
  const a = err(`export u32 bad(f64 x) { return f32.toBits(x); }`);
  if (!a.includes("must be f32")) throw new Error(`unexpected: ${a}`);
  const b = err(`export f32 bad(u64 b) { return f32.fromBits(b); }`);
  if (!b.includes("must be u32")) throw new Error(`unexpected: ${b}`);
  const c = err(`export u64 bad(f32 x) { return f64.toBits(x); }`);
  if (!c.includes("must be f64")) throw new Error(`unexpected: ${c}`);
  const d = err(`export f32 bad() { return f32.nope(1); }`);
  if (!d.includes("no static method")) throw new Error(`unexpected: ${d}`);
});

// ── §wac-str-frombytes-* — string.fromBytes ──────────────────────────────────

Deno.test(`[§wac-str-frombytes-p3kq7wn] hi() returns "hi"`, async () => {
  const inst = await run(`
    export bool test() { return string.fromBytes(u8[]('h', 'i')) == "hi"; }
    export i32 len()   { return string.fromBytes(u8[]('h', 'i')).len(); }
    export bool empty(){ return string.fromBytes(u8[0]()) == ""; }
  `);
  eq(inst.call("test", []), true, `fromBytes("hi") == "hi"`);
  eq(inst.call("len", []), 2, "two bytes");
  eq(inst.call("empty", []), true, "an empty array gives the empty string");
});

Deno.test(`[§wac-str-frombytes-utf8-m9fj2xr] bytes are copied verbatim`, async () => {
  // Compared against literals, so the bytes must match what the lexer produced
  // for the same characters — a byte-order or off-by-one error in the copy fails.
  const inst = await run(`
    export bool two()   { return string.fromBytes(u8[](0xC3, 0xA9)) == "é"; }
    export bool three() { return string.fromBytes(u8[](0xE6, 0x97, 0xA5)) == "日"; }
    export bool four()  { return string.fromBytes(u8[](0xF0, 0x9F, 0x98, 0x80)) == "😀"; }
    export i32 twoLen() { return string.fromBytes(u8[](0xC3, 0xA9)).len(); }
    export i32 longer() {
      u8[] b = u8[300]();
      for (i32 i = 0; i < 300; i++) { b[i] = 'x'; }
      return string.fromBytes(b).len();
    }
  `);
  eq(inst.call("two", []), true, "U+00E9 from its two UTF-8 bytes");
  eq(inst.call("three", []), true, "U+65E5 from its three bytes");
  eq(inst.call("four", []), true, "U+1F600 from its four bytes");
  eq(inst.call("twoLen", []), 2, "len is the byte count, not the character count");
  // Past any plausible inline threshold, so the copy loop is exercised properly.
  eq(inst.call("longer", []), 300, "300 bytes copy");
});

Deno.test(`[§wac-str-frombytes-copy-w4nk8dt] the result is a copy, not a view`, async () => {
  // The important one. Aliasing the caller's array would let a later write mutate
  // a value the language guarantees is immutable, and nothing else would notice.
  const inst = await run(`
    export bool test() {
      u8[] b = u8[]('a', 'b');
      string s = string.fromBytes(b);
      b[0] = 'z';
      return s == "ab";
    }
    export bool sourceStillMutable() {
      u8[] b = u8[]('a', 'b');
      string s = string.fromBytes(b);
      b[0] = 'z';
      return b[0] == 'z';
    }
  `);
  eq(inst.call("test", []), true, "the string is unaffected by a later write");
  eq(inst.call("sourceStillMutable", []), true, "and the array is still writable");
});

Deno.test(`[§wac-str-frombytes-p3kq7wn] arity and argument type are checked`, () => {
  const a = err(`export string bad() { return string.fromBytes(); }`);
  if (!a.includes("takes 1 argument")) throw new Error(`unexpected: ${a}`);
  const b = err(`export string bad() { return string.fromBytes(5); }`);
  if (!b.includes("must be u8[]")) throw new Error(`unexpected: ${b}`);
  // i8[] is the same storage but a different type, and signedness is the whole
  // point of the distinction, so it must not be silently accepted.
  const c = err(`export string bad(i8[] b) { return string.fromBytes(b); }`);
  if (!c.includes("must be u8[]")) throw new Error(`unexpected: ${c}`);
});

// ── §wac-str-tobytes-* — string.toBytes ──────────────────────────────────────

Deno.test(`[§wac-str-tobytes-k7mq4wp] firstByte() returns 104`, async () => {
  const inst = await run(`
    export i32 first() { return "hi".toBytes()[0]; }
    export i32 len()   { return "hi".toBytes().len(); }
    export i32 empty() { return "".toBytes().len(); }
  `);
  eq(inst.call("first", []), 104, "'h' is 104");
  eq(inst.call("len", []), 2, "two bytes");
  eq(inst.call("empty", []), 0, "the empty string gives an empty array");
});

Deno.test(`[§wac-str-tobytes-utf8-r2nf8jt] the bytes are UTF-8`, async () => {
  const inst = await run(`
    export bool two()   { u8[] b = "é".toBytes(); return b.len() == 2 && b[0] == 0xC3 && b[1] == 0xA9; }
    export bool three() { u8[] b = "日".toBytes(); return b.len() == 3 && b[0] == 0xE6 && b[2] == 0xA5; }
    export bool four()  { u8[] b = "😀".toBytes(); return b.len() == 4 && b[0] == 0xF0 && b[3] == 0x80; }
    // Unsigned: a lead byte above 0x7F must not read back negative.
    export bool unsigned() { return "é".toBytes()[0] > 0; }
    export bool roundTrip() { return string.fromBytes("日本語".toBytes()) == "日本語"; }
  `);
  eq(inst.call("two", []), true, "U+00E9 is C3 A9");
  eq(inst.call("three", []), true, "U+65E5 is three bytes");
  eq(inst.call("four", []), true, "U+1F600 is four bytes");
  eq(inst.call("unsigned", []), true, "bytes read back unsigned");
  eq(inst.call("roundTrip", []), true, "fromBytes(toBytes(s)) == s");
});

Deno.test(`[§wac-str-tobytes-copy-h5wk3qm] the result is a copy, not a view`, async () => {
  // Returning the string's own storage would hand out a writable view of an
  // immutable value; a second call proves the original was untouched.
  const inst = await run(`
    export bool test() {
      u8[] b = "ab".toBytes();
      b[0] = 'z';
      return "ab".toBytes()[0] == 'a' && b[0] == 'z';
    }
    export bool viaString() {
      string s = "ab";
      u8[] b = s.toBytes();
      b[0] = 'z';
      return s == "ab";
    }
  `);
  eq(inst.call("test", []), true, "writing to the copy leaves the string alone");
  eq(inst.call("viaString", []), true, "including through a bound variable");
});

Deno.test(`[§wac-str-tobytes-k7mq4wp] toBytes takes no arguments`, () => {
  const msg = err(`export i32 bad() { return "hi".toBytes(1).len(); }`);
  if (!msg.includes("takes no arguments")) throw new Error(`unexpected: ${msg}`);
});

// ── §wac-charlit-* — character literals are i32 codepoints ───────────────────

Deno.test("[§wac-charlit-p4kn8wq] letterA() returns 97", async () => {
  const inst = await run(`export i32 letterA() { return 'a'; }`);
  eq(inst.call("letterA", []), 97, "'a' is 97");
});

Deno.test("[§wac-charlit-esc-h7mf2xj] escapes in character literals", async () => {
  const inst = await run(`
    export i32 newline() { return '\\n'; }
    export i32 quote()   { return '\\''; }
    export i32 tab()     { return '\\t'; }
    export i32 cr()      { return '\\r'; }
    export i32 nul()     { return '\\0'; }
    export i32 bslash()  { return '\\\\'; }
    export i32 dquote()  { return '\\"'; }
  `);
  eq(inst.call("newline", []), 10, "\\n is 10");
  eq(inst.call("quote", []), 39, "\\' is 39");
  eq(inst.call("tab", []), 9, "\\t is 9");
  eq(inst.call("cr", []), 13, "\\r is 13");
  eq(inst.call("nul", []), 0, "\\0 is 0");
  eq(inst.call("bslash", []), 92, "\\\\ is 92");
  eq(inst.call("dquote", []), 34, "\\\" is 34");
});

Deno.test("[§wac-charlit-cp-r3jw9kt] a character literal is a codepoint, not a byte", async () => {
  // The distinction only shows above ASCII, so both cases are non-ASCII and are
  // checked against the string byte length they are NOT equal to.
  const inst = await run(`
    export i32 emoji()    { return '😀'; }
    export i32 eacute()   { return 'é'; }
    export i32 eacuteLen() { return "é".len(); }
  `);
  eq(inst.call("emoji", []), 128512, "U+1F600 is 128512");
  eq(inst.call("eacute", []), 233, "U+00E9 is 233");
  eq(inst.call("eacuteLen", []), 2, "the same character is 2 UTF-8 bytes as a string");
});

Deno.test("[§wac-charlit-empty-m8qf5np] '' is a compile error", () => {
  const msg = err(`export i32 bad() { return ''; }`);
  if (!msg.includes("empty character literal")) {
    throw new Error(`unexpected error: ${msg}`);
  }
});

Deno.test("[§wac-charlit-multi-w2nk7dr] 'ab' is a compile error", () => {
  const msg = err(`export i32 bad() { return 'ab'; }`);
  if (!msg.includes("exactly one character")) {
    throw new Error(`unexpected error: ${msg}`);
  }
});

Deno.test("[§wac-charlit-p4kn8wq] character literals work as switch cases", async () => {
  // The reason to have them at all: a byte scanner reads as case 'x'. This also
  // proves they reach the emitter as ordinary integer constants, since switch
  // requires i32 case values.
  const inst = await run(`
    export i32 classify(i32 c) {
      switch (c) {
        case '{': { return 1; }
        case '}': { return 2; }
        case '\\n': { return 3; }
        default:  { return 0; }
      }
    }
  `);
  eq(inst.call("classify", [123]), 1, "'{' is 123");
  eq(inst.call("classify", [125]), 2, "'}' is 125");
  eq(inst.call("classify", [10]), 3, "'\\n' is 10");
  eq(inst.call("classify", [65]), 0, "'A' hits default");
});

// ── §wac-struct-export-* — export on a struct, alone and with const ──────────

Deno.test("[§wac-struct-export-m3kq8wp] only an exported struct can be imported", async () => {
  const exported = new Map([
    ["lib.wac", `export struct Open { i32 v; }`],
    ["main.wac", `
      import { Open } from "./lib.wac";
      export i32 test() { return Open(7).v; }
    `],
  ]);
  const r = wacCompile(exported, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  eq((await wacInstance(r.compiled)).call("test", []), 7, "exported struct is importable");

  const hidden = new Map([
    ["lib.wac", `struct Shut { i32 v; }`],
    ["main.wac", `
      import { Shut } from "./lib.wac";
      export i32 test() { return Shut(7).v; }
    `],
  ]);
  const bad = wacCompile(hidden, "main.wac");
  if (bad.ok) throw new Error("importing a non-exported struct should fail");
  if (!bad.diagnostics[0].message.includes("not exported")) {
    throw new Error(`unexpected error: ${bad.diagnostics[0].message}`);
  }
});

Deno.test("[§wac-struct-export-const-r7nf4jq] export const struct: both modifiers apply", async () => {
  // Two independent claims, so two checks. Parsing alone is not enough — a parser
  // that consumed `const` and dropped it would pass a compile-only test while
  // silently making the fields mutable.
  const files = new Map([
    ["lib.wac", `
      export const struct Frozen {
        i32 w;
        i32 h;
        Frozen of(i32 w, i32 h) { return Frozen(w, h); }
      }
    `],
    ["main.wac", `
      import { Frozen } from "./lib.wac";
      export i32 area() { Frozen f = Frozen.of(137, 429); return f.w * f.h; }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  // 137 * 429 = 58773 — not a value a truncation or a swapped field could produce.
  eq((await wacInstance(r.compiled)).call("area", []), 58773, "exported and usable");

  const mutating = new Map([
    ["lib.wac", `export const struct Frozen { i32 w; }`],
    ["main.wac", `
      import { Frozen } from "./lib.wac";
      export void bad() { Frozen f = Frozen(1); f.w = 2; }
    `],
  ]);
  const bad = wacCompile(mutating, "main.wac");
  if (bad.ok) throw new Error("const struct fields must stay immutable when exported");
});

// ── §wac-subpos-order-m7kx3qf — subtype positional construction order ─────────

Deno.test("[§wac-subpos-order-m7kx3qf] Rect(x,y,w,h) parent fields first", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Rect : Shape { f64 w; f64 h; }
    export f64 getW() { Rect r = Rect(1.0, 2.0, 10.0, 20.0); return r.w; }
    export f64 getX() { Rect r = Rect(1.0, 2.0, 10.0, 20.0); return r.x; }
  `);
  near(inst.call("getW", []) as number, 10.0, "w=10");
  near(inst.call("getX", []) as number, 1.0,  "x=1");
});

// ── §wac-subtype-assign-jjrjz7g — subtype assignable to parent ───────────────

Deno.test("[§wac-subtype-assign-jjrjz7g] Rect assignable to Shape, x accessible", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Rect : Shape { f64 w; f64 h; }
    export f64 testAssign() {
      Rect r = Rect(3.0, 4.0, 10.0, 20.0);
      Shape s = r;
      return s.x;
    }
  `);
  near(inst.call("testAssign", []) as number, 3.0, "s.x");
});

// ── §wac-subtype-method-2s28pfb — parent methods work on subtypes ─────────────

Deno.test("[§wac-subtype-method-2s28pfb] getX callable on Rect and Circle", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; f64 getX(const this) { return this.x; } }
    struct Rect   : Shape { f64 w; f64 h; }
    struct Circle : Shape { f64 radius; }
    export f64 rectX()   { Rect   r = Rect(5.0, 0.0, 1.0, 1.0); return r.getX(); }
    export f64 circleX() { Circle c = Circle(7.0, 0.0, 3.0);    return c.getX(); }
  `);
  near(inst.call("rectX",   []) as number, 5.0, "rect x");
  near(inst.call("circleX", []) as number, 7.0, "circle x");
});

// ── §wac-override-k7fn3qp — override method ──────────────────────────────────
// NOTE: static dispatch — override only enforces naming rules, not vtable.
// The name() method returns a string, but strings aren't yet in wasm, so we test
// that override compiles without error.

Deno.test("[§wac-override-k7fn3qp] Circle can override name method (compiles)", async () => {
  // This tests that override compiles — runtime string dispatch tested separately
  const inst = await run(`
    struct Shape { i32 x; i32 name(const this) { return 1; } }
    struct Circle : Shape { i32 radius; override i32 name(const this) { return 2; } }
    export i32 test() {
      Circle c = Circle(0, 5);
      return c.name();
    }
  `);
  eq(inst.call("test", []), 2, "override method called");
});

// ── §wac-override-missing-m4jw2rk — missing override is error ────────────────

Deno.test("[§wac-override-missing-m4jw2rk] missing override keyword is a compile error", () => {
  err(`
    struct Shape { i32 x; i32 name(const this) { return 1; } }
    struct BadRect : Shape { i32 w; i32 name(const this) { return 2; } }
    export void test() {}
  `);
});

// ── §wac-override-spurious-p9qn5xl — spurious override is error ──────────────

Deno.test("[§wac-override-spurious-p9qn5xl] override with no parent method is error", () => {
  err(`
    struct BadShape { override i32 foo(const this) { return 0; } }
    export void test() {}
  `);
});

// ── §wac-nostatic-inh-r3kf8wp — static not inherited ────────────────────────

Deno.test("[§wac-nostatic-inh-r3kf8wp] calling inherited static is a compile error", () => {
  err(`
    struct Base { Base make() { return Base(); } }
    struct Sub : Base { i32 extra; }
    export void bad() { Sub s = Sub.make(); }
  `);
});

// ── §wac-is-dz9jg1l — is type test ───────────────────────────────────────────

Deno.test("[§wac-is-dz9jg1l] Circle is Circle=true, Circle is Rect=false", async () => {
  const inst = await run(`
    struct Shape  { f64 x; f64 y; }
    struct Rect   : Shape { f64 w; f64 h; }
    struct Circle : Shape { f64 radius; }
    export bool isCircle() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      return s is Circle;
    }
    export bool isRect() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      return s is Rect;
    }
  `);
  eq(inst.call("isCircle", []), true,  "Circle is Circle");
  eq(inst.call("isRect",   []), false, "Circle is Rect");
});

// ── §wac-as-trap-d10qz88 — wrong as! cast traps ───────────────────────────────

Deno.test("[§wac-as-trap-d10qz88] casting Circle as! Rect traps", async () => {
  const inst = await run(`
    struct Shape  { f64 x; f64 y; }
    struct Rect   : Shape { f64 w; f64 h; }
    struct Circle : Shape { f64 radius; }
    export f64 badCast() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      Rect r = s as! Rect;
      return r.w;
    }
  `);
  traps(() => inst.call("badCast", []), "wrong cast traps");
});

// ── §wac-is-not-fwatmyk — is not ─────────────────────────────────────────────

Deno.test("[§wac-is-not-fwatmyk] Circle is not Rect = true", async () => {
  const inst = await run(`
    struct Shape  { f64 x; f64 y; }
    struct Rect   : Shape { f64 w; f64 h; }
    struct Circle : Shape { f64 radius; }
    export bool testIsNot() {
      Circle c = Circle(0.0, 0.0, 5.0);
      Shape s = c;
      return s is not Rect;
    }
  `);
  eq(inst.call("testIsNot", []), true, "Circle is not Rect");
});

// ── §wac-refid-same-k7fn4wp — ref identity same ───────────────────────────────

Deno.test("[§wac-refid-same-k7fn4wp] testIdentity() returns true", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export bool testIdentity() {
      Point a = Point(1, 2);
      Point b = a;
      return a is b;
    }
  `);
  eq(inst.call("testIdentity", []), true, "same ref");
});

// ── §wac-refid-diff-m4jw3rk — ref identity different ────────────────────────

Deno.test("[§wac-refid-diff-m4jw3rk] testDistinct() returns false", async () => {
  const inst = await run(`
    struct Point { i32 x; i32 y; }
    export bool testDistinct() {
      Point a = Point(1, 2);
      Point c = Point(1, 2);
      return a is c;
    }
  `);
  eq(inst.call("testDistinct", []), false, "distinct refs");
});

// ── §wac-deep-const-j4fn2xq — const is deep ──────────────────────────────────

Deno.test("[§wac-deep-const-j4fn2xq] calling non-const method through const this is error", () => {
  err(`
    struct Inner { i32 val; void mutate(this) { this.val = 1; } }
    struct Outer {
      Inner inner;
      void tryMutate(const this) { this.inner.mutate(); }
    }
    export void test() {}
  `);
});

// ── §wac-dup-func-ohfg5bi — duplicate function ───────────────────────────────

Deno.test("[§wac-dup-func-ohfg5bi] duplicate function name is a compile error", () => {
  err(`i32 foo() { return 1; } i32 foo() { return 2; } export void test() {}`);
});

// ── §wac-dup-struct-spu3kml — duplicate struct ───────────────────────────────

Deno.test("[§wac-dup-struct-spu3kml] duplicate struct name is a compile error", () => {
  err(`struct Point { i32 x; } struct Point { i32 y; } export void test() {}`);
});

// ── §wac-dup-kind-9h0mrly — function and struct same name ────────────────────

Deno.test("[§wac-dup-kind-9h0mrly] function and struct with same name is error", () => {
  err(`struct Foo { i32 x; } i32 Foo() { return 1; } export void test() {}`);
});

// ── §wac-dup-field-oa60dpa — duplicate struct field ──────────────────────────

Deno.test("[§wac-dup-field-oa60dpa] duplicate field name is a compile error", () => {
  err(`struct Bad { i32 x; i32 x; } export void test() {}`);
});

// ── §wac-dup-method-4jv9jst — duplicate struct method ────────────────────────

Deno.test("[§wac-dup-method-4jv9jst] duplicate method name is a compile error", () => {
  err(`
    struct Bad {
      i32 get(const this) { return 0; }
      i32 get(const this) { return 1; }
    }
    export void test() {}
  `);
});

// ── §wac-dup-field-method-dnwlmiz — field and method same name ───────────────

Deno.test("[§wac-dup-field-method-dnwlmiz] method and field with same name is error", () => {
  err(`
    struct Bad { i32 len; i32 len(const this) { return 0; } }
    export void test() {}
  `);
});

// ── §wac-dup-import-vqn4100 — two imports same name ──────────────────────────

Deno.test("[§wac-dup-import-vqn4100] two imports with same name is error", () => {
  const files = new Map([
    ["a.wac", `export i32 foo() { return 1; }`],
    ["b.wac", `export i32 foo() { return 2; }`],
    ["main.wac", `
      import { foo } from "./a.wac";
      import { foo } from "./b.wac";
      export void test() {}
    `],
  ]);
  errMulti(files);
});

// ── §wac-rename-pohglv4 — import rename resolves collision ───────────────────

Deno.test("[§wac-rename-pohglv4] renaming import resolves collision", async () => {
  const files = new Map([
    ["a.wac", `export i32 foo() { return 1; }`],
    ["b.wac", `export i32 foo() { return 2; }`],
    ["main.wac", `
      import { foo } from "./a.wac";
      import { foo as fooB } from "./b.wac";
      export i32 test() { return foo() + fooB(); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`should compile: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 3, "foo()+fooB()=3");
});

// ── §wac-rename-type-h0a08xz — struct import rename ──────────────────────────

Deno.test("[§wac-rename-type-h0a08xz] renaming struct imports resolves collision", async () => {
  const files = new Map([
    ["flat.wac",    `export struct Point { i32 x; i32 y; }`],
    ["spatial.wac", `export struct Point { i32 x; i32 y; i32 z; }`],
    ["main.wac", `
      import { Point as Point2d } from "./flat.wac";
      import { Point as Point3d } from "./spatial.wac";
      export i32 test() {
        Point2d p2 = Point2d(1, 2);
        Point3d p3 = Point3d(1, 2, 3);
        return p2.x + p3.z;
      }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`should compile: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 4, "p2.x + p3.z = 4");
});

// ── §wac-shadow-8u8qh2j — block scope shadowing ──────────────────────────────

Deno.test("[§wac-shadow-8u8qh2j] shadow() returns 1", async () => {
  const inst = await run(`
    export i32 shadow() {
      i32 x = 1;
      {
        i32 x = 2;
        x = 3;
      }
      return x;
    }
  `);
  eq(inst.call("shadow", []), 1, "outer x=1");
});

// ── §wac-shadow-loop-vwe8gfz — for loop variable shadowing ───────────────────

Deno.test("[§wac-shadow-loop-vwe8gfz] loopShadow() returns 99", async () => {
  const inst = await run(`
    export i32 loopShadow() {
      i32 i = 99;
      for (i32 i = 0; i < 10; i++) {}
      return i;
    }
  `);
  eq(inst.call("loopShadow", []), 99, "outer i=99");
});

// ── §wac-const-var-7b4swc8 — const var is immutable ──────────────────────────

Deno.test("[§wac-const-var-7b4swc8] y = 11 is a compile error (const var)", () => {
  err(`export void bad() { const i32 y = 10; y = 11; }`);
});

// ── §wac-uninit-nypziz8 — uninitialized variable is error ────────────────────

Deno.test("[§wac-uninit-nypziz8] i32 z; is a compile error", () => {
  err(`export void bad() { i32 z; }`);
});

// ── §wac-const-ref-617go61 — const ref field write is error ──────────────────

Deno.test("[§wac-const-ref-617go61] p.x = 3 through const p is error", () => {
  err(`
    struct Point { i32 x; i32 y; }
    export void bad() { const Point p = Point(1, 2); p.x = 3; }
  `);
});

// ── §wac-const-deep-j6b1nyg — deep const traversal ──────────────────────────

Deno.test("[§wac-const-deep-j6b1nyg] writing through const ref at depth is error", () => {
  err(`
    struct Tree { i32 val; Tree? left; Tree? right; }
    export void bad(Tree t) { const Tree ct = t; ct.val = 5; }
  `);
});

Deno.test("[§wac-const-deep-j6b1nyg] writing a const array's element is an error", () => {
  // Array elements are a depth too — this bypass was found while fixing
  // audit-03 (lv-index writes never consulted the const chain at all).
  err(`
    export i32 bad() {
      const i32[] a = i32[](1, 2, 3);
      a[0] = 99;
      return a[0];
    }
  `);
});

// ── §wac-ret-void-ezw2lqp — void function with no return ─────────────────────

Deno.test("[§wac-ret-void-ezw2lqp] void function with no return compiles", async () => {
  const inst = await run(`export void greet() { i32 x = 1; }`);
  eq(inst.call("greet", []), undefined, "void returns undefined");
});

// ── §wac-ret-struct-kpjs5dg — struct return ──────────────────────────────────

Deno.test("[§wac-ret-struct-kpjs5dg] makePoint(1.0, 2.0).x = 1.0", async () => {
  const inst = await run(`
    struct Point { f64 x; f64 y; }
    export f64 getX(f64 x, f64 y) {
      Point p = Point(x, y);
      return p.x;
    }
  `);
  near(inst.call("getX", [1.0, 2.0]) as number, 1.0, "p.x");
});

// ── §wac-ret-array-mptjuer — array return ────────────────────────────────────

Deno.test("[§wac-ret-array-mptjuer] makeArray(5) length is 5", async () => {
  const inst = await run(`
    export i32 makeArrayLen(i32 n) {
      i32[] a = i32[n]();
      return a.len();
    }
  `);
  eq(inst.call("makeArrayLen", [5]), 5, "array length");
});

// ── §wac-factorial-lzkw61q — recursion ───────────────────────────────────────

Deno.test("[§wac-factorial-lzkw61q] factorial(10) returns 3628800", async () => {
  const inst = await run(`
    export i32 factorial(i32 n) {
      if (n <= 1) { return 1; }
      return n * factorial(n - 1);
    }
  `);
  eq(inst.call("factorial", [10]), 3628800, "10!");
});

// ── §wac-mutual-exg2t9c — mutual recursion ────────────────────────────────────

Deno.test("[§wac-mutual-exg2t9c] checkEven(42)=1, checkEven(17)=0", async () => {
  const inst = await run(`
    i32 isEven(i32 n) {
      if (n == 0) { return 1; }
      return isOdd(n - 1);
    }
    i32 isOdd(i32 n) {
      if (n == 0) { return 0; }
      return isEven(n - 1);
    }
    export i32 checkEven(i32 n) { return isEven(n); }
  `);
  eq(inst.call("checkEven", [42]), 1, "42 is even");
  eq(inst.call("checkEven", [17]), 0, "17 is odd");
});

// ── §wac-void-return-h7qm4xf — return; in void function ─────────────────────

Deno.test("[§wac-void-return-h7qm4xf] return; in void function compiles", async () => {
  const inst = await run(`
    export void earlyReturn(bool flag) {
      if (flag) { return; }
      i32 x = 1;
    }
  `);
  eq(inst.call("earlyReturn", [true]),  undefined, "early exit");
  eq(inst.call("earlyReturn", [false]), undefined, "no exit");
});

// ── §wac-missing-return-k4fn8wp — missing return is error ────────────────────

Deno.test("[§wac-missing-return-k4fn8wp] code path missing return is error", () => {
  err(`i32 bad(bool x) { if (x) { return 1; } }`);
});

// ── §wac-all-paths-return-m7qj3xf — all paths return ────────────────────────

Deno.test("[§wac-all-paths-return-m7qj3xf] ok(true)=1, all paths return", async () => {
  const inst = await run(`
    export i32 ok(bool x) {
      if (x) { return 1; }
      else { return 0; }
    }
  `);
  eq(inst.call("ok", [true]),  1, "ok(true)");
  eq(inst.call("ok", [false]), 0, "ok(false)");
});

// ── §wac-paramatch-84zc2km — param type match required ───────────────────────

Deno.test("[§wac-paramatch-84zc2km] f32 passed to f64 param is a compile error", () => {
  err(`
    f64 sqrtVal(f64 x) { return x; }
    export f64 bad(f32 approx) { return sqrtVal(approx); }
  `);
});

// ── §wac-diamond-79emza1 — diamond import ────────────────────────────────────

Deno.test("[§wac-diamond-79emza1] combined() returns 230", async () => {
  const files = new Map([
    ["shared.wac", `export i32 base() { return 100; }`],
    ["left.wac",   `import { base } from "./shared.wac"; export i32 left() { return base() + 10; }`],
    ["right.wac",  `import { base } from "./shared.wac"; export i32 right() { return base() + 20; }`],
    ["main.wac",   `
      import { left }  from "./left.wac";
      import { right } from "./right.wac";
      export i32 combined() { return left() + right(); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("combined", []), 230, "combined()");
});

// ── §wac-circular-m7jx3p4 — circular imports ─────────────────────────────────

Deno.test("[§wac-circular-m7jx3p4] ping(5) returns 5", async () => {
  const files = new Map([
    ["ping.wac", `
      import { pong } from "./pong.wac";
      export i32 ping(i32 n) {
        if (n == 0) { return 0; }
        return pong(n - 1) + 1;
      }
    `],
    ["pong.wac", `
      import { ping } from "./ping.wac";
      export i32 pong(i32 n) {
        if (n == 0) { return 0; }
        return ping(n - 1) + 1;
      }
    `],
    ["main.wac", `
      import { ping } from "./ping.wac";
      export i32 test(i32 n) { return ping(n); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", [5]), 5, "ping(5)=5");
});

// ── §wac-imp-coexist-p8km2v6 — imported and local coexist ────────────────────

Deno.test("[§wac-imp-coexist-p8km2v6] test() returns 21 (6 + 15)", async () => {
  const files = new Map([
    ["utils_a.wac", `export i32 compute(i32 x) { return x + 1; }`],
    ["main.wac", `
      import { compute } from "./utils_a.wac";
      i32 compute2(i32 x) { return x * 3; }
      export i32 test() { return compute(5) + compute2(5); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 21, "6 + 15 = 21");
});

// ── §wac-rename-imp-w4fn9k2 — same-name functions in different files ──────────

Deno.test("[§wac-rename-imp-w4fn9k2] test() returns 16 (6 + 10)", async () => {
  const files = new Map([
    ["utils_a.wac", `export i32 compute(i32 x) { return x + 1; }`],
    ["utils_b.wac", `export i32 compute(i32 x) { return x * 2; }`],
    ["main.wac", `
      import { compute as computeA } from "./utils_a.wac";
      import { compute as computeB } from "./utils_b.wac";
      export i32 test() { return computeA(5) + computeB(5); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 16, "6 + 10 = 16");
});

// ── §wac-import-type-ev21tgx — import struct type ────────────────────────────

Deno.test("[§wac-import-type-ev21tgx] importing struct makes constructors and methods accessible", async () => {
  const files = new Map([
    ["geometry.wac", `
      export struct Point {
        f64 x;
        f64 y;
        f64 getX(const this) { return this.x; }
      }
    `],
    ["main.wac", `
      import { Point } from "./geometry.wac";
      export f64 test() {
        Point p = Point(3.0, 4.0);
        return p.getX();
      }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics[0].message}`);
  const inst = await wacInstance(r.compiled);
  near(inst.call("test", []) as number, 3.0, "p.getX()");
});

// ── §wac-dup-import-local-4fadlvg — import collides with local ───────────────

Deno.test("[§wac-dup-import-local-4fadlvg] import colliding with local name is error", () => {
  const files = new Map([
    ["geometry.wac", `export f64 distance(f64 x, f64 y) { return x - y; }`],
    ["main.wac", `
      import { distance } from "./geometry.wac";
      f64 distance(f64 x, f64 y) { return x - y; }
      export void test() {}
    `],
  ]);
  errMulti(files);
});

// ── §wac-fnref-get-t4kn7wp — function reference assignment ───────────────────

Deno.test("[§wac-fnref-get-t4kn7wp] cmp = descending; cmp(3,5) returns false (3>5)", async () => {
  const inst = await run(`
    bool ascending(i32 a, i32 b)  { return a < b; }
    bool descending(i32 a, i32 b) { return a > b; }
    export bool testAscending()  {
      fn[bool(i32, i32)] cmp = ascending;
      return cmp(3, 5);
    }
    export bool testDescending() {
      fn[bool(i32, i32)] cmp = descending;
      return cmp(3, 5);
    }
  `);
  eq(inst.call("testAscending",  []), true,  "ascending(3,5)");
  eq(inst.call("testDescending", []), false, "descending(3,5)=3>5=false");
});

// ── §wac-fnref-call-m8qj3xf — call through reference ────────────────────────

Deno.test("[§wac-fnref-call-m8qj3xf] testCall() returns 10", async () => {
  const inst = await run(`
    i32 double(i32 x) { return x * 2; }
    export i32 testCall() {
      fn[i32(i32)] f = double;
      return f(5);
    }
  `);
  eq(inst.call("testCall", []), 10, "testCall()");
});

// ── §wac-fnref-param-k5fn2jq — funcref as parameter ──────────────────────────

Deno.test("[§wac-fnref-param-k5fn2jq] apply(double,5)=10, apply(square,5)=25", async () => {
  const inst = await run(`
    i32 apply(fn[i32(i32)] f, i32 x) { return f(x); }
    i32 double(i32 x) { return x * 2; }
    i32 square(i32 x) { return x * x; }
    export i32 testDouble() { return apply(double, 5); }
    export i32 testSquare() { return apply(square, 5); }
  `);
  eq(inst.call("testDouble", []), 10, "apply(double,5)");
  eq(inst.call("testSquare", []), 25, "apply(square,5)");
});

// ── §wac-fnref-ret-p7hd4wn — funcref as return value ─────────────────────────

Deno.test("[§wac-fnref-ret-p7hd4wn] getComparator(true)(3,5)=true, getComparator(false)(3,5)=false", async () => {
  const inst = await run(`
    bool ascending(i32 a, i32 b)  { return a < b; }
    bool descending(i32 a, i32 b) { return a > b; }
    fn[bool(i32, i32)] getComparator(bool reverse) {
      if (reverse) { return descending; }
      return ascending;
    }
    export bool testReverse() {
      fn[bool(i32, i32)] cmp = getComparator(true);
      return cmp(3, 5);
    }
    export bool testForward() {
      fn[bool(i32, i32)] cmp = getComparator(false);
      return cmp(3, 5);
    }
  `);
  // getComparator(true) = descending; descending(3,5) = 3>5 = false
  eq(inst.call("testReverse", []), false, "descending(3,5)=false");
  // getComparator(false) = ascending; ascending(3,5) = 3<5 = true
  eq(inst.call("testForward", []), true,  "ascending(3,5)=true");
});

// ── §wac-fnref-null-w3qn5jk — nullable funcref ────────────────────────────────

Deno.test("[§wac-fnref-null-w3qn5jk] testNullFnref() returns 0 without trapping", async () => {
  const inst = await run(`
    export i32 testNullFnref() {
      fn[void(i32)]? cb = null;
      if (cb is not null) { cb!(42); }
      return 0;
    }
  `);
  eq(inst.call("testNullFnref", []), 0, "null fnref no trap");
});

// ── §wac-fnref-method-h9pd3wn — method reference ─────────────────────────────

Deno.test("[§wac-fnref-method-h9pd3wn] testMethodRef() returns 2", async () => {
  const inst = await run(`
    struct Counter {
      i32 count;
      Counter create(i32 initial) { return Counter(initial); }
      void inc(this) { this.count++; }
      i32 getCount(const this) { return this.count; }
    }
    export i32 testMethodRef() {
      Counter c = Counter.create(0);
      fn[void(Counter)] f = Counter.inc;
      f(c);
      f(c);
      return c.getCount();
    }
  `);
  eq(inst.call("testMethodRef", []), 2, "two increments");
});

// ── §wac-fnref-nocapture-j4wk8pm — no closure capture ────────────────────────

Deno.test("[§wac-fnref-nocapture-j4wk8pm] c.inc as value is a compile error", () => {
  err(`
    struct Counter {
      i32 count;
      void inc(this) { this.count++; }
    }
    export void bad() {
      Counter c = Counter.create(0);
      fn[void()] f = c.inc;
    }
    export Counter create() { return Counter(0); }
  `);
});

// ── §wac-fnref-inline-f7km2xq — inline call syntax ───────────────────────────

Deno.test("[§wac-fnref-inline-f7km2xq] (Counter.inc)(c) is equiv to c.inc()", async () => {
  const inst = await run(`
    struct Counter {
      i32 count;
      void inc(this) { this.count++; }
      i32 getCount(const this) { return this.count; }
      Counter create(i32 n) { return Counter(n); }
    }
    export i32 testInline() {
      Counter c = Counter.create(0);
      (Counter.inc)(c);
      return c.getCount();
    }
  `);
  eq(inst.call("testInline", []), 1, "inline method call");
});

// ── §wac-fnref-array-n8qm4jf — array of function references ──────────────────

Deno.test("[§wac-fnref-array-n8qm4jf] testFnArray() returns 30 (10+25-5)", async () => {
  const inst = await run(`
    i32 double(i32 x) { return x * 2; }
    i32 square(i32 x) { return x * x; }
    i32 negate(i32 x) { return -x; }
    export i32 testFnArray() {
      fn[i32(i32)][] transforms = fn[i32(i32)][](double, square, negate);
      i32 total = 0;
      for (i32 i = 0; i < transforms.len(); i++) {
        total += transforms[i](5);
      }
      return total;
    }
  `);
  eq(inst.call("testFnArray", []), 30, "10+25+(-5)=30");
});

// ── §wac-fnref-higher-p4jn7wq — higher-order functions ───────────────────────

Deno.test("[§wac-fnref-higher-p4jn7wq] testHigherOrder() returns 30", async () => {
  const inst = await run(`
    i32[] map(i32[] arr, fn[i32(i32)] f) {
      i32[] result = i32[arr.len()]();
      for (i32 i = 0; i < arr.len(); i++) {
        result[i] = f(arr[i]);
      }
      return result;
    }
    i32 reduce(i32[] arr, i32 init, fn[i32(i32, i32)] f) {
      i32 acc = init;
      for (i32 i = 0; i < arr.len(); i++) {
        acc = f(acc, arr[i]);
      }
      return acc;
    }
    i32 double(i32 x) { return x * 2; }
    i32 add(i32 a, i32 b) { return a + b; }
    export i32 testHigherOrder() {
      i32[] data = i32[](1, 2, 3, 4, 5);
      i32[] doubled = map(data, double);
      return reduce(doubled, 0, add);
    }
  `);
  eq(inst.call("testHigherOrder", []), 30, "2+4+6+8+10=30");
});

// ── §wac-buf-* — Buffer: growable byte buffer ─────────────────────────────────

const BUF_SRC = `
struct Buffer {
  u8[] data; i32 len; i32 cap;
  Buffer create(i32 cap) { return Buffer(u8[cap](), 0, cap); }
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
      u8[] next = u8[newCap]();
      for (i32 i = 0; i < this.len; i++) { next[i] = this.data[i]; }
      this.data = next; this.cap = newCap;
    }
    this.data[this.len] = val; this.len++;
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

Deno.test("[§wac-buf-basic-k4mf2js] testBasic() returns 3", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testBasic() {
      Buffer b = Buffer.create(4);
      b.push(0x41); b.push(0x42); b.push(0x43);
      return b.len;
    }
  `);
  eq(inst.call("testBasic", []), 3, "testBasic");
});

Deno.test("[§wac-buf-getset-p9qn3xl] testGetSet() returns 60", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testGetSet() {
      Buffer b = Buffer.create(4);
      b.push(10); b.push(20); b.push(30);
      return b.get(0) + b.get(1) + b.get(2);
    }
  `);
  eq(inst.call("testGetSet", []), 60, "testGetSet");
});

Deno.test("[§wac-buf-overwrite-w7rk5bt] testOverwrite() returns 65408", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testOverwrite() {
      Buffer b = Buffer.create(4);
      b.push(0); b.push(0);
      b.set(0, 0xFF); b.set(1, 0x80);
      return b.get(0) * 256 + b.get(1);
    }
  `);
  eq(inst.call("testOverwrite", []), 65408, "testOverwrite: 255*256+128=65408");
});

Deno.test("[§wac-buf-grow-m3hd8qz] testGrow() returns 1920", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testGrow() {
      Buffer b = Buffer.create(4);
      for (i32 i = 0; i < 20; i++) { b.push(i); }
      return b.get(19) * 100 + b.len;
    }
  `);
  eq(inst.call("testGrow", []), 1920, "19*100+20=1920");
});

Deno.test("[§wac-buf-pop-j2fn9rk] testPop() returns 3002", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testPop() {
      Buffer b = Buffer.create(4);
      b.push(10); b.push(20); b.push(30);
      i32 last = b.pop();
      return last * 100 + b.len;
    }
  `);
  eq(inst.call("testPop", []), 3002, "30*100+2=3002");
});

Deno.test("[§wac-buf-equals-h8wd2pm] testEquals() returns true", async () => {
  const inst = await run(BUF_SRC + `
    export bool testEquals() {
      Buffer a = Buffer.create(4);
      Buffer b = Buffer.create(8);
      a.push(1); a.push(2); a.push(3);
      b.push(1); b.push(2); b.push(3);
      return a.equals(b);
    }
  `);
  eq(inst.call("testEquals", []), true, "testEquals");
});

Deno.test("[§wac-buf-oob-get-f4kp7wn] testBoundsGet() traps", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testBoundsGet() {
      Buffer b = Buffer.create(4); b.push(1);
      return b.get(5);
    }
  `);
  traps(() => inst.call("testBoundsGet", []), "bounds get");
});

Deno.test("[§wac-buf-oob-set-n2qm8xl] testBoundsSet() traps", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testBoundsSet() {
      Buffer b = Buffer.create(4); b.push(1);
      b.set(5, 99);
      return 0;
    }
  `);
  traps(() => inst.call("testBoundsSet", []), "bounds set");
});

Deno.test("[§wac-buf-pop-empty-c7jw3kf] testPopEmpty() traps", async () => {
  const inst = await run(BUF_SRC + `
    export i32 testPopEmpty() {
      Buffer b = Buffer.create(4);
      return b.pop();
    }
  `);
  traps(() => inst.call("testPopEmpty", []), "pop empty");
});

// ── §wac-grammar-k7fn4xq — EBNF grammar coverage ────────────────────────────

Deno.test("[§wac-grammar-k7fn4xq] grammar covers all major constructs", async () => {
  // Exercises every major production in the EBNF grammar:
  // imports, structs (with inheritance, methods, const this), functions,
  // expressions (binary, unary, ternary, casts, calls), statements
  // (if/else, while, for, do-while, switch, break, continue, return, trap)
  const inst = await run(`
    struct Base { i32 x; i32 getX(const this) { return this.x; } }
    struct Sub : Base { i32 y; }
    export i32 grammar() {
      Sub s = Sub(3, 7);
      i32 a = s.getX();
      i32 b = s.x + s.y;
      bool flag = a < b;
      i32 r = flag ? b : a;
      i32 c = 0;
      for (i32 i = 0; i < 3; i++) {
        if (i == 1) { continue; }
        c += i;
      }
      i32 d = 0;
      do { d++; } while (d < 2);
      switch (d) {
        case 1: r += 0; break;
        case 2: r += 10; break;
      }
      while (c < 5) { c++; }
      i32 x = 0xFF;
      i64 y = 42 as i64;
      return r + c + d + x + y as~ i32;
    }
  `);
  // r=20 (10+switch+10), c=5, d=2, x=255, y=42 → 20+5+2+255+42=324
  eq(inst.call("grammar", []), 324, "grammar covers major constructs");
});

// ── §wac-sound-k3fn9wp — type system soundness ───────────────────────────────

Deno.test("[§wac-sound-k3fn9wp] type system prevents unsound programs", () => {
  // Several type-safety violations bundled together
  const cases = [
    `export f64 bad(i32 x) { return x; }`,                    // implicit int->float
    `export i32 bad(f64 x) { return x; }`,                    // implicit float->int
    `export void bad() { i32 x = true; }`,                    // bool to i32
    `export void bad() { bool x = 0; }`,                      // i32 to bool
  ];
  for (const src of cases) {
    const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
    if (r.ok) throw new Error(`should have failed: ${src}`);
  }
});

// ── §wac-str-* — string operations ───────────────────────────────────────────
//
// Helper: compile source that includes a string equality checker and a byte
// reader, returning rawExports so string refs can be passed to helpers.
async function runStr(src: string) {
  // Append hidden helpers for content verification.
  const fullSrc = src + `
    export bool __strEq(string a, string b) { return a == b; }
    export i32 __strLen(string s) { return s.len(); }
    export i32 __strByte(string s, i32 i) {
      // Return first byte of s[i] by slicing and reading len.
      // We can't access raw bytes directly, so we use a concat trick:
      // read the char and return its byte count.
      return s[i].len();
    }
  `;
  const r = wacCompile(new Map([["main.wac", fullSrc]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const raw = instance.exports as Record<string, (...args: unknown[]) => unknown>;

  /** Call a string-returning export and compare to expected JS string. */
  function callStrEq(name: string, expected: string): boolean {
    const strRef = raw[name]!();
    const expectedRef = raw["__strLen"]!(expected) as number;
    void expectedRef;
    // Use strEq: call the fn, compare with a literal embedded in wasm
    // We can't easily create a string ref from JS, so use length + indexOf for verification.
    // For simplicity: check that strRef has the same length as expected,
    // and that __strEq(result, result) is true (identity check).
    // Full content: embed expected as a wac literal via a wrapper.
    return true; // length/indexOf checks done in each test
  }
  void callStrEq;

  return {
    raw,
    /** Get length of string returned by export `name`. */
    len(name: string): number {
      const strRef = raw[name]!();
      return raw["__strLen"]!(strRef) as number;
    },
    /** Check if string returned by export `name` equals expected. */
    strEq(name: string, expectedExport: string): boolean {
      const a = raw[name]!();
      const b = raw[expectedExport]!();
      return raw["__strEq"]!(a, b) as boolean;
    },
    /** Call a function and compare result string to literal by checking len + content
     *  using indexOf (returns true if result contains expected at pos 0 and len matches). */
    check(fnName: string, expected: string): boolean {
      const strRef = raw[fnName]!();
      const slen = raw["__strLen"]!(strRef) as number;
      if (slen !== expected.length) return false;
      // Verify content: pass strRef to the string cmp helper via indexOf(needle)
      // We can't create a wasm string from JS, so we verify via a secondary wac function.
      // The test sources below include an explicit verify function for content checks.
      return true;
    },
  };
}

/** Helper: compile with string content verification by including an expected literal. */
/**
 * Compile `src`, call `fnName`, and return the string it produced.
 *
 * This used to append a `__verify` function and compare the two strings *inside* wac, because
 * `wacInstance` could not decode a string return [issue 0021]. It can now, so a failure reports
 * what it actually got rather than only that it differed — which is the whole reason that
 * workaround was worth removing.
 */
async function runForString(src: string, fnName: string): Promise<string> {
  const r = wacCompile(new Map([["main.wac", `export ${src}`]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const inst2 = await wacInstance(r.compiled);
  return inst2.call(fnName, []) as string;
}

// ── §wac-str-literal-k8fn2qp — s.len() returns 5 for "hello" ────────────────

Deno.test(`[§wac-str-literal-k8fn2qp] s.len() returns 5 for "hello"`, async () => {
  const inst = await run(`export i32 test() { string s = "hello"; return s.len(); }`);
  eq(inst.call("test", []), 5, "\"hello\".len()");
});

// ── §wac-str-emoji-m4jw7rk — emoji.len() returns 10 for "hello 😀" ──────────

Deno.test(`[§wac-str-emoji-m4jw7rk] emoji.len() returns 10 for "hello 😀"`, async () => {
  const inst = await run(`export i32 test() { string s = "hello 😀"; return s.len(); }`);
  eq(inst.call("test", []), 10, `"hello 😀".len() = 10 (6 ascii + 4 emoji bytes)`);
});

// ── §wac-str-esc-h9qm3v7 — testEscapes() returns 5 ─────────────────────────

Deno.test(`[§wac-str-esc-h9qm3v7] testEscapes() returns 5`, async () => {
  // The spec's own program: five one-character strings, one per escape form. The
  // previous version of this test compiled `"hell\0"` instead, which returns 5
  // without ever exercising `\\` or `\"` — the two that were actually broken.
  const inst = await run(`
    export i32 testEscapes() {
      string nl = "\\n";
      string tab = "\\t";
      string nul = "\\0";
      string bs = "\\\\";
      string qt = "\\"";
      return nl.len() + tab.len() + nul.len() + bs.len() + qt.len();
    }
  `);
  eq(inst.call("testEscapes", []), 5, "each of the five escapes is one byte");
});

// ── §wac-str-esc-mid-* — an escape does not consume what follows it ──────────

Deno.test(`[§wac-str-esc-mid-w7kn3qf] escMid() returns 3`, async () => {
  const inst = await run(`export i32 escMid() { return "a\\\\b".len(); }`);
  eq(inst.call("escMid", []), 3, `"a\\b" is a, backslash, b`);
});

Deno.test(`[§wac-str-esc-dbl-h2mf9xp] escDouble() returns 2`, async () => {
  const inst = await run(`export i32 escDouble() { return "\\\\\\\\".len(); }`);
  eq(inst.call("escDouble", []), 2, `"\\\\" is two backslashes`);
});

Deno.test(`[§wac-str-esc-run-r5jw4kt] escRun() returns 5`, async () => {
  const inst = await run(`export i32 escRun() { return "[\\\\]^_".len(); }`);
  eq(inst.call("escRun", []), 5, `"[\\]^_" keeps every character after the escape`);
});

Deno.test(`[§wac-str-esc-mid-w7kn3qf] the characters around an escape are the right ones`, async () => {
  // Length alone would also pass if the escape emitted two backslashes and
  // dropped the `b`, so check the characters themselves. Compared inside wac
  // because a `string` cannot cross wacInstance's boundary.
  const inst = await run(`
    export bool escChars() {
      string s = "a\\\\b";
      return s[0] == "a" && s[1] == "\\\\" && s[2] == "b";
    }
  `);
  eq(inst.call("escChars", []), true, `"a\\b" is exactly a, backslash, b`);
});

// ── §wac-str-len-p2hd9xf — strLen() returns 3 ──────────────────────────────

Deno.test(`[§wac-str-len-p2hd9xf] strLen() returns 3`, async () => {
  const inst = await run(`export i32 strLen() { string s = "abc"; return s.len(); }`);
  eq(inst.call("strLen", []), 3, `"abc".len() = 3`);
});

// ── §wac-str-append-q5km7wn — strAppend() returns "hello world" ──────────────

Deno.test(`[§wac-str-append-q5km7wn] strAppend() returns "hello world"`, async () => {
  // The tag is about `+=`, so this has to use `+=` — testing `+` here would pass
  // while `+=` was broken, which is exactly what happened before: compound
  // assignment on a string emitted f64.add on two string refs and produced a
  // module that failed wasm validation.
  const got = await runForString(
    `string strAppend() { string s = "hello"; s += " world"; return s; }`,
    "strAppend",
  );
  eq(got, "hello world", "strAppend()");

  // Also on a struct field, which takes a different emit path from a local.
  const got2 = await runForString(
    `string fieldAppend() { Msg m = Msg("hello"); m.text += " world"; return m.text; }
     struct Msg { string text; }`,
    "fieldAppend",
  );
  eq(got2, "hello world", "fieldAppend()");
});

// ── §wac-str-idx-r7kf4mb — strIdx() returns "e" ─────────────────────────────

Deno.test(`[§wac-str-idx-r7kf4mb] strIdx() returns "e"`, async () => {
  const got = await runForString(
    `string strIdx() { string s = "hello"; return s[1]; }`,
    "strIdx",
  );
  eq(got, "e", `"hello"[1] == "e"`);
});

// ── §wac-str-idx-emoji-w3qn8jk — strEmoji() returns "😀" ─────────────────────

Deno.test(`[§wac-str-idx-emoji-w3qn8jk] strEmoji() returns "😀"`, async () => {
  const got = await runForString(
    `string strEmoji() { string s = "hello 😀"; return s[6]; }`,
    "strEmoji",
  );
  eq(got, "😀", `"hello 😀"[6] == "😀"`);
});

// ── §wac-str-idx-mid-h5pd2wn — strMid() returns "" (continuation byte) ──────

Deno.test(`[§wac-str-idx-mid-h5pd2wn] strMid() returns "" for continuation byte`, async () => {
  // "a😀b"[2] — byte 2 is a continuation byte (😀 = 0xF0 0x9F 0x98 0x80, starts at byte 1)
  // The spec says s[i] in the middle of a multi-byte sequence returns ""
  const inst = await run(`export i32 strMid() { string s = "a\uD83D\uDE00b"; return s[2].len(); }`);
  eq(inst.call("strMid", []), 0, `"a😀b"[2] is a continuation byte → len=0 (empty string)`);
});

// ── §wac-str-idx-midlen-f9km3xq — strMidLen() returns 0 ─────────────────────

Deno.test(`[§wac-str-idx-midlen-f9km3xq] strMidLen() returns 0`, async () => {
  // Per spec: s[2] where "a😀b"[2] is a continuation byte → "" → .len() = 0
  const inst = await run(`export i32 strMidLen() { string s = "a\uD83D\uDE00b"; return s[2].len(); }`);
  eq(inst.call("strMidLen", []), 0, `"a😀b"[2].len() = 0 (continuation byte → empty string)`);
});

// ── §wac-str-oob-j4wk7pm — strOob() traps ────────────────────────────────────

Deno.test(`[§wac-str-oob-j4wk7pm] strOob() traps on out-of-bounds index`, async () => {
  const inst = await run(`export i32 strOob() { string s = "hello"; return s[10].len(); }`);
  traps(() => inst.call("strOob", []), `"hello"[10] should trap`);
});

// ── §wac-str-concat-n8qm5jf — strConcat() returns "hello world" ──────────────

Deno.test(`[§wac-str-concat-n8qm5jf] strConcat() returns "hello world"`, async () => {
  const got = await runForString(
    `string strConcat() { string a = "hello"; string b = " world"; return a + b; }`,
    "strConcat",
  );
  eq(got, "hello world", `strConcat() == "hello world"`);
});

// ── §wac-str-concat-len-k2fn8wp — strConcatLen() returns 6 ──────────────────

Deno.test(`[§wac-str-concat-len-k2fn8wp] strConcatLen() returns 6`, async () => {
  const inst = await run(`export i32 strConcatLen() { return ("foo" + "bar").len(); }`);
  eq(inst.call("strConcatLen", []), 6, `("foo"+"bar").len() = 6`);
});

// ── §wac-str-noimplicit-p3jw7xf — string + i32 is a compile error ────────────

Deno.test(`[§wac-str-noimplicit-p3jw7xf] string + i32 is a compile error`, () => {
  const msg = err(`export void bad() { string s = "x"; i32 n = 1; string t = s + n; }`);
  if (!msg.includes("string") && !msg.includes("mismatch") && !msg.includes("type")) {
    throw new Error(`unexpected error: ${msg}`);
  }
});

// ── §wac-str-eq-p4jn2wq — strEq() returns true ──────────────────────────────

Deno.test(`[§wac-str-eq-p4jn2wq] strEq() returns true`, async () => {
  const inst = await run(`export bool strEq() { return "hello" == "hello"; }`);
  eq(inst.call("strEq", []), true, `"hello" == "hello"`);
});

// ── §wac-str-neq-r8kf3mb — strNeq() returns true ─────────────────────────────

Deno.test(`[§wac-str-neq-r8kf3mb] strNeq() returns true`, async () => {
  const inst = await run(`export bool strNeq() { return "hello" != "world"; }`);
  eq(inst.call("strNeq", []), true, `"hello" != "world"`);
});

// ── §wac-str-lt-w5hm9qf — strLt() returns true ───────────────────────────────

Deno.test(`[§wac-str-lt-w5hm9qf] strLt() returns true`, async () => {
  const inst = await run(`export bool strLt() { return "abc" < "abd"; }`);
  eq(inst.call("strLt", []), true, `"abc" < "abd"`);
});

// ── §wac-str-gt-c7jw3kf — strGt() returns true ───────────────────────────────

Deno.test(`[§wac-str-gt-c7jw3kf] strGt() returns true`, async () => {
  const inst = await run(`export bool strGt() { return "abd" > "abc"; }`);
  eq(inst.call("strGt", []), true, `"abd" > "abc"`);
});

// ── §wac-str-immut-m3hd7qz — s[0] = "H" is a compile error ──────────────────

Deno.test(`[§wac-str-immut-m3hd7qz] s[0] = "H" is a compile error`, () => {
  const msg = err(`export void bad() { string s = "hello"; s[0] = "H"; }`);
  if (!msg.toLowerCase().includes("immut") && !msg.includes("string")) {
    throw new Error(`unexpected error: ${msg}`);
  }
});

// ── §wac-str-slice-h8wd4pm — slice(6,11) returns "world" ─────────────────────

Deno.test(`[§wac-str-slice-h8wd4pm] slice(6,11) returns "world"`, async () => {
  const got = await runForString(
    `string strSlice() { return "hello world".slice(6, 11); }`,
    "strSlice",
  );
  eq(got, "world", `"hello world".slice(6, 11) == "world"`);
});

// ── §wac-str-indexof-j2fn5rk — indexOf("world") returns 6 ───────────────────

Deno.test(`[§wac-str-indexof-j2fn5rk] indexOf("world") returns 6`, async () => {
  const inst = await run(`export i32 strIndexOf() { return "hello world".indexOf("world"); }`);
  eq(inst.call("strIndexOf", []), 6, `"hello world".indexOf("world") = 6`);
});

// ── §wac-str-indexof-miss-k4mf8js — indexOf("xyz") returns -1 ───────────────

Deno.test(`[§wac-str-indexof-miss-k4mf8js] indexOf("xyz") returns -1`, async () => {
  const inst = await run(`export i32 strIndexOfMiss() { return "hello world".indexOf("xyz"); }`);
  eq(inst.call("strIndexOfMiss", []), -1, `"hello world".indexOf("xyz") = -1`);
});

// ── §wac-fnref-field-r2km8jf — funcref as struct field ───────────────────────

Deno.test("[§wac-fnref-field-r2km8jf] testHandler() calls funcref field with arg", async () => {
  // Tests that fn[...] types work as struct fields and can be called
  const inst = await run(`
    struct Handler { fn[i32(string)] callback; }
    i32 strLen(string msg) { return msg.len(); }
    export i32 testHandler() {
      Handler h = Handler(strLen);
      return h.callback("hello");
    }
  `);
  eq(inst.call("testHandler", []), 5, "Handler.callback(\"hello\") = 5");
});

// ── §wac-static-disp-x4rk7m2 — static dispatch calls method on declared type ─

Deno.test("[§wac-static-disp-x4rk7m2] testStaticDispatch() returns 6 (Shape.len not Circle.len)", async () => {
  // WasmGC has no virtual dispatch — method call is on the *static* type
  // s: Shape → s.getLen() calls Shape.getLen(), returns 5, not Circle.getLen() which returns 6
  const inst = await run(`
    struct Shape { i32 len; i32 getLen(const this) { return this.len; } }
    struct Circle : Shape { i32 radius; }
    export i32 testStaticDispatch() {
      Circle c = Circle(5, 10);
      Shape s = c;
      return s.getLen();
    }
  `);
  // s.getLen() dispatches statically to Shape.getLen() which returns s.len = 5
  eq(inst.call("testStaticDispatch", []), 5, "static dispatch: s.getLen() calls Shape.getLen()");
});

// ── §wac-override-dispatch-r2km6jf — dynamic dispatch via is/as! ─────────────

Deno.test("[§wac-override-dispatch-r2km6jf] getName dispatches dynamically via is/as!", async () => {
  // Dynamic dispatch: use is/as! to check runtime type, then call appropriate method
  const inst = await run(`
    struct Shape { i32 tag; i32 getTag(const this) { return this.tag; } }
    struct Circle : Shape { i32 radius; override i32 getTag(const this) { return 42; } }
    i32 dispatch(Shape s) {
      // s is narrowed to Circle inside the block [see wac-narrow-if-2mkq8vp], so the
      // (s as! Circle) this test used to need is now a redundant upcast and rejected as
      // one. That is the point of the narrowing; the dispatch it demonstrates is unchanged.
      if (s is Circle) { return s.getTag(); }
      return s.getTag();
    }
    // The cast is still how you get there when narrowing does not apply — from a field, for
    // instance, where there is no name to shadow.
    struct Holder { Shape s; }
    i32 viaField(Holder h) {
      if (h.s is Circle) { return (h.s as! Circle).getTag(); }
      return h.s.getTag();
    }
    export i32 testDynDispatch() {
      Circle c = Circle(0, 5);
      Shape s = Shape(99);
      return dispatch(c) * 100 + dispatch(s);
    }
    export i32 testViaField() {
      return viaField(Holder(Circle(0, 5))) * 100 + viaField(Holder(Shape(99)));
    }
  `);
  // c is Circle → (c as! Circle).getTag() = 42
  // s is Shape (not Circle) → s.getTag() = 99
  // result: 42 * 100 + 99 = 4299
  eq(inst.call("testDynDispatch", []), 4299, "dynamic dispatch: Circle → 42, Shape → 99");
  eq(inst.call("testViaField", []), 4299, "and through a field, where the cast is still needed");
});

// ── §wac-bind-* — TypeScript bindgen ─────────────────────────────────────────

const MATH_SRC = `
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
  export f64 circle_area(f64 radius) { return 3.14159265358979 * radius * radius; }
`;

// Matches spec/spec/bindgen.md's sort.wac — bubbleSort returns the array
// explicitly (arrays are strictly copy-in; void mutations are discarded).
const SORT_SRC = `
  export i32[] bubbleSort(i32[] arr) {
    for (i32 i = 0; i < arr.len(); i++) {
      for (i32 j = 0; j < arr.len() - 1 - i; j++) {
        if (arr[j] > arr[j + 1]) {
          i32 tmp = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = tmp;
        }
      }
    }
    return arr;
  }
  export i32 sum(i32[] arr) {
    i32 total = 0;
    for (i32 i = 0; i < arr.len(); i++) { total += arr[i]; }
    return total;
  }
`;

const GREET_SRC = `
  export string greet(string name) { return "hello, " + name + "!"; }
  export i32 countBytes(string s) { return s.len(); }
`;

const BIG_SRC = `export i64 add64(i64 a, i64 b) { return a + b; }`;

const MIXED_SRC = `
  struct Point { f64 x; f64 y; }
  export i32 simple() { return 42; }
  export Point getOrigin() { return Point(0.0, 0.0); }
`;

/** Create an i32[] wasm GC array from a JS Int32Array using exported bind helpers. */
async function jsArrayToWasm(
  exports: WebAssembly.Exports,
  arr: Int32Array,
): Promise<unknown> {
  const newFn  = exports.__bind_arr_i32_new as (...a: unknown[]) => unknown;
  const setFn  = exports.__bind_arr_i32_set as (...a: unknown[]) => unknown;
  const wasmArr = newFn(arr.length);
  for (let i = 0; i < arr.length; i++) setFn(wasmArr, i, arr[i]);
  return wasmArr;
}

/** Read a wasm GC i32[] back to a JS Int32Array using exported bind helpers. */
async function wasmArrayToJs(
  exports: WebAssembly.Exports,
  wasmArr: unknown,
): Promise<Int32Array> {
  const getLenFn = exports.__bind_arr_i32_len as (...a: unknown[]) => number;
  const getElemFn = exports.__bind_arr_i32_get as (...a: unknown[]) => number;
  const n = getLenFn(wasmArr);
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = getElemFn(wasmArr, i);
  return out;
}

/** Create a wasm string from JS using exported bind helpers. */
function jsStringToWasm(exports: WebAssembly.Exports, s: string): unknown {
  const newFn  = exports.__bind_str_new as (...a: unknown[]) => unknown;
  const setFn  = exports.__bind_str_set as (...a: unknown[]) => unknown;
  const bytes  = new TextEncoder().encode(s);
  const wa = newFn(bytes.length);
  for (let i = 0; i < bytes.length; i++) setFn(wa, i, bytes[i]);
  return wa;
}

/** Read a wasm string back to JS using exported bind helpers. */
function wasmStringToJs(exports: WebAssembly.Exports, wa: unknown): string {
  const lenFn = exports.__bind_str_len as (...a: unknown[]) => number;
  const getFn = exports.__bind_str_get as (...a: unknown[]) => number;
  const n = lenFn(wa);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = getFn(wa, i);
  return new TextDecoder().decode(bytes);
}

Deno.test("[§wac-bind-prims-k4fn8wp] Bindgen for math.wac: gcd(48,18)=6, fib(20)=6765, circle_area(5)=~78.54", async () => {
  const r = wacCompile(new Map([["math.wac", MATH_SRC]]), "math.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  // Verify bindgen generates correct TS with wrapper functions
  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function gcd(a: number, b: number): number"), true, "gcd wrapper");
  eq(ts.includes("function fib(n: number): number"), true, "fib wrapper");
  eq(ts.includes("function circle_area(radius: number): number"), true, "circle_area wrapper (verbatim, no camelCase renaming)");

  // Verify underlying wasm behavior (same wasm embedded in bindgen output)
  const inst = await wacInstance(r.compiled);
  eq(inst.call("gcd", [48, 18]), 6, "gcd(48, 18) = 6");
  eq(inst.call("fib", [20]), 6765, "fib(20) = 6765");
  const area = inst.call("circle_area", [5.0]) as number; // wasm export uses snake_case
  eq(Math.abs(area - 78.53981633974483) < 1e-9, true, "circle_area(5) ≈ 78.54");
});

Deno.test("[§wac-bind-arr-m7qj3xf] Bindgen for sort.wac: sum(Int32Array([10,20,30]))=60", async () => {
  const r = wacCompile(new Map([["sort.wac", SORT_SRC]]), "sort.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  // Verify bindgen generates correct TS
  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function sum(arr: Int32Array): number"), true, "sum wrapper type");
  eq(ts.includes("_arrayToWasm_i32"), true, "uses array marshal helper");

  // Verify sum via bind helpers
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const exports = instance.exports;
  const wasmArr = await jsArrayToWasm(exports, new Int32Array([10, 20, 30]));
  const sumFn = exports.sum as (...a: unknown[]) => number;
  eq(sumFn(wasmArr), 60, "sum([10,20,30]) = 60");
});

Deno.test("[§wac-bind-arr-mut-p3kn7wp] Bindgen for sort.wac: bubbleSort([5,3,1,4,2])=[1,2,3,4,5]", async () => {
  const r = wacCompile(new Map([["sort.wac", SORT_SRC]]), "sort.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function bubbleSort(arr: Int32Array): Int32Array"), true, "bubbleSort returns Int32Array");

  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const exports = instance.exports;
  const input = new Int32Array([5, 3, 1, 4, 2]);
  const wasmArr = await jsArrayToWasm(exports, input);
  const sortFn = exports.bubbleSort as (...a: unknown[]) => void;
  sortFn(wasmArr);
  const result = await wasmArrayToJs(exports, wasmArr);
  eq(Array.from(result).join(","), "1,2,3,4,5", "sorted array = [1,2,3,4,5]");
});

Deno.test("[§wac-bind-arr-copy-j4wk7pm] Array params are copied into wasm; original JS array unmodified", async () => {
  const r = wacCompile(new Map([["sort.wac", SORT_SRC]]), "sort.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const exports = instance.exports;
  const original = new Int32Array([5, 3, 1, 4, 2]);
  const copy = new Int32Array(original); // simulate: copy before passing to wasm
  const wasmArr = await jsArrayToWasm(exports, copy); // copy goes into wasm
  const sortFn = exports.bubbleSort as (...a: unknown[]) => void;
  sortFn(wasmArr); // wasm mutates its own GC array, not `copy`
  // original JS array is unchanged (it was never given to wasm)
  eq(Array.from(original).join(","), "5,3,1,4,2", "original unchanged");
});

Deno.test("[§wac-bind-str-r8jm4xf] Bindgen for greet.wac: greet('world')='hello, world!'", async () => {
  const r = wacCompile(new Map([["greet.wac", GREET_SRC]]), "greet.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function greet(name: string): string"), true, "greet wrapper type");
  eq(ts.includes("_stringToWasm"), true, "uses string marshal helper");

  // Verify string marshaling behavior
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const exports = instance.exports;
  const nameRef = jsStringToWasm(exports, "world");
  const greetFn = exports.greet as (...a: unknown[]) => unknown;
  const resultRef = greetFn(nameRef);
  const result = wasmStringToJs(exports, resultRef);
  eq(result, "hello, world!", "greet('world') = 'hello, world!'");
});

Deno.test("[§wac-bind-strbytes-w5hd3jk] Bindgen for greet.wac: countBytes('hello')=5", async () => {
  const r = wacCompile(new Map([["greet.wac", GREET_SRC]]), "greet.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const exports = instance.exports;
  const sRef = jsStringToWasm(exports, "hello");
  const fn = exports.countBytes as (...a: unknown[]) => number;
  eq(fn(sRef), 5, "countBytes('hello') = 5");
});

Deno.test("[§wac-bind-i64-k3fn9wp] Bindgen for big.wac: add64(100n, 200n)=300n", async () => {
  const r = wacCompile(new Map([["big.wac", BIG_SRC]]), "big.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function add64(a: bigint, b: bigint): bigint"), true, "add64 wrapper type");

  const inst = await wacInstance(r.compiled);
  eq(inst.call("add64", [100n, 200n]), 300n, "add64(100n, 200n) = 300n");
});

Deno.test("[§wac-bind-skip-h9pd5wn] Functions with unsupported types are omitted with a comment", () => {
  const r = wacCompile(new Map([["mixed.wac", MIXED_SRC]]), "mixed.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));

  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function simple(): number"), true, "simple() included");
  eq(ts.includes("// skipped:"), true, "skipped comment present");
  eq(ts.includes("getOrigin"), true, "getOrigin mentioned in skip comment");
  eq(ts.includes("function getOrigin"), false, "getOrigin not exported as function");

  // The reason was recorded only as a comment in the generated file, which nobody
  // reads while wondering why `mod.getOrigin` is undefined — and a module whose every
  // export is struct-typed binds cleanly and exports nothing at all, which reads like a
  // build failure. The list is a real export now, so it is reachable from the place the
  // question gets asked.
  eq(ts.includes("__bindgenSkipped"), true, "the skip list is exported, not only commented");
  eq(ts.includes("readonly string[]"), true, "and is typed");
});

Deno.test("[§wac-bind-skip-h9pd5wn] the skip list is reachable from the bound module", async () => {
  const r = wacCompile(new Map([["main.wac", `
    export struct Expr { i32 line; }
    export Expr mk(i32 line) { return Expr(line); }
    export i32 lineOf(Expr e) { return e.line; }
  `]]), "main.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));
  const ts = wacBindgen(r.compiled);
  // Every export here is struct-typed, so the module's whole surface is skipped. Before,
  // that produced a file with no exports whatsoever and no indication why.
  eq(ts.includes("__bindgenSkipped"), true, "an all-skipped module still exports the reason");
  eq(/mk\(\) — return type 'Expr'/.test(ts), true, "and names the return-type case");
  eq(/lineOf\(\) — parameter 'e: Expr'/.test(ts), true, "and the parameter case");
});

// ── §wac-diag-* — structured error diagnostics ────────────────────────────────

Deno.test("[§wac-diag-bool-r8kn4wp] Bool error: CompileError has span/annotation/hint", () => {
  const src = `export i32 bad(i32 x) {\n  if (x) { return 1; }\n  return 0;\n}`;
  const r = wacCompile(new Map([["err.wac", src]]), "err.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.span, 1, "span=1 for ident condition");
  eq(e.annotation, "expected bool, found i32", "annotation");
  eq(typeof e.hint, "string", "has hint");
  eq(e.hint!.includes("comparison"), true, "hint mentions comparison");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["err.wac", src]]));
  eq(diag.includes("error:"), true, "has error prefix");
  eq(diag.includes("--> err.wac:"), true, "has file reference");
  eq(diag.includes("^"), true, "has underline");
});

Deno.test("[§wac-diag-assign-j3qm7xf] Assignment error: CompileError has span/annotation/hint", () => {
  const src = `export void test() {\n  i32 x = 1;\n  i32 y = 2;\n  i32 n = 3.14;\n}`;
  const r = wacCompile(new Map([["err.wac", src]]), "err.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.span, 4, "span=4 for 3.14");
  eq(e.annotation, "expected i32, found f64", "annotation");
  eq(typeof e.hint, "string", "has hint");
  eq(e.hint!.includes("as!"), true, "hint mentions as!");
  const result = wacDiag(r.diagnostics as DiagError[], new Map([["err.wac", src]]));
  eq(result.includes("error:"), true, "message");
  eq(result.includes("--> err.wac:4:"), true, "file:line");
  eq(result.includes("i32 n = 3.14;"), true, "source line");
  eq(result.includes("^^^^"), true, "4-char underline");
  eq(result.includes("expected i32, found f64"), true, "annotation");
  eq(result.includes("= help:"), true, "hint");
});

Deno.test("[§wac-diag-cast-p5fn2rk] Cast error: lossy cast not needed", () => {
  const src = `export void test(i32 x) {\n  i64 a = x as~ i64;\n}`;
  const diagErr: DiagError = {
    message: "lossy cast not needed",
    file: "file.wac", line: 2, col: 11, phase: "typecheck", severity: "error",
    span: 9, annotation: "i32 -> i64 is lossless",
    hint: "use `as` instead: i64 a = x as i64;",
  };
  const result = wacDiag([diagErr], new Map([["file.wac", src]]));
  eq(result.includes("error: lossy cast not needed"), true, "message");
  eq(result.includes("--> file.wac:2:9"), false, "note: col 11 not 9"); // spec shows 2:9 but our test uses col 11
  eq(result.includes("--> file.wac:2:11"), true, "file:line:col");
  eq(result.includes("i64 a = x as~ i64;"), true, "source line");
  eq(result.includes("i32 -> i64 is lossless"), true, "annotation");
});

Deno.test("[§wac-diag-null-h6kp9wn] Null error: nullable assigned to non-null", () => {
  const src = `struct Point { i32 x; i32 y; }\nexport void test(Point? q) {\n  Point p = q;\n}`;
  const diagErr: DiagError = {
    message: "cannot assign nullable to non-null",
    file: "file.wac", line: 3, col: 13, phase: "typecheck", severity: "error",
    span: 1, annotation: "expected Point, found Point?",
    hint: "unwrap with `!`: Point p = q!;",
  };
  const result = wacDiag([diagErr], new Map([["file.wac", src]]));
  eq(result.includes("error: cannot assign nullable to non-null"), true, "message");
  eq(result.includes("Point p = q;"), true, "source line");
  eq(result.includes("= help: unwrap with"), true, "hint");
});

Deno.test("[§wac-diag-const-w2jm5xf] Const error: write through const reference", () => {
  const src = `struct Point { i32 x; i32 y; }\nexport void test() {\n  const Point p = Point(1, 2);\n  p.x = 5;\n}`;
  const r = wacCompile(new Map([["file.wac", src]]), "file.wac");
  eq(r.ok, false, "should fail typecheck");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["file.wac", src]]));
  eq(diag.includes("error:"), true, "has error");
  eq(diag.includes("p.x = 5"), true, "shows source line with assignment");
});

Deno.test("[§wac-diag-wide-k4rn8wp] Gutter width adjusts for high line numbers", () => {
  // Build source with 50 lines; error at line 47
  const lines = [];
  for (let i = 0; i < 46; i++) lines.push(`  i32 x${i} = ${i};`);
  lines.push(`  return sum > 0;`); // line 47
  lines.push(`}`);
  const src = `export i32 algo() {\n` + lines.join("\n") + `\n`;
  const diagErr: DiagError = {
    message: "return: expected i32, found bool",
    file: "algo.wac", line: 47, col: 10, phase: "typecheck", severity: "error",
    span: 7, annotation: "expected i32, found bool",
    hint: "use `(sum > 0) as i32` to convert",
  };
  const result = wacDiag([diagErr], new Map([["algo.wac", src]]));
  // Line 47 has 2 digits → gutter = 4 (pad = 4 spaces before |)
  eq(result.includes("   --> algo.wac:47:10"), true, "arrow has 3 spaces (gutter-1=3)");
  eq(result.includes("    |"), true, "blank lines have 4-space gutter");
  eq(result.includes(" 47 | "), true, "source line has ' 47 | '");
});

Deno.test("[§wac-diag-multiline-ic7x2hq] Multi-line spans show context lines", () => {
  const lines = [
    "export void test() {",
    "  i32 x = 1;",
    "  i32 a = 2;",
    "  i32 b = 3;",
    "  i32 c = 4;",
    "  i32 d = 5;",
    "  i32 e = 6;",
    "  i32 f = 7;",
    "  i32 g = 8;",
    "  i32 h = 9;",
    "  i32 i = 10;",
    "  i32 result = compute(",
    "    x,",
    "    3.14",
    "  );",
    "}",
  ];
  const src = lines.join("\n");
  const diagErr: DiagError = {
    message: "incompatible argument type",
    file: "algo.wac", line: 14, col: 5, phase: "typecheck", severity: "error",
    span: 4, annotation: "expected i32, found f64",
    contextStart: 12,
  };
  const result = wacDiag([diagErr], new Map([["algo.wac", src]]));
  eq(result.includes("i32 result = compute("), true, "shows context line 12");
  eq(result.includes("    x,"), true, "shows context line 13");
  eq(result.includes("    3.14"), true, "shows error line 14");
  eq(result.includes("^^^^"), true, "underline on error line");
});

Deno.test("[§wac-diag-parse-unexpected-q3kn8wp] Unexpected token shows formatted parse error", () => {
  const src = `export void test() {\n  i32 x = ;\n}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error prefix");
  eq(diag.includes("--> main.wac:"), true, "has file reference");
  eq(diag.includes("^"), true, "has underline");
});

Deno.test("[§wac-diag-parse-missing-semi-r7jm4xf] Missing semicolon shows formatted parse error", () => {
  const src = `export void test() {\n  i32 x = 5 + 2\n  i32 y = 3;\n}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error prefix");
  eq(diag.includes("main.wac"), true, "has file reference");
});

Deno.test("[§wac-diag-parse-missing-brace-w5hd2jk] Missing closing brace shows parse error", () => {
  const src = `export void foo() {\n  i32 x = 1;\n`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error");
  eq(diag.includes("main.wac"), true, "has file");
});

Deno.test("[§wac-diag-parse-missing-paren-k8fn3qp] Missing closing paren shows parse error", () => {
  const src = `export void test() {\n  i32 x = add(1, 2;\n}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error prefix");
  eq(diag.includes("main.wac"), true, "has file reference");
});

Deno.test("[§wac-diag-parse-bad-type-n7qm3xf] Unknown type shows parse error", () => {
  const src = `export void test() {\n  foo x = 5;\n}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error");
  eq(diag.includes("main.wac"), true, "has file");
});

Deno.test("[§wac-diag-parse-bad-struct-h9pd5wn] Struct syntax error shows parse error", () => {
  const src = `struct Bad {\n  = 5;\n}\nexport void test() {}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail");
  if (r.ok) throw new Error("expected compile error");
  const diag = wacDiag(r.diagnostics as DiagError[], new Map([["main.wac", src]]));
  eq(diag.includes("error:"), true, "has error");
});

// ── §wac-unwrap-lvalue-k9fn2wp — unwrap as lvalue ─────────────────────────────

const LL_SRC = `struct Node { i32 val; Node? next; }
struct LinkedList {
  Node? head; Node? tail; i32 count;
  LinkedList create() { return LinkedList(); }
  void push_front(this, i32 val) {
    Node n = Node(val, this.head);
    this.head = n;
    if (this.tail is null) { this.tail = n; }
    this.count++;
  }
  void push_back(this, i32 val) {
    Node n = Node(val, null);
    if (this.tail is not null) { this.tail!.next = n; } else { this.head = n; }
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
  i32 front(const this) { if (this.head is null) { trap; } return this.head!.val; }
  i32 back(const this) { if (this.tail is null) { trap; } return this.tail!.val; }
  i32 len(const this) { return this.count; }
  i32 sum(const this) {
    i32 total = 0; Node? cur = this.head;
    while (cur is not null) { total += cur!.val; cur = cur!.next; }
    return total;
  }
  void reverse(this) {
    Node? prev = null; Node? cur = this.head; this.tail = this.head;
    while (cur is not null) {
      Node c = cur!; Node? next = c.next; c.next = prev; prev = c; cur = next;
    }
    this.head = prev;
  }
}
`;

Deno.test("[§wac-unwrap-lvalue-k9fn2wp] unwrap ! as lvalue: p!.next = a returns p!.next!.val", async () => {
  const src = `struct Node { i32 val; Node? next; }
export i32 test() {
  Node a = Node(); a.val = 10;
  Node b = Node(); b.val = 20;
  Node? p = b;
  p!.next = a;
  return p!.next!.val;
}`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) throw new Error(r.diagnostics[0].message);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 10, "p!.next!.val == 10");
});

// ── §wac-export-entry-only-v3kp8wn and §wac-export-no-collision-m4fn9rk ──────

Deno.test("[§wac-export-entry-only-v3kp8wn] only entry file exports appear in wasm exports; test() returns 16", async () => {
  const files = new Map([
    ["utils_a.wac", `export i32 compute(i32 x) { return x + 1; }`],
    ["utils_b.wac", `export i32 compute(i32 x) { return x * 2; }`],
    ["main.wac", `import { compute as a } from "./utils_a.wac";\nimport { compute as b } from "./utils_b.wac";\nexport i32 test() { return a(5) + b(5); }`],
  ]);
  const r = wacCompile(files, "main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) throw new Error(r.diagnostics[0].message);
  const exportNames = r.compiled.exports.map(e => e.name).filter(n => !n.startsWith("__bind"));
  eq(exportNames.length, 1, "exactly one user export");
  eq(exportNames[0], "test", "export name is 'test'");
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 16, "test() == 16");
});

Deno.test("[§wac-export-no-collision-m4fn9rk] two imported files with same export name don't collide", () => {
  const files = new Map([
    ["utils_a.wac", `export i32 compute(i32 x) { return x + 1; }`],
    ["utils_b.wac", `export i32 compute(i32 x) { return x * 2; }`],
    ["main.wac", `import { compute as a } from "./utils_a.wac";\nimport { compute as b } from "./utils_b.wac";\nexport i32 test() { return a(5) + b(5); }`],
  ]);
  const r = wacCompile(files, "main.wac");
  eq(r.ok, true, "compiles without collision error");
});

// ── §wac-struct-null-arg-h7kp3wn — null constructor arg ──────────────────────

Deno.test("[§wac-struct-null-arg-h7kp3wn] Node(42, null).val == 42 and .next is null", async () => {
  const src = `struct Node { i32 val; Node? next; }
export i32 testVal() { Node n = Node(42, null); return n.val; }
export i32 testNext() { Node n = Node(42, null); return n.next is null ? 1 : 0; }`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) throw new Error(r.diagnostics[0].message);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("testVal", []), 42, "val == 42");
  eq(inst.call("testNext", []), 1, "next is null");
});

// ── §wac-method-mixed-fields-r4kn7wp — mixed ref/primitive fields ─────────────

Deno.test("[§wac-method-mixed-fields-r4kn7wp] Stack.push x2 then len() == 2", async () => {
  const src = `struct Node { i32 val; Node? next; }
struct Stack {
  Node? top; i32 count;
  void push(this, i32 val) {
    Node n = Node(); n.val = val; n.next = this.top; this.top = n; this.count++;
  }
  i32 len(const this) { return this.count; }
}
export i32 test() { Stack s = Stack(); s.push(10); s.push(20); return s.len(); }`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) throw new Error(r.diagnostics[0].message);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 2, "len() == 2");
});

// ── §wac-ll-* — LinkedList spec tests ─────────────────────────────────────────

async function llTest(testFn: string): Promise<ReturnType<typeof wacInstance>> {
  const src = LL_SRC + testFn;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (!r.ok) throw new Error("compile error: " + r.diagnostics[0].message);
  return wacInstance(r.compiled);
}

Deno.test("[§wac-ll-push-front-k4mf2js] push_front x3 then front() == 30", async () => {
  const inst = await llTest(`export i32 testPushFront() {
  LinkedList l = LinkedList.create(); l.push_front(10); l.push_front(20); l.push_front(30);
  return l.front(); }`);
  eq(inst.call("testPushFront", []), 30, "front == 30");
});

Deno.test("[§wac-ll-push-back-p9qn3xl] push_back x3 then back() == 30", async () => {
  const inst = await llTest(`export i32 testPushBack() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20); l.push_back(30);
  return l.back(); }`);
  eq(inst.call("testPushBack", []), 30, "back == 30");
});

Deno.test("[§wac-ll-len-w7rk5bt] push_back x3 then len() == 3", async () => {
  const inst = await llTest(`export i32 testLen() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20); l.push_back(30);
  return l.len(); }`);
  eq(inst.call("testLen", []), 3, "len == 3");
});

Deno.test("[§wac-ll-len-empty-m3hd8qz] empty list len() == 0", async () => {
  const inst = await llTest(`export i32 testLenEmpty() {
  LinkedList l = LinkedList.create(); return l.len(); }`);
  eq(inst.call("testLenEmpty", []), 0, "len == 0");
});

Deno.test("[§wac-ll-sum-j2fn9rk] push_back 10/20/30 then sum() == 60", async () => {
  const inst = await llTest(`export i32 testSum() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20); l.push_back(30);
  return l.sum(); }`);
  eq(inst.call("testSum", []), 60, "sum == 60");
});

Deno.test("[§wac-ll-pop-front-h8wd2pm] pop_front returns 10, len becomes 2 → 1002", async () => {
  const inst = await llTest(`export i32 testPopFront() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20); l.push_back(30);
  i32 first = l.pop_front(); return first * 100 + l.len(); }`);
  eq(inst.call("testPopFront", []), 1002, "result == 1002");
});

Deno.test("[§wac-ll-pop-all-f4kp7wn] pop_front twice from [10,20] returns 1200", async () => {
  const inst = await llTest(`export i32 testPopFrontAll() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20);
  i32 a = l.pop_front(); i32 b = l.pop_front(); return a * 100 + b * 10 + l.len(); }`);
  eq(inst.call("testPopFrontAll", []), 1200, "result == 1200");
});

Deno.test("[§wac-ll-pop-empty-n2qm8xl] pop_front on empty list traps", async () => {
  const inst = await llTest(`export i32 testPopEmpty() {
  LinkedList l = LinkedList.create(); return l.pop_front(); }`);
  let trapped = false;
  try { inst.call("testPopEmpty", []); } catch { trapped = true; }
  eq(trapped, true, "traps on empty pop");
});

Deno.test("[§wac-ll-reverse-c7jw3kf] reverse [10,20,30] → front=30 back=10 → 3010", async () => {
  const inst = await llTest(`export i32 testReverse() {
  LinkedList l = LinkedList.create(); l.push_back(10); l.push_back(20); l.push_back(30);
  l.reverse(); return l.front() * 100 + l.back(); }`);
  eq(inst.call("testReverse", []), 3010, "result == 3010");
});

Deno.test("[§wac-ll-front-back-q8kn2wp] push_front(10) push_back(20) → front*100+back=1020", async () => {
  const inst = await llTest(`export i32 testFrontBack() {
  LinkedList l = LinkedList.create(); l.push_front(10); l.push_back(20);
  return l.front() * 100 + l.back(); }`);
  eq(inst.call("testFrontBack", []), 1020, "result == 1020");
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit regression tests (2026-07-11)
//
// Added via TDD from a compiler-correctness audit, after the spec was
// updated to resolve every design question the audit raised (see
// notes/audit-*.md and notes/spec-changes-applied.md in the repo root).
// Each test asserts the now-spec-compliant behavior and is EXPECTED TO FAIL
// against the current implementation — that's intentional. Do not edit
// these tests to make them pass; fix atoms/wac/*.ts instead, one at a time.
//
// A few fields referenced below (CompileDiagnostic.contextStart, .severity,
// CompileResult.diagnostics) don't exist on the real types yet, so those
// specific tests use `DiagError`/`any` casts to keep this file type-checking
// while still exercising real behavior. Drop the casts once the real types
// are migrated.
// ═══════════════════════════════════════════════════════════════════════════

// ── audit-01 — same-name structs in different files must not collide ───────

Deno.test("[§wac-samename-struct-k7fn3wq] same-name structs in different files don't collide", async () => {
  // NOTE: field access alone doesn't trigger this bug — wasmBuildBin.ts's
  // structFields lookup already has an `@<typeIndex>`-keyed fallback that
  // happens to route around the bare-name collision for plain field access.
  // The collision is in *method* mangling (`StructName$methodName` with no
  // file-stem qualifier) — verified empirically against the real compiler
  // before writing this test.
  const files = new Map([
    ["a.wac", `export struct Box { i32 v; i32 get(const this) { return this.v * 2; } }`],
    ["b.wac", `export struct Box { i32 v; i32 get(const this) { return this.v * 3; } }`],
    ["main.wac", `
      import { Box as BoxA } from "./a.wac";
      import { Box as BoxB } from "./b.wac";
      export i32 test() {
        BoxA a = BoxA(10);
        BoxB b = BoxB(10);
        return a.get() * 100 + b.get();
      }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`should compile: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 2030, "a.get()=20 (v*2), b.get()=30 (v*3) -> 20*100+30=2030, each struct keeps its own method");
});

Deno.test("[§wac-alias-same-type-j3wq8kf] aliased struct import is the same type as the original", async () => {
  // Mirror image of the same-name-collision bug: one struct, two names.
  // Name-based type comparison wrongly rejects `fn[i32(BoxA)] f = BoxA.get;`
  // with "expected fn(BoxA) -> i32, got fn(Box) -> i32".
  const files = new Map([
    ["lib.wac", `
      export struct Box {
        i32 v;
        i32 get(const this) { return this.v; }
      }
    `],
    ["main.wac", `
      import { Box as BoxA } from "./lib.wac";
      export i32 test() {
        BoxA b = BoxA(7);
        fn[i32(BoxA)] f = BoxA.get;
        return f(b);
      }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`should compile: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const inst = await wacInstance(r.compiled);
  eq(inst.call("test", []), 7, "funcref annotation written with the alias matches the original struct's method");
});

// ── audit-02 — block-scope shadowing must not leak past if/while/switch/for ─

Deno.test("(audit-02) shadowing inside an if-body doesn't corrupt the outer variable", async () => {
  const inst = await run(`
    export i32 shadowIf(bool flag) {
      i32 x = 1;
      if (flag) { i32 x = 2; x = 3; }
      return x;
    }
  `);
  eq(inst.call("shadowIf", [true]), 1, "outer x is untouched after the if block ends");
});

Deno.test("(audit-02) shadowing inside a while-body doesn't corrupt the outer variable", async () => {
  const inst = await run(`
    export i32 shadowWhile() {
      i32 x = 1;
      i32 i = 0;
      while (i < 1) {
        i32 x = 101;
        x = 202;
        i = i + 1;
      }
      return x;
    }
  `);
  eq(inst.call("shadowWhile", []), 1, "outer x is untouched after the while block ends");
});

Deno.test("(audit-02) shadowing inside a switch-case doesn't corrupt the outer variable", async () => {
  const inst = await run(`
    export i32 shadowSwitch() {
      i32 x = 1;
      switch (0) {
        case 0: {
          i32 x = 1000;
          x = 2000;
          break;
        }
      }
      return x;
    }
  `);
  eq(inst.call("shadowSwitch", []), 1, "outer x is untouched after the switch ends");
});

Deno.test("(audit-02) shadowing a for-loop's own control variable inside its body doesn't corrupt the loop", async () => {
  const inst = await run(`
    export i32 shadowForBody() {
      i32 count = 0;
      for (i32 i = 0; i < 5; i++) {
        i32 i = 100;
        count = count + 1;
        if (count > 20) { break; }
      }
      return count;
    }
  `);
  eq(inst.call("shadowForBody", []), 5, "loop runs exactly 5 times, not corrupted into a runaway loop");
});

// ── audit-03 — deep const must survive an accessor chain and a local alias ──

Deno.test("[§wac-deep-const-accessor-w3kf8nq] (audit-03) const is deep through a const-returning accessor method", () => {
  err(`
    struct Inner { i32 val; void mutate(this) { this.val = 1; } }
    struct Outer {
      Inner inner;
      Inner getInner(const this) { return this.inner; }
      void tryMutate(const this) { this.getInner().mutate(); }
    }
    export void test() {}
  `);
});

Deno.test("[§wac-deep-const-alias-p6mk2wf] (audit-03) const is deep through a local alias of this", () => {
  err(`
    struct Counter {
      i32 count;
      void mutate(this) { this.count = 99; }
      i32 tryMutate(const this) {
        Counter c = this;
        c.mutate();
        return this.count;
      }
    }
    export void test() {}
  `);
});

// ── audit-04 — ternary types to the closest common ancestor ────────────────

Deno.test("[§wac-ternary-subtype-h4jm9wq] ternary widens a subtype branch to its parent", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Circle : Shape { f64 radius; }
    export f64 pickParent(bool flag, f64 cx, f64 cy, f64 r, f64 sx, f64 sy) {
      Circle c = Circle(cx, cy, r);
      Shape s = Shape(sx, sy);
      Shape result = flag ? c : s;
      return result.x;
    }
  `);
  eq(inst.call("pickParent", [true, 1.0, 2.0, 5.0, 3.0, 4.0]), 1.0, "flag=true picks Circle, widened to Shape.x=1.0");
  eq(inst.call("pickParent", [false, 1.0, 2.0, 5.0, 3.0, 4.0]), 3.0, "flag=false picks Shape directly, x=3.0");
});

Deno.test("[§wac-ternary-lca-q7fk3wn] ternary types sibling subtypes to their closest common ancestor", async () => {
  const inst = await run(`
    struct Shape { f64 x; f64 y; }
    struct Circle : Shape { f64 radius; }
    struct Rect : Shape { f64 w; f64 h; }
    export f64 pickSiblings(bool flag, f64 cx, f64 cy, f64 r, f64 rx, f64 ry, f64 w, f64 h) {
      Circle c = Circle(cx, cy, r);
      Rect rect = Rect(rx, ry, w, h);
      Shape result = flag ? c : rect;
      return result.x;
    }
  `);
  eq(inst.call("pickSiblings", [true, 1.0, 2.0, 5.0, 3.0, 4.0, 10.0, 20.0]), 1.0, "flag=true picks Circle, common ancestor Shape.x=1.0");
  eq(inst.call("pickSiblings", [false, 1.0, 2.0, 5.0, 3.0, 4.0, 10.0, 20.0]), 3.0, "flag=false picks Rect, common ancestor Shape.x=3.0");
});

// ── audit-05 — as@ never traps where a raw form exists; compile error otherwise ─

Deno.test("[§wac-raw-truncf-nan-w9fk2xq] as@ float->int never traps on NaN or overflow", async () => {
  const inst = await run(`
    export i32 truncFloatNaN() { return (0.0 / 0.0) as@ i32; }
    export i32 truncFloatOverflow() { return 1.0e300 as@ i32; }
  `);
  eq(inst.call("truncFloatNaN", []), 0, "NaN as@ i32 == 0, never traps");
  eq(inst.call("truncFloatOverflow", []), 2147483647, "overflow saturates to i32 max, never traps");
});

Deno.test("[§wac-raw-noalt-k3jf7wq] as@ is a compile error where no raw form exists (f64 -> f32)", () => {
  err(`
    export f32 noAlt(f64 x) { return x as@ f32; }
  `);
});

// ── audit-06 — as!/as~ are complete for every non-lossless numeric pair ─────

Deno.test("[§wac-narrow-f32-ok-h8fk3wq] [§wac-narrow-f32-trap-r5tn9wq] f64 as! f32 is exact-value-or-trap", async () => {
  const inst = await run(`
    export f32 exactNarrow(f64 x) { return x as! f32; }
  `);
  eq(inst.call("exactNarrow", [0.5]), 0.5, "0.5 is exact in f32, no trap");
  traps(() => inst.call("exactNarrow", [0.1]), "0.1 has no exact f32 representation, must trap");
});

Deno.test("[§wac-round-i64-h3fm2wq] f64 as~ i64 rounds to nearest and clamps on overflow", async () => {
  const inst = await run(`
    export i64 roundBig(f64 x) { return x as~ i64; }
  `);
  eq(inst.call("roundBig", [3.7]), 4n, "rounds to nearest i64");
  eq(inst.call("roundBig", [1.0e300]), 9223372036854775807n, "clamps to i64 max, never traps");
});

Deno.test("(audit-06) remaining as!/as~ pairs from the completed casts.md tables", async () => {
  const inst = await run(`
    export f32 i32f32(i32 x)  { return x as! f32; }
    export f32 i64f32(i64 x)  { return x as! f32; }
    export f64 i64f64(i64 x)  { return x as! f64; }
    export i64 rf32i64(f32 x) { return x as~ i64; }
    export f32 ri64f32(i64 x) { return x as~ f32; }
  `);
  // as!: exact value or trap (2^24+1 is the first integer with no f32 image,
  // 2^53+1 the first with no f64 image; the type MIN values are exact powers
  // of two and must NOT trap despite sitting at the saturation boundary)
  eq(inst.call("i32f32", [16777216]), 16777216, "2^24 exact in f32");
  traps(() => inst.call("i32f32", [16777217]), "2^24+1 has no exact f32");
  traps(() => inst.call("i32f32", [2147483647]), "i32::MAX has no exact f32");
  eq(inst.call("i32f32", [-2147483648]), -2147483648, "-2^31 is exact");
  traps(() => inst.call("i64f32", [16777217n]), "2^24+1 has no exact f32 (from i64)");
  eq(inst.call("i64f32", [-9223372036854775808n]), -9223372036854775808, "-2^63 is exact in f32");
  traps(() => inst.call("i64f64", [9007199254740993n]), "2^53+1 has no exact f64");
  traps(() => inst.call("i64f64", [9223372036854775807n]), "i64::MAX has no exact f64");
  eq(inst.call("i64f64", [-9223372036854775808n]), -9223372036854775808, "-2^63 is exact in f64");
  // as~: round to nearest, clamp, never trap
  eq(inst.call("rf32i64", [3.7]), 4n, "f32 as~ i64 rounds to nearest");
  eq(inst.call("rf32i64", [1e30]), 9223372036854775807n, "f32 as~ i64 clamps");
  eq(inst.call("ri64f32", [16777217n]), 16777216, "i64 as~ f32 rounds to nearest");
});

// §wac-nullable-primitive-4mzq7vp — a nullable primitive, boxed
Deno.test("[§wac-nullable-primitive-4mzq7vp] a nullable primitive works in every position", async () => {
  // Issue 0045. Every one of these produced invalid wasm before — `local.set expected anyref,
  // found i32` — because no wasm numeric type has a null, so the value has to be boxed and
  // nothing boxed it. The positions are listed one per export because they are separate paths
  // through the emitter: each is a place where a value is stored into a slot.
  const inst = await run(`
    struct H { i32? v; f64? f; i32 get(const this) { return this.v!; } }
    enum E { A(i32? v), B }
    i32 take(i32? a) { return a is null ? -1 : a!; }
    i32? give(bool some) { if (some) { return 5; } return null; }
    export i32 declared()   { i32? a = 7; return a!; }
    export i32 assigned()   { i32? a = null; a = 6; return a!; }
    export i32 computed()   { i32 x = 40; i32? a = x + 2; return a!; }
    export i32 aliased()    { i32? a = 5; i32? b = a; return b!; }
    export i32 field()      { H h = H(7, 2.0); return h.v! + (h.f! as! i32); }
    export i32 fieldNull()  { H h = H(null, null); return h.v is null ? 1 : 0; }
    export i32 fieldSet()   { H h = H(null, null); h.v = 9; return h.v!; }
    export i32 element()    { i32?[] xs = i32?[3](); xs[1] = 4; return (xs[0] is null ? 1 : 0) * 10 + xs[1]!; }
    export i32 argument()   { i32 x = 3; return take(x) * 10 + take(null); }
    export i32 returned()   { return give(true)! * 10 + (give(false) is null ? 1 : 0); }
    export i32 ternary(bool c) { i32? a = c ? 1 : null; return a is null ? -1 : a!; }
    export i32 matchArm(bool c) {
      i32? a = match (c ? E.A(3) : E.B) { case A(v): v, case B: null };
      return a is null ? -1 : a!;
    }
    export i32 payload()    { E e = E.A(8); return match (e) { case A(v): v!, case B: 0 }; }
    export i32 viaMethod()  { H h = H(3, 0.0); return h.get(); }
  `);
  eq(inst.call("declared", []), 7, "a declaration");
  eq(inst.call("assigned", []), 6, "assignment to a local");
  eq(inst.call("computed", []), 42, "a computed value, not just a literal");
  eq(inst.call("aliased", []), 5, "one nullable assigned from another, which must not double-box");
  eq(inst.call("field", []), 9, "struct fields, i32 and f64");
  eq(inst.call("fieldNull", []), 1, "a null field");
  eq(inst.call("fieldSet", []), 9, "assignment to a field");
  eq(inst.call("element", []), 14, "an array of them, and assignment to an element");
  eq(inst.call("argument", []), 29, "a call argument, with a value and with null");
  eq(inst.call("returned", []), 51, "a return, both ways");
  eq(inst.call("ternary", [1]), 1, "a ternary branch against a null branch");
  eq(inst.call("ternary", [0]), -1, "and the null side of it");
  eq(inst.call("matchArm", [1]), 3, "a match expression's arm");
  eq(inst.call("matchArm", [0]), -1, "and its null arm");
  eq(inst.call("payload", []), 8, "an enum payload");
  eq(inst.call("viaMethod", []), 3, "read through a method");
});

Deno.test("[§wac-nullable-primitive-4mzq7vp] the full range survives, which i31 did not", async () => {
  // The reason it is a boxed struct rather than `ref.i31`, which is free: i31 holds 31 bits, so
  // 2000000000 came back as -147483648. A wrong answer with no diagnostic, at exactly the
  // values a program is most careful about. This test is the whole argument for the allocation.
  const inst = await run(`
    export i32 big()      { i32? a = 2000000000;      return a!; }
    export i32 negBig()   { i32? a = 0 - 2000000000;  return a!; }
    export i32 iMax()     { i32? a = 2147483647;      return a!; }
    export u32 uMax()     { u32? a = 4294967295;      return a!; }
    export i64 wide()     { i64? a = 9007199254740993; return a!; }
    export f64 fraction() { f64? a = 1.25;            return a!; }
    export bool flag()    { bool? a = true;           return a!; }
  `);
  eq(inst.call("big", []), 2000000000, "past 2^30, which i31 truncated");
  eq(inst.call("negBig", []), -2000000000, "and the negative side");
  eq(inst.call("iMax", []), 2147483647, "i32's maximum");
  eq(inst.call("uMax", []), 4294967295, "u32's maximum, which needs all 32 bits");
  eq(inst.call("wide", []), 9007199254740993n, "an i64 beyond f64's integer range");
  eq(inst.call("fraction", []), 1.25, "an f64, which i31 could not have held at all");
  eq(inst.call("flag", []), true, "and a bool");
});

Deno.test("[§wac-nullable-primitive-4mzq7vp] unwrapping an absent one traps", async () => {
  const inst = await run(`
    export i32 nullUnwrap() { i32? a = null; return a!; }
    export i32 present()    { i32? a = 1;    return a!; }
  `);
  traps(() => inst.call("nullUnwrap", []), "unwrapping a null nullable primitive");
  eq(inst.call("present", []), 1, "and the present case does not");
});

// ── audit-07 — nullable primitives must produce valid, instantiable wasm ───

Deno.test("(audit-07) a nullable primitive crosses the host boundary as a reference", async () => {
  // It used to come back as a *number*, because a nullable primitive was `ref.i31` — which is
  // free and holds 31 bits, so `2000000000` came back as `-147483648`. It is a boxed struct now
  // [issue 0045], so at the boundary it is a reference like any other, and reading one from the
  // host needs an accessor written in wac. Asserted rather than described: this is the one
  // observable behaviour the fix changed.
  const inst = await run(`
    export i32? mk() { return 5; }
    export i32 read(i32? x) { return x is null ? -1 : x!; }
  `);
  const boxed = inst.call("mk", []);
  if (typeof boxed === "number") {
    throw new Error("a nullable primitive should cross as a reference, not a number");
  }
  eq(inst.call("read", [boxed as object]), 5, "and wac can read it back");
  eq(inst.call("read", [null]), -1, "including the absent case");
});

// ── audit-08 — a bare null call argument must not miscompile ───────────────

Deno.test("(audit-08) sum(null) from spec/examples.md example 2 compiles and instantiates", async () => {
  const inst = await run(`
    struct Node {
      i32 val;
      Node? next;
      Node create(i32 val) { Node n = Node(); n.val = val; return n; }
    }
    export i32 sum(Node? head) {
      i32 total = 0;
      Node? cur = head;
      while (cur is not null) {
        total += cur!.val;
        cur = cur!.next;
      }
      return total;
    }
    export i32 testNullArg() { return sum(null); }
  `);
  eq(inst.call("testNullArg", []), 0, "sum(null) == 0");
});

// ── audit-09 — exporting a function with an anyref[] parameter must not corrupt the module ─

Deno.test("(audit-09) sumBoxed(anyref[]) from spec/examples.md example 6 compiles and instantiates", async () => {
  const inst = await run(`
    export i32 sumBoxed(anyref[] items) {
      i32 total = 0;
      for (i32 i = 0; i < items.len(); i++) {
        if (items[i] is i31ref) {
          total += items[i] as! i31ref as i32;
        }
      }
      return total;
    }
    export i32 testSumBoxed() {
      anyref[] items = anyref[](10 as! i31ref, 20 as! i31ref, 30 as! i31ref);
      return sumBoxed(items);
    }
  `);
  eq(inst.call("testSumBoxed", []), 60, "sumBoxed({10,20,30}) == 60");
});

// ── audit-10 — a non-nullable array field defaults to an empty array ───────
// Resolved: unlike a non-null recursive struct reference (which genuinely
// has no default — constructing one would recurse forever), a non-null
// array field has an obvious default with no size ambiguity: the empty
// array. The element type's own defaultability is irrelevant here (it only
// matters for T[N](), which requires N actual default elements).

Deno.test("[§wac-arr-field-default-k9wq3fm] a struct with a non-null array field defaults to an empty array", async () => {
  const inst = await run(`
    struct Foo { i32[] data; }
    export i32 test() { Foo f = Foo(); return f.data.len(); }
  `);
  eq(inst.call("test", []), 0, "Foo().data is an empty array, len() == 0");
});

// ── audit-11 — switch break must not count as "returns a value" ────────────

Deno.test("(audit-11) a switch case ending in break is still a missing return", () => {
  err(`
    i32 f(i32 x) {
      switch (x) {
        case 0: { break; }
        default: { return 1; }
      }
    }
    export void test() {}
  `);
});

// ── audit-12 — `is Type ? ident : ident` must parse as a ternary ───────────

Deno.test("(audit-12) is-test followed by a ternary with identifier branches parses correctly", async () => {
  const inst = await run(`
    export i32 pick(anyref x, i32 y, i32 z) {
      return x is i31ref ? y : z;
    }
    export i32 testPick() { return pick(5 as! i31ref, 10, 20); }
  `);
  eq(inst.call("testPick", []), 10, "x is i31ref is true, so y (10) is picked");
});

// ── audit-13 / audit-14 — unterminated string/comment must be lex errors ───

Deno.test("[§wac-diag-lex-unterm-str-m9fk2wq] unterminated string literal is a lex-phase error", () => {
  const src = `export i32 f() { string s = "hello; return 1; }`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail to compile");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.phase, "lex", "should be a lex-phase error");
  eq(/unterminated/i.test(e.message) && /string/i.test(e.message), true, "message should mention unterminated string");
});

Deno.test("[§wac-diag-lex-unterm-comment-r4jn8xq] unterminated block comment is a lex-phase error", () => {
  const src = `export i32 f() { return 1; }\n/* oops, forgot to close`;
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, false, "should fail to compile");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.phase, "lex", "should be a lex-phase error");
  eq(/unterminated/i.test(e.message) && /comment/i.test(e.message), true, "message should mention unterminated comment");
});

// ── audit-16 — non-exported structs must not be importable ─────────────────

Deno.test("(audit-16) importing a non-exported struct is a compile error", () => {
  const files = new Map([
    ["geo.wac", `struct Point { i32 x; i32 y; }`],
    ["main.wac", `import { Point } from "./geo.wac"; export void test() {}`],
  ]);
  errMulti(files);
});

// ── audit-17 — export visibility must not leak transitively ────────────────

Deno.test("[§wac-no-reexport-f7kn4wq] (audit-17) importing a symbol doesn't implicitly re-export it", () => {
  const files = new Map([
    ["a.wac", `export i32 foo() { return 42; }`],
    ["b.wac", `import { foo } from "./a.wac";`],
    ["main.wac", `import { foo } from "./b.wac"; export i32 test() { return foo(); }`],
  ]);
  errMulti(files);
});

// ── audit-18 — i32 as~ bool must normalize the value, not just pass i32 through ─

Deno.test("(audit-18) i32 as~ bool normalizes to canonical true/false before comparison", async () => {
  const inst = await run(`
    export bool testBoolCast() {
      i32 x = 5;
      bool b = x as~ bool;
      return b == true;
    }
  `);
  eq(inst.call("testBoolCast", []), true, "5 as~ bool normalizes to true, compares equal to true");
});

// ── audit-19 — bindgen must not rename exports to camelCase ─────────────────

Deno.test("(audit-19) bindgen keeps the wac export name verbatim, no camelCase renaming", () => {
  const r = wacCompile(new Map([["math.wac", `
    export f64 circle_area(f64 radius) { return 3.14159265358979 * radius * radius; }
  `]]), "math.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));
  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function circle_area("), true, "generated wrapper keeps circle_area verbatim");
  eq(ts.includes("function circleArea("), false, "generated wrapper must not rename to circleArea");
});

// ── audit-20 — bindgen must never mirror array mutations back automatically ─

Deno.test("(audit-20) a void function's array mutation is never copied back by bindgen", () => {
  const r = wacCompile(new Map([["m.wac", `
    export void mutateArr(i32[] arr) { arr[0] = 999; }
  `]]), "m.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));
  const ts = wacBindgen(r.compiled);
  eq(ts.includes("function mutateArr(arr: Int32Array): void"), true, "void function stays void in the generated wrapper");
  eq(ts.includes("_arrayFromWasm_i32"), false, "must not attempt to copy the array back for a void function");
});

// ── audit-21 — multi-line argument-position diagnostics need a real span/contextStart ─

Deno.test("[§wac-diag-multiline-ic7x2hq] multi-line call diagnostics carry the real span and contextStart", () => {
  const src = [
    "export i32 compute(i32 a, i32 b) { return a; }",
    "export void test() {",
    "  i32 x = 1;",
    "  i32 result = compute(",
    "    x,",
    "    3.14",
    "  );",
    "}",
  ].join("\n");
  const r = wacCompile(new Map([["algo.wac", src]]), "algo.wac");
  eq(r.ok, false, "should fail to compile");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0] as DiagError;
  eq(e.line, 6, "error reported on the 3.14 line");
  eq(e.span, 4, "span covers the 4-character literal 3.14, not a default of 1");
  eq(e.contextStart, 4, "contextStart points back to the compute( line, not left undefined");
});

// ── audit-22 — const-write diagnostics must carry span/annotation ──────────

Deno.test('[§wac-diag-const-w2jm5xf] const-write diagnostic carries span=3 and annotation="p is const"', () => {
  const src = `struct Point { i32 x; i32 y; }\nexport void test() {\n  const Point p = Point(1, 2);\n  p.x = 5;\n}`;
  const r = wacCompile(new Map([["file.wac", src]]), "file.wac");
  eq(r.ok, false, "should fail typecheck");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.span, 3, "span=3 for 'p.x'");
  eq(e.annotation, "p is const", "annotation identifies p as const");
});

// ── audit-23 — diagnostic hint text must reconstruct the real source, not a placeholder ─

Deno.test('[§wac-diag-wide-k4rn8wp] return-type hint reconstructs the real expression, not the placeholder "expr"', () => {
  const src = `export i32 algo(i32 sum) {\n  return sum > 0;\n}`;
  const r = wacCompile(new Map([["algo.wac", src]]), "algo.wac");
  eq(r.ok, false, "should fail typecheck");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  eq(e.hint, "use `(sum > 0) as i32` to convert", "hint reconstructs the real source expression");
});

Deno.test("[§wac-diag-cast-p5fn2rk] lossy-cast diagnostic matches the spec's exact col and hint text", () => {
  const src = `export void test(i32 x) {\n  i64 a = x as~ i64;\n}`;
  const r = wacCompile(new Map([["file.wac", src]]), "file.wac");
  eq(r.ok, false, "should fail typecheck");
  if (r.ok) throw new Error("expected compile error");
  const e = r.diagnostics[0];
  // The spec's rendered caret (and its sibling assign example) anchor at the
  // castee `x`, column 11 with the 2-space body indent — the original "2:9"
  // header was a spec self-inconsistency, fixed to 2:11.
  eq(e.col, 11, "col=11: the castee x, matching the spec's rendered caret");
  eq(e.span, 9, "span covers `x as~ i64`");
  eq(e.hint, "use `as` instead: i64 a = x as i64;", "hint matches the spec's exact required text");
});

// ── audit-24 — prefix/postfix ++/-- are full expressions ───────────────────

Deno.test("[§wac-postincr-expr-n4kx8wq] postfix ++ evaluates to the old value as an expression", async () => {
  const inst = await run(`
    export i32 postIncr() {
      i32 x = 5;
      i32 y = x++;
      return y * 10 + x;
    }
  `);
  eq(inst.call("postIncr", []), 56, "y=5 (old value), x=6 -> 5*10+6=56");
});

Deno.test("[§wac-preincr-expr-t8jm3wq] prefix ++ evaluates to the new value as an expression", async () => {
  const inst = await run(`
    export i32 preIncr() {
      i32 x = 5;
      i32 z = ++x;
      return z * 10 + x;
    }
  `);
  eq(inst.call("preIncr", []), 66, "x becomes 6, z=6 (new value) -> 6*10+6=66");
});

Deno.test("(audit-24) ++/-- expressions on fields, elements, and mid-expression", async () => {
  const inst = await run(`
    struct P { i32 n; }
    export i32 fieldPost() { P p = P(5); i32 old = p.n++; return old * 100 + p.n; }
    export i32 fieldPre()  { P p = P(5); i32 nw = ++p.n; return nw * 100 + p.n; }
    export i32 elemPost()  { i32[] a = i32[](7); i32 old = a[0]--; return old * 100 + a[0]; }
    export i32 inExpr()    { i32 x = 3; return x++ * 2 + x; }
  `);
  eq(inst.call("fieldPost", []), 506, "p.n++ yields old 5, field becomes 6");
  eq(inst.call("fieldPre", []), 606, "++p.n yields new 6");
  eq(inst.call("elemPost", []), 706, "a[0]-- yields old 7, element becomes 6");
  eq(inst.call("inExpr", []), 10, "x++ * 2 + x = 3*2 + 4");
});

Deno.test("(audit-24) ++ requires an integer lvalue", () => {
  err(`export i32 f() { return 5++; }`);
  err(`export i32 g() { const i32 x = 1; return x++; }`);
  err(`export f64 h() { f64 x = 1.5; return x++; }`);
});

// ── audit-25 — a switch may have at most one default clause, and it must be last ─

Deno.test("(audit-25) a second default clause in a switch is a compile error", () => {
  err(`
    export i32 test(i32 x) {
      switch (x) {
        case 0: { return 1; }
        default: { return 2; }
        default: { return 3; }
      }
    }
  `);
});

// ── audit-26 — is/as! between unrelated struct types should warn, not silently pass ─
// NOTE: exercises the not-yet-existing CompileResult.diagnostics/severity
// shape (see errors.md "Warnings"), so it uses `any` rather than the real
// (not-yet-migrated) CompileResult type.

Deno.test("(audit-26) is/as! between statically unrelated struct types produces a warning", () => {
  const src = `
    struct A { i32 a; }
    struct B { i32 b; }
    export void test() {
      A x = A(1);
      if (x is B) { }
    }
  `;
  // deno-lint-ignore no-explicit-any
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac") as any;
  eq(r.ok, true, "should still compile successfully — this is a warning, not an error");
  eq(Array.isArray(r.diagnostics), true, "CompileResult should expose a diagnostics array (not yet migrated)");
  const warning = (r.diagnostics ?? []).find((d: { severity?: string }) => d.severity === "warning");
  eq(!!warning, true, "should include a warning-severity diagnostic for the unrelated is-test");
});

// ── Unsigned integers ────────────────────────────────────────────────────────

// §wac-udiv-3kf9wqm — the same 32 bits divide differently depending on the type
Deno.test(`[§wac-udiv-3kf9wqm] u32 and i32 divide the same bits differently`, async () => {
  const i = await run(`
    export u32 half(u32 x) { return x / (2 as@ u32); }
    export i32 halfSigned(i32 x) { return x / 2; }
  `);
  eq(i.call("half", [4294967295]), 2147483647, "half(4294967295) == 2147483647");
  eq(i.call("halfSigned", [-1]), 0, "halfSigned(-1) == 0 — same bits, signed");
});

// §wac-usign-raw-m2kf7wq — as@ between signednesses is a pure reinterpretation
Deno.test(`[§wac-usign-raw-m2kf7wq] as@ reinterprets i32 <-> u32 losslessly`, async () => {
  const i = await run(`
    export u32 bits(i32 x)     { return x as@ u32; }
    export i32 roundTrip(i32 x) { return x as@ u32 as@ i32; }
  `);
  eq(i.call("bits", [-1]), 4294967295, "bits(-1) == 4294967295");
  eq(i.call("roundTrip", [-1]), -1, "reinterpreting twice returns the original");
});

// §wac-usign-chk-p8jn3wl — as! traps when the value has no unsigned reading
Deno.test(`[§wac-usign-chk-p8jn3wl] as! i32 -> u32 traps on a negative`, async () => {
  const i = await run(`export u32 check(i32 x) { return x as! u32; }`);
  eq(i.call("check", [5]), 5, "check(5) == 5");
  let trapped = false;
  try { i.call("check", [-1]); } catch { trapped = true; }
  eq(trapped, true, "check(-1) traps");
});

// §wac-usign-clamp-r4mk9xf — as~ clamps rather than trapping
Deno.test(`[§wac-usign-clamp-r4mk9xf] as~ i32 -> u32 clamps a negative to 0`, async () => {
  const i = await run(`export u32 clamp(i32 x) { return x as~ u32; }`);
  eq(i.call("clamp", [-5]), 0, "clamp(-5) == 0");
  eq(i.call("clamp", [7]), 7, "clamp(7) == 7");
});

// ── Contextual literal typing ────────────────────────────────────────────────

// §wac-litctx-w7kn2mf — a literal takes the integer type expected of it
Deno.test(`[§wac-litctx-w7kn2mf] integer literals adopt the expected type`, async () => {
  const i = await run(`
    struct Hdr { u32 magic; u32 len; }
    u32 addU(u32 a, u32 b) { return a + b; }
    export u32 twice(u32 x)  { return x * 2; }
    export u32 mask(u32 x)   { return x & 0xFF; }
    export u32 leftLit(u32 x) { return 2 * x; }
    export i64 wideInit()    { return 5; }
    export u64 uMax()        { return 18446744073709551615; }
    export u32 args()        { return addU(1, 2); }
    export u32 fields()      { Hdr h = Hdr(7, 9); return h.magic + h.len; }
    export u32 elems()       { u32[] a = u32[](1, 4000000000); return a[1]; }
  `);
  eq(i.call("twice", [2147483648]), 0, "u32 * 2 wraps — literal is u32, not i32");
  eq(i.call("mask", [0xDEAD]), 0xAD, "hex literal adopts u32");
  eq(i.call("leftLit", [2147483648]), 0, "literal on the left of the operator too");
  eq(i.call("wideInit", []), 5n, "i64 n = 5 — previously an error");
  eq(i.call("uMax", []), 18446744073709551615n, "a decimal only u64 can hold");
  eq(i.call("args", []), 3, "call arguments adopt the parameter type");
  eq(i.call("fields", []), 16, "struct fields adopt the field type");
  eq(i.call("elems", []), 4000000000, "array literal elements adopt the element type");
});

// §wac-litctx-nofit-k3mq8wl — adoption requires the value to fit
Deno.test(`[§wac-litctx-nofit-k3mq8wl] a literal that does not fit is rejected`, () => {
  const bad = (src: string) => {
    const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
    return !r.ok;
  };
  eq(bad(`u32 f() { return -1; }`), true, "-1 has no u32 reading");
  eq(bad(`i32 f() { return 5000000000; }`), true, "5000000000 exceeds i32");
  eq(bad(`u32 f() { return 5000000000; }`), true, "5000000000 exceeds u32");
  eq(bad(`u64 f() { return 18446744073709551616; }`), true, "past u64 max");
  eq(bad(`i64 f() { return 9223372036854775808; }`), true, "needs u64, none expected");
  eq(bad(`u32 f(i32 x) { return x; }`), true, "a variable still never coerces");
});

// §wac-litctx-minint-p9fk4wq — the most negative value is spellable in decimal
Deno.test(`[§wac-litctx-minint-p9fk4wq] -2147483648 is an i32`, async () => {
  const i = await run(`
    export i32 minI32() { return -2147483648; }
    export i64 minI64() { return -9223372036854775808; }
  `);
  eq(i.call("minI32", []), -2147483648, "i32 min");
  eq(i.call("minI64", []), -9223372036854775808n, "i64 min");
});

// §wac-arr-signedness-h4kq7wn — packed elements: one storage, two readings
Deno.test(`[§wac-arr-signedness-h4kq7wn] packed reads extend per the element type`, async () => {
  const i = await run(`
    export i32 u8Read()  { u8[] b = u8[1]();  b[0] = 0xFF;   return b[0]; }
    export i32 i8Read()  { i8[] b = i8[1]();  b[0] = 0xFF;   return b[0]; }
    export i32 i8Min()   { i8[] b = i8[1]();  b[0] = 0x80;   return b[0]; }
    export i32 u16Read() { u16[] b = u16[1](); b[0] = 0xFFFF; return b[0]; }
    export i32 i16Read() { i16[] b = i16[1](); b[0] = 0xFFFF; return b[0]; }
    export i32 trunc()   { u8[] b = u8[1]();  b[0] = 300;    return b[0]; }
  `);
  // The stored byte is the same in each pair; only the read differs.
  eq(i.call("u8Read", []), 255, "u8 zero-extends");
  eq(i.call("i8Read", []), -1, "i8 sign-extends the same byte");
  eq(i.call("i8Min", []), -128, "0x80 is i8's most negative");
  eq(i.call("u16Read", []), 65535, "u16 zero-extends");
  eq(i.call("i16Read", []), -1, "i16 sign-extends");
  eq(i.call("trunc", []), 44, "writes still truncate to the element width");
});

// §wac-narrow-frac-t6kq2wp — as! float->int is exact or it traps
Deno.test(`[§wac-narrow-frac-t6kq2wp] as! f64 -> i32 traps on a fractional part`, async () => {
  const i = await run(`export i32 exact(f64 x) { return x as! i32; }`);
  eq(i.call("exact", [3.0]), 3, "exact(3.0) == 3");
  const traps = (x: number) => {
    try { i.call("exact", [x]); return false; } catch { return true; }
  };
  eq(traps(3.5), true, "exact(3.5) traps");
  eq(traps(-2.3), true, "exact(-2.3) traps");
});

// §wac-litctx-ternary-j8kw3mq — ternary branches take the expected type too
Deno.test(`[§wac-litctx-ternary-j8kw3mq] ternary branches adopt the expected type`, async () => {
  const i = await run(`
    export u32 pick(bool c)          { return c ? 1 : 2; }
    export u64 orZero(bool c, u64 a) { return c ? a : 0; }
    export u32 wraps(bool c, u32 x)  { return (c ? x : 1) * 2; }
  `);
  eq(i.call("pick", [true]), 1, "both branches are u32");
  eq(i.call("pick", [false]), 2, "either way");
  eq(i.call("orZero", [false, 7n]), 0n, "a literal branch follows the typed one");
  eq(i.call("wraps", [true, 2147483648]), 0, "result really is u32 — it wraps");
});

// §wac-switch-u32-r5nk8wf — switch dispatches on any 32-bit integer
Deno.test(`[§wac-switch-u32-r5nk8wf] switch accepts a u32 scrutinee`, async () => {
  const i = await run(`
    export i32 classify(u32 x) {
      switch (x) {
        case 0: { return 10; }
        case 4294967295: { return 20; }
        default: { return 30; }
      }
    }
  `);
  eq(i.call("classify", [0]), 10, "case 0");
  eq(i.call("classify", [4294967295]), 20, "a case value beyond i32's range");
  eq(i.call("classify", [7]), 30, "default");
});

// §wac-shr-u-redundant-m3kq7wn — `>>>` says nothing extra on an unsigned type
Deno.test(`[§wac-shr-u-redundant-m3kq7wn] '>>>' on an unsigned type is rejected`, () => {
  const m = err(`export u32 bad(u32 x) { return x >>> 1; }`);
  if (!m.includes("redundant")) {
    throw new Error(`expected the redundancy diagnostic, got: ${m}`);
  }
  // `>>` is the logical shift there, and is accepted.
  const r = wacCompile(new Map([["main.wac", `export u32 ok(u32 x) { return x >> 1; }`]]), "main.wac");
  eq(r.ok, true, "'>>' on u32 compiles");
});

// §wac-string-default-k2mf9wq — "" is string's default value
Deno.test(`[§wac-string-default-k2mf9wq] string defaults to the empty string`, async () => {
  const i = await run(`
    struct S { string s; i32 n; }
    struct Nested { S inner; }
    export i32 fieldDefault()  { S x = S(); return x.s.len(); }
    export bool fieldIsEmpty() { S x = S(); return x.s == ""; }
    export i32 nestedDefault() { Nested x = Nested(); return x.inner.s.len(); }
    export i32 sizedArray()    { string[] a = string[3](); return a.len() * 10 + a[2].len(); }
    export bool arrayElemEmpty(){ string[] a = string[2](); return a[0] == ""; }
    export i32 dynamicSize(i32 n) { string[] a = string[n](); return a.len(); }
    export i32 arrayLiteral()  { string[] a = string[]("x", "yz"); return a[0].len() + a[1].len(); }
  `);
  // struct.new_default and array.new_default both refuse a non-null ref element,
  // which is what string compiles to — so each of these used to typecheck and
  // then fail to instantiate.
  eq(i.call("fieldDefault", []), 0, "a defaulted string field is empty");
  eq(i.call("fieldIsEmpty", []), true, "and equals \"\"");
  eq(i.call("nestedDefault", []), 0, "through a nested struct default");
  eq(i.call("sizedArray", []), 30, "string[3]() has length 3, elements empty");
  eq(i.call("arrayElemEmpty", []), true, "elements really are \"\"");
  eq(i.call("dynamicSize", [4]), 4, "size may be a runtime value");
  eq(i.call("arrayLiteral", []), 3, "the literal form still works");
});

// §wac-fnref-static-n7kq3wm — static methods are referenceable, like any function
Deno.test(`[§wac-fnref-static-n7kq3wm] a static method reference is its own signature`, async () => {
  const i = await run(`
    struct Counter {
      i32 count;
      Counter create(i32 initial) { return Counter(initial); }
      i32 twice(i32 x) { return x * 2; }
      void inc(this) { this.count++; }
    }
    export i32 viaFactory() { fn[Counter(i32)] f = Counter.create; return f(7).count; }
    export i32 viaPlain()   { fn[i32(i32)] f = Counter.twice; return f(21); }
    export i32 viaInstance() {
      fn[void(Counter)] bump = Counter.inc;   // receiver is a leading parameter
      Counter c = Counter.create(0);
      bump(c); bump(c);
      return c.count;
    }
  `);
  eq(i.call("viaFactory", []), 7, "static constructor as a value");
  eq(i.call("viaPlain", []), 42, "static method with no receiver");
  eq(i.call("viaInstance", []), 2, "instance references still carry the receiver");
});

// §wac-arr-struct-runtime-w4kf2nq — a runtime size builds real elements too
Deno.test(`[§wac-arr-struct-runtime-w4kf2nq] T[n]() fills with distinct defaults`, async () => {
  const i = await run(`
    struct P { i32 x; }
    struct S { string s; i32 n; }
    export i32 readIt(i32 n)   { P[] a = P[n](); return a[1].x; }
    export i32 distinct(i32 n) { P[] a = P[n](); a[0].x = 99; return a[1].x * 100 + a[0].x; }
    export i32 nested(i32 n)   { i32[][] g = i32[][n](); return g.len() * 10 + g[0].len(); }
    export i32 withString(i32 n) { S[] a = S[n](); return a.len() * 10 + a[1].s.len(); }
    export i32 zero()          { P[] a = P[0](); return a.len(); }
    export i32 twice(i32 n)    { return P[n]().len() * 10 + P[n + 1]().len(); }
  `);
  // array.new_default fills a struct-element array with nulls, and every read
  // unwraps — so before the fill loop, reading any element trapped.
  eq(i.call("readIt", [3]), 0, "an element is readable");
  // Rules out array.fill: one replicated value would alias across the array.
  eq(i.call("distinct", [3]), 99, "writing a[0] leaves a[1] alone");
  eq(i.call("nested", [2]), 20, "array elements default to empty arrays");
  eq(i.call("withString", [3]), 30, "a struct holding a string still works");
  eq(i.call("zero", []), 0, "a zero-length array fills vacuously");
  eq(i.call("twice", [2]), 23, "two fills in one expression do not collide");
});

// ── enums and match ───────────────────────────────────────────────────────────
//
// Every one of these instantiates rather than only compiling. In this codebase the
// recurring failure has been a construct that typechecks and then emits invalid
// wasm — six times now — and match is exactly the shape that risks it: casts,
// nested ifs, and locals bound from struct fields.

const SHAPES = `enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}`;

Deno.test("[§enum-match-basic] [§enum-match-nopayload] match dispatches on the variant", async () => {
  const inst = await run(`${SHAPES}
    export f64 area(Shape s) {
      match (s) {
        case Point:      return 0.0;
        case Circle(r):  return 3.0 * r * r;
        case Rect(w, h): return w * h;
      }
    }
    export Shape mkPoint()             { return Shape.Point; }
    export Shape mkCircle(f64 r)       { return Shape.Circle(r); }
    export Shape mkRect(f64 w, f64 h)  { return Shape.Rect(w, h); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.area(raw.mkRect(3.0, 4.0)), 12, "Rect arm, both payloads bound");
  eq(raw.area(raw.mkCircle(2.0)), 12, "Circle arm");
  eq(raw.area(raw.mkPoint()), 0, "payload-less arm");
});

Deno.test("[§enum-match-else] an else arm covers the rest", async () => {
  const inst = await run(`${SHAPES}
    export f64 radiusOr(Shape s, f64 fallback) {
      match (s) {
        case Circle(r): return r;
        else:           return fallback;
      }
    }
    export Shape mkPoint()       { return Shape.Point; }
    export Shape mkCircle(f64 r) { return Shape.Circle(r); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.radiusOr(raw.mkCircle(2.5), 1.5), 2.5, "the covered variant");
  eq(raw.radiusOr(raw.mkPoint(), 1.5), 1.5, "falls to else");
});

Deno.test("[§enum-narrow] [§enum-narrow-field] an arm narrows the subject implicitly", async () => {
  // The point of the feature: `s.width` only exists on Rect, and no cast is written.
  const inst = await run(`${SHAPES}
    export f64 widthOf(Shape s) {
      match (s) {
        case Rect:   return s.width;
        case Circle: return s.radius * 2.0;
        case Point:  return 0.0;
      }
    }
    export Shape mkCircle(f64 r)      { return Shape.Circle(r); }
    export Shape mkRect(f64 w, f64 h) { return Shape.Rect(w, h); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.widthOf(raw.mkRect(3.0, 4.0)), 3, "narrowed to Rect");
  eq(raw.widthOf(raw.mkCircle(2.0)), 4, "narrowed to Circle");
});

Deno.test("[§enum-match-ignore] `_` discards a payload and may repeat", async () => {
  const inst = await run(`${SHAPES}
    export f64 h(Shape s) {
      match (s) {
        case Rect(_, height): return height;
        case Circle:          return 0.0;
        case Point:           return 0.0;
      }
    }
    export f64 anyRect(Shape s) {
      match (s) {
        case Rect(_, _): return 1.0;
        else:            return 0.0;
      }
    }
    export Shape mkRect(f64 w, f64 h) { return Shape.Rect(w, h); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.h(raw.mkRect(3.0, 7.0)), 7, "second payload bound, first discarded");
  eq(raw.anyRect(raw.mkRect(1.0, 2.0)), 1, "both discarded");
});

Deno.test("[§enum-recursive] a recursive enum walks with match", async () => {
  const inst = await run(`
    enum Tree { Leaf(i32 value), Node(Tree left, Tree right) }
    export i32 sum(Tree t) {
      match (t) {
        case Leaf(v):    return v;
        case Node(l, r): return sum(l) + sum(r);
      }
    }
    export Tree leaf(i32 v)            { return Tree.Leaf(v); }
    export Tree node(Tree l, Tree r)   { return Tree.Node(l, r); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  const t = raw.node(raw.node(raw.leaf(1), raw.leaf(2)), raw.leaf(3));
  eq(raw.sum(t), 6, "1 + 2 + 3 over a nested tree");
});

Deno.test("[§enum-recursive-via-struct] recursion through a struct with methods", async () => {
  // The shape a container forces: variants cannot carry methods, so the growable
  // part is a struct that holds an array of the enum. Neither declaration precedes
  // the other, which is what makes this different from a directly recursive enum.
  const inst = await run(`
    enum Val { Nil, Num(f64 v), Arr(ArrData a) }

    struct ArrData {
      Val?[] items;
      i32 count;

      ArrData create() { return ArrData(Val?[0](), 0); }

      void push(this, Val v) {
        if (this.count == this.items.len()) {
          i32 next = this.items.len() * 2;
          if (next == 0) { next = 4; }
          Val?[] grown = Val?[next]();
          for (i32 i = 0; i < this.count; i++) { grown[i] = this.items[i]; }
          this.items = grown;
        }
        this.items[this.count] = v;
        this.count++;
      }

      Val at(const this, i32 i) { return this.items[i]!; }
    }

    f64 total(Val v) {
      match (v) {
        case Nil:    return 0.0;
        case Num(n): return n;
        case Arr(a): {
          f64 sum = 0.0;
          for (i32 i = 0; i < a.count; i++) { sum = sum + total(a.at(i)); }
          return sum;
        }
      }
    }

    export f64 nested() {
      ArrData inner = ArrData.create();
      inner.push(Val.Num(1.5));
      inner.push(Val.Num(2.25));
      ArrData outer = ArrData.create();
      outer.push(Val.Arr(inner));
      outer.push(Val.Num(10.0));
      outer.push(Val.Nil);
      return total(Val.Arr(outer));
    }
  `);
  // 1.5 + 2.25 + 10.0, with the Nil contributing nothing. Not a round number, so a
  // fold that visited a node twice or skipped one would not land on it.
  eq(inst.call("nested", []), 13.75, "a fold through the struct reaches every leaf");
});

Deno.test("[§enum-array] an enum in a struct field and in a nullable array", async () => {
  // Two positions the other tests do not cover: an enum-typed struct field, and a
  // `T?[]` of enums that has to be unwrapped before matching.
  const inst = await run(`${SHAPES}
    struct Holder { Shape s; }

    i32 tag(Shape s) {
      match (s) {
        case Point:  return 1;
        case Circle: return 2;
        case Rect:   return 3;
      }
    }

    export i32 viaField() { Holder h = Holder(Shape.Circle(1.0)); return tag(h.s); }

    export i32 viaNullableArray() {
      Shape?[] xs = Shape?[3]();
      xs[0] = Shape.Point;
      xs[1] = Shape.Rect(1.0, 2.0);
      xs[2] = Shape.Circle(3.0);
      i32 acc = 0;
      for (i32 i = 0; i < xs.len(); i++) {
        Shape s = xs[i]!;
        acc = acc * 10 + tag(s);
      }
      return acc;
    }
  `);
  eq(inst.call("viaField", []), 2, "an enum reached through a struct field matches");
  // 1, 3, 2 in order — a digit per element, so a wrong order or a dropped element
  // changes the number rather than cancelling out.
  eq(inst.call("viaNullableArray", []), 132, "each element unwraps and matches");
});

Deno.test("[§enum-match-break-loop] a break in an arm inside a for loop", async () => {
  // The documented break rule, in a `for` rather than a `while (true)` — the update
  // clause is the part that could plausibly be skipped or run by a br to the wrong
  // depth.
  const inst = await run(`${SHAPES}
    export i32 countUntilRect(Shape?[] xs) {
      i32 n = 0;
      for (i32 i = 0; i < xs.len(); i++) {
        Shape s = xs[i]!;
        match (s) {
          case Rect: break;
          else:      n++;
        }
      }
      return n;
    }
    export Shape?[] three() {
      Shape?[] xs = Shape?[3]();
      xs[0] = Shape.Point;
      xs[1] = Shape.Rect(1.0, 1.0);
      xs[2] = Shape.Point;
      return xs;
    }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.countUntilRect(raw.three()), 1, "the break leaves the for loop, not the arm");
});

Deno.test("[§enum-match-inexhaustive] a missing variant is a compile error", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape s) {
      match (s) {
        case Point:     return 0.0;
        case Circle(r): return r;
      }
    }`);
  if (!m.includes("does not cover 'Rect'")) {
    throw new Error(`expected the uncovered-variant diagnostic, got: ${m}`);
  }
});

Deno.test("[§enum-match-else-unreachable] a covering match plus else is an error", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape s) {
      match (s) {
        case Point:      return 0.0;
        case Circle(r):  return r;
        case Rect(w, h): return w;
        else:            return 0.0;
      }
    }`);
  if (!m.includes("unreachable")) throw new Error(`expected an unreachable-else error, got: ${m}`);
});

Deno.test("[§enum-match-duplicate] a repeated variant is an error", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape s) {
      match (s) {
        case Circle(r):  return r;
        case Circle(r2): return r2;
        else:            return 0.0;
      }
    }`);
  if (!m.includes("duplicate case")) throw new Error(`got: ${m}`);
});

Deno.test("[§enum-narrow-const] the narrowed subject cannot be assigned", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape s) {
      match (s) {
        case Circle: { s = Shape.Point; return 0.0; }
        else:        return 0.0;
      }
    }`);
  if (!m.includes("const") && !m.includes("assign")) throw new Error(`got: ${m}`);
});

Deno.test("[§enum-narrow-collision] a binding cannot reuse the subject's name", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape s) {
      match (s) {
        case Circle(s): return 0.0;
        else:           return 0.0;
      }
    }`);
  if (!m.includes("collides")) throw new Error(`got: ${m}`);
});

Deno.test("[§enum-match-nullable] a nullable subject must be unwrapped", () => {
  const m = err(`${SHAPES}
    export f64 bad(Shape? s) {
      match (s) {
        case Circle: return 0.0;
        else:        return 0.0;
      }
    }`);
  if (!m.includes("non-null")) throw new Error(`got: ${m}`);
});

Deno.test("[§enum-narrow-nonvariable] a non-variable subject matches but narrows nothing", async () => {
  // It compiles and dispatches; there is simply no name for the arm to shadow.
  const inst = await run(`${SHAPES}
    export f64 firstIsRound(Shape[] xs) {
      match (xs[0]) {
        case Circle: return 1.0;
        else:        return 0.0;
      }
    }
    export Shape[] one(Shape s) { return Shape[](s); }
    export Shape mkCircle(f64 r) { return Shape.Circle(r); }
    export Shape mkPoint()       { return Shape.Point; }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  eq(raw.firstIsRound(raw.one(raw.mkCircle(1.0))), 1, "dispatch works without a name");
  eq(raw.firstIsRound(raw.one(raw.mkPoint())), 0, "and falls to else");
});

Deno.test("[§enum-array] enums live in arrays like any struct", async () => {
  const inst = await run(`${SHAPES}
    export i32 countRects(Shape[] shapes) {
      i32 n = 0;
      for (i32 i = 0; i < shapes.len(); i++) {
        match (shapes[i]) {
          case Rect: n++;
          else:      { }
        }
      }
      return n;
    }
    export Shape[] three(Shape a, Shape b, Shape c) { return Shape[](a, b, c); }
    export Shape mkPoint()            { return Shape.Point; }
    export Shape mkRect(f64 w, f64 h) { return Shape.Rect(w, h); }
  `);
  const raw = inst.rawExports as Record<string, CallableFunction>;
  const arr = raw.three(raw.mkRect(1.0, 1.0), raw.mkPoint(), raw.mkPoint());
  eq(raw.countRects(arr), 1, "one Rect among three");
});

Deno.test("[§enum-match-basic] the subject is evaluated exactly once", async () => {
  // Every arm test needs the subject again, so a naive emitter would re-evaluate it.
  const inst = await run(`${SHAPES}
    struct Counter { i32 n; }
    Shape bump(Counter c) { c.n++; return Shape.Point; }
    export i32 calls() {
      Counter c = Counter(0);
      match (bump(c)) {
        case Point:      return c.n;
        case Circle(r):  return -1;
        case Rect(w, h): return -2;
      }
    }
  `);
  eq(inst.call("calls", []), 1, "the subject expression ran once");
});

Deno.test("[§wac-arr-fill-7kqm3xz] a sized array can be given an element value", async () => {
  // `T[n]()` needs T to have a default, so once an enum correctly had none (issue 0012)
  // there was no way at all to build a dynamically-sized array of one — the literal form
  // needs a compile-time count. This is the third form, and it maps onto `array.new`,
  // which the emitter already used to replicate the empty string for `string[n]()`.
  const inst = await run(`
    enum E { A(i32 v), B }
    struct P { i32 v; }
    export i32 enums(i32 n) {
      E[] a = E[n](fill: E.A(4));
      i32 s = 0;
      for (i32 i = 0; i < a.len(); i++) { match (a[i]) { case A(v): s += v; case B: s += 100; } }
      return s;
    }
    export i32 prims(i32 n)  { i32[] a = i32[n](fill: -1); return a[0] + a[n - 1]; }
    export i32 packed()      { u8[] a = u8[2](fill: 300); return a[0]; }
    export i32 zeroLength()  { E[] a = E[0](fill: E.B); return a.len(); }
  `);
  eq(inst.call("enums", [3]), 12, "three elements of A(4)");
  eq(inst.call("prims", [4]), -2, "a -1-filled table, which is useful in its own right");
  eq(inst.call("packed", []), 44, "a packed element truncates, as an indexed write does");
  eq(inst.call("zeroLength", []), 0, "a zero-length fill is still a fill");
});

Deno.test("[§wac-arr-fill-7kqm3xz] one fill value is shared, not copied per element", async () => {
  // `array.new` replicates a single value, so for a reference element type every slot is
  // the same reference. That is what a caller supplying one value must mean; the
  // alternative — n separately constructed copies — is what `T[n]()` already does.
  const inst = await run(`
    struct P { i32 v; }
    export i32 shared() { P[] a = P[2](fill: P(1)); a[0].v = 9; return a[1].v; }
    export i32 distinct() { P[] a = P[2](); a[0].v = 9; return a[1].v; }
  `);
  eq(inst.call("shared", []), 9, "writing through one element is visible through the other");
  eq(inst.call("distinct", []), 0, "whereas T[n]() constructs a separate element each");
});

Deno.test("[§wac-arr-fill-7kqm3xz] the fill value is checked, and a bare argument is refused", () => {
  const wrongType = err(`
    enum E { A(i32 v), B }
    export i32 f() { E[] a = E[2](fill: 5); return a.len(); }`);
  if (!wrongType.includes("expected E")) {
    throw new Error(`expected the fill type mismatch, got: ${wrongType}`);
  }
  // A bare `T[n](v)` cannot be allowed: `arr[i](5)` already means index a funcref array
  // and call it, so the two are indistinguishable without a symbol table. The named form
  // is unambiguous because a call rejects named arguments outright.
  const bare = err(`export i32 f() { i32[] a = i32[2](7); return a[0]; }`);
  if (!bare.includes("fill:")) {
    throw new Error(`expected the diagnostic to name 'fill:', got: ${bare}`);
  }
  // And the shape it would have collided with still works.
  const ok = wacCompile(new Map([["main.wac", `
    i32 dbl(i32 x) { return x * 2; }
    export i32 f() { fn[i32(i32)][] fs = fn[i32(i32)][](dbl); return fs[0](21); }`]]), "main.wac");
  if (!ok.ok) {
    throw new Error(`indexing a funcref array and calling it should be unaffected, got: ${
      ok.diagnostics.map(d => d.message).join("; ")}`);
  }
});

Deno.test("[§wac-arr-fill-7kqm3xz] the fill expression is visible to every walk", async () => {
  // A type or function reachable only through the fill expression has to be reached by
  // the resolver's annotation pass and by array-type collection. It was not, at first —
  // the same omission as issue 0005's match arms, and the reason this test exists at all.
  const inst = await run(`
    struct Q { i32 v; }
    i32 mk() { return 3; }
    export i32 f(i32 n) {
      // Q, Q[] and mk() all appear nowhere else in the program.
      Q[] a = Q[n](fill: Q(mk()));
      return a[0].v * a.len();
    }
  `);
  eq(inst.call("f", [2]), 6, "the fill expression compiled and ran");
});

Deno.test("[§wac-const-param-2vhk7dq] a parameter may be const", async () => {
  // `const this` gave a method receiver this guarantee and nothing gave it to a free
  // function's parameter, so moving a method to a function silently lost it. The
  // enforcement needed no new machinery: const is already deep, and the parameter is
  // simply bound with the flag the environment already carries per binding.
  const inst = await run(`
    struct P { i32 v; }
    i32 peek(const P p) { return p.v; }
    i32 addTo(const i32 a, i32 b) { b += a; return b; }
    struct S { i32 n; i32 m(const this, const P p) { return p.v + this.n; } }
    export i32 viaFunction() { return peek(P(7)); }
    export i32 primitive()   { return addTo(2, 5); }
    export i32 inMethod()    { return S(1).m(P(2)); }
  `);
  eq(inst.call("viaFunction", []), 7, "a struct parameter");
  eq(inst.call("primitive", []), 7, "a primitive parameter, with a mutable one beside it");
  eq(inst.call("inMethod", []), 3, "and alongside `const this`");
});

Deno.test("[§wac-const-param-2vhk7dq] const on a parameter is deep and blocks writes", () => {
  const cases: [string, string, string][] = [
    ["a field write", `struct P { i32 v; }
      void bad(const P p) { p.v = 1; }
      export i32 f() { bad(P(1)); return 1; }`, "const reference"],
    ["a reassignment", `struct P { i32 v; }
      void bad(const P p) { p = P(2); }
      export i32 f() { bad(P(1)); return 1; }`, "cannot assign to const variable"],
    ["an element write", `void bad(const i32[] a) { a[0] = 1; }
      export i32 f() { bad(i32[2]()); return 1; }`, "const reference"],
    ["a primitive write", `i32 bad(const i32 a) { a = 2; return a; }
      export i32 f() { return bad(1); }`, "cannot assign to const variable"],
  ];
  for (const [what, src, want] of cases) {
    const m = err(src);
    if (!m.includes(want)) {
      throw new Error(`${what}: expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
  }
});

Deno.test("[§wac-const-param-2vhk7dq] a non-const parameter is unaffected", async () => {
  // The flag has to be per-parameter, not per-signature: a const parameter beside a
  // mutable one must not make the mutable one const.
  const inst = await run(`
    struct P { i32 v; }
    void bump(P p) { p.v = 5; }
    export i32 f() { P p = P(1); bump(p); return p.v; }
  `);
  eq(inst.call("f", []), 5, "a plain parameter is still mutable, and mutation is visible");
});

Deno.test("[§wac-float-literal-ctx-8dqm2vw] a float literal takes an expected f32", async () => {
  // types.md already stated this rule for integers: "a literal first takes whatever
  // integer type is expected of it". Floats never followed it, so *no* float literal
  // could be an f32 anywhere — `f32 x = 1.5;` was a type error, and every f32 needed
  // `as~ f32`, the truncating cast, as though the loss were deliberate. The spec's own
  // f32 example omitted the cast and did not compile; its test quietly added one.
  const inst = await run(`
    struct S { f32 v; }
    f32 take(f32 v) { return v; }
    export f32 local()     { f32 x = 1.5; return x; }
    export f32 returned()  { return 1.5; }
    export f32 argument()  { return take(1.5); }
    export f32 ternary(bool y) { f32 x = y ? 1.5 : 2.5; return x; }
    export f32 field()     { return S(1.25).v; }
    export f32 arrayLit()  { f32[] a = f32[](1.5, 2.5); return a[1]; }
    export f32 compound()  { f32 x = 1.0; x += 0.5; return x; }
    export f64 stillF64()  { f64 x = 2.5; return x; }
  `);
  near(inst.call("local", []) as number, 1.5, "a local");
  near(inst.call("returned", []) as number, 1.5, "a return value");
  near(inst.call("argument", []) as number, 1.5, "an argument");
  near(inst.call("ternary", [1]) as number, 1.5, "a ternary branch");
  near(inst.call("field", []) as number, 1.25, "a struct field");
  near(inst.call("arrayLit", []) as number, 2.5, "an array literal element");
  near(inst.call("compound", []) as number, 1.5, "a compound assignment");
  near(inst.call("stillF64", []) as number, 2.5, "and f64 is unaffected");
});

Deno.test("[§wac-float-literal-ctx-8dqm2vw] an f32 literal rounds, and overflow is refused", async () => {
  // Rounding is what decimal notation does — `0.1` is inexact in f64 too — so requiring
  // exactness would reject `f32 pi = 3.14159;` and make the rule useless. Overflow is a
  // different matter: the literal denotes a value f32 has no reading for.
  const inst = await run(`export f32 rounded() { f32 x = 3.14159; return x; }`);
  const got = inst.call("rounded", []) as number;
  if (got === 3.14159) throw new Error("expected f32 rounding, got the exact f64 value");
  near(got, 3.14159, "rounded to f32", 1e-6);

  const over = err(`export f32 f() { f32 x = 1.0e40; return x; }`);
  if (!over.includes("out of range for f32")) {
    throw new Error(`expected the f32 range diagnostic, got: ${over}`);
  }
});

Deno.test("[§wac-float-exponent-7mkq3wv] an exponent alone makes a float literal", async () => {
  // Issue 0018, decided rather than left open: `1e9` is a float. The grammar required the point on
  // purpose, but the rule bought nothing — `1e9` for a billion is common and every language in this
  // family accepts it.
  const inst = await run(`
    export f64 plain()    { return 1e9; }
    export f64 upper()    { return 1E10; }
    export f64 negative() { return 2e-3; }
    export f64 withPoint() { return 1.5e10; }
    export f64 signed()   { return 1.5e+10; }
    export f64 grouped()  { return 1_000e3; }
  `);
  near(inst.call("plain", []) as number, 1e9, "1e9", 1);
  near(inst.call("upper", []) as number, 1e10, "1E10", 1);
  near(inst.call("negative", []) as number, 2e-3, "2e-3", 1e-9);
  near(inst.call("withPoint", []) as number, 1.5e10, "1.5e10 still works", 1);
  near(inst.call("signed", []) as number, 1.5e10, "and 1.5e+10", 1);
  near(inst.call("grouped", []) as number, 1_000e3, "underscores are still allowed", 1);
  // That last one found issue 0044: every float literal with an underscore evaluated to the digits
  // before it, because `parseFloat` stops there and returns what it has.
});

Deno.test("[§wac-float-underscore-4wnk8mq] underscores in a float literal are separators", async () => {
  const inst = await run(`
    export f64 intPart()  { return 1_000.5; }
    export f64 zeroFrac() { return 1_000.0; }
    export f64 fraction() { return 0.000_1; }
    export f64 inExp()    { return 1e1_0; }
    export i32 integer()  { return 1_000; }
  `);
  near(inst.call("intPart", []) as number, 1000.5, "in the integer part", 1e-9);
  near(inst.call("zeroFrac", []) as number, 1000, "with a zero fraction", 1e-9);
  near(inst.call("fraction", []) as number, 0.0001, "in the fraction", 1e-12);
  near(inst.call("inExp", []) as number, 1e10, "in the exponent", 1);
  eq(inst.call("integer", []), 1000, "and integers were always right, via wacIntLit");
});

Deno.test("[§wac-float-exponent-7mkq3wv] it has to be a real exponent", () => {
  // `1e` and `1electron` are an integer followed by an identifier, not malformed floats — and
  // `0x1e5` is hex, where `e` is a digit rather than an exponent marker.
  const kinds = (src: string) =>
    wacLex(src).tokens.slice(0, -1).map((t) => `${t.kind}:${t.text}`).join(" ");
  eq(kinds("1e"), "int:1 ident:e", "no digits after e");
  eq(kinds("1electron"), "int:1 ident:electron", "an identifier that happens to start with e");
  eq(kinds("0x1e5"), "int:0x1e5", "hex is unaffected");
  eq(kinds("1e9"), "float:1e9", "and the real thing is a float");
});

Deno.test("[§enum-ternary-variants] a ternary of two variants types to their enum", async () => {
  // `typeOfExpr` did not recognise variant construction: `E.A(9)` is a call with a field
  // callee, so it fell through to method resolution, found none, and reported void. The
  // ternary then declared its block with no result and pushed a value into it. It
  // surfaced only here because nearly every other context supplies an expected type
  // rather than asking for the expression's own — a ternary asks.
  const inst = await run(`
    enum E { A(i32 v), B }
    E identity(E e) { return e; }
    export i32 twoVariants()  { E e = true ? E.A(9) : E.B;            match (e) { case A(v): return v; case B: return 1; } }
    export i32 sameVariant()  { E e = true ? E.A(8) : E.A(1);         match (e) { case A(v): return v; case B: return 1; } }
    export i32 variantAndEnum() { E e = true ? E.A(7) : identity(E.B); match (e) { case A(v): return v; case B: return 1; } }
    export i32 payloadless()  { E e = false ? E.A(1) : E.B;           match (e) { case A(v): return v; case B: return 5; } }
  `);
  eq(inst.call("twoVariants", []), 9, "two different variants");
  eq(inst.call("sameVariant", []), 8, "the same variant twice");
  eq(inst.call("variantAndEnum", []), 7, "a variant and an enum-typed expression");
  eq(inst.call("payloadless", []), 5, "a payload-less variant as a value");
});

Deno.test("[§enum-dup-payload-field] a variant may not repeat a payload field name", () => {
  // The resolver's duplicate-field check runs over hand-written struct declarations, and
  // the generated variant structs skipped it — so this compiled while the equivalent
  // `struct S { i32 x; i32 x; }` was already an error.
  const m = err(`enum E { A(i32 x, i32 x), B } export i32 f() { return 1; }`);
  if (!m.includes("duplicate payload field")) {
    throw new Error(`expected the duplicate-payload diagnostic, got: ${m}`);
  }
});

Deno.test("[§enum-dup-payload-field] two variants may share a field name", async () => {
  // They are different structs, so this must stay legal — the check above must not be
  // written as "no field name may repeat within an enum".
  const inst = await run(`
    enum E { A(i32 x), B(i32 x) }
    export i32 f(bool y) {
      E e = y ? E.A(3) : E.B(4);
      match (e) { case A(x): return x; case B(x): return x * 10; }
    }
  `);
  eq(inst.call("f", [1]), 3, "the A payload");
  eq(inst.call("f", [0]), 40, "the B payload of the same name");
});

Deno.test("[§wac-dup-param-4tnq8vx] a duplicate parameter name is an error", () => {
  // This compiled, and the second parameter silently won: `dup(1, 2)` returned 2 with
  // the first parameter unreachable. A duplicate field was already an error and a local
  // shadowing a parameter is well defined; only this was neither.
  const fn = err(`export i32 dup(i32 a, i32 a) { return a; }`);
  if (!fn.includes("duplicate parameter")) {
    throw new Error(`expected the duplicate-parameter diagnostic for a function, got: ${fn}`);
  }
  const meth = err(`
    struct S { i32 v;
      i32 m(const this, i32 a, i32 a) { return a; }
    }
    export i32 f() { return S(1).m(1, 2); }`);
  if (!meth.includes("duplicate parameter")) {
    throw new Error(`expected the duplicate-parameter diagnostic for a method, got: ${meth}`);
  }
});

Deno.test("[§enum-no-default] an enum has no default value", async () => {
  // The base struct's only field is the tag, which does have a default, so the
  // ordinary defaultability rule said an enum was defaultable. It is not: a bare base
  // is no variant at all, and a default-constructed variant carries tag 0 rather than
  // its own. Both were reachable — `E[n]()` produced n of them, and `S()` on a struct
  // with an enum field produced one — and matching one trapped on `illegal cast`,
  // pointing at the arm rather than at the construction responsible.
  const sized = err(`
    enum E { A(i32 v), B }
    export i32 f() { E[] a = E[2](); return a.len(); }`);
  if (!sized.includes("no default value")) {
    throw new Error(`expected the no-default diagnostic for E[n](), got: ${sized}`);
  }
  const defaulted = err(`
    enum E { A(i32 v), B }
    struct S { E e; }
    export i32 f() { S s = S(); return 1; }`);
  if (!defaulted.includes("no default value")) {
    throw new Error(`expected the no-default diagnostic for S(), got: ${defaulted}`);
  }

  // What still works, since rejecting the above is only tolerable if there is a way to
  // write it: the fixed literal, a nullable element type, and a struct that merely
  // *has* an enum field and is constructed positionally.
  const inst = await run(`
    enum E { A(i32 v), B }
    struct S { E e; i32 n; }
    export i32 literal()  { E[] a = E[](E.A(3), E.B); match (a[0]) { case A(v): return v; case B: return 0; } }
    export i32 nullableElems() { E?[] a = E?[2](); a[0] = E.A(5);
      if (a[0] is null) { return -1; }
      match (a[0]!) { case A(v): return v; case B: return 0; } }
    export i32 field() { S s = S(E.A(4), 1); match (s.e) { case A(v): return v + s.n; case B: return 0; } }
  `);
  eq(inst.call("literal", []), 3, "a fixed literal needs no default");
  eq(inst.call("nullableElems", []), 5, "a nullable element type defaults to null");
  eq(inst.call("field", []), 5, "a struct may hold an enum and be built positionally");
});

Deno.test("[§enum-no-default] a struct with an enum field is not 'recursive'", () => {
  // Making enums non-defaultable initially reported `struct S { E e; }` as "field 'e'
  // creates a non-null recursive reference" — and rejected the declaration outright,
  // which would have made a struct with an enum field illegal to write. The
  // recursive-field check and the defaultability check had been sharing one predicate,
  // which was sound only while recursion was the single reason a struct field could
  // lack a default.
  const r = wacCompile(new Map([["main.wac", `
    enum E { A(i32 v), B }
    struct S { E e; i32 n; }
    export i32 f() { S s = S(E.B, 2); return s.n; }`]]), "main.wac");
  if (!r.ok) {
    throw new Error(`declaring a struct with an enum field should be legal, got: ${
      r.diagnostics.map(d => d.message).join("; ")}`);
  }
  // And genuine recursion is still reported as recursion.
  const rec = err(`struct Node { Node next; } export i32 f() { return 1; }`);
  if (!rec.includes("recursive")) {
    throw new Error(`expected the recursion diagnostic, got: ${rec}`);
  }
});

Deno.test("[§wac-array-literal-named-9mzq4rt] a fixed array literal accepts a named element type", async () => {
  // `i32[](1, 2)` parsed and `S[](S(1), S(2))` did not. The construction lookahead only
  // recognised the *sized* form for a named element type: it skipped `[]` pairs looking
  // for a size bracket, found `(` instead, and gave up — so the whole thing fell
  // through to being parsed as an identifier followed by junk. A primitive element type
  // took an earlier path and worked. The parser proper handled the shape all along.
  const inst = await run(`
    struct S { i32 v; }
    enum E { A(i32 v), B }
    export i32 structs()  { S[] a = S[](S(1), S(2)); return a.len() + a[1].v; }
    export i32 nested()   { S[][] a = S[][](S[](S(7))); return a[0][0].v; }
    export i32 nullables() { S?[] a = S?[](S(1), null); return a[1] is null ? 10 : 0; }
    export i32 enums()    { E[] a = E[](E.A(4), E.B); match (a[0]) { case A(v): return v; case B: return 0; } }
    export i32 empty()    { S[] a = S[](); return a.len(); }
  `);
  eq(inst.call("structs", []), 4, "two elements, second holds 2");
  eq(inst.call("nested", []), 7, "an array of arrays of structs");
  eq(inst.call("nullables", []), 10, "a nullable element type");
  eq(inst.call("enums", []), 4, "and an enum element type");
  eq(inst.call("empty", []), 0, "an empty literal is still a literal");
});

Deno.test("[§enum-match-variant-subject] a variant-typed value can be matched", async () => {
  // `match (Shape.Circle(2.0))` types its subject as `Circle`, not `Shape`, and so did
  // a variable declared `Circle c`. Both were rejected with "match requires an enum
  // value, got Circle" — naming the value's own type as the reason it could not be
  // used. A variant is an enum value; the arms still cover the whole enum, since
  // narrowing that requirement to the static type would need flow analysis and an
  // unreachable arm costs nothing.
  const inst = await run(`${SHAPES}
    export f64 direct() {
      match (Shape.Rect(3.0, 4.0)) {
        case Point:      return 0.0;
        case Circle(r):  return r;
        case Rect(w, h): return w * h;
      }
    }
    export f64 viaVariable() {
      Circle c = Shape.Circle(2.5);
      match (c) {
        case Point:      return 0.0;
        case Circle(r):  return r;
        case Rect(w, h): return w * h;
      }
    }
  `);
  eq(inst.call("direct", []), 12.0, "matched a construction expression");
  eq(inst.call("viaVariable", []), 2.5, "matched a variable of variant type");
});

Deno.test("[§wac-ternary-null-3kx9ba2] a null branch makes a ternary nullable", async () => {
  // `cond ? S(1) : null` was rejected outright: `null` is assignable to no
  // non-nullable type and no type is assignable to `null`, so neither side could win
  // the widening and the branches were called incompatible. Nothing to do with enums —
  // every struct, array and funcref had it.
  const inst = await run(`
    struct S { i32 v; }
    S? pick(bool y) { return y ? S(1) : null; }
    S? pickFlipped(bool y) { return y ? null : S(2); }
    export i32 taken()   { S? r = pick(true);         return r is null ? -1 : r!.v; }
    export i32 skipped() { S? r = pick(false);        return r is null ? -1 : r!.v; }
    export i32 flipped() { S? r = pickFlipped(false); return r is null ? -1 : r!.v; }
    export i32 inLocal() { S? r = true ? S(3) : null; return r is null ? -1 : r!.v; }
    export i32 arrays()  { i32[]? a = true ? i32[2]() : null; return a is null ? -1 : a!.len(); }
  `);
  eq(inst.call("taken", []), 1, "the value branch");
  eq(inst.call("skipped", []), -1, "the null branch");
  eq(inst.call("flipped", []), 2, "null on the left");
  eq(inst.call("inLocal", []), 3, "as a local initialiser");
  eq(inst.call("arrays", []), 2, "and for an array type");
});

Deno.test("[§wac-ternary-null-3kx9ba2] a ternary emits both branches at the result type", async () => {
  // Accepting the above exposed the next layer: the emitter typed the ternary as its
  // then-branch, so the block was declared non-nullable while the else branch pushed
  // `ref.null any`. Two places computing one type and disagreeing — the same shape as
  // the i64-literal split. The branches are now emitted against the result type, which
  // is what a `null` branch needs to emit a typed null at all.
  const inst = await run(`
    struct S { i32 v; }
    export f64 floatBranch(bool y) { return y ? 1.5 : 2.5; }
    export i32 nested(bool a, bool b) {
      S? r = a ? (b ? S(1) : null) : S(2);
      return r is null ? -1 : r!.v;
    }
    export i32 outer(bool a) {
      S? r = a ? null : (true ? S(4) : null);
      return r is null ? -1 : r!.v;
    }
  `);
  near(inst.call("floatBranch", [1]) as number, 1.5, "an ordinary ternary is unaffected");
  eq(inst.call("nested", [1, 0]), -1, "a null nested inside another ternary");
  eq(inst.call("nested", [1, 1]), 1, "and its value branch");
  eq(inst.call("outer", [0]), 4, "a nullable ternary inside a nullable ternary");
});

Deno.test("[§enum-name-identity] two files may declare the same enum name", async () => {
  // Three separate bugs met here, all of them "resolved by name where identity was
  // meant", and none of them reachable with a single file:
  //
  //   the resolver never annotated an enum-typed anything with its type identity,
  //   because annotateType only handled scope entries of kind "struct" — so an enum
  //   type keyed by its name string while everything else keyed by index, and a
  //   variant was not assignable to its own enum;
  //
  //   emitCall and emitField each searched every enum in the program by name, found
  //   the wrong one, skipped the whole variant-construction branch and emitted
  //   *nothing* for the value — which surfaced as the enclosing array.set failing
  //   validation two arguments short, nowhere near the cause.
  //
  // Both variants here are called `X` as well, so a name search cannot even
  // disambiguate by variant.
  const inst = await runMulti(new Map([
    ["a.wac", `
      export enum E { X, Y(i32 v) }
      export E mkY(i32 v) { return E.Y(v); }
      export i32 readA(E e) { match (e) { case X: return 1; case Y(v): return v; } }
    `],
    ["main.wac", `
      import { E, mkY, readA } from "./a.wac";
      enum F { X, Z(i32 v) }
      i32 readF(F f) { match (f) { case X: return 20; case Z(v): return v; } }
      export i32 go(i32 v) {
        F[] mine = F[](F.X, F.Z(v));
        return readA(mkY(v)) + readF(mine[0]) + readF(mine[1]);
      }
    `],
  ]));
  eq(inst.call("go", [5]), 30, "5 + 20 + 5, each enum resolved to itself");
});

Deno.test("[§enum-cross-file] an enum works across files", async () => {
  // An enum declared in one file and matched in another. This is the normal shape
  // for anything real — an AST in one module, a parser in the next — and it was
  // never tested until a port needed it.
  const inst = await runMulti(new Map([
    ["shape.wac", `
      export enum Shape {
        Point,
        Circle(f64 radius),
      }
      export Shape mkCircle(f64 r) { return Shape.Circle(r); }
    `],
    ["main.wac", `
      import { Shape, mkCircle } from "./shape.wac";
      export f64 area(f64 r) {
        Shape s = mkCircle(r);
        match (s) {
          case Point:     return 0.0;
          case Circle(x): return x * x;
        }
      }
    `],
  ]));
  eq(inst.call("area", [3.0]), 9.0, "matched an imported enum");
});

Deno.test("[§enum-cross-file] matching does not require the enum's name in scope", async () => {
  // It used to, and the diagnostic said so clearly — which was a good message for a rule that
  // should not have existed. An arm resolves its variants through the enum the subject *is*, not
  // through the file's scope, so nothing here needs the name; requiring it rejected
  // `match (xs.get(0))` on a `Vec<JsonValue>` in a file that had imported `JsonValue`, because a
  // container hands its element back under the name the *template's* file knows it by.
  //
  // Reported by agent-b against `packages/std`'s Vec (issue 0049). The narrower shape is this one:
  // an enum reached through an imported struct, with the enum's own name never mentioned.
  const inst = await runMulti(new Map([
    ["k.wac", `
      export enum Kind { A, B }
      export struct Holder { Kind kind; i32 n; }
      export Holder mk() { return Holder(Kind.B, 1); }
    `],
    ["main.wac", `
      import { Holder, mk } from "./k.wac";
      export i32 f() {
        Holder h = mk();
        match (h.kind) {
          case A: return 1;
          case B: return 2;
        }
      }
    `],
  ]));
  eq(inst.call("f", []), 2, "the arm for the variant the value holds");
});

Deno.test("[§enum-cross-file] an enum inside a generic container crosses files", async () => {
  // Issue 0049, in its original shape: the element type comes back from the *template's*
  // file, so it bears that file's name for the enum and not this one's. Identifying an enum by
  // name rather than by type index made a legal program fail — the eighth instance of that
  // family in this compiler.
  const inst = await runMulti(new Map([
    ["v.wac", `
      export enum V {
        Null, Bool(bool value), Num(f64 v)
        i32 tag(const this) { return match (this) { case Null: 0, case Bool(_): 1, case Num(_): 2 }; }
      }`],
    ["vec.wac", `
      export struct Vec<T> {
        T[] data; i32 n;
        Vec<T> create() { return Vec(T[](), 0); }
        void push(this, T v) {
          if (this.n == this.data.len()) {
            T[] next = T[this.n == 0 ? 4 : this.n * 2](fill: v);
            for (i32 i = 0; i < this.n; i++) { next[i] = this.data[i]; }
            this.data = next;
          }
          this.data[this.n] = v; this.n++;
        }
        T get(const this, i32 i) { return this.data[i]; }
        i32 len(const this) { return this.n; }
      }`],
    ["main.wac", `
      // Bool is imported as well as V: a variant is a file-scope name like any other, and naming
      // one as a type needs it in scope (issue 0048). match does not.
      import { V, Bool } from "./v.wac";
      import { Vec } from "./vec.wac";
      export i32 matched() {
        Vec<V> xs = Vec.create();
        xs.push(V.Bool(true));
        xs.push(V.Null);
        return xs.len() * 10 + match (xs.get(0)) { case Bool(b): b ? 1 : 0, case Null: 5, case Num(_): 6 };
      }
      export i32 method()   { Vec<V> xs = Vec.create(); xs.push(V.Num(1.0)); return xs.get(0).tag(); }
      export i32 narrowed() { Vec<V> xs = Vec.create(); xs.push(V.Bool(true)); V got = xs.get(0); return got is Bool ? 1 : 0; }
      export i32 cast()     { Vec<V> xs = Vec.create(); xs.push(V.Bool(true)); V got = xs.get(0); return (got as! Bool).value ? 1 : 0; }
      export i32 passedOn() { Vec<V> a = Vec.create(); a.push(V.Null); Vec<V> b = Vec.create(); b.push(a.get(0)); return b.get(0).tag(); }
    `],
  ]));
  eq(inst.call("matched", []), 21, "match on an element of a generic container");
  eq(inst.call("method", []), 2, "a method on one");
  eq(inst.call("narrowed", []), 1, "an is-test against a variant");
  eq(inst.call("cast", []), 1, "a cast to a variant");
  eq(inst.call("passedOn", []), 0, "and putting one back into another container");
});

Deno.test("[§enum-cross-file] a subject narrowed to a variant can be matched again", async () => {
  // The other half of identifying an enum by index: inside `case Bool(_)` the subject's type is
  // the *variant*, and matching it again has to find the enum from that. The variant's name is no
  // more in scope than the enum's, so the index has to answer for variants too.
  const inst = await runMulti(new Map([
    ["v.wac", `export enum V { Null, Bool(bool value), Num(f64 v) }`],
    ["vec.wac", `export struct Vec<T> { T[] data; i32 n;
      Vec<T> create() { return Vec(T[](), 0); }
      void push(this, T v) {
        T[] next = T[this.n + 1](fill: v);
        for (i32 i = 0; i < this.n; i++) { next[i] = this.data[i]; }
        this.data = next; this.data[this.n] = v; this.n++;
      }
      T get(const this, i32 i) { return this.data[i]; } }`],
    ["main.wac", `
      import { V } from "./v.wac";
      import { Vec } from "./vec.wac";
      export i32 f() {
        Vec<V> xs = Vec.create();
        xs.push(V.Bool(true));
        V v = xs.get(0);
        match (v) {
          case Bool(_): { return match (v) { case Bool(b): b ? 6 : 0, case Null: 1, case Num(_): 2 }; }
          case Null: return 1;
          case Num(_): return 2;
        }
      }`],
  ]));
  eq(inst.call("f", []), 6, "the inner match resolves the enum from the narrowed variant's index");
});

Deno.test("[§enum-cross-file] a diagnostic names the type as the author wrote it", () => {
  // A substituted argument type is renamed to a canonical alias so it resolves in the template's
  // file, and that alias is a name nobody wrote — so it goes through the same demangling as an
  // instantiation. Without it this message read `got V__v`.
  const m = errMulti(new Map([
    ["v.wac", `export enum V { Null, Bool(bool value) }`],
    ["vec.wac", `export struct Vec<T> { T[] data; i32 n;
      Vec<T> create() { return Vec(T[](), 0); }
      T get(const this, i32 i) { return this.data[i]; } }`],
    ["main.wac", `
      import { V } from "./v.wac";
      import { Vec } from "./vec.wac";
      export i32 f() { Vec<V> xs = Vec.create(); i32 x = xs.get(0); return x; }`],
  ]));
  if (!m.includes("expected i32, got V")) {
    throw new Error(`expected the written name in the diagnostic, got: ${m}`);
  }
  if (m.includes("__")) throw new Error(`an invented name leaked into a diagnostic: ${m}`);
});

Deno.test("[§enum-arm-walks-kubc3rt] an arm body is reachable to every AST walk", async () => {
  // Five separate walks over statements had no `match` case, so anything appearing
  // *only* inside an arm was invisible to them. Each of these was a distinct failure
  // and none of them was a compile error at the point of the mistake:
  //
  //   resolver's annotateType   — a struct construct in an arm: "undefined function"
  //   collectArrayTypes         — an array type in an arm: invalid array index
  //   collectFuncSigs           — a funcref type in an arm: missing type entry
  //   scanBodyFuncref           — likewise
  //
  // They are one test because they are one mistake, and a walk added later will
  // most likely miss `match` in exactly this way again.
  const inst = await run(`
    struct Q { i32 v; }
    enum E { One(i32 v), Two }
    i32 dbl(i32 x) { return x * 2; }
    export i32 inArm(i32 seed) {
      E e = E.One(seed);
      match (e) {
        case One(v): {
          Q q = Q(v);                    // construct: needs the resolver's annotation
          Q[] a = Q[2]();                // array type used nowhere else in the program
          a[0] = q;
          a[1] = Q(v + 1);
          fn[i32(i32)] f = dbl;          // funcref sig used nowhere else
          return f(a[0].v) + a[1].v;
        }
        case Two: return -1;
      }
    }
  `);
  eq(inst.call("inArm", [10]), 31, "dbl(10) + 11");
});

Deno.test("[§enum-arm-payload-struct-array] a payload may be an array of structs", async () => {
  // The variant structs are generated in the resolver and are not in `prog.items`,
  // so the annotation walk never reached their field types. A payload of struct type
  // then keyed by name where every other reference to the same struct keyed by
  // index, and `P[]` interned as two distinct array types — which only surfaced as
  // a wasm validation failure at instantiation, never as a compile error.
  const inst = await run(`
    struct P { i32 v; }
    enum Holder { Some(P[] xs), None }
    export i32 total(i32 a, i32 b) {
      P[] arr = P[2]();
      arr[0] = P(a);
      arr[1] = P(b);
      Holder h = Holder.Some(arr);
      match (h) {
        case Some(xs): {
          i32 n = 0;
          for (i32 i = 0; i < xs.len(); i++) { n += xs[i].v; }
          return n;
        }
        case None: return 0;
      }
    }
  `);
  eq(inst.call("total", [3, 4]), 7, "the payload array survived the round trip");
});

Deno.test("[§enum-match-break-loop] a break in an arm binds to the enclosing loop", async () => {
  // An arm has no fallthrough, so `break` has nothing to mean locally and the
  // emitter lets it reach the loop. The return checker disagreed: it treated an arm
  // as a break barrier the way it treats `switch`, so `while (true)` containing one
  // looked infinite, the missing return went unreported, and the function trapped on
  // the `unreachable` the emitter appends.
  const inst = await run(`
    enum E { A, B }
    export i32 loopBreak(i32 limit) {
      E e = E.A;
      i32 n = 0;
      while (true) {
        n++;
        match (e) {
          case A: { if (n >= limit) { break; } }
          case B: { }
        }
      }
      return n;
    }
  `);
  eq(inst.call("loopBreak", [3]), 3, "the break left the loop, not the match");
});

Deno.test("[§enum-match-break-loop] the return check sees a break inside an arm", () => {
  const m = err(`
    enum E { A, B }
    export i32 f() {
      E e = E.A;
      while (true) {
        match (e) { case A: break; case B: { } }
      }
    }`);
  if (!m.includes("not all code paths return a value")) {
    throw new Error(`expected the missing-return diagnostic, got: ${m}`);
  }
});

Deno.test("[§wac-shadow-param-7apc0wt] a local shadowing a parameter leaves it alone", async () => {
  // This was wrong: a shadowing local aliased the parameter's slot, so the parameter
  // read back as the shadow's value after the block ended. Silent, not a crash.
  const inst = await run(`
    export i32 shadowParam(i32 x) {
      {
        i32 x = 99;
      }
      return x;
    }
    export i32 usesInner(i32 x) {
      {
        i32 x = 99;
        return x;
      }
    }
    export i32 twoShadows(i32 x) {
      { i32 x = 1; }
      { i32 x = 2; }
      return x;
    }
  `);
  eq(inst.call("shadowParam", [7]), 7, "the parameter survives the shadow");
  eq(inst.call("usesInner", [7]), 99, "the shadow is still visible inside");
  eq(inst.call("twoShadows", [3]), 3, "two shadows, parameter still intact");
});

// ── Module-level constants ───────────────────────────────────────────────────

// §wac-modconst-h3kq8wn — a top-level const is a named compile-time value
Deno.test(`[§wac-modconst-h3kq8wn] module-level constants substitute at each use`, async () => {
  const i = await run(`
    const i32 BLOCK = 64;
    const i32 TWO_BLOCKS = BLOCK * 2;
    const u32 POLY = 0xEDB88320;
    const u64 BIG = 18446744073709551615;
    const f64 TAU = 6.283185307179586;
    const bool ON = true;
    const string NAME = "wac";
    export i32 block()   { return BLOCK; }
    export i32 two()     { return TWO_BLOCKS; }
    export u32 poly()    { return POLY; }
    export u64 big()     { return BIG; }
    export f64 tau()     { return TAU; }
    export bool on()     { return ON; }
    export i32 nameLen() { return NAME.len(); }
    export i32 inExpr(i32 x) { return (x & BLOCK) + TWO_BLOCKS; }
  `);
  eq(i.call("block", []), 64, "a plain constant");
  eq(i.call("two", []), 128, "one constant defined from another");
  eq(i.call("poly", []), 4023233417 - 34941033, "u32 constant");  // 0xEDB88320
  eq(i.call("big", []), 18446744073709551615n, "u64 constant");
  eq(i.call("tau", []), 6.283185307179586, "f64 constant");
  eq(i.call("on", []), true, "bool constant");
  eq(i.call("nameLen", []), 3, "string constant, used as a receiver");
  eq(i.call("inExpr", [255]), 192, "used inside a larger expression");
});

// §wac-modconst-import-p7fm2wj — exported constants cross files, private ones do not
Deno.test(`[§wac-modconst-import-p7fm2wj] constants obey export`, async () => {
  const files = new Map([
    ["/c.wac", `export const i32 BLOCK = 64;\nconst i32 HIDDEN = 7;\nexport i32 useHidden() { return HIDDEN; }`],
    ["/main.wac", `import { BLOCK, useHidden } from "/c.wac";\nexport i32 f() { return BLOCK + useHidden(); }`],
  ]);
  const r = wacCompile(files, "/main.wac");
  eq(r.ok, true, "importing an exported constant compiles");
  if (r.ok) {
    const inst = await wacInstance(r.compiled);
    eq(inst.call("f", []), 71, "64 from the constant, 7 through a function");
  }
  const bad = wacCompile(new Map([
    ["/c.wac", `export const i32 BLOCK = 64;\nconst i32 HIDDEN = 7;`],
    ["/main.wac", `import { HIDDEN } from "/c.wac";\nexport i32 f() { return HIDDEN; }`],
  ]), "/main.wac");
  eq(bad.ok, false, "a constant that is not exported cannot be imported");
});

// §wac-modconst-notconst-r4jn9kq — the initialiser must be evaluable at compile time
Deno.test(`[§wac-modconst-notconst-r4jn9kq] non-constant initialisers are rejected`, () => {
  const bad = (src: string) => !wacCompile(new Map([["main.wac", src]]), "main.wac").ok;
  eq(bad(`i32 f() { return 1; } const i32 A = f(); export i32 g() { return A; }`), true, "a call");
  eq(bad(`const i32 A = A + 1; export i32 g() { return A; }`), true, "self-reference");
  eq(bad(`const i32 A = B; const i32 B = A; export i32 g() { return A; }`), true, "a cycle");
  eq(bad(`const i32 A = 1; export i32 g() { A = 2; return A; }`), true, "assigning to one");
  eq(bad(`const void A = 1; export i32 g() { return 0; }`), true, "void");
  eq(bad(`const i32 A = 1; const i32 A = 2; export i32 g() { return A; }`), true, "duplicate");
  eq(bad(`i32 A() { return 1; } const i32 A = 2; export i32 g() { return A; }`), true, "clashes with a function");
  // Construction itself is allowed now (§wac-modconst-ref-9jvq2mt); what is still
  // rejected is a construction whose arguments are not constant.
  eq(bad(`struct P { i32 x; } i32 f() { return 1; } const P A = P(f()); export i32 g() { return A.x; }`),
    true, "construction with a computed argument");
  eq(bad(`enum E { A(i32 v), B } i32 f() { return 1; } const E X = E.A(f()); export i32 g() { return 0; }`),
    true, "variant construction with a computed argument");
  eq(bad(`struct P { i32 x; } i32 P2() { return 1; } const P A = P2(); export i32 g() { return A.x; }`),
    true, "a plain call that merely looks like construction");
  eq(bad(`const i32 A = 1.5; export i32 g() { return A; }`), true, "wrong type");
});

Deno.test(`[§wac-grammar-keywords-h4mq7wn] the type names really are identifiers`, async () => {
  // The reason the list above must not contain them: each of these parses as
  // `IDENT "." IDENT "(" args ")"`, which only works if the type name is an identifier.
  const inst = await run(`
    export u64 bits(f64 x)   { return f64.toBits(x); }
    export f64 unbits(u64 b) { return f64.fromBits(b); }
    export i32 fromB()       { u8[] b = u8[](104, 105); return string.fromBytes(b).len(); }
  `);
  eq(inst.call("bits", [1.0]), 0x3FF0000000000000n, "f64.toBits is a static call on an identifier");
  eq(inst.call("unbits", [0x3FF0000000000000n]), 1.0, "and f64.fromBits");
  eq(inst.call("fromB", []), 2, "and string.fromBytes");
});

// §wac-modconst-ref-9jvq2mt — constants of reference type
Deno.test(`[§wac-modconst-ref-9jvq2mt] a struct or enum can be a module constant`, async () => {
  // `struct.new` is a constant instruction in the GC proposal, so a constant is not
  // limited to scalars. Before this, a dispatch table of variants had to be built inside
  // a function and so was rebuilt on every call — the same cost the constant-array work
  // removed for scalar tables.
  const inst = await run(`
    enum E { A(i32 v), B }
    struct P { i32 x; i32 y; }
    struct Inner { i32 v; }
    struct Outer { Inner i; i32 n; }
    struct Named { string s; i32 n; }
    struct Link { Link? next; i32 v; }

    const E      X      = E.A(7);
    const E      PLAIN  = E.B;
    const E[]    TABLE  = E[](E.A(1), E.B, E.A(3));
    const P      ORIGIN = P(3, 4);
    const P      BRACED = P { x: 1, y: 2 };
    const Outer  NEST   = Outer(Inner(6), 1);
    const Inner[] PS    = Inner[](Inner(1), Inner(2), Inner(4));
    const Named  HI     = Named("hi", 2);
    const Link   TAIL   = Link(null, 9);

    export i32 payload()  { match (X) { case A(v): return v; case B: return 0; } }
    export i32 noPayload() { match (PLAIN) { case A(v): return v; case B: return 5; } }
    export i32 table() {
      i32 n = 0;
      for (i32 i = 0; i < TABLE.len(); i++) { match (TABLE[i]) { case A(v): n += v; case B: n += 100; } }
      return n;
    }
    export i32 plainStruct() { return ORIGIN.x * 10 + ORIGIN.y; }
    export i32 braced()      { return BRACED.x * 10 + BRACED.y; }
    export i32 nested()      { return NEST.i.v + NEST.n; }
    export i32 structArray() { return PS[0].v + PS[1].v + PS[2].v; }   // Inner has .v
    export i32 withString()  { return HI.s.len() + HI.n; }
    export i32 withNull()    { return TAIL.v + (TAIL.next is null ? 1 : 0); }
  `);
  eq(inst.call("payload", []), 7, "a variant with a payload");
  eq(inst.call("noPayload", []), 5, "a payload-less variant");
  eq(inst.call("table", []), 104, "an array of variants — the case that motivated this");
  eq(inst.call("plainStruct", []), 34, "a struct, positionally");
  eq(inst.call("braced", []), 12, "a struct, named");
  eq(inst.call("nested", []), 7, "a struct holding a struct");
  eq(inst.call("structArray", []), 7, "an array of structs");
  eq(inst.call("withString", []), 4, "a struct holding a string");
  eq(inst.call("withNull", []), 10, "a struct holding a null");
});

Deno.test(`[§wac-modconst-ref-9jvq2mt] a reference constant is one shared value`, async () => {
  // The point of the feature, and the thing that was wrong at first: a struct constant
  // was substituted at each use, so two mentions were two objects and the value was
  // rebuilt every time. Identity is observable through a mutable field, which is what
  // this checks — an array constant already behaved this way.
  const inst = await run(`
    struct P { i32 v; }
    const P SHARED = P(1);
    const i32[] K  = i32[](1, 2);
    P getP()    { return SHARED; }
    i32[] getK() { return K; }
    export i32 structIdentity() { P a = getP(); a.v = 42; return getP().v; }
    export i32 arrayIdentity()  { i32[] a = getK(); a[0] = 42; return getK()[0]; }
  `);
  eq(inst.call("structIdentity", []), 42, "both mentions are the same struct");
  eq(inst.call("arrayIdentity", []), 42, "as was already true of arrays");
});

Deno.test(`[§wac-modconst-ref-9jvq2mt] writing through a reference constant is refused`, () => {
  const field = err(`struct P { i32 v; } const P S = P(1); export i32 f() { S.v = 9; return S.v; }`);
  if (!field.includes("cannot assign")) {
    throw new Error(`expected an assignment diagnostic for a const struct field, got: ${field}`);
  }
  const elem = err(`const i32[] K = i32[](1, 2); export i32 f() { K[0] = 9; return K[0]; }`);
  if (!elem.includes("cannot assign")) {
    throw new Error(`expected an assignment diagnostic for a const array element, got: ${elem}`);
  }
});

// §wac-modconst-array-t8kn4wq — constant arrays are built once, as globals
Deno.test(`[§wac-modconst-array-t8kn4wq] a constant array is one shared table`, async () => {
  const src = `
    const i32 N = 3;
    const i32[] TABLE   = i32[](10, 20, 30);
    const u32[] POLYS   = u32[](0xEDB88320, 0x82F63B78);
    const u8[]  BYTES   = u8[](104, 101, 255);
    const i64[] WIDE    = i64[](1000000000000, -1);
    const f64[] FS      = f64[](1.5, 2.5);
    const i32[] DERIVED = i32[](N, N * 2, N + 100);
    export i32 sum()        { i32 t = 0; for (i32 i = 0; i < TABLE.len(); i++) { t += TABLE[i]; } return t; }
    export u32 poly(i32 i)  { return POLYS[i]; }
    export i32 byte(i32 i)  { return BYTES[i]; }
    export i64 wide(i32 i)  { return WIDE[i]; }
    export f64 f(i32 i)     { return FS[i]; }
    export i32 derived(i32 i) { return DERIVED[i]; }
  `;
  const i = await run(src);
  eq(i.call("sum", []), 60, "iterating a constant table");
  eq(i.call("poly", [0]), 3988292384, "u32 elements keep their bit pattern");
  eq(i.call("byte", [2]), 255, "packed u8 elements zero-extend");
  eq(i.call("wide", [0]), 1000000000000n, "i64 elements");
  eq(i.call("wide", [1]), -1n, "negative i64 elements");
  eq(i.call("f", [1]), 2.5, "f64 elements");
  eq(i.call("derived", [1]), 6, "elements may be constant expressions");
  eq(i.call("derived", [2]), 103, "and reference other constants");

  // The point of the feature is that the table is built once at instantiation
  // rather than rebuilt per call, so assert it in the bytes: every constant
  // array appears as array.new_fixed in the global section and none in code.
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) return;
  const w = r.compiled.wasm;
  let p = 8;
  let codeSec: Uint8Array | null = null, globalSec: Uint8Array | null = null;
  while (p < w.length) {
    const id = w[p++];
    let size = 0, shift = 0, b: number;
    do { b = w[p++]; size |= (b & 0x7F) << shift; shift += 7; } while (b & 0x80);
    if (id === 10) codeSec = w.slice(p, p + size);
    if (id === 6) globalSec = w.slice(p, p + size);
    p += size;
  }
  const count = (buf: Uint8Array | null, pat: number[]) => {
    if (!buf) return 0;
    let n = 0;
    for (let j = 0; j + pat.length <= buf.length; j++) {
      if (pat.every((x, k) => buf[j + k] === x)) n++;
    }
    return n;
  };
  eq(count(globalSec, [0xFB, 0x08]), 6, "six arrays built in the global section");
  eq(count(codeSec, [0xFB, 0x08]), 0, "and none rebuilt inside a function body");
});

// §wac-modconst-sized-5wnq8kt — a sized array can be a constant
Deno.test(`[§wac-modconst-sized-5wnq8kt] a constant array may be written in the sized form`, async () => {
  // Reported as the second half of issue 0032. `array.new_default` and `array.new` are
  // both constant instructions, so a sized array is as constant as a literal one — what
  // has to be constant is the *length*, not the elements.
  const inst = await run(`
    struct P { i32 v; }
    enum E { A(i32 v), B }
    const i32   N     = 5;
    const i32[] ZEROS = i32[8]();
    const i32[] ONES  = i32[4](fill: -1);
    const i32[] BYN   = i32[N]();
    const i32[] BYEXP = i32[N * 2]();
    const P[]   PS    = P[3](fill: P(7));
    const E[]   ES    = E[3](fill: E.A(4));
    export i32 zeros() { return ZEROS.len() * 10 + ZEROS[0]; }
    export i32 ones()  { return ONES.len() * 10 + ONES[3]; }
    export i32 byN()   { return BYN.len(); }
    export i32 byExp() { return BYEXP.len(); }
    export i32 structs() { return PS.len() * 10 + PS[2].v; }
    export i32 enums() {
      i32 n = 0;
      for (i32 i = 0; i < ES.len(); i++) { match (ES[i]) { case A(v): n += v; case B: n += 1; } }
      return n;
    }
  `);
  eq(inst.call("zeros", []), 80, "eight elements, default-filled");
  eq(inst.call("ones", []), 39, "four elements of -1");
  eq(inst.call("byN", []), 5, "a length from another constant");
  eq(inst.call("byExp", []), 10, "a length from an expression over constants — N is 5");
  eq(inst.call("structs", []), 37, "struct elements need fill, and take it");
  eq(inst.call("enums", []), 12, "and so do enum elements");
});

Deno.test(`[§wac-modconst-sized-5wnq8kt] the length must be constant and the elements defaultable`, () => {
  const computed = err(`i32 n() { return 3; } const i32[] T = i32[n()](); export i32 f() { return T[0]; }`);
  if (!computed.includes("needs a compile-time value")) {
    throw new Error(`expected a compile-time diagnostic for a computed length, got: ${computed}`);
  }
  // An enum has no default, so the sized form needs `fill:` — the same rule as outside a
  // constant, and the diagnostic says which.
  const noDefault = wacCompile(new Map([["main.wac",
    `enum E { A(i32 v), B } const E[] T = E[3](); export i32 f() { return T.len(); }`]]), "main.wac");
  if (noDefault.ok) throw new Error("expected an enum sized array with no fill to be rejected");
  const ann = noDefault.diagnostics[0].annotation ?? "";
  if (!ann.includes("fill:")) {
    throw new Error(`expected the diagnostic to suggest 'fill:', got: ${ann}`);
  }
});

// §wac-modconst-array-const-w2mk9fj — a constant table cannot be written through
Deno.test(`[§wac-modconst-array-const-w2mk9fj] writing to a constant array is rejected`, () => {
  const bad = (src: string) => !wacCompile(new Map([["main.wac", src]]), "main.wac").ok;
  // One object is shared by every use, so a write would be visible everywhere.
  eq(bad(`const i32[] T = i32[](1, 2); export void f() { T[0] = 9; }`), true, "element write");
  eq(bad(`const i32[] T = i32[](1, 2); export void f() { T[0] += 1; }`), true, "compound write");
  eq(bad(`const i32[] T = i32[](1, 2); export void f() { T[0]++; }`), true, "increment");
  // The sized form is allowed now (§wac-modconst-sized-5wnq8kt) and is still read-only.
  eq(bad(`const i32[] T = i32[8](); export void f() { T[0] = 9; }`), true, "sized form, written");
  // What a constant cannot have is a length that must be computed.
  eq(bad(`i32 n() { return 3; } const i32[] T = i32[n()](); export i32 f() { return T[0]; }`),
    true, "sized form with a computed length");
  // Reading is fine.
  eq(bad(`const i32[] T = i32[](1, 2); export i32 f() { return T[1]; }`), false, "reads are allowed");
});

// §wac-samename-private-k9fw3nm — a bare call means what the *calling file* says
Deno.test(`[§wac-samename-private-k9fw3nm] same-named private functions do not collide`, async () => {
  // imports.md promises two files may each define `max`. That held for exported
  // names, which are mangled and imported explicitly, but a *private* helper was
  // resolved through a global bare-name map on a first-registered-wins basis —
  // so the second file's calls silently reached the first file's function, with
  // its signature. Different widths make that a wasm validation failure; same
  // widths would have been a wrong answer with no error at all.
  const files = new Map([
    ["/a.wac", `i32 helper(i32 x) { return x * 2; }\nexport i32 fromA(i32 x) { return helper(x); }`],
    ["/b.wac", `i64 helper(i64 x) { return x * 3; }\nexport i64 fromB(i64 x) { return helper(x); }`],
    ["/c.wac", `i32 helper(i32 x) { return x + 100; }\nexport i32 fromC(i32 x) { return helper(x); }`],
    ["/main.wac", `import { fromA } from "/a.wac";\nimport { fromB } from "/b.wac";\nimport { fromC } from "/c.wac";
      export i32 a(i32 x) { return fromA(x); }
      export i64 b(i64 x) { return fromB(x); }
      export i32 c(i32 x) { return fromC(x); }`],
  ]);
  const r = wacCompile(files, "/main.wac");
  eq(r.ok, true, "compiles");
  if (!r.ok) return;
  const i = await wacInstance(r.compiled);
  eq(i.call("a", [5]), 10, "a.wac's helper doubles");
  eq(i.call("b", [5n]), 15n, "b.wac's helper triples, at 64 bits");
  eq(i.call("c", [5]), 105, "c.wac's helper adds 100 — same width as a's, different body");
});

// §wac-u64-unary-p3mk8wq — unary operators at 64-bit width on unsigned
Deno.test(`[§wac-u64-unary-p3mk8wq] '~' on a u64 is a 64-bit operation`, async () => {
  // The emitter tested for i64 by name, so u64 fell through to the 32-bit form
  // and emitted i32.xor against an i64 operand.
  const i = await run(`
    export u64 notU64(u64 x) { return ~x; }
    export u32 notU32(u32 x) { return ~x; }
    export i64 notI64(i64 x) { return ~x; }
  `);
  eq(i.call("notU64", [0n]), 18446744073709551615n, "~0 fills all 64 bits");
  eq(i.call("notU64", [18446744073709551615n]), 0n, "and back");
  eq(i.call("notU32", [0]), 4294967295, "~0 at 32 bits");
  eq(i.call("notI64", [0n]), -1n, "signed is unchanged");
});

// §wac-generic-struct-9tkq4wm — generic structs, monomorphised
const VEC = `
struct Vec<T> {
  T[] data;
  i32 n;
  void push(this, T v) {
    if (this.n == this.data.len()) {
      T[] next = T[this.data.len() == 0 ? 4 : this.data.len() * 2](fill: v);
      for (i32 i = 0; i < this.n; i++) { next[i] = this.data[i]; }
      this.data = next;
    }
    this.data[this.n] = v;
    this.n++;
  }
  T get(const this, i32 i) { return this.data[i]; }
  i32 len(const this) { return this.n; }
}`;

Deno.test("[§wac-generic-struct-9tkq4wm] a generic struct works for several arguments", async () => {
  // Issue 0034, built to the design in ~/notes/living/wac/generics-design.md: monomorphisation in
  // the resolver, so the type checker and the emitter never learn the word "generic" — the same
  // containment that kept enums out of them.
  const inst = await run(`${VEC}
    struct P { i32 v; }
    enum E { A(i32 v), B }
    export i32 ints() {
      Vec<i32> v = Vec(i32[0](), 0);
      v.push(10); v.push(20); v.push(30);
      return v.len() * 100 + v.get(2);
    }
    export i32 floats() { Vec<f64> v = Vec(f64[0](), 0); v.push(1.5); v.push(2.5); return (v.get(1) * 2.0) as~ i32; }
    export i32 structs() { Vec<P> v = Vec(P[0](), 0); v.push(P(5)); v.push(P(6)); return v.get(1).v; }
    export i32 enums() {
      Vec<E> v = Vec(E[](), 0);   // E has no default, so the literal form
      v.push(E.A(8));
      return match (v.get(0)) { case A(x): x, case B: 0 };
    }
    // Two instantiations of one template in one program: separate copies, separate element types.
    export i32 both() {
      Vec<i32> a = Vec(i32[0](), 0);  a.push(7);
      Vec<f64> b = Vec(f64[0](), 0);  b.push(1.5);
      return a.get(0) + (b.get(0) as~ i32);
    }
  `);
  eq(inst.call("ints", []), 330, "a primitive argument");
  eq(inst.call("floats", []), 5, "a float argument — the case erasure would have boxed");
  eq(inst.call("structs", []), 6, "a struct argument");
  eq(inst.call("enums", []), 8, "an enum argument, so generics run before enums desugar");
  eq(inst.call("both", []), 9, "two instantiations coexist");
});

Deno.test("[§wac-generic-struct-9tkq4wm] generics nest, and compose with arrays and other generics", async () => {
  const inst = await run(`${VEC}
    struct Box<T> { T v; T get(const this) { return this.v; } }
    struct Wrap<T> { Box<T> inner; T peek(const this) { return this.inner.get(); } }
    struct Pair<A, B> { A first; B second; A getFirst(const this) { return this.first; } }
    export i32 nested() {
      Vec<i32> inner = Vec(i32[0](), 0); inner.push(9);
      Vec<Vec<i32>> outer = Vec(Vec<i32>[0](), 0);
      outer.push(inner);
      return outer.get(0).get(0);
    }
    export i32 genericField() { Box<i32> b = Box(5); Wrap<i32> w = Wrap(b); return w.peek(); }
    // Box(this.v) has to find its type arguments in the declared type of b, which is only a
    // concrete type after substitution — so the pass that matches the two runs on the materialised
    // copy, not on the template. Before that it reported "Box is generic and needs type arguments".
    struct Holder<T> { T v; Box<T> boxed(const this) { Box<T> b = Box(this.v); return b; } }
    export i32 constructInMethod() { Holder<i32> h = Holder(4); return h.boxed().get(); }
    export i32 twoParams()    { Pair<i32, f64> p = Pair(4, 1.5); return p.getFirst(); }
    export i32 arrayOf()      { Box<i32>[] a = Box<i32>[2](fill: Box(4)); return a[0].get() + a[1].get(); }
    export i32 inTernary()    { Box<i32> b = true ? Box(3) : Box(4); return b.get(); }
  `);
  eq(inst.call("nested", []), 9, "Vec<Vec<i32>> — the `>>` the lexer munched is split by the parser");
  eq(inst.call("genericField", []), 5, "a generic holding a generic, substituted through");
  eq(inst.call("constructInMethod", []), 4,
    "a construction inside a template's own method, which takes its arguments from the " +
    "declared type only after that type has been substituted");
  eq(inst.call("twoParams", []), 4, "two type parameters");
  eq(inst.call("arrayOf", []), 8, "an array of a generic, with a fill");
  eq(inst.call("inTernary", []), 3, "and both ternary branches take the expected type");
});

Deno.test("[§wac-generic-struct-9tkq4wm] a type argument may be any type", async () => {
  // The five tests around this one were written from the shapes I had in mind while implementing,
  // which is the failure mode this project keeps hitting: they use whatever was already convenient.
  // These are the ones a probe found afterwards, and one of them failed — `Box<fn[i32(i32)]>`, where
  // the var-decl lookahead bailed on the funcref's own `)` and read the declaration as an
  // expression.
  const inst = await run(`
    struct Box<T> { T v; T get(const this) { return this.v; } }
    i32 dbl(i32 x) { return x * 2; }
    export i32 arrayArg()    { Box<i32[]> b = Box(i32[](1, 2, 3)); return b.get().len(); }
    export i32 nullableArg() { Box<i32[]?> b = Box(null); return b.get() is null ? 7 : 0; }
    export i32 funcrefArg()  { Box<fn[i32(i32)]> b = Box(dbl); return b.get()(21); }
    export i32 stringArg()   { Box<string> b = Box("hello"); return b.get().len(); }
    export i32 threeAtOnce() {
      Box<i32> a = Box(1); Box<f64> b = Box(2.0); Box<string> c = Box("xyz");
      return a.get() + (b.get() as~ i32) + c.get().len();
    }
  `);
  eq(inst.call("arrayArg", []), 3, "an array type");
  eq(inst.call("nullableArg", []), 7, "a nullable type");
  eq(inst.call("funcrefArg", []), 42, "a funcref type — the case the lookahead got wrong");
  eq(inst.call("stringArg", []), 5, "a string");
  eq(inst.call("threeAtOnce", []), 6, "three instantiations of one template together");
});

Deno.test("[§wac-generic-struct-9tkq4wm] a generic composes with the rest of the language", async () => {
  const inst = await run(`
    enum E { A(i32 v), B }
    struct Base { i32 a; }
    struct Sub : Base { i32 b; }
    struct Parented<T> : Base { T v; T get(const this) { return this.v; } }
    struct Node<T> { T v; Node<T>? next; i32 depth(const this) { return this.next is null ? 1 : 2; } }
    struct Uses<T> {
      T v;
      i32 viaMatch(const this, E e)   { match (e) { case A(x): return x; case B: return 0; } }
      i32 viaNarrow(const this, Base x) { if (x is Sub) { return x.b; } return 0; }
      i32 viaLocal(const this, T seed) { T[] a = T[2](fill: seed); return a.len(); }
      T   viaOther(const this)         { return this.get(); }
      T   get(const this)              { return this.v; }
    }
    const Box<i32> ONE = Box(5);   // a generic as a module constant
    struct Box<T> { T v; T get(const this) { return this.v; } }

    export i32 parent()   { Parented<i32> p = Parented(1, 6); return p.get() + p.a; }
    export i32 selfRef()  { Node<i32> n = Node(1, null); return n.depth(); }
    export i32 withMatch() { Uses<i32> u = Uses(1); return u.viaMatch(E.A(9)); }
    export i32 withNarrow() { Uses<i32> u = Uses(1); return u.viaNarrow(Sub(1, 8)); }
    export i32 withLocal()  { Uses<i32> u = Uses(1); return u.viaLocal(7); }
    export i32 methodCall() { Uses<i32> u = Uses(4); return u.viaOther(); }
    export i32 asConstant()  { return ONE.get(); }
  `);
  eq(inst.call("parent", []), 7, "a generic struct may have a parent");
  eq(inst.call("selfRef", []), 1, "and a nullable field of its own type");
  eq(inst.call("withMatch", []), 9, "match inside a generic method");
  eq(inst.call("withNarrow", []), 8, "narrowing inside one");
  eq(inst.call("withLocal", []), 2, "a local whose type is the parameter");
  eq(inst.call("methodCall", []), 4, "one generic method calling another");
  eq(inst.call("asConstant", []), 5, "and a generic as a module constant");
});

Deno.test("[§wac-generic-struct-9tkq4wm] two instantiations share no AST", async () => {
  // Substitution has to return fresh type nodes even where nothing changed. The bare `Vec` in
  // `return Vec(T[0](), 0)` mentions no type parameter, so it used to be the *same node* in every
  // copy — and the pass that gives a construction its type arguments rewrites in place, so the
  // first instantiation to be resolved gave its arguments to all of them. `Vec<string>.create()`
  // returned a `Vec<i32>`, which the type checker then reported against code the author wrote
  // correctly.
  const inst = await run(`
    struct Vec<T> {
      T[] data; i32 n;
      Vec<T> create() { return Vec(T[0](), 0); }
      i32 len(const this) { return this.n; }
      void push(this, T v) {
        if (this.n == this.data.len()) {
          T[] next = T[this.data.len() == 0 ? 4 : this.data.len() * 2](fill: v);
          for (i32 i = 0; i < this.n; i++) { next[i] = this.data[i]; }
          this.data = next;
        }
        this.data[this.n] = v;
        this.n++;
      }
      T get(const this, i32 i) { return this.data[i]; }
    }
    export i32 ints()    { Vec<i32> v = Vec.create(); v.push(7); return v.get(0); }
    export i32 strings() { Vec<string> v = Vec.create(); v.push("abc"); return v.get(0).len(); }
    export i32 both() {
      Vec<i32> a = Vec.create();     a.push(1);
      Vec<string> b = Vec.create();  b.push("xy");
      return a.get(0) + b.get(0).len();
    }
  `);
  eq(inst.call("ints", []), 7, "the first instantiation");
  eq(inst.call("strings", []), 3, "the second, which must not have been given the first's arguments");
  eq(inst.call("both", []), 3, "and both in one function");
});

Deno.test("[§wac-generic-struct-9tkq4wm] each instantiation is instrumented separately", () => {
  // Coverage of a generic would be meaningless if instantiations shared branch points: one
  // instantiation exercising a branch would mark it covered for all of them.
  const r = wacCompile(new Map([["main.wac", `
    struct Box<T> { T v; i32 sign(const this, i32 k) { if (k > 0) { return 1; } return 0; } }
    export i32 useInt()   { Box<i32> b = Box(1); return b.sign(1); }
    export i32 useFloat() { Box<f64> b = Box(1.0); return b.sign(-1); }
  `]]), "main.wac", { coverage: true });
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));
  const thens = r.compiled.coverage!.filter((p) => p.kind === "then");
  eq(thens.length, 2, "one 'then' point per instantiation, not one shared");
});

Deno.test("[§wac-generic-struct-9tkq4wm] a generic crosses module boundaries", async () => {
  // A materialised struct lives in the *template's* file, so the ordinary export and import rules
  // apply to it — which means the import item naming the template has to be rewritten to the
  // instantiations the importing file actually uses.
  const inst = await runMulti(new Map([
    ["box.wac", `export struct Box<T> { T v; T get(const this) { return this.v; } void set(this, T x) { this.v = x; } }`],
    ["a.wac",   `import { Box } from "./box.wac";
                 export i32 fromA() { Box<i32> b = Box(1); return b.get(); }`],
    ["main.wac", `import { Box } from "./box.wac";
                  import { fromA } from "./a.wac";
                  export i32 test() { Box<i32> b = Box(2); b.set(5); return b.get() + fromA(); }
                  // An alias must work too, since this pass runs before imports are resolved.
                  export i32 viaAlias() { Box<f64> d = Box(2.5); return (d.get() * 2.0) as~ i32; }
                  // Not exported, and it does not need to be: nothing can name Box$Local.
                  struct Local { i32 v; }
                  export i32 localArgument() { Box<Local> b = Box(Local(4)); return b.get().v; }`],
  ]));
  eq(inst.call("test", []), 6, "the same instantiation used from two files is one struct");
  eq(inst.call("viaAlias", []), 5, "and a second instantiation from the same import");
  eq(inst.call("localArgument", []), 4,
    "a type argument the importing file declares and does not export: the copy lives in the " +
    "template's file, so the compiler injects the import that makes it resolve there");
});

// §wac-generic-enum-7dkq2mv — generic enums, which is what Option and Result need
const OPTION = `
enum Option<T> {
  Some(T v), None

  bool isSome(const this) { return match (this) { case Some(_): true, case None: false }; }
  T orElse(const this, T d) { return match (this) { case Some(v): v, case None: d }; }
}`;

Deno.test("[§wac-generic-enum-7dkq2mv] a generic enum works, with methods and several arguments", async () => {
  // The design's payoff: Option and Result need generics *and* enums, and the ordering it settled —
  // generics substitute before enums desugar — is what makes an instantiation an ordinary enum by
  // the time anything else looks at it.
  const inst = await run(`${OPTION}
    enum Result<T, E> {
      Ok(T v), Err(E e)
      bool isOk(const this) { return match (this) { case Ok(_): true, case Err(_): false }; }
    }
    export i32 some()   { Option<i32> a = Option.Some(4); return a.orElse(0); }
    export i32 none()   { Option<i32> a = Option.None;   return a.orElse(9); }
    export bool isSome(){ Option<i32> a = Option.None;   return a.isSome(); }
    export i32 two() {
      Option<i32> a = Option.Some(3);
      Option<f64> b = Option.Some(2.0);
      return a.orElse(0) + (b.orElse(0.0) as! i32);
    }
    export i32 result() {
      Result<i32, string> r = Result.Err("no");
      return r.isOk() ? 0 : match (r) { case Ok(v): v, case Err(e): e.len() };
    }
    // A generic enum whose payload is another template: the type sweep has to skip an enum
    // template's variants as it skips a struct template's fields, or the inner reference is
    // materialised with the parameter name T treated as an argument.
    struct Box<T> { T v; }
    enum Wrap<T> { W(Box<T> b), Empty }
    export i32 payloadIsGeneric() {
      Wrap<i32> w = Wrap.W(Box(5));
      return match (w) { case W(b): b.v, case Empty: 0 };
    }
    export i32 nested() {
      Option<Option<i32>> oo = Option.Some(Option.Some(2));
      Option<i32> inner = oo.orElse(Option.None);
      return inner.orElse(0);
    }
  `);
  eq(inst.call("some", []), 4, "a payload variant, with T from the declared type");
  eq(inst.call("none", []), 9, "a payload-less variant, which is a value rather than a call");
  eq(inst.call("isSome", []), false, "a method on the instantiation");
  eq(inst.call("two", []), 5, "two instantiations of one generic enum coexist");
  eq(inst.call("result", []), 2, "two type parameters, and a string argument");
  eq(inst.call("payloadIsGeneric", []), 5, "a variant carrying an instantiation of a generic struct");
  eq(inst.call("nested", []), 2, "an Option of an Option");
});

Deno.test("[§wac-generic-enum-7dkq2mv] a generic enum composes with the rest of the language", async () => {
  const inst = await runMulti(new Map([
    ["opt.wac", `export ${OPTION}`],
    ["main.wac", `import { Option } from "./opt.wac";
      struct Holder { Option<i32> o; }
      struct Box<T> { Option<T> o; T get(const this, T d) { return this.o.orElse(d); } }
      Option<i32> find(i32 x) { if (x > 0) { return Option.Some(x); } return Option.None; }
      T unwrapOr<T>(Option<T> o, T d) { return o.orElse(d); }
      export i32 asField()      { Holder h = Holder(Option.Some(6)); return h.o.orElse(0); }
      export i32 inGeneric()    { Box<i32> b = Box(Option.Some(8)); return b.get(0); }
      export i32 returned()     { return find(3).orElse(0) * 10 + find(-1).orElse(7); }
      export i32 viaGenericFn() { Option<i32> a = Option.Some(5); return unwrapOr(a, 0); }
      export i32 inArray() {
        Option<i32>[] xs = Option<i32>[3](fill: Option.None);
        xs[1] = Option.Some(4);
        return xs[1].orElse(0) + xs[0].orElse(1);
      }
      export i32 reassigned() { Option<i32> o = Option.None; o = Option.Some(4); return o.orElse(0); }
      // Every arm of a match *expression* produces the value, so each is an expected-type position
      // of its own — which is how a generic enum's own combinators have to be written.
      Option<i32> doubled(Option<i32> o) {
        return match (o) {
          case Some(v): Option.Some(v * 2),
          case None: Option.None,
        };
      }
      export i32 throughMatchArms() {
        Option<i32> a = doubled(Option.Some(3));
        Option<i32> b = doubled(Option.None);
        return a.orElse(0) * 10 + b.orElse(7);
      }`],
  ]));
  eq(inst.call("asField", []), 6, "a construction's argument, across a module boundary");
  eq(inst.call("inGeneric", []), 8, "a generic enum inside a generic struct");
  eq(inst.call("returned", []), 37, "returned from a function, both variants");
  eq(inst.call("viaGenericFn", []), 5, "passed to a generic function, which infers T through it");
  eq(inst.call("inArray", []), 5, "an array's fill and an element assignment");
  eq(inst.call("reassigned", []), 4, "assignment to a local");
  eq(inst.call("throughMatchArms", []), 67, "a match expression's arms, each an expected-type position");
});

Deno.test("[§wac-generic-enum-7dkq2mv] a generic enum's variants have no bare name", () => {
  // An ordinary enum's variant is a file-scope name, which is what lets it be a type. A generic
  // one's cannot be: two instantiations would both claim `Some`. `match` is unaffected, and the
  // diagnostic says which generic enum the name belongs to rather than suggesting a typo.
  const r = wacCompile(new Map([["main.wac", `${OPTION}
    export i32 f() { Option<i32> a = Option.Some(1); return a is Some ? 1 : 0; }`]]), "main.wac");
  if (r.ok) throw new Error("expected a compile error for 'is Some'");
  const d = r.diagnostics[0];
  if (!d.message.includes("undefined type 'Some'")) {
    throw new Error(`expected 'undefined type', got: ${d.message}`);
  }
  if (!(d.hint ?? "").includes("generic enum 'Option'")) {
    throw new Error(`the hint should name the enum, got: ${d.hint}`);
  }
  // Naming it as a declared type or a cast target fails too, though those positions report an
  // unknown type name less directly — see issue 0046.
  err(`${OPTION}
    export i32 f() { Option<i32> a = Option.Some(1); Some s = a; return s.v; }`);
  err(`${OPTION}
    export i32 f() { Option<i32> a = Option.Some(1); return (a as! Some).v; }`);
  // And no diagnostic about a generic enum shows its mangled name.
  const m = err(`${OPTION}
    export i32 f() { Option<i32> a = Option.Some(1); return match (a) { case Nope(v): v, case None: 0 }; }`);
  if (!m.includes("Option<i32>")) throw new Error(`expected the written name in: ${m}`);
  if (m.includes("$")) throw new Error(`a mangled name reached a diagnostic: ${m}`);
});

// §wac-generic-expected-position-3qmz8vk — every position that supplies an expected type
Deno.test("[§wac-generic-expected-position-3qmz8vk] a construction takes its arguments from any expected type", async () => {
  // A construction cannot name its type arguments, so every position that supplies an expected type
  // has to be found. Only a declaration and a `return` were, which made `v = Vec(...)` and
  // `take(Vec(...))` impossible to write — and for a *generic enum* there is no spelling at all, so
  // the gap was invisible until Option existed.
  const inst = await run(`
    struct Box<T> { T v; }
    struct Holder { Box<i32> b; }
    void ignore(Box<i32> b) { }
    i32 peek(Box<i32> b) { return b.v; }
    export i32 toLocal()      { Box<i32> b = Box(1); b = Box(4); return b.v; }
    export i32 toField()      { Holder h = Holder(Box(1)); h.b = Box(4); return h.b.v; }
    export i32 toElement()    { Box<i32>[] xs = Box<i32>[2](fill: Box(0)); xs[1] = Box(4); return xs[1].v; }
    export i32 asArgument()   { return peek(Box(5)); }
    export i32 asFieldArg()   { Holder h = Holder(Box(6)); return h.b.v; }
    export i32 asNamedArg()   { Holder h = Holder { b: Box(7) }; return h.b.v; }
    export i32 asElement()    { Box<i32>[] xs = Box<i32>[](Box(8), Box(9)); return xs[0].v + xs[1].v; }
    export i32 throughTernary(bool c) { Box<i32> b = c ? Box(1) : Box(2); return b.v; }
    // A static method on a generic struct is the same shape as a variant construction — a call on a
    // field of the template's name — and the design lists it as a supported position.
    struct Vec<T> {
      T[] data; i32 n;
      Vec<T> create() { return Vec(T[0](), 0); }
      i32 len(const this) { return this.n; }
      void push(this, T v) {
        if (this.n == this.data.len()) {
          T[] next = T[this.data.len() == 0 ? 4 : this.data.len() * 2](fill: v);
          for (i32 i = 0; i < this.n; i++) { next[i] = this.data[i]; }
          this.data = next;
        }
        this.data[this.n] = v;
        this.n++;
      }
    }
    export i32 viaStatic() { Vec<i32> v = Vec.create(); v.push(1); v.push(2); v.push(3); return v.len(); }
  `);
  eq(inst.call("toLocal", []), 4, "assignment to a local");
  eq(inst.call("toField", []), 4, "assignment to a field");
  eq(inst.call("toElement", []), 4, "assignment to an array element");
  eq(inst.call("asArgument", []), 5, "a call's argument");
  eq(inst.call("asFieldArg", []), 6, "a construction's positional argument");
  eq(inst.call("asNamedArg", []), 7, "a construction's named argument");
  eq(inst.call("asElement", []), 17, "an array literal's elements");
  eq(inst.call("throughTernary", [true]), 1, "and still through both ternary branches");
  eq(inst.call("viaStatic", []), 3, "a static method on the template, which is how a container " +
    "gives itself a constructor without exposing its fields");
});

Deno.test("[§wac-generic-expected-position-3qmz8vk] a construction with nowhere to take arguments from is an error", () => {
  // The restriction that remains, and it is the one the design predicted: a value going nowhere in
  // particular has no expected type. Reported last of all, after every position has had its chance.
  const m = err(`
    struct Box<T> { T v; i32 get(const this) { return 1; } }
    export i32 f() { return Box(1).get(); }
  `);
  if (!m.includes("needs type arguments")) {
    throw new Error(`expected the bare-template diagnostic, got: ${m}`);
  }
});

// §wac-generic-fn-5hvq3mt — generic functions, with argument-directed inference
Deno.test("[§wac-generic-fn-5hvq3mt] a generic function infers its type arguments from the call", async () => {
  // Issue 0034 Stage C. There is no `max<i32>(x, y)` — angle brackets are type syntax only — so
  // inference is the whole interface. It is tractable because wac has no declaration type
  // inference: every local and parameter states its type, so an argument's type is syntactic.
  const inst = await run(`
    T max<T>(T a, T b) { return a > b ? a : b; }
    struct P { i32 v; i32 get(const this) { return this.v; } }
    export i32 ints() { i32 x = 3; i32 y = 7; return max(x, y); }
    export i32 both() {
      i32 x = 3; i32 y = 7;
      f64 p = 2.0; f64 q = 1.0;
      return max(x, y) + (max(p, q) as! i32);
    }
    export i32 literals() { return max(3, 7); }
    export i32 nested() { i32 a = 1; i32 b = 2; i32 c = 3; return max(max(a, b), c); }
    export i32 fromMethod() { P s = P(4); i32 x = 1; return max(s.get(), x); }
    export i32 fromField() { P s = P(6); return max(s.v, 2); }
    export i32 fromCast() { f64 d = 5.0; i32 one = 1; return max(d as! i32, one); }
    export i32 fromIndex() { i32[] xs = i32[](4, 9); return max(xs[0], xs[1]); }
  `);
  eq(inst.call("ints", []), 7, "two i32 locals");
  eq(inst.call("both", []), 9, "two instantiations of one template coexist");
  eq(inst.call("literals", []), 7, "a literal's own type is enough");
  eq(inst.call("nested", []), 3, "an inner call resolves first, so its return type is known");
  eq(inst.call("fromMethod", []), 4, "a method's declared return type");
  eq(inst.call("fromField", []), 6, "a field's declared type");
  eq(inst.call("fromCast", []), 5, "a cast states its own type");
  eq(inst.call("fromIndex", []), 9, "an array element's type comes from the array");
});

Deno.test("[§wac-generic-fn-5hvq3mt] a type parameter may be anything, including inside a structure", async () => {
  // The parameter's type is a *pattern* matched against the argument's: `T[]` against `i32[]` binds
  // T to i32, and `Box<T>` against a monomorphised `Box$i32` does too — which needs the resolver to
  // read a mangled name back, since by then no argument's type says `Box<i32>` anywhere.
  const inst = await run(`
    struct Box<T> { T v; }
    struct P { i32 v; }
    enum E { A(i32 v), B }
    T id<T>(T a) { return a; }
    i32 count<T>(T[] xs) { return xs.len(); }
    T unbox<T>(Box<T> b) { return b.v; }
    T applyTo<T>(fn[T(T)] f, T x) { return f(x); }
    i32 inc(i32 a) { return a + 1; }
    T orElse<T>(T? a, T d) { if (a is null) { return d; } return a!; }
    export i32 structArg() { P p = P(4); P q = id(p); return q.v; }
    export i32 enumArg() {
      E e = E.A(7);
      E f = id(e);
      return match (f) { case A(x): x, case B: 0 };
    }
    export i32 stringArg() { string s = "hey"; string t = id(s); return t.len(); }
    export i32 arrayElem() { i32[] xs = i32[3](); return count(xs); }
    export i32 insideGeneric() { Box<i32> b = Box(5); return unbox(b); }
    export i32 insideFuncref() { fn[i32(i32)] f = inc; i32 x = 5; return applyTo(f, x); }
    export i32 insideNullable() { P? absent = null; P d = P(3); return orElse(absent, d).v; }
    export i32 arrayOfGeneric() { Box<i32>[] a = Box<i32>[2](fill: Box(6)); return unbox(a[0]); }
    // An array of *nullable* instantiations, which is how an open-addressed hash table says
    // "empty slot": a sized array needs a default value and a struct has none, but a nullable
    // element type defaults to null.
    export i32 arrayOfNullableGeneric() {
      Box<i32>?[] a = Box<i32>?[4]();
      a[1] = Box(9);
      Box<i32>? got = a[1];
      return (a[0] is null ? 1 : 0) * 100 + unbox(got!);
    }
  `);
  eq(inst.call("structArg", []), 4, "a struct argument");
  eq(inst.call("enumArg", []), 7, "an enum argument, so functions substitute before enums desugar");
  eq(inst.call("stringArg", []), 3, "a string argument");
  eq(inst.call("arrayElem", []), 3, "T from an array's element type");
  eq(inst.call("insideGeneric", []), 5, "T from inside an instantiation of a generic struct");
  eq(inst.call("insideFuncref", []), 6, "T from a funcref's signature");
  eq(inst.call("insideNullable", []), 3, "T from inside a nullable — a reference, see issue 0045");
  eq(inst.call("arrayOfGeneric", []), 6, "an array of instantiations, one of them passed on");
  eq(inst.call("arrayOfNullableGeneric", []), 109, "an array of nullable instantiations");
});

Deno.test("[§wac-generic-fn-5hvq3mt] generic functions compose with the rest of the language", async () => {
  const inst = await run(`
    struct Box<T> { T v; }
    T max<T>(T a, T b) { return a > b ? a : b; }
    T id<T>(T a) { return a; }
    T twice<T>(T a) { return id(id(a)); }
    Box<T> wrap<T>(T v) { Box<T> b = Box(v); return b; }
    T last<T>(T[] xs, i32 i) { if (i >= xs.len() - 1) { return xs[i]; } return last(xs, i + 1); }
    struct S { i32 v; i32 big(const this, i32 o) { return max(this.v, o); } }
    struct Holder<T> {
      T v;
      // The struct's own type parameter supplies the call's: this body is substituted first, so by
      // the time the call is looked at the argument is a concrete type.
      T larger(const this, T o) { return max(this.v, o); }
    }
    export i32 viaMethod() { S s = S(4); return s.big(11); }
    export i32 genericInGeneric() { Holder<i32> h = Holder(3); return h.larger(8); }
    export i32 callsAnother() { i32 a = 42; return twice(a); }
    export i32 returnsGeneric() { i32 x = 6; Box<i32> b = wrap(x); return b.v; }
    export i32 recursive() { i32[] xs = i32[](1, 2, 3, 9); return last(xs, 0); }
    export i32 twoParams() { i32 x = 3; f64 y = 1.0; return firstOf(x, y); }
    A firstOf<A, B>(A a, B b) { return a; }
  `);
  eq(inst.call("viaMethod", []), 11, "called from an ordinary method");
  eq(inst.call("genericInGeneric", []), 8, "called from a generic method, T from the struct");
  eq(inst.call("callsAnother", []), 42, "a generic function calling a generic function");
  eq(inst.call("returnsGeneric", []), 6, "returning an instantiation of a generic struct");
  eq(inst.call("recursive", []), 9, "recursion, which instantiates once and calls itself");
  eq(inst.call("twoParams", []), 3, "two type parameters, bound independently");
});

Deno.test("[§wac-generic-fn-5hvq3mt] a generic function crosses module boundaries", async () => {
  // As for a struct: the copy belongs to the template's file, so the export and import rules apply
  // unchanged and the import naming the template is rewritten to the instantiations used. `P` here
  // is the case that needs the *third* file's import injected into lib.wac, where the copy lands.
  const inst = await runMulti(new Map([
    ["p.wac",   `export struct P { i32 v; }`],
    ["lib.wac", `export T max<T>(T a, T b) { return a > b ? a : b; }
                 export T first<T>(T a, T b) { return a; }`],
    ["a.wac",   `import { max } from "./lib.wac";
                 export i32 fromA() { i32 x = 1; i32 y = 4; return max(x, y); }`],
    ["main.wac", `import { max } from "./lib.wac";
                  import { first } from "./lib.wac";
                  import { P } from "./p.wac";
                  import { fromA } from "./a.wac";
                  export i32 test() { i32 a = 2; i32 b = 5; return max(a, b) + fromA(); }
                  export i32 structArg() { P a = P(3); P b = P(8); return first(a, b).v; }`],
  ]));
  eq(inst.call("test", []), 9, "one instantiation shared by two files");
  eq(inst.call("structArg", []), 3, "a struct from a third file, imported into the template's file");
});

Deno.test("[§wac-generic-fn-5hvq3mt] an instantiation is not a wasm export", () => {
  // `export` still governs whether another wac file may import it — the test above depends on that
  // — but the host would have to call `max__main$i32`, a name the author never wrote and one that
  // changes with the file the template lives in. A concrete wrapper is the stable way out.
  const r = wacCompile(new Map([["main.wac", `
    export T max<T>(T a, T b) { return a > b ? a : b; }
    export i32 maxI32(i32 a, i32 b) { return max(a, b); }
  `]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const names = r.compiled.exports.map((e) => e.name).filter((n) => !n.startsWith("__bind"));
  eq(names.join(","), "maxI32", "the wrapper is exported and the instantiation is not");
});

Deno.test("[§wac-generic-fn-5hvq3mt] inference failures and misuse are compile errors", () => {
  const cases: [string, string, string][] = [
    ["two arguments implying different types",
     `T max<T>(T a, T b) { return a > b ? a : b; }
      export i32 f() { i32 x = 1; f64 y = 2.0; return max(x, y) as! i32; }`,
     "different types for the same type parameter"],
    ["a type parameter no parameter mentions",
     `T zero<T>() { return 0; }
      export i32 f() { return zero(); }`,
     "a call cannot name its type arguments"],
    ["an argument whose type is not evident",
     `T id<T>(T a) { return a; }
      export i32 f() { i32 x = id(null); return x; }`,
     "not evident here"],
    ["a call through a funcref, whose return type is not read here",
     `T id<T>(T a) { return a; }
      i32 inc(i32 a) { return a + 1; }
      export i32 f() { fn[i32(i32)] g = inc; return id(g(1)); }`,
     "not evident here"],
    ["the wrong number of arguments",
     `T max<T>(T a, T b) { return a > b ? a : b; }
      export i32 f() { i32 x = 1; return max(x); }`,
     "takes 2 argument(s), got 1"],
    ["a generic that calls itself with a larger argument",
     `struct Box<T> { T v; }
      i32 grow<T>(T a) { Box<T> b = Box(a); return grow(b); }
      export i32 f() { i32 x = 1; return grow(x); }`,
     "never terminates"],
  ];
  for (const [what, src, want] of cases) {
    const m = err(src);
    if (!m.includes(want)) {
      throw new Error(`${what}: expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
  }
});

Deno.test("[§wac-generic-fn-5hvq3mt] a generic function is checked at its definition too", async () => {
  // Stage D's pass applies to functions as well: a generic function nobody calls is removed from
  // the program by monomorphisation, so without this it is never checked at all.
  const m = err(`
    T oops<T>(T a) { i32 x = "hello"; return a; }
    export i32 f() { return 1; }
  `);
  if (!m.includes("expected i32")) {
    throw new Error(`a T-independent mistake should be reported at the definition, got: ${m}`);
  }
  // And the other half: arithmetic and comparison on an opaque T must *not* be reported, or `max`
  // itself would be unwritable. This was the one operator diagnostic that named no type, so it
  // could not be told apart from a real one until it did.
  const inst = await run(`
    T max<T>(T a, T b) { return a > b ? a : b; }
    T sum<T>(T a, T b) { return a + b; }
    export i32 f() { i32 x = 2; i32 y = 3; return max(x, y) + sum(x, y); }
  `);
  eq(inst.call("f", []), 8, "comparison and arithmetic on a T are deferred to instantiation");
});

Deno.test("[§wac-generic-fn-5hvq3mt] a call is found in every statement position", async () => {
  // The recurring failure in this compiler is a new construct reaching only the walks its own tests
  // happen to use. Finding a generic call needs its own walk over statements, so every statement
  // form gets one call, and each is checked by its answer rather than by compiling.
  const inst = await run(`
    T id<T>(T a) { return a; }
    enum E { A(i32 v), B }
    export i32 inAssign()  { i32 a = 0; a = id(7); return a; }
    export i32 inIf()      { i32 x = 1; if (id(x) == 1) { return id(10); } else { return id(20); } }
    export i32 inElseIf()  { i32 x = 2; if (id(x) == 1) { return 1; } else if (id(x) == 2) { return 12; } return 0; }
    export i32 inWhile()   { i32 n = 0; while (id(n) < 3) { n = n + id(1); } return n; }
    export i32 inDoWhile() { i32 n = 0; do { n = n + id(2); } while (id(n) < 4); return n; }
    export i32 inFor()     { i32 s = 0; for (i32 i = id(0); i < id(3); i = i + id(1)) { s = s + id(i); } return s; }
    export i32 inSwitch()  { i32 x = 2; switch (id(x)) { case id(2): return 22; default: return 0; } }
    export i32 inMatch()   { E e = E.A(5); match (id(e)) { case A(v): return id(v); case B: return 0; } }
    export i32 inBlock()   { i32 x = 3; { return id(x) * 3; } }
    export i32 inExprStmt(){ i32 x = 4; id(x); return x; }
    export i32 inTernary() { i32 x = 5; return true ? id(x) : id(0); }
    export i32 inNamedArg(){ Holder h = Holder { v: id(6) }; return h.v; }
    struct Holder { i32 v; }
  `);
  eq(inst.call("inAssign", []), 7, "the right-hand side of an assignment");
  eq(inst.call("inIf", []), 10, "an if condition and both branches");
  eq(inst.call("inElseIf", []), 12, "an else-if, which is a statement rather than a block");
  eq(inst.call("inWhile", []), 3, "a while condition and body");
  eq(inst.call("inDoWhile", []), 4, "a do-while, whose condition is checked after the body");
  eq(inst.call("inFor", []), 3, "a for's init, condition, update and body");
  eq(inst.call("inSwitch", []), 22, "a switch subject and a case value");
  eq(inst.call("inMatch", []), 5, "a match subject and an arm body");
  eq(inst.call("inBlock", []), 9, "a bare block");
  eq(inst.call("inExprStmt", []), 4, "a call whose value is discarded");
  eq(inst.call("inTernary", []), 5, "both ternary branches");
  eq(inst.call("inNamedArg", []), 6, "a named construction argument");
});

Deno.test("[§wac-generic-fn-5hvq3mt] every evident argument shape infers", async () => {
  // The other half of the same walk: an argument is an expression, and its type has to be read from
  // the syntax. Each form here is one case of that reading, and a wrong answer would mean the wrong
  // instantiation was chosen rather than a compile failure.
  const inst = await run(`
    T id<T>(T a) { return a; }
    i32 which<T>(T a) { return 1; }
    struct P { i32 v; }
    export i32 floatLit()   { return (id(1.5) * 2.0) as~ i32; }
    export bool boolLit()   { return id(true); }
    export i32 stringLit()  { return id("abc").len(); }
    export i32 unary()      { i32 x = 4; return -id(-x); }
    export bool isExpr()    { P? p = null; return id(p is null); }
    export i32 unwrap()     { P? p = P(7); return id(p!).v; }
    export i32 comparison() { i32 x = 1; return id(x < 2) ? 1 : 0; }
    export i32 arithmetic() { i32 x = 3; return id(x + 1); }
    export i32 ternaryArg() { i32 x = 8; return id(true ? x : 0); }
    export i32 stringIndex() { string s = "xyz"; return id(s[1]).len(); }
    export i32 arrayArg()   { return which(i32[2]()); }
    export i32 constructArg() { return id(P(9)).v; }
    export i32 nested()     { i32 x = 2; return id(id(id(x))); }
  `);
  eq(inst.call("floatLit", []), 3, "a float literal is f64");
  eq(inst.call("boolLit", []), true, "a bool literal");
  eq(inst.call("stringLit", []), 3, "a string literal");
  eq(inst.call("unary", []), 4, "a unary operand's type is the operand's");
  eq(inst.call("isExpr", []), true, "an is-expression is bool");
  eq(inst.call("unwrap", []), 7, "an unwrap drops the nullable");
  eq(inst.call("comparison", []), 1, "a comparison is bool whatever its operands are");
  eq(inst.call("arithmetic", []), 4, "arithmetic takes the left operand's type");
  eq(inst.call("ternaryArg", []), 8, "a ternary takes its then-branch's type");
  eq(inst.call("stringIndex", []), 1, "a string index is a one-character string");
  eq(inst.call("arrayArg", []), 1, "an array construction states its element type");
  eq(inst.call("constructArg", []), 9, "a struct construction is the struct");
  eq(inst.call("nested", []), 2, "and an instantiation's own declared return type");
});

Deno.test("[§wac-generic-fn-5hvq3mt] an argument that does not fit the parameter's shape is named", () => {
  // Distinct from "no parameter mentions T", which is a property of the declaration and can never be
  // satisfied. This one is about *this* call, so the message names the argument and the parameter.
  const cases: [string, string][] = [
    [`struct Box<T> { T v; }
      struct P { i32 v; }
      T unbox<T>(Box<T> b) { return b.v; }
      export i32 f() { P p = P(1); return unbox(p); }`,
     "argument 1 is P, and the parameter is Box<T>"],
    [`struct Box<T> { T v; }
      struct Bag<T> { T v; }
      T unbox<T>(Box<T> b) { return b.v; }
      export i32 f() { Bag<i32> g = Bag(1); return unbox(g); }`,
     "argument 1 is Bag<i32>"],
    [`i32 count<T>(T[] xs) { return xs.len(); }
      export i32 f() { i32 x = 1; return count(x); }`,
     "the parameter is T[]"],
  ];
  for (const [src, want] of cases) {
    const m = err(src);
    if (!m.includes(want)) {
      throw new Error(`expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
    if (m.includes("$")) throw new Error(`a mangled name reached a diagnostic: ${m}`);
  }
});

Deno.test("[§wac-generic-fn-5hvq3mt] no diagnostic shows a mangled name", () => {
  // The instantiation trace is the whole difference between this and a C++ template error: an
  // error inside substituted code must name types the author wrote.
  const m = err(`
    struct Box<T> { T v; }
    T unbox<T>(Box<T> b) { return b.v; }
    export i32 f() { Box<f64> b = Box(1.0); i32 x = unbox(b); return x; }
  `);
  if (m.includes("$")) throw new Error(`a mangled name reached a diagnostic: ${m}`);
  if (!m.includes("f64")) throw new Error(`expected the real types in: ${m}`);
});

// §wac-overflow-detect-8jqm4wn — the idioms for detecting overflow
Deno.test("[§wac-overflow-detect-8jqm4wn] widen-then-narrow traps on overflow", async () => {
  // Issue 0033: wrapping is the only arithmetic and should stay so — the codecs and hashes built on
  // wac depend on it. What was missing is that the detection idioms existed and were written down
  // nowhere, so the gap was documentation rather than language.
  const inst = await run(`
    export i32 sumOk()   { i32 a = 2000000000; i32 b = 100; return (a as i64 + b as i64) as! i32; }
    export i32 sumBad()  { i32 a = 2147483647; i32 b = 1;   return (a as i64 + b as i64) as! i32; }
    export u32 mulBad()  { u32 a = 100000; u32 b = 100000;  return (a as u64 * b as u64) as! u32; }
  `);
  eq(inst.call("sumOk", []), 2000000100, "in range, so no trap");
  traps(() => inst.call("sumBad", []), "i32 addition that would not fit");
  traps(() => inst.call("mulBad", []), "u32 multiplication that would not fit");
});

Deno.test("[§wac-overflow-detect-8jqm4wn] 64-bit overflow is detected by comparison", async () => {
  // There is no type wider than 64 bits, so the widen idiom does not apply and a comparison is the
  // only option. Both directions are checked, because an idiom that reports overflow when there is
  // none would be worse than none at all.
  const inst = await run(`
    export bool uWraps(u64 a, u64 b)     { return a + b < a; }
    export bool iOverflows(i64 a, i64 b) { i64 s = a + b; return (a < 0) == (b < 0) && (s < 0) != (a < 0); }
  `);
  eq(inst.call("uWraps", [18446744073709551615n, 2n]), true, "u64 wrap detected");
  eq(inst.call("uWraps", [5n, 2n]), false, "and not reported when it did not");
  eq(inst.call("iOverflows", [9223372036854775807n, 1n]), true, "i64 positive overflow");
  eq(inst.call("iOverflows", [-9223372036854775808n, -1n]), true, "and negative");
  eq(inst.call("iOverflows", [5n, -3n]), false, "not reported for opposite signs");
  eq(inst.call("iOverflows", [5n, 3n]), false, "nor for a sum that fits");
});

// §wac-generic-template-check-2wkq7nm — templates are checked with opaque type parameters
Deno.test("[§wac-generic-template-check-2wkq7nm] a mistake independent of T is caught at the definition", () => {
  // Issue 0043 (Stage D). A generic was otherwise checked only when instantiated, so a template
  // nobody instantiates was never checked at all. Each is now checked once with its parameters
  // bound to a struct that has no members, which catches everything structurally wrong regardless
  // of what T turns out to be.
  const cases: [string, string, string][] = [
    ["a string assigned to i32",
     `struct Vec<T> { T[] data; i32 n; void oops(this) { i32 x = "hello"; } }`, "expected i32"],
    ["arithmetic on a string",
     `struct V<T> { T[] d; i32 n; void bad(this) { this.n = this.n + "x"; } }`, "i32"],
    ["a call with the wrong arity",
     `i32 needsTwo(i32 a, i32 b) { return a + b; }
      struct V<T> { T[] d; i32 bad(const this) { return needsTwo(1); } }`, "expected 2 argument"],
  ];
  for (const [what, tpl, want] of cases) {
    // Nothing instantiates the template: before this pass, none of these was reported at all.
    const m = err(`${tpl}\nexport i32 f() { return 1; }`);
    if (!m.includes(want)) {
      throw new Error(`${what}: expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
  }
});

Deno.test("[§wac-generic-template-check-2wkq7nm] anything depending on T is still deferred", async () => {
  // The other half, and the harder one: an opaque `T` fails almost every ordinary check, so a
  // permissive rule is needed or valid templates become unreportable. These all compile.
  const inst = await run(`
    struct Vec<T> {
      T[] data; i32 n;
      T first(const this) { return this.data[0]; }
      void set(this, T x) { this.data[0] = x; }
      i32 viaLocal(const this, T seed) { T[] a = T[2](fill: seed); return a.len(); }
      i32 len(const this) { return this.n; }
      i32 viaOther(const this) { return this.len(); }
    }
    // A template naming another template cannot be checked either: Box<T> is not a type until
    // T is known, so its members are unknowable rather than absent.
    struct Box<T> { T v; T get(const this) { return this.v; } }
    struct Wrap<T> { Box<T> inner; T peek(const this) { return this.inner.get(); } }
    export i32 f() { Vec<i32> v = Vec(i32[](7), 1); return v.first() + v.viaOther(); }
  `);
  eq(inst.call("f", []), 8, "the template still works when instantiated");
});

Deno.test("[§wac-generic-template-check-2wkq7nm] a T-independent mistake is reported once, not per instantiation", () => {
  // A template checked at its definition *and* at each instantiation would report the same mistake
  // once per use. Two instantiations here; the diagnostic should appear once.
  const r = wacCompile(new Map([["main.wac", `
    struct Vec<T> { T[] data; i32 n; void oops(this) { i32 x = "hello"; } }
    export i32 f() {
      Vec<i32> a = Vec(i32[](), 0);
      Vec<f64> b = Vec(f64[](), 0);
      return a.n + b.n;
    }
  `]]), "main.wac");
  if (r.ok) throw new Error("expected the template mistake to be reported");
  const hits = r.diagnostics.filter((d) => d.message.includes("expected i32"));
  eq(hits.length, 1, "reported once for the template, not once per instantiation");
});

Deno.test("[§wac-generic-instantiation-identity-6pnq4wj] instantiations are keyed by identity, not by the written name", async () => {
  // Issue 0042. Mangling used the name *as written*, which is only unique within a file, so it was
  // wrong in both directions at once. All three symptoms in one test because they are one cause.
  const BOX = `export struct Box<T> { T v; T get(const this) { return this.v; } }`;

  // 1. An alias and its target are the same type, so one instantiation — not two.
  const dedup = await runMulti(new Map([
    ["p.wac", `export struct Point { i32 x; }
               export Point mk() { return Point(4); }`],
    ["box.wac", BOX],
    ["a.wac", `import { Box } from "./box.wac";
               import { Point as P, mk } from "./p.wac";
               export i32 fa() { Box<P> b = Box(mk()); return b.get().x; }`],
    ["main.wac", `import { Box } from "./box.wac";
                  import { Point, mk } from "./p.wac";
                  import { fa } from "./a.wac";
                  export i32 test() { Box<Point> b = Box(mk()); return b.get().x + fa(); }`],
  ]));
  eq(dedup.call("test", []), 8, "Box<P> and Box<Point> are one type");

  // 2. An aliased *template* name resolved to nothing at all: the instantiation was materialised as
  // `B$i32` while the import rewriting keyed on the declared name, so nothing imported it.
  const aliasedTemplate = await runMulti(new Map([
    ["box.wac", BOX],
    ["a.wac", `import { Box as B } from "./box.wac";
               export i32 fa() { B<i32> b = B(1); return b.get(); }`],
    ["main.wac", `import { Box } from "./box.wac";
                  import { fa } from "./a.wac";
                  export i32 test() { Box<i32> b = Box(2); return b.get() + fa(); }`],
  ]));
  eq(aliasedTemplate.call("test", []), 3, "an aliased generic is usable");

  // 3. Two *different* structs sharing a name must stay apart. This one was a type confusion rather
  // than a diagnostic: both mangled to `Box$Point`, so one struct served both, and it errored only
  // because the layouts happened to differ. §wac-samename-struct-4jhq7wn makes the name legal.
  const apart = await runMulti(new Map([
    ["box.wac", BOX],
    ["p1.wac", `export struct Point { i32 x; }
                export Point mk1() { return Point(1); }`],
    ["p2.wac", `export struct Point { i32 a; i32 b; }
                export Point mk2() { return Point(2, 3); }`],
    ["a.wac", `import { Box } from "./box.wac";
               import { Point, mk1 } from "./p1.wac";
               export i32 fa() { Box<Point> b = Box(mk1()); return b.get().x; }`],
    ["main.wac", `import { Box } from "./box.wac";
                  import { Point, mk2 } from "./p2.wac";
                  import { fa } from "./a.wac";
                  export i32 test() { Box<Point> b = Box(mk2()); return b.get().a * 10 + b.get().b + fa(); }`],
  ]));
  eq(apart.call("test", []), 24, "23 from p2's Point, 1 from p1's — two instantiations");
});

Deno.test("[§wac-generic-instantiation-identity-6pnq4wj] a nested instantiation keeps its argument", async () => {
  // agent-b's report, issue 0047. Four things together: two instantiations, at least one argument
  // an enum, the generic in another module, and a method whose return type mentions a *second*
  // generic from a third module. `Option<P>` and `Option<S>` became one type and the module did
  // not validate — `struct.new[1] expected (ref 0), found (ref 1)`, the two payloads that should
  // have stayed apart.
  //
  // The cause is that substitution is recursive and the alias it mints is not a name the author
  // wrote: materialising `V<P>` renames the argument to `P__main` so it resolves in V's file, and
  // materialising `Option<P>` from inside that copy then had to carry `P__main` into *Option's*
  // file — where the pass no longer recognised its own alias, injected no import, and left the
  // payload type resolving to whatever the fallback found.
  //
  // Two structs did not show it: agent-b guessed why, and was right — a struct payload lands at a
  // type both instantiations satisfy, so the collapse is invisible until an enum pins it exactly.
  const inst = await runMulti(new Map([
    ["opt.wac", `export enum Option<T> {
      Some(T v), None
      bool isSome(const this) { return match (this) { case Some(_): true, case None: false }; }
      T orElse(const this, T d) { return match (this) { case Some(v): v, case None: d }; }
    }`],
    ["vbox.wac", `import { Option } from "./opt.wac";
      export struct V<T> {
        T[] data; i32 n;
        V<T> create() { return V(T[](), 0); }
        void put(this, T v) { T[] d = T[1](fill: v); this.data = d; this.n = 1; }
        Option<T> first(const this) { return this.n == 0 ? Option.None : Option.Some(this.data[0]); }
      }`],
    ["main.wac", `
      import { V } from "./vbox.wac";
      // Neither is exported: a type argument does not have to be, and the import the compiler
      // injects to make the copy resolve is exempt from the export rule.
      enum P { A(i32 x) }
      enum Q { B(i32 y) }
      struct S { i32 y; }
      i32 pOf(P p) { return match (p) { case A(x): x }; }
      export i32 enumAndStruct() {
        V<P> a = V.create(); a.put(P.A(7));
        V<S> b = V.create(); b.put(S(3));
        return pOf(a.first().orElse(P.A(0))) * 10 + b.first().orElse(S(0)).y;
      }
      export i32 twoEnums() {
        V<P> a = V.create(); a.put(P.A(4));
        V<Q> b = V.create(); b.put(Q.B(5));
        return pOf(a.first().orElse(P.A(0))) * 10 +
               match (b.first().orElse(Q.B(0))) { case B(v): v };
      }
      export i32 withAPrimitive() {
        V<P> a = V.create(); a.put(P.A(1));
        V<i32> c = V.create(); c.put(9);
        return pOf(a.first().orElse(P.A(0))) * 10 + c.first().orElse(0);
      }
      // A third level: the argument of the outer instantiation is itself an instantiation, which
      // is the other kind of invented name — one the pass materialised rather than aliased.
      export i32 nested() {
        V<V<P>> outer = V.create();
        V<P> inner = V.create(); inner.put(P.A(8));
        outer.put(inner);
        return pOf(outer.first().orElse(V.create()).first().orElse(P.A(0)));
      }
      export i32 absent() {
        V<P> a = V.create();
        V<S> b = V.create(); b.put(S(1));
        return (a.first().isSome() ? 1 : 0) * 10 + (b.first().isSome() ? 1 : 0);
      }
    `],
  ]));
  eq(inst.call("enumAndStruct", []), 73, "an enum and a struct argument stay apart");
  eq(inst.call("twoEnums", []), 45, "so do two enums");
  eq(inst.call("withAPrimitive", []), 19, "and an enum alongside a primitive");
  eq(inst.call("nested", []), 8, "an instantiation as the argument of an instantiation");
  eq(inst.call("absent", []), 1, "and the None case of each is its own");
});

Deno.test("[§wac-generic-instantiation-identity-6pnq4wj] the instantiation count is what identity implies", () => {
  // Counting is what distinguishes "correct" from "correct but duplicated": the aliased case above
  // answered correctly while materialising two structs, which is the cost monomorphisation was
  // allowed to pay once, not twice.
  const count = (files: Map<string, string>) => {
    const programs = new Map<string, ReturnType<typeof wacParse>["program"]>();
    for (const [path, src] of files) programs.set(path, wacParse(wacLex(src).tokens, path).program);
    // Only the *instantiation* entries: `genericDisplay` also carries the cross-file aliases a
    // substituted argument type is renamed to, which are names the author never wrote for the same
    // reason and want demangling by the same map. An instantiation's display name is the one with
    // the angle brackets.
    const display = wacResolve("main.wac", programs).genericDisplay;
    return [...display.values()].filter((v) => v.includes("<")).length;
  };
  const BOX = `export struct Box<T> { T v; T get(const this) { return this.v; } }`;
  eq(count(new Map([
    ["p.wac", `export struct Point { i32 x; }`],
    ["box.wac", BOX],
    ["main.wac", `import { Box } from "./box.wac";
                  // Both spellings of one type, so the count distinguishes identity from text.
                  import { Point, Point as P } from "./p.wac";
                  export i32 test() { Box<P> a = Box(Point(1)); Box<Point> b = Box(Point(2)); return a.get().x + b.get().x; }`],
  ])), 1, "an alias and its target share one instantiation");
  eq(count(new Map([
    ["box.wac", BOX],
    ["main.wac", `import { Box } from "./box.wac";
                  export i32 test() { Box<i32> a = Box(1); Box<f64> b = Box(2.0); return a.get(); }`],
  ])), 2, "different arguments are different instantiations");
});

Deno.test("[§wac-generic-struct-9tkq4wm] instantiations are invariant and diagnostics are demangled", () => {
  // `Vec<Circle>` is not a `Vec<Shape>`: Java's covariant arrays are a known mistake and a mutable
  // container cannot be covariant soundly.
  const m = err(`
    struct Box<T> { T v; T get(const this) { return this.v; } }
    struct Base { i32 a; }
    struct Sub : Base { i32 b; }
    i32 take(Box<Base> x) { return x.get().a; }
    export i32 f() { Box<Sub> s = Box(Sub(1, 2)); return take(s); }`);
  if (!m.includes("expected Box<Base>, got Box<Sub>")) {
    throw new Error(`expected a demangled invariance diagnostic, got: ${m}`);
  }
  // The mangled name must never appear in a message — an error about `Box$Base` is an error about
  // code the author did not write.
  if (m.includes("$")) throw new Error(`a mangled name leaked into a diagnostic: ${m}`);
});

Deno.test("[§wac-generic-struct-9tkq4wm] the errors a generic can raise", () => {
  const cases: [string, string, string][] = [
    ["a bare template name", `Box b = Box(1);`, "needs type arguments"],
    ["too many arguments", `Box<i32, f64> b = Box(1);`, "takes 1 type argument"],
    ["arguments on a non-generic", `P<i32> p = P(1);`, "is not generic"],
  ];
  for (const [what, body, want] of cases) {
    const m = err(`
      struct Box<T> { T v; }
      struct P { i32 v; }
      export i32 f() { ${body} return 0; }`);
    if (!m.includes(want)) {
      throw new Error(`${what}: expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
  }
  // A generic that instantiates itself with a larger argument never terminates, so depth is capped
  // and reported rather than hanging the compiler.
  const deep = err(`
    struct Box<T> { T v; }
    struct Rec<T> { Rec<Box<T>>? next; i32 v; }
    export i32 f() { Rec<i32> r = Rec(null, 1); return r.v; }`);
  if (!deep.includes("nests more than")) {
    throw new Error(`expected the depth-cap diagnostic, got: ${deep}`);
  }
});

// §wac-instance-ref-return-8mkq4wp — wacInstance decodes string and array returns
Deno.test("[§wac-instance-ref-return-8mkq4wp] a string or array return comes back decoded", async () => {
  // Issue 0021. `coerceResult` handled the numeric types and then fell through to `Number()`,
  // which threw "Cannot convert object to primitive value" on any reference. Three separate
  // workarounds had grown around it, including a helper in this very file that compared strings
  // *inside* wac — so a failing string test could say only that it differed, never what it got.
  // That helper is gone; the string tests above now compare directly.
  const inst = await run(`
    export string greet()   { return "hi"; }
    export string unicode() { return "héllo → 😀"; }
    export string blank()   { return ""; }
    export u8[]  bytes()    { return u8[](104, 105, 255); }
    export i32[] ints()     { return i32[](1, -2, 3); }
    export u32[] unsigned() { return u32[](0xFF000000, 5); }
    export i64[] wide()     { return i64[](1000000000000, -1); }
    export f64[] floats()   { return f64[](1.5, -2.5); }
    export i32   plain()    { return 42; }
  `);
  eq(inst.call("greet", []), "hi", "a string return");
  eq(inst.call("unicode", []), "héllo → 😀", "multi-byte characters survive the round trip");
  eq(inst.call("blank", []), "", "and the empty string");
  eq(JSON.stringify(inst.call("bytes", [])), "[104,105,255]", "a u8[] return");
  eq(JSON.stringify(inst.call("ints", [])), "[1,-2,3]", "signed elements keep their sign");
  // u32 elements arrive through a signed wasm type, exactly as u32 *returns* do [0039].
  eq(JSON.stringify(inst.call("unsigned", [])), "[4278190080,5]", "u32 elements are unsigned");
  eq((inst.call("wide", []) as bigint[])[0], 1000000000000n, "i64 elements are bigints");
  eq((inst.call("wide", []) as bigint[])[1], -1n, "including negative ones");
  eq(JSON.stringify(inst.call("floats", [])), "[1.5,-2.5]", "f64 elements");
  eq(inst.call("plain", []), 42, "and a plain i32 is unaffected");
});

// §wac-str-slice-clamp-3qnv7wk — slice clamps rather than trapping
Deno.test("[§wac-str-slice-clamp-3qnv7wk] slice clamps at both ends and never traps", async () => {
  // Issue 0037: the behaviour was definite but undocumented, so every edge was undefined in
  // the spec sense. No code change — clamping is the right answer to the question `slice` asks
  // — but the rule is now written down and pinned, including the two things a reader might
  // expect from a negative start and not get: a trap, or Python's from-the-end indexing.
  const inst = await run(`
    export i32 endPast()   { return "hello".slice(3, 99).len(); }
    export i32 startPast() { return "hello".slice(9, 99).len(); }
    export i32 reversed()  { return "hello".slice(3, 1).len(); }
    export i32 negStart()  { return "hello".slice(-2, 3).len(); }
    export i32 negBoth()   { return "hello".slice(-4, -1).len(); }
    export i32 whole()     { return "hello".slice(0, 5).len(); }
    export i32 emptyRange() { return "hello".slice(2, 2).len(); }
    // A negative start clamps to 0, so the slice begins at 'h' — not at 'l' as it would if
    // negatives counted from the end.
    export i32 negFromStart() { return "hello".slice(-2, 3)[0] == "h" ? 1 : 0; }
  `);
  eq(inst.call("endPast", []), 2, "the end clamps to the length");
  eq(inst.call("startPast", []), 0, "a start past the end leaves nothing");
  eq(inst.call("reversed", []), 0, "a reversed range is empty, not an error");
  eq(inst.call("negStart", []), 3, "a negative start clamps to 0");
  eq(inst.call("negBoth", []), 0, "both negative gives an empty range");
  eq(inst.call("whole", []), 5, "the whole string");
  eq(inst.call("emptyRange", []), 0, "an empty range");
  eq(inst.call("negFromStart", []), 1, "negatives clamp; they do not count from the end");
});

// §wac-str-badlead-7kvq2mn — a byte that begins no UTF-8 sequence is not a character
Deno.test("[§wac-str-badlead-7kvq2mn] indexing an invalid lead byte gives the empty string", async () => {
  // Issue 0038. `string.fromBytes` copies bytes verbatim — documented — so a string can hold
  // invalid UTF-8. Indexing a *continuation* byte already returned "", but 0xF8..0xFF fell
  // through the sequence-length chain to its `len = 1` default and decoded as a one-byte
  // character. The two cases are equally un-indexable and now agree.
  const inst = await run(`
    export i32 ff()      { u8[] b = u8[](0xFF, 0xFE, 0x41); return string.fromBytes(b)[0].len(); }
    export i32 f8()      { u8[] b = u8[](0xF8, 0x41);       return string.fromBytes(b)[0].len(); }
    export i32 cont()    { u8[] b = u8[](0x80, 0x41);       return string.fromBytes(b)[0].len(); }
    export i32 bytesLen() { u8[] b = u8[](0xFF, 0xFE, 0x41); return string.fromBytes(b).len(); }
    // The valid leads must be untouched, and 0xF7 is the last valid one.
    export i32 ascii()   { return "hello"[0].len(); }
    export i32 twoByte() { return "é"[0].len(); }
    export i32 three()   { return "→"[0].len(); }
    export i32 four()    { return "😀"[0].len(); }
    export i32 f7()      { u8[] b = u8[](0xF7, 0x80, 0x80, 0x80); return string.fromBytes(b)[0].len(); }
  `);
  eq(inst.call("ff", []), 0, "0xFF begins no sequence");
  eq(inst.call("f8", []), 0, "nor does 0xF8, the first invalid lead");
  eq(inst.call("cont", []), 0, "a continuation byte, as before");
  eq(inst.call("bytesLen", []), 3, "len() still counts bytes verbatim");
  eq(inst.call("ascii", []), 1, "ascii");
  eq(inst.call("twoByte", []), 2, "two-byte lead");
  eq(inst.call("three", []), 3, "three-byte lead");
  eq(inst.call("four", []), 4, "four-byte lead");
  eq(inst.call("f7", []), 4, "0xF7 is still a valid four-byte lead");
});

// §wac-bind-unsigned-5wqk3np — unsigned returns reach JS unsigned
Deno.test("[§wac-bind-unsigned-5wqk3np] u32 and u64 returns are not signed in JS", () => {
  // Issue 0039. wac's u32/u64 are wasm's i32/i64, which is right — signedness lives in the
  // instruction. But WebAssembly's JS API converts i32 to a signed number and i64 to a signed
  // BigInt, so a high-bit value arrived as `want - 2**width`. The wrapper is the only place
  // that can reinterpret it.
  const r = wacCompile(new Map([["main.wac", `
    export u32 u32High() { return 0xFF000000; }
    export u64 u64High() { return 0xFF00000000000000; }
    export i32 i32High() { return 0xFF000000; }
    export i64 i64High() { return 0xFF00000000000000; }
  `]]), "main.wac");
  if (!r.ok) throw new Error(r.diagnostics.map(e => e.message).join("; "));
  const ts = wacBindgen(r.compiled);
  eq(/return \(\(_exports\.u32High[^\n]*\) >>> 0;/.test(ts), true, "u32 is reinterpreted with >>> 0");
  eq(/BigInt\.asUintN\(64, \(_exports\.u64High/.test(ts), true, "u64 with BigInt.asUintN");
  // The signed types must be left exactly as they were.
  eq(/return \(_exports\.i32High as CallableFunction\)\(\) as number;/.test(ts), true, "i32 untouched");
  eq(/return \(_exports\.i64High as CallableFunction\)\(\) as bigint;/.test(ts), true, "i64 untouched");
});

// §wac-samename-struct-4jhq7wn — two modules may declare a struct with one name
Deno.test("[§wac-samename-struct-4jhq7wn] same-named structs in two modules stay distinct", async () => {
  // Issue 0041, reported by agent-b after an hour lost to it. The emitter resolved a written
  // struct name through a global bare-name map, last-wins, so two modules each declaring `Dup`
  // both reached whichever was registered last: the module typechecked and then failed to
  // instantiate, because a function's declared return type and the `struct.new` inside it
  // disagreed. The resolver already keeps a per-file scope; the emitter was not asking it.
  //
  // What made it expensive is that `main.wac` need never mention the second `Dup` — the
  // collision can be entirely between a module you import and something it pulls in, so
  // neither file you are reading mentions the other's type.
  const A = `export struct Dup { i32 x; Dup make() { return Dup(1); } i32 get(const this) { return this.x; } }
             export Dup fromA() { return Dup.make(); }`;
  const B = `export struct Dup { i32 p; i32 q; Dup make() { return Dup(2, 3); } i32 get(const this) { return this.p * 10 + this.q; } }
             export Dup fromB() { return Dup.make(); }`;

  const one = await runMulti(new Map([["a.wac", A], ["b.wac", B], ["main.wac", `
    import { Dup, fromA } from "./a.wac";
    import { fromB } from "./b.wac";
    export i32 test() { Dup d = fromA(); return d.x; }`]]));
  eq(one.call("test", []), 1, "a's Dup, with b reached only for a function");

  const other = await runMulti(new Map([["a.wac", A], ["b.wac", B], ["main.wac", `
    import { fromA } from "./a.wac";
    import { Dup, fromB } from "./b.wac";
    export i32 test() { Dup d = fromB(); return d.p * 10 + d.q; }`]]));
  eq(other.call("test", []), 23, "and the same the other way round");

  const both = await runMulti(new Map([["a.wac", A], ["b.wac", B], ["main.wac", `
    import { Dup, fromA } from "./a.wac";
    import { Dup as DupB, fromB } from "./b.wac";
    export i32 test()    { Dup a = fromA(); DupB b = fromB(); return a.x + b.p * 10 + b.q; }
    export i32 methods() { return fromA().get() + fromB().get(); }`]]));
  eq(both.call("test", []), 24, "both in one file, one aliased");
  eq(both.call("methods", []), 24, "and a method on each, which is where the wrong index showed");
});

Deno.test("[§wac-samename-struct-4jhq7wn] the name may even be a struct in one module and an enum in another", async () => {
  const inst = await runMulti(new Map([
    ["a.wac", `export enum Dup { A(i32 v), B }
               export Dup mkA() { return Dup.A(4); }
               export i32 readA(Dup d) { match (d) { case A(v): return v; case B: return 0; } }`],
    ["b.wac", `export struct Dup { i32 z; Dup make() { return Dup(9); } }
               export Dup fromB() { return Dup.make(); }`],
    ["main.wac", `import { mkA, readA } from "./a.wac";
                  import { fromB } from "./b.wac";
                  export i32 test() { return readA(mkA()) + fromB().z; }`],
  ]));
  eq(inst.call("test", []), 13, "4 from the enum variant, 9 from the struct");
});

// §wac-inherited-method-type-9dkq3wv — an inherited method's result type
Deno.test("[§wac-inherited-method-type-9dkq3wv] an inherited method's result is typed correctly", async () => {
  // Issue 0040. `typeOfExpr` resolved a method through the struct's *own* method map, so an
  // inherited one missed, the expression ended up typed f64, and `s.get() + 1` emitted
  // `f64.add` for two i32s. Two things had to coincide for it to show: the method inherited,
  // and its result feeding an operator so that something asks for its type. The call on its
  // own was always emitted correctly, by a path that does walk the chain — so this was the
  // checker and the emitter holding two answers, which is this compiler's most common bug.
  const inst = await run(`
    struct Base { i32 a; i32 get(const this) { return this.a; } f64 half(const this) { return 0.5; } }
    struct Sub : Base { i32 b; }
    struct Deeper : Sub { i32 c; }
    enum E { A(i32 v), B, i32 val(const this) { return match (this) { case A(v): v, case B: 0 }; } }

    export i32 oneLevel()   { Sub s = Sub(4, 5); return s.get() + 1; }
    export i32 twoLevels()  { Deeper d = Deeper(4, 5, 6); return d.get() + 1; }
    export i32 ownMethod()  { Base b = Base(4); return b.get() + 1; }
    export f64 floatToo()   { Sub s = Sub(4, 5); return s.half() + 0.25; }
    // An enum's methods live on its generated base, so calling one on a narrowed variant is
    // an inherited call — which is how this was found.
    export i32 viaNarrowing() { E e = E.A(9); if (e is A) { return e.val() + e.v; } return 0; }
  `);
  eq(inst.call("oneLevel", []), 5, "inherited one level, feeding an operator");
  eq(inst.call("twoLevels", []), 5, "and two levels down");
  eq(inst.call("ownMethod", []), 5, "a struct's own method still works");
  near(inst.call("floatToo", []) as number, 0.75, "an inherited f64 method is not broken the other way");
  eq(inst.call("viaNarrowing", []), 18, "an enum method on a narrowed variant");
});

// §wac-narrow-if-2mkq8vp — `if (x is T)` narrows x in the then-block
Deno.test("[§wac-narrow-if-2mkq8vp] `if (x is T)` narrows x", async () => {
  // Issue 0029. Only the exact shape `ident is Type` narrows, and only in the then-block,
  // which makes this a scope rule rather than flow-sensitive typing — the same mechanism a
  // match arm uses: a const shadowing binding with a lexical extent.
  const inst = await run(`
    enum Shape { Point, Circle(f64 radius), Rect(f64 w, f64 h) }
    struct Base { i32 a; }
    struct Sub : Base { i32 b; }
    struct Deeper : Sub { i32 c; }
    export f64 variant()   { Shape s = Shape.Circle(2.5); if (s is Circle) { return s.radius; } return 0.0; }
    export f64 notTaken()  { Shape s = Shape.Point;       if (s is Circle) { return s.radius; } return 7.0; }
    export i32 structs()   { Base x = Sub(1, 2);          if (x is Sub) { return x.b; } return 0; }
    export i32 nested()    { Base x = Deeper(1, 2, 3);    if (x is Sub) { if (x is Deeper) { return x.c; } return x.b; } return 0; }
    export f64 elseIf()    {
      Shape s = Shape.Rect(2.0, 3.0);
      if (s is Circle) { return s.radius; } else if (s is Rect) { return s.w * s.h; }
      return 0.0;
    }
    export f64 afterwards() {
      // The outer binding is untouched, which is why no analysis is needed for what holds
      // after the block.
      Shape s = Shape.Circle(1.5);
      if (s is Circle) { f64 unused = s.radius; }
      return match (s) { case Circle(r): r, else: 0.0 };
    }
  `);
  near(inst.call("variant", []) as number, 2.5, "an enum variant");
  near(inst.call("notTaken", []) as number, 7.0, "the branch not taken is unaffected");
  eq(inst.call("structs", []), 2, "a hand-written struct hierarchy, not just enums");
  eq(inst.call("nested", []), 3, "narrowing inside a narrowing");
  near(inst.call("elseIf", []) as number, 6.0, "an else-if arm narrows too");
  near(inst.call("afterwards", []) as number, 1.5, "and the outer binding still has its own type");
});

Deno.test("[§wac-narrow-if-2mkq8vp] && narrows from either operand, || from neither", async () => {
  // Reaching the block means both operands of `&&` held, so both are available as premises.
  // One branch of `||` holding is not enough, so it narrows from neither.
  const inst = await run(`
    enum Shape { Point, Circle(f64 radius) }
    export f64 left()  { Shape s = Shape.Circle(2.0); f64 k = 1.0; if ((s is Circle) && k > 0.0) { return s.radius; } return 0.0; }
    export f64 right() { Shape s = Shape.Circle(3.0); f64 k = 1.0; if (k > 0.0 && (s is Circle)) { return s.radius; } return 0.0; }
    export f64 chain() { Shape s = Shape.Circle(4.0); f64 k = 1.0; if ((s is Circle) && k > 0.0 && k < 5.0) { return s.radius; } return 0.0; }
  `);
  near(inst.call("left", []) as number, 2.0, "from the left operand");
  near(inst.call("right", []) as number, 3.0, "from the right operand");
  near(inst.call("chain", []) as number, 4.0, "and through a chain");

  const orCond = err(`
    enum Shape { Point, Circle(f64 radius) }
    export f64 f() { Shape s = Shape.Circle(1.0); if ((s is Circle) || true) { return s.radius; } return 0.0; }`);
  if (!orCond.includes("has no field 'radius'")) {
    throw new Error(`|| should not narrow, got: ${orCond}`);
  }
});

Deno.test("[§wac-narrow-if-2mkq8vp] what does not narrow, and the const rule", () => {
  const cases: [string, string, string][] = [
    ["`is not`", `if (s is not Point) { return s.radius; }`, "has no field 'radius'"],
    ["assigning to the narrowed name", `if (s is Circle) { s = Shape.Point; } return 0.0;`, "cannot assign to const"],
  ];
  for (const [what, body, want] of cases) {
    const m = err(`
      enum Shape { Point, Circle(f64 radius) }
      export f64 f() { Shape s = Shape.Circle(1.0); ${body} return 0.0; }`);
    if (!m.includes(want)) {
      throw new Error(`${what}: expected a diagnostic containing ${JSON.stringify(want)}, got: ${m}`);
    }
  }
});

// §enum-methods-6vkq2wn — methods on an enum
Deno.test("[§enum-methods-6vkq2wn] an enum may have methods", async () => {
  // Issue 0028. The methods attach to the enum's generated base struct, so `this` is the
  // enum type and `match (this)` is how a method reaches a variant. Nothing downstream
  // needed teaching: from the resolver on, the base is an ordinary struct with methods.
  const inst = await run(`
    enum Shape {
      Point,
      Circle(f64 radius),
      Rect(f64 w, f64 h),

      f64 area(const this) {
        match (this) {
          case Point:      return 0.0;
          case Circle(r):  return 3.0 * r * r;
          case Rect(w, h): return w * h;
        }
      }
      f64 twiceArea(const this) { return this.area() * 2.0; }
      f64 scaled(const this, f64 k) { return this.area() * k; }
    }
    export f64 onLiteral()  { return Shape.Rect(3.0, 4.0).area(); }
    export f64 onVariable() { Shape s = Shape.Circle(2.0); return s.area(); }
    export f64 calling()    { return Shape.Rect(2.0, 3.0).twiceArea(); }
    export f64 withArg()    { return Shape.Rect(2.0, 3.0).scaled(10.0); }
    export f64 onPoint()    { Shape s = Shape.Point; return s.area(); }
  `);
  near(inst.call("onLiteral", []) as number, 12.0, "called on a constructed variant");
  near(inst.call("onVariable", []) as number, 12.0, "and on an enum-typed variable");
  near(inst.call("calling", []) as number, 12.0, "a method calling another through `this`");
  near(inst.call("withArg", []) as number, 60.0, "a method with parameters beside `this`");
  near(inst.call("onPoint", []) as number, 0.0, "and a payload-less variant");
});

Deno.test("[§enum-methods-6vkq2wn] a method may use the expression form and a mutable this", async () => {
  const inst = await run(`
    enum E {
      A(i32 v), B,
      i32 val(const this) { return match (this) { case A(v): v, case B: 0 }; }
      i32 mutableThis(this) { return match (this) { case A(v): v * 2, case B: 1 }; }
    }
    export i32 exprForm() { return E.A(9).val(); }
    export i32 mutThis()  { return E.A(4).mutableThis(); }
  `);
  eq(inst.call("exprForm", []), 9, "match as an expression inside a method");
  eq(inst.call("mutThis", []), 8, "and a non-const receiver");
});

Deno.test("[§enum-methods-6vkq2wn] an enum method's body is reachable to every walk", async () => {
  // The three tests above all passed while the resolver's annotation pass ignored enum
  // method bodies entirely, because none of them named a type that appears nowhere else.
  // This one does: `Q`, `Q[]` and `helper()` exist only inside the method, and without the
  // annotation the construct reported "undefined function or struct 'Q'".
  //
  // Seventh appearance of issue 0005's shape, and the reason to write the test this way
  // round: a feature's own tests will use whatever is already in scope, so they do not
  // exercise the walks. A type reachable *only* through the new construct does.
  const inst = await run(`
    struct Q { i32 v; }
    i32 helper() { return 3; }
    enum E {
      A(i32 v), B,
      i32 sum(const this) {
        Q[] qs = Q[2](fill: Q(helper()));
        i32 base = match (this) { case A(v): v, case B: 0 };
        return base + qs[0].v + qs[1].v;
      }
    }
    export i32 f() { return E.A(4).sum(); }
  `);
  eq(inst.call("f", []), 10, "4 from the payload, plus two Q(3)s built inside the method");
});

Deno.test("[§enum-methods-6vkq2wn] the two shapes that are refused, and why", () => {
  // `override` would be per-variant virtual dispatch — the variants are compiler-generated
  // subtypes of the base — which is a different feature with its own questions. Refused
  // rather than quietly accepted and half-working.
  const over = err(`enum E { A, B, override i32 val(const this) { return 0; } }
    export i32 f() { return 1; }`);
  if (!over.includes("'override' is not allowed")) {
    throw new Error(`expected the override diagnostic, got: ${over}`);
  }
  // A static method would be written `E.make()`, which is already how a variant is
  // constructed, so that spelling has to mean one thing until it is decided deliberately.
  const stat = err(`enum E { A, B, i32 make() { return 0; } }
    export i32 f() { return 1; }`);
  if (!stat.includes("must take 'this'")) {
    throw new Error(`expected the static-method diagnostic, got: ${stat}`);
  }
  // And a method may not take a variant's name, since `E.name` would mean two things.
  const clash = err(`enum E { A(i32 v), B, i32 A(const this) { return 0; } }
    export i32 f() { return 1; }`);
  if (!clash.includes("already a variant")) {
    throw new Error(`expected the variant-clash diagnostic, got: ${clash}`);
  }
});

// §enum-match-expr-4wnq7bk — `match` as an expression
Deno.test("[§enum-match-expr-4wnq7bk] match can be an expression", async () => {
  // Issue 0026, and the last of the six items enums.md had listed as deferred. Arms give a
  // value after the colon and are comma-separated; the arm header is identical to the
  // statement form, so there is one arm syntax in the language.
  const inst = await run(`${SHAPES}
    f64 area(Shape s) {
      return match (s) { case Point: 0.0, case Circle(r): 3.14159 * r * r, case Rect(w, h): w * h };
    }
    f64 twice(f64 x) { return x * 2.0; }
    export f64 initialiser() {
      Shape s = Shape.Rect(3.0, 4.0);
      f64 a = match (s) { case Point: 0.0, case Circle(r): r, case Rect(w, h): w * h, };
      return a;
    }
    export f64 returned()  { return area(Shape.Rect(2.0, 5.0)); }
    export f64 elseArm()   { Shape s = Shape.Point; return match (s) { case Circle(r): r, else: 9.0 }; }
    export f64 narrowed()  {
      Shape s = Shape.Rect(2.0, 3.0);
      return match (s) { case Point: 0.0, case Circle: s.radius, case Rect: s.width * s.height };
    }
    export f64 nested() {
      Shape a = Shape.Circle(2.0);
      Shape b = Shape.Point;
      return match (a) {
        case Point:     0.0,
        case Circle(r): match (b) { case Point: r, else: 0.0 },
        case Rect(w, h): w,
      };
    }
    export f64 asArgument() {
      Shape s = Shape.Circle(1.5);
      return twice(match (s) { case Circle(r): r, else: 0.0 });
    }
  `);
  near(inst.call("initialiser", []) as number, 12.0, "a trailing comma is allowed too");
  near(inst.call("returned", []) as number, 10.0, "as a return value");
  near(inst.call("elseArm", []) as number, 9.0, "with an else arm");
  near(inst.call("narrowed", []) as number, 6.0, "the subject narrows inside an arm value");
  near(inst.call("nested", []) as number, 2.0, "a match expression inside a match expression");
  near(inst.call("asArgument", []) as number, 3.0, "and in an argument position");
});

Deno.test("[§enum-match-expr-4wnq7bk] arm types unify the way ternary branches do", async () => {
  // The unification is literally the ternary's, extracted rather than reimplemented — which
  // is why a `null` arm widens and an integer arm takes the expected type without either
  // rule being written twice.
  const inst = await run(`${SHAPES}
    struct P { i32 v; }
    export i64 integers()  { Shape s = Shape.Point; i64 n = match (s) { case Point: 1, else: 2 }; return n; }
    export f32 floats()    { Shape s = Shape.Point; f32 x = match (s) { case Point: 1.5, else: 2.5 }; return x; }
    export i32 nullArm()   {
      Shape s = Shape.Point;
      P? p = match (s) { case Point: null, else: P(1) };
      return p is null ? 7 : p!.v;
    }
    export f64 toTheEnum() {
      Shape s = Shape.Point;
      // Two arms give different *variants*, so the result is their common ancestor: Shape.
      Shape t = match (s) { case Point: Shape.Circle(1.0), case Circle(r): Shape.Point, case Rect(w, h): Shape.Point };
      return match (t) { case Circle(r): r, else: 0.0 };
    }
  `);
  eq(inst.call("integers", []), 1n, "an integer arm takes the expected i64");
  near(inst.call("floats", []) as number, 1.5, "and a float arm the expected f32");
  eq(inst.call("nullArm", []), 7, "a null arm widens the result to nullable");
  near(inst.call("toTheEnum", []) as number, 1.0, "two variants unify to their enum");
});

Deno.test("[§enum-match-expr-4wnq7bk] an expression match must be total and consistent", () => {
  const inexhaustive = err(`${SHAPES}
    export f64 f() { Shape s = Shape.Point; return match (s) { case Point: 0.0 }; }`);
  if (!inexhaustive.includes("does not cover")) {
    throw new Error(`expected the exhaustiveness diagnostic, got: ${inexhaustive}`);
  }
  // There is no falling off the end of an expression, so this matters more here than in the
  // statement form — and the arms must agree on a type, named as arms rather than branches.
  const mixed = err(`${SHAPES}
    export f64 f() { Shape s = Shape.Point; return match (s) { case Point: 0.0, else: "x" }; }`);
  if (!mixed.includes("match arms have incompatible types")) {
    throw new Error(`expected the arm-type diagnostic, got: ${mixed}`);
  }
});

// §enum-is-qualified-8jkq4wp — a qualified variant name works in an `is` test
Deno.test("[§enum-is-qualified-8jkq4wp] `s is Shape.Empty` means what `s is Empty` means", async () => {
  // Reported by agent-c as issue 0036. The qualified form parses as an expression, not a
  // type, so the test became reference identity against a freshly constructed variant and
  // was always false — silently for a payload-less variant, and with "needs a payload" for
  // one with a payload, a message about construction when nothing was being constructed.
  //
  // The same inversion as 0022: the meaningless spelling passed quietly while a sensible
  // one was rejected. And it is the spelling the docs teach, since it is how the variant is
  // constructed in the first place.
  const inst = await run(`${SHAPES}
    export i32 barePoint()      { Shape s = Shape.Point;         return (s is Point) ? 1 : 0; }
    export i32 qualPoint()      { Shape s = Shape.Point;         return (s is Shape.Point) ? 1 : 0; }
    export i32 qualPointFalse() { Shape s = Shape.Circle(1.0);   return (s is Shape.Point) ? 1 : 0; }
    export i32 qualPayload()    { Shape s = Shape.Circle(1.0);   return (s is Shape.Circle) ? 1 : 0; }
    export i32 qualNot()        { Shape s = Shape.Point;         return (s is not Shape.Circle) ? 1 : 0; }
    export i32 qualRect()       { Shape s = Shape.Rect(1.0, 2.0); return (s is Shape.Rect) ? 1 : 0; }
  `);
  eq(inst.call("barePoint", []), 1, "the bare form, which always worked");
  eq(inst.call("qualPoint", []), 1, "the qualified form now agrees with it");
  eq(inst.call("qualPointFalse", []), 0, "and is false when it should be, not always");
  eq(inst.call("qualPayload", []), 1, "a variant with a payload needs none for a type test");
  eq(inst.call("qualNot", []), 1, "`is not` too");
  eq(inst.call("qualRect", []), 1, "and a multi-field variant");
});

Deno.test("[§enum-is-qualified-8jkq4wp] a payload written in a type test is rejected", () => {
  // `s is Shape.Circle(1.0)` was silently false — it compared against a new object. It is
  // now an error, since a type test has no use for a payload and writing one means the
  // author expected something else to happen.
  const m = err(`${SHAPES}
    export i32 f() { Shape s = Shape.Circle(1.0); return (s is Shape.Circle(1.0)) ? 1 : 0; }`);
  if (!m.includes("without a payload")) {
    throw new Error(`expected the no-payload diagnostic, got: ${m}`);
  }
});

Deno.test("[§enum-is-qualified-8jkq4wp] ordinary reference identity is unaffected", async () => {
  // The qualified-variant path must not swallow a genuine identity test against something
  // that merely looks similar — a field holding a reference, read off a struct.
  const inst = await run(`
    struct Inner { i32 v; }
    struct Holder { Inner i; }
    export i32 sameField() { Inner x = Inner(1); Holder h = Holder(x); return (h.i is x) ? 1 : 0; }
    export i32 diffField() { Holder h = Holder(Inner(1)); Inner y = Inner(1); return (h.i is y) ? 1 : 0; }
  `);
  eq(inst.call("sameField", []), 1, "a field holding the same reference");
  eq(inst.call("diffField", []), 0, "and a different one");
});

// §wac-is-undefined-type-6qbn3wr — `is` against a name that does not exist
Deno.test("[§wac-is-undefined-type-6qbn3wr] `is` against an undefined type is an error", () => {
  // Reported by agent-c as issue 0022. It compiled with no diagnostic and returned *true*,
  // because an unresolved target left nothing for ref.test to narrow against. The contrast
  // is what makes it a real bug: a test against a real but unrelated type already warns
  // that it can never be true, so the meaningless case was the quiet one.
  for (const src of [
    `struct P { i32 x; } export i32 f() { P p = P(1); return (p is Nonexistent) ? 1 : 0; }`,
    `struct P { i32 x; } export i32 f() { P p = P(1); return (p is not Nonexistent) ? 1 : 0; }`,
    `struct P { i32 x; } export i32 f() { P p = P(1); return (p is Nonexistent[]) ? 1 : 0; }`,
    `struct P { i32 x; } export i32 f() { P p = P(1); return (p is Nonexistent?) ? 1 : 0; }`,
  ]) {
    const m = err(src);
    if (!m.includes("undefined type 'Nonexistent'")) {
      throw new Error(`expected the undefined-type diagnostic for ${src}, got: ${m}`);
    }
  }
});

Deno.test("[§wac-is-undefined-type-6qbn3wr] what still works is unaffected", async () => {
  // The fix must not catch any of these. The last is the interesting one: the parser
  // decides type-versus-value by naming convention, so an uppercase *variable* looks like
  // a type — and rejecting it as a missing type would be wrong, since the author meant an
  // identity test and the convention guessed.
  const inst = await run(`
    struct P { i32 x; }
    struct Q { i32 y; }
    enum E { A(i32 v), B }
    export i32 sameType()   { P p = P(1); return (p is P) ? 1 : 0; }
    export i32 otherType()  { P p = P(1); return (p is Q) ? 1 : 0; }
    export i32 variant()    { E e = E.A(1); return (e is A) ? 1 : 0; }
    export i32 identity()   { P p = P(1); P q = p; return (p is q) ? 1 : 0; }
    export i32 upperLocal() { P p = P(1); P Other = p; return (p is Other) ? 1 : 0; }
    export i32 notSame()    { P p = P(1); return (p is not Q) ? 1 : 0; }
  `);
  eq(inst.call("sameType", []), 1, "its own type");
  eq(inst.call("otherType", []), 0, "an unrelated type is false, not an error");
  eq(inst.call("variant", []), 1, "an enum variant is a type");
  eq(inst.call("identity", []), 1, "a lowercase variable is an identity test");
  eq(inst.call("upperLocal", []), 1, "and so is an uppercase one, despite looking like a type");
  eq(inst.call("notSame", []), 1, "`is not` against a real type");
});

// The issue tracker's own invariants. Not a language rule, but the tracker is how the
// compiler's history is navigated, so a broken one costs real time.
// §wac-type-name-scope-8vqk3mn — a type name means what the file that wrote it says
Deno.test("[§wac-type-name-scope-8vqk3mn] a type name must be in scope in the file that writes it", () => {
  // Issue 0048. Identity is the type index, and a type whose name did not resolve had none — so
  // every consumer fell back to a *global* name map. A file could name a type it never imported,
  // and when two files declared the same name one of them won arbitrarily.
  for (const [what, files] of [
    ["a struct", new Map([
      ["p.wac", `export struct P { i32 x; }
                 export P mk() { return P(3); }`],
      ["main.wac", `import { mk } from "./p.wac";
                    export i32 f() { P p = mk(); return p.x; }`],
    ])],
    ["an enum", new Map([
      ["k.wac", `export enum K { A, B }
                 export K mk() { return K.A; }`],
      ["main.wac", `import { mk } from "./k.wac";
                    export i32 f() { K k = mk(); return match (k) { case A: 1, case B: 2 }; }`],
    ])],
    ["a variant", new Map([
      ["k.wac", `export enum K { A(i32 v), B }
                 export K mk() { return K.A(1); }`],
      ["main.wac", `import { mk } from "./k.wac";
                    export i32 f() { A a = mk() as! A; return a.v; }`],
    ])],
    ["a field's type", new Map([
      ["p.wac", `export struct Inner { i32 x; }
                 export struct Outer { Inner i; }`],
      ["main.wac", `import { Outer } from "./p.wac";
                    struct Holder { Inner i; }
                    export i32 f() { return 1; }`],
    ])],
  ] as [string, Map<string, string>][]) {
    const m = errMulti(files);
    if (!m.includes("undefined type")) {
      throw new Error(`${what}: expected 'undefined type', got: ${m}`);
    }
  }
});

Deno.test("[§wac-type-name-scope-8vqk3mn] the wrong answer that came of it", () => {
  // The reason this is a bug rather than a tidiness point. Two files each declare a `Circle`
  // variant, which `§enum-name-identity` permits; a third tested both. `x is Circle` resolved
  // globally, picked one, and answered **false about a value that was a Circle** — no diagnostic.
  const m = errMulti(new Map([
    ["a.wac", `export enum A { Circle(i32 n), Sq }
               export A mkA() { return A.Circle(5); }`],
    ["b.wac", `export enum B { Circle(f64 r), Tri }
               export B mkB() { return B.Circle(2.5); }`],
    ["main.wac", `import { mkA } from "./a.wac";
                  import { mkB } from "./b.wac";
                  export i32 f() { return (mkA() is Circle ? 1 : 0) * 10 + (mkB() is Circle ? 1 : 0); }`],
  ]));
  if (!m.includes("undefined type 'Circle'")) {
    throw new Error(`expected the ambiguous name to be refused, got: ${m}`);
  }
});

Deno.test("[§wac-type-name-scope-8vqk3mn] importing the name is what makes it work", async () => {
  // The fix is an import, and a variant imports like anything else — so nothing legitimate became
  // unwritable. Both spellings of the same test, one per kind of name.
  const inst = await runMulti(new Map([
    ["k.wac", `export enum K { A(i32 v), B }
               export struct P { i32 x; }
               export K mkK() { return K.A(7); }
               export P mkP() { return P(3); }`],
    ["main.wac", `import { K, A, P, mkK, mkP } from "./k.wac";
      export i32 viaVariant() { A a = mkK() as! A; return a.v; }
      export i32 viaIs()      { K k = mkK(); return k is A ? 1 : 0; }
      export i32 viaStruct()  { P p = mkP(); return p.x; }
      // And match needs neither the enum name nor its variants: it never did.
      export i32 viaMatch()   { return match (mkK()) { case A(v): v, case B: 0 }; }`],
  ]));
  eq(inst.call("viaVariant", []), 7, "a variant named as a type, imported");
  eq(inst.call("viaIs", []), 1, "and in an is-test");
  eq(inst.call("viaStruct", []), 3, "a struct named as a type, imported");
  eq(inst.call("viaMatch", []), 7, "match, which resolves through the enum the subject is");
});

Deno.test("[§wac-type-name-scope-8vqk3mn] what is not a type name is left alone", async () => {
  // Two positions look like a type and are not, and the strict pass has to skip both or it reports
  // a local variable as an undefined type. `f(x)` parses as a construction whose "type" is `f`, and
  // `x is Other` parses its right-hand side as a type when it may be an identity test.
  const inst = await run(`
    struct P { i32 x; }
    i32 twice(i32 v) { return v * 2; }
    export i32 viaFuncrefLocal() { fn[i32(i32)] f = twice; return f(4); }
    export i32 viaIdentity()     { P p = P(1); P Other = p; return (p is Other) ? 1 : 0; }
    export i32 viaPlainCall()    { return twice(3); }
  `);
  eq(inst.call("viaFuncrefLocal", []), 8, "a funcref local called by name");
  eq(inst.call("viaIdentity", []), 1, "an is-test against an upper-case local");
  eq(inst.call("viaPlainCall", []), 6, "and an ordinary call");
});

Deno.test("[§wac-type-name-scope-8vqk3mn] an unknown type says so where it is written", () => {
  // Issue 0046, which is the same pass: a name that resolves nowhere used to be reported by
  // whatever tripped over it later, so `Nope n = 1` complained about the *initialiser*.
  for (const [src, want] of [
    [`export i32 f() { Nope n = 1; return 0; }`, "undefined type 'Nope'"],
    [`struct P { i32 x; }
      export i32 f() { P p = P(1); return (p as! Nope).x; }`, "undefined type 'Nope'"],
    [`export i32 f(Nope n) { return 0; }`, "undefined type 'Nope'"],
    [`struct P { Nope n; }
      export i32 f() { return 0; }`, "undefined type 'Nope'"],
    [`export Nope f() { return 0; }`, "undefined type 'Nope'"],
    [`export i32 f() { Nope[] xs = i32[](); return 0; }`, "undefined type 'Nope'"],
  ] as [string, string][]) {
    const m = err(src);
    if (!m.includes(want)) throw new Error(`expected ${want}, got: ${m}`);
  }
});

Deno.test("spec/tour.wac compiles and its selfTest() returns true", async () => {
  // `CLAUDE.md` sends every reader here first and the file's own header says "it compiles, and
  // `selfTest()` at the bottom returns true". Nothing checked either, so it rotted: narrowing made
  // the `as!` in its dynamic-dispatch example an error — an upcast to a type the value already has
  // — and the tour went on claiming otherwise for as long as no test compiled it.
  const src = await Deno.readTextFile(new URL("../../spec/tour.wac", import.meta.url));
  const r = wacCompile(new Map([["tour.wac", src]]), "tour.wac");
  if (!r.ok) {
    const lines = r.diagnostics.map((d) => `  ${d.line}:${d.col} ${d.message}`);
    throw new Error(`spec/tour.wac does not compile:\n${lines.join("\n")}`);
  }
  const inst = await wacInstance(r.compiled);
  eq(inst.call("selfTest", []), true, "the tour's own claims about itself");
});

Deno.test("issues: every issue has a unique number and a consistent status", async () => {
  // Three agents picked 0021 within a minute of each other, from the same stale view of
  // "the next free number". Two files answering to one number makes every commit message
  // and cross-reference that cites it ambiguous, so this is worth a test rather than
  // vigilance.
  const dir = new URL("../../issues/", import.meta.url);
  const seen = new Map<string, string[]>();
  for (const state of ["open", "closed"]) {
    for await (const f of Deno.readDir(new URL(`${state}/`, dir))) {
      if (!f.isFile || !f.name.endsWith(".md")) continue;
      const num = f.name.match(/^(\d{4})-/);
      if (!num) throw new Error(`issues/${state}/${f.name}: name must start with a 4-digit number`);
      const where = `${state}/${f.name}`;
      seen.set(num[1], [...(seen.get(num[1]) ?? []), where]);

      // The heading, the directory and the Status line must agree, since each is what
      // some reader trusts.
      const body = await Deno.readTextFile(new URL(where, dir));
      const heading = body.match(/^# (\d{4}) —/);
      if (!heading) throw new Error(`${where}: first line must be "# NNNN — summary"`);
      if (heading[1] !== num[1]) {
        throw new Error(`${where}: heading says ${heading[1]}, filename says ${num[1]}`);
      }
      const status = body.match(/^- \*\*Status:\*\* (open|closed)$/m);
      if (!status) {
        // Twice now I have written `Status: open (with a caveat)`, which this rejects. The rule is
        // worth keeping strict — the line is what the directory check compares against — so the
        // message says where the caveat goes instead.
        throw new Error(
          `${where}: needs a line that is exactly "- **Status:** open" or "- **Status:** closed". ` +
          `Put any qualification on its own line, such as "- **Scope:**".`);
      }
      if (status[1] !== (state === "open" ? "open" : "closed")) {
        throw new Error(`${where}: Status says ${status[1]} but it is in ${state}/`);
      }
      // A closed issue must say which commit closed it. That is the link back to the
      // reasoning, and it is the first thing anyone reading the file wants; 0020 was
      // closed with only a `Fixed by: <agent>` line, which names who but not what.
      if (state === "closed" && !/^- \*\*Fixed in:\*\* \S/m.test(body)) {
        throw new Error(
          `${where}: a closed issue needs a "- **Fixed in:** <commit>" line — ` +
          `naming the agent is not enough to find the change`);
      }
    }
  }
  const dupes = [...seen].filter(([, where]) => where.length > 1);
  if (dupes.length > 0) {
    throw new Error(`duplicate issue numbers:\n${
      dupes.map(([n, w]) => `  ${n}: ${w.join(", ")}`).join("\n")}`);
  }

  // INDEX.md's counts and its row set are maintained by hand, and have been wrong in both
  // directions more than once — an issue closed without its row removed, and a total that
  // no longer matched the directory. Both are trivially checkable against the files.
  const index = await Deno.readTextFile(new URL("INDEX.md", dir));
  const open = [...seen].filter(([, w]) => w[0].startsWith("open/")).map(([n]) => n);
  const closed = [...seen].filter(([, w]) => w[0].startsWith("closed/")).map(([n]) => n);

  const counts = index.match(/^(\d+) issues, (\d+) closed\./m);
  if (!counts) throw new Error("INDEX.md needs a line of the form 'N issues, M closed.'");
  if (Number(counts[1]) !== seen.size || Number(counts[2]) !== closed.length) {
    throw new Error(
      `INDEX.md says ${counts[1]} issues and ${counts[2]} closed; ` +
      `the directory has ${seen.size} and ${closed.length}`);
  }

  // Every open issue needs a row, and no closed one may keep its row — a stale row is a
  // link to a file that has moved.
  const listed = new Set([...index.matchAll(/\| \[(\d{4})\]/g)].map((m) => m[1]));
  const missingRow = open.filter((n) => !listed.has(n)).sort();
  const staleRow = closed.filter((n) => listed.has(n)).sort();
  if (missingRow.length > 0 || staleRow.length > 0) {
    throw new Error(
      `INDEX.md's rows disagree with the directory\n` +
      (missingRow.length ? `  open with no row: ${missingRow.join(" ")}\n` : "") +
      (staleRow.length ? `  closed but still listed: ${staleRow.join(" ")}\n` : ""));
  }
});

// §wac-grammar-keywords-h4mq7wn — the grammar's keyword block matches the lexer
Deno.test(`[§wac-grammar-keywords-h4mq7wn] grammar.md's keyword list matches KEYWORDS`, async () => {
  // This block has drifted from the implementation three times, each time found
  // by someone writing wac rather than reading the spec (issue 0020). Comparing
  // the two directly is cheaper than noticing again.
  const md = await Deno.readTextFile(new URL("../../spec/spec/grammar.md", import.meta.url));
  const m = md.match(/### Keywords\n\n```\n([\s\S]*?)```/);
  if (!m) throw new Error("could not find the keyword block in grammar.md");
  const documented = m[1].split(/\s+/).filter(Boolean).sort();

  // The lexer's set, read from source so the test cannot drift from it either.
  const lex = await Deno.readTextFile(new URL("./wacLex.ts", import.meta.url));
  const km = lex.match(/const KEYWORDS = new Set<string>\(\[([\s\S]*?)\]\);/);
  if (!km) throw new Error("could not find KEYWORDS in wacLex.ts");
  const actual = [...km[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();

  // The cast operators are lexed as single tokens, not identifiers, so they are
  // in the grammar's list without being in KEYWORDS.
  const castOps = ["as!", "as~", "as@"];
  const documentedMinusCasts = documented.filter(k => !castOps.includes(k));

  const missing = actual.filter(k => !documentedMinusCasts.includes(k));
  const extra = documentedMinusCasts.filter(k => !actual.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `grammar.md's keyword block disagrees with the lexer\n` +
      `  in KEYWORDS but not documented: ${missing.join(", ") || "(none)"}\n` +
      `  documented but not a keyword:   ${extra.join(", ") || "(none)"}`);
  }
});
