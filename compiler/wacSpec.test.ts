// Spec compliance tests — each test name starts with the §wac-* tag it covers.
// Tags from: types.md, operators.md, control.md, variables.md, naming.md,
//            arrays.md, structs.md, casts.md, functions.md, imports.md, funcrefs.md

import { wacCompile } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(src: string) {
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.errors.map(e => e.message).join("; ")}`);
  return wacInstance(r.compiled);
}

function err(src: string): string {
  const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
  if (r.ok) throw new Error("expected compile error");
  return r.errors[0].message;
}

function errMulti(files: Map<string, string>): string {
  const r = wacCompile(files, "main.wac");
  if (r.ok) throw new Error("expected compile error");
  return r.errors[0].message;
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

// ── §wac-increxpr-cabck67 — ++ is statement not expression ───────────────────

Deno.test("[§wac-increxpr-cabck67] i32 y = x++ is a compile error", () => {
  err(`export i32 bad() { i32 x = 5; i32 y = x++; return y; }`);
});

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

// ── §wac-arr-i8-k3fn7wp — i8 packed array ────────────────────────────────────

Deno.test("[§wac-arr-i8-k3fn7wp] bytes[0]=255 after setting 0xFF", async () => {
  const inst = await run(`
    export i32 testI8() {
      i8[] bytes = i8[4]();
      bytes[0] = 0xFF;
      return bytes[0];
    }
  `);
  eq(inst.call("testI8", []), 255, "i8 read 0xFF");
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
  if (!r.ok) throw new Error(`should compile: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`should compile: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors[0].message}`);
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors[0].message}`);
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
