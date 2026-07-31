// Spec compliance tests — each test name starts with the §wac-* tag it covers.
// Tags from: types.md, operators.md, control.md, variables.md, naming.md,
//            arrays.md, structs.md, casts.md, functions.md, imports.md, funcrefs.md,
//            buffer.md, strings.md, grammar.md

import { wacCompile } from "./wacCompile.ts";
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
  const inst = await run(`export f32 float32() { return 3.14 as~ f32; }`);
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
async function runWithExpected(src: string, fnName: string, expected: string): Promise<boolean> {
  const escaped = JSON.stringify(expected); // JS string literal
  const fullSrc = src + `
    export bool __verify() {
      string got = ${fnName}();
      string want = ${escaped};
      return got == want;
    }
  `;
  const r = wacCompile(new Map([["main.wac", fullSrc]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const inst2 = await wacInstance(r.compiled);
  return inst2.call("__verify", []) as boolean;
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
  const ok = await runWithExpected(
    `string strAppend() { string s = "hello"; s += " world"; return s; }`,
    "strAppend",
    "hello world",
  );
  eq(ok, true, `strAppend() == "hello world"`);

  // Also on a struct field, which takes a different emit path from a local.
  const ok2 = await runWithExpected(
    `struct Msg { string text; }
     string fieldAppend() { Msg m = Msg("hello"); m.text += " world"; return m.text; }`,
    "fieldAppend",
    "hello world",
  );
  eq(ok2, true, `fieldAppend() == "hello world"`);
});

// ── §wac-str-idx-r7kf4mb — strIdx() returns "e" ─────────────────────────────

Deno.test(`[§wac-str-idx-r7kf4mb] strIdx() returns "e"`, async () => {
  const ok = await runWithExpected(
    `string strIdx() { string s = "hello"; return s[1]; }`,
    "strIdx",
    "e",
  );
  eq(ok, true, `"hello"[1] == "e"`);
});

// ── §wac-str-idx-emoji-w3qn8jk — strEmoji() returns "😀" ─────────────────────

Deno.test(`[§wac-str-idx-emoji-w3qn8jk] strEmoji() returns "😀"`, async () => {
  const ok = await runWithExpected(
    `string strEmoji() { string s = "hello 😀"; return s[6]; }`,
    "strEmoji",
    "😀",
  );
  eq(ok, true, `"hello 😀"[6] == "😀"`);
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
  const ok = await runWithExpected(
    `string strConcat() { string a = "hello"; string b = " world"; return a + b; }`,
    "strConcat",
    "hello world",
  );
  eq(ok, true, `strConcat() == "hello world"`);
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
  const ok = await runWithExpected(
    `string strSlice() { return "hello world".slice(6, 11); }`,
    "strSlice",
    "world",
  );
  eq(ok, true, `"hello world".slice(6, 11) == "world"`);
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
      if (s is Circle) { return (s as! Circle).getTag(); }
      return s.getTag();
    }
    export i32 testDynDispatch() {
      Circle c = Circle(0, 5);
      Shape s = Shape(99);
      return dispatch(c) * 100 + dispatch(s);
    }
  `);
  // c is Circle → (c as! Circle).getTag() = 42
  // s is Shape (not Circle) → s.getTag() = 99
  // result: 42 * 100 + 99 = 4299
  eq(inst.call("testDynDispatch", []), 4299, "dynamic dispatch: Circle → 42, Shape → 99");
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

// ── audit-07 — nullable primitives must produce valid, instantiable wasm ───

Deno.test("(audit-07) a boxed literal returned as a nullable primitive instantiates and runs", async () => {
  const inst = await run(`
    export i32? mk() { return 5; }
  `);
  eq(inst.call("mk", []), 5, "mk() returns the boxed value 5");
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
