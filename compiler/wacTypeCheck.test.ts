import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import { wacResolve, type ResolveResult } from "./wacResolve.ts";
import { wacTypeCheck, type TypeCheckError } from "./wacTypeCheck.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(src: string, path = "/main.wac"): Program {
  const { tokens } = wacLex(src);
  const { program } = wacParse(tokens, path);
  return program;
}

function makeMap(entries: [string, string][]): Map<string, Program> {
  return new Map(entries.map(([p, src]) => [p, parse(src, p)]));
}

/** Check a multi-file program and return type errors. */
function check(entry: string, files: [string, string][]): TypeCheckError[] {
  const programs = makeMap(files);
  const result = wacResolve(entry, programs);
  return wacTypeCheck(result, programs);
}

/** Single-file shorthand. */
function chk(src: string): TypeCheckError[] {
  return check("/main.wac", [["/main.wac", src]]);
}

/** Assert no type errors. */
function ok(src: string): void {
  const errs = chk(src);
  if (errs.length !== 0) {
    throw new Error(`Expected no errors, got: ${errs.map(e => e.message).join("; ")}`);
  }
}

/** Assert at least one error matching a substring. */
function fail(src: string, sub: string): void {
  const errs = chk(src);
  if (!errs.some(e => e.message.toLowerCase().includes(sub.toLowerCase()))) {
    throw new Error(
      `Expected error containing '${sub}', got: [${errs.map(e => e.message).join("; ")}]`,
    );
  }
}

/** Assert error count. */
function errCount(src: string, n: number): void {
  const errs = chk(src);
  if (errs.length !== n) {
    throw new Error(`Expected ${n} error(s), got ${errs.length}: ${errs.map(e => e.message).join("; ")}`);
  }
}

// ── Basics ────────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: empty program", () => { ok(""); });

Deno.test("wacTypeCheck: simple return i32", () => {
  ok("export i32 add(i32 a, i32 b) { return a + b; }");
});

Deno.test("wacTypeCheck: void function no return", () => {
  ok("export void greet() { }");
});

Deno.test("wacTypeCheck: void function with empty return", () => {
  ok("export void earlyReturn(bool flag) { if (flag) { return; } }");
});

Deno.test("wacTypeCheck: bool literals and logic", () => {
  ok(`export bool test() {
    bool a = true;
    bool b = false;
    return a && b || !a;
  }`);
});

Deno.test("wacTypeCheck: integer arithmetic", () => {
  ok(`export i32 arith(i32 x) {
    i32 y = x * 2 + 1;
    y -= 3;
    y++;
    y--;
    return y;
  }`);
});

Deno.test("wacTypeCheck: f64 arithmetic", () => {
  ok(`export f64 math(f64 a, f64 b) { return a * b + 1.5; }`);
});

// ── Type mismatches ───────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: return type mismatch", () => {
  fail("export i32 bad() { return true; }", "type mismatch");
});

Deno.test("wacTypeCheck: var init type mismatch", () => {
  fail("export void bad() { i32 x = true; }", "type mismatch");
});

Deno.test("wacTypeCheck: assign type mismatch", () => {
  fail("export void bad(i32 x) { x = true; }", "type mismatch");
});

Deno.test("wacTypeCheck: arithmetic type mismatch", () => {
  fail("export void bad(i32 x, f64 y) { i32 z = x + y; }", "type mismatch");
});

// ── Bool conditions ───────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: if condition must be bool", () => {
  fail("export void bad(i32 x) { if (x) { } }", "bool");
});

Deno.test("wacTypeCheck: while condition must be bool", () => {
  fail("export void bad(i32 x) { while (x) { } }", "bool");
});

Deno.test("wacTypeCheck: for condition must be bool", () => {
  fail("export void bad() { for (i32 i = 0; i; i++) { } }", "bool");
});

Deno.test("wacTypeCheck: dowhile condition must be bool", () => {
  fail("export void bad() { i32 i = 0; do { i++; } while (i); }", "bool");
});

Deno.test("wacTypeCheck: ternary condition must be bool", () => {
  fail("export i32 bad(i32 x) { return x ? 1 : 2; }", "bool");
});

// ── Return checking ───────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: missing return in non-void function", () => {
  fail("i32 bad(bool x) { if (x) { return 1; } }", "not all code paths");
});

Deno.test("wacTypeCheck: all paths return via if-else", () => {
  ok("i32 ok(bool x) { if (x) { return 1; } else { return 0; } }");
});

Deno.test("wacTypeCheck: switch with default all return", () => {
  ok(`i32 f(i32 x) {
    switch (x) {
      case 0: { return 1; }
      default: { return 0; }
    }
  }`);
});

Deno.test("wacTypeCheck: switch without default not all paths", () => {
  fail(`i32 bad(i32 x) {
    switch (x) { case 0: { return 1; } }
  }`, "not all code paths");
});

Deno.test("wacTypeCheck: trap terminates path", () => {
  ok("i32 ok(bool x) { if (x) { return 1; } else { trap; } }");
});

Deno.test("wacTypeCheck: void return with value", () => {
  fail("export void bad() { return 1; }", "void function cannot return");
});

Deno.test("wacTypeCheck: non-void return without value", () => {
  fail("i32 bad() { return; }", "missing return value");
});

// ── Break / continue ──────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: break outside loop is error", () => {
  fail("export void bad() { break; }", "break");
});

Deno.test("wacTypeCheck: continue outside loop is error", () => {
  fail("export void bad() { continue; }", "continue");
});

Deno.test("wacTypeCheck: break inside while is ok", () => {
  ok("export void ok() { while (true) { break; } }");
});

Deno.test("wacTypeCheck: continue inside for is ok", () => {
  ok("export void ok() { for (i32 i = 0; i < 10; i++) { continue; } }");
});

Deno.test("wacTypeCheck: break inside switch is ok", () => {
  ok(`export void ok(i32 x) {
    switch (x) { case 0: { break; } default: { break; } }
  }`);
});

// ── Packed types ──────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: i8 variable is error", () => {
  fail("export void bad() { i8 x = 5; }", "packed type");
});

Deno.test("wacTypeCheck: i16 parameter is error", () => {
  fail("i32 bad(i16 x) { return x; }", "packed type");
});

Deno.test("wacTypeCheck: i8 return type is error", () => {
  fail("i8 bad() { return 0; }", "packed type");
});

Deno.test("wacTypeCheck: i8 struct field is error", () => {
  fail("struct S { i8 x; } export void f() { }", "packed type");
});

Deno.test("wacTypeCheck: i8[] array element is ok", () => {
  ok("export void ok() { i8[] b = i8[4](); b[0] = 0xFF; i32 v = b[0]; }");
});

// ── Struct construction ───────────────────────────────────────────────────────

Deno.test("wacTypeCheck: positional struct construction", () => {
  ok(`struct Point { i32 x; i32 y; }
  export Point make() { return Point(3, 4); }`);
});

Deno.test("wacTypeCheck: named struct construction", () => {
  ok(`struct Point { i32 x; i32 y; }
  export Point make() { return Point { x: 3, y: 4 }; }`);
});

Deno.test("wacTypeCheck: default struct construction", () => {
  ok(`struct Point { i32 x; i32 y; }
  export Point zero() { return Point(); }`);
});

Deno.test("wacTypeCheck: positional wrong arg count", () => {
  fail(`struct Point { i32 x; i32 y; }
  export void bad() { Point p = Point(1); }`, "expects 2");
});

Deno.test("wacTypeCheck: positional wrong arg type", () => {
  fail(`struct Point { i32 x; i32 y; }
  export void bad() { Point p = Point(1, true); }`, "type mismatch");
});

Deno.test("wacTypeCheck: named missing field", () => {
  fail(`struct Point { i32 x; i32 y; }
  export void bad() { Point p = Point { x: 1 }; }`, "missing field");
});

Deno.test("wacTypeCheck: named unknown field", () => {
  fail(`struct Point { i32 x; i32 y; }
  export void bad() { Point p = Point { x: 1, y: 2, z: 3 }; }`, "no field");
});

Deno.test("wacTypeCheck: default construction no default (non-null ref field)", () => {
  fail(`struct Node { i32 val; Node next; }
  export void bad() { Node n = Node(); }`, "no default");
});

// ── Array construction ────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: array default construction", () => {
  ok("export void ok() { i32[] a = i32[5](); }");
});

Deno.test("wacTypeCheck: array fixed construction", () => {
  ok("export void ok() { i32[] a = i32[](1, 2, 3); }");
});

Deno.test("wacTypeCheck: array size must be i32", () => {
  fail("export void bad() { i32[] a = i32[true](); }", "i32");
});

Deno.test("wacTypeCheck: array fixed element type mismatch", () => {
  fail("export void bad() { i32[] a = i32[](1, true); }", "type mismatch");
});

Deno.test("wacTypeCheck: array index must be i32", () => {
  fail("export void bad(i32[] a) { i32 x = a[true]; }", "i32");
});

Deno.test("wacTypeCheck: array lval index must be i32", () => {
  fail("export void bad(i32[] a) { a[true] = 0; }", "i32");
});

// ── Field access ──────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: struct field read", () => {
  ok(`struct Point { i32 x; i32 y; }
  export i32 getX(Point p) { return p.x; }`);
});

Deno.test("wacTypeCheck: struct field write", () => {
  ok(`struct Point { i32 x; i32 y; }
  export void setX(Point p) { p.x = 5; }`);
});

Deno.test("wacTypeCheck: field on non-struct is error", () => {
  fail(`export void bad(i32 x) { i32 y = x.something; }`, "no field");
});

Deno.test("wacTypeCheck: unknown field is error", () => {
  fail(`struct P { i32 x; }
  export void bad(P p) { i32 y = p.z; }`, "no field");
});

Deno.test("wacTypeCheck: field on nullable requires unwrap", () => {
  fail(`struct P { i32 x; }
  export i32 bad(P? p) { return p.x; }`, "nullable");
});

// ── Const enforcement ─────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: const variable cannot be reassigned", () => {
  fail(`export void bad() {
    const i32 x = 5;
    x = 10;
  }`, "const");
});

Deno.test("wacTypeCheck: const struct field cannot be written", () => {
  fail(`struct P { const i32 id; i32 x; }
  export void bad(P p) { p.id = 5; }`, "const field");
});

Deno.test("wacTypeCheck: const struct all fields immutable", () => {
  fail(`const struct Config { i32 w; i32 h; }
  export void bad(Config c) { c.w = 5; }`, "const");
});

Deno.test("wacTypeCheck: deep const through reference", () => {
  fail(`struct P { i32 x; }
  struct Outer { P inner; }
  export void bad(const Outer o) { o.inner.x = 1; }`, "const");
});

// ── Method calls ──────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: instance method call", () => {
  ok(`struct Counter {
    i32 count;
    void inc(this) { this.count += 1; }
    i32 get(const this) { return this.count; }
  }
  export i32 test() {
    Counter c = Counter(0);
    c.inc();
    return c.get();
  }`);
});

Deno.test("wacTypeCheck: static method call", () => {
  ok(`struct Counter {
    i32 count;
    Counter make(i32 n) { return Counter(n); }
  }
  export Counter test() { return Counter.make(5); }`);
});

Deno.test("wacTypeCheck: calling non-const method through const this is error", () => {
  fail(`struct Inner {
    i32 val;
    void mutate(this) { this.val = 1; }
  }
  struct Outer {
    Inner inner;
    void bad(const this) { this.inner.mutate(); }
  }`, "non-const method");
});

Deno.test("wacTypeCheck: method call on nullable is error", () => {
  fail(`struct P { i32 x; void inc(this) { this.x++; } }
  export void bad(P? p) { p.inc(); }`, "nullable");
});

Deno.test("wacTypeCheck: static method via instance is error", () => {
  fail(`struct S {
    S make() { return S(); }
  }
  export void bad() {
    S s = S();
    S s2 = s.make();
  }`, "static method");
});

Deno.test("wacTypeCheck: unknown method is error", () => {
  fail(`struct P { i32 x; }
  export void bad(P p) { p.doThing(); }`, "no method");
});

Deno.test("wacTypeCheck: instance method via struct name requires receiver arg", () => {
  // P.inc() with no args — receiver argument is missing
  fail(`struct P {
    i32 x;
    void inc(this) { this.x++; }
  }
  export void bad() { P.inc(); }`, "argument");
});

Deno.test("wacTypeCheck: struct name has no static method", () => {
  fail(`struct P { i32 x; }
  export void bad() { P.missing(); }`, "no static method");
});

// ── Override ──────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: override with parent method is ok", () => {
  ok(`struct Shape {
    string name(const this) { return "shape"; }
  }
  struct Circle : Shape {
    f64 radius;
    override string name(const this) { return "circle"; }
  }`);
});

Deno.test("wacTypeCheck: override without parent method is error", () => {
  fail(`struct S {
    override void foo(const this) { }
  }`, "override");
});

Deno.test("wacTypeCheck: hiding parent method without override is error", () => {
  fail(`struct Base {
    void foo(this) { }
  }
  struct Sub : Base {
    void foo(this) { }
  }`, "override");
});

// ── Casts ─────────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: lossless cast i32 -> i64", () => {
  ok("export i64 ok(i32 x) { return x as i64; }");
});

Deno.test("wacTypeCheck: lossless cast i32 -> f64", () => {
  ok("export f64 ok(i32 x) { return x as f64; }");
});

Deno.test("wacTypeCheck: checked cast i64 -> i32", () => {
  ok("export i32 ok(i64 x) { return x as! i32; }");
});

Deno.test("wacTypeCheck: checked cast f64 -> i32", () => {
  ok("export i32 ok(f64 x) { return x as! i32; }");
});

Deno.test("wacTypeCheck: nearest cast f64 -> i32", () => {
  ok("export i32 ok(f64 x) { return x as~ i32; }");
});

Deno.test("wacTypeCheck: raw cast i64 -> i32", () => {
  ok("export i32 ok(i64 x) { return x as@ i32; }");
});

Deno.test("wacTypeCheck: lossless cast with wrong operator", () => {
  fail("export i64 bad(i32 x) { return x as~ i64; }", "lossless");
});

Deno.test("wacTypeCheck: checked cast with as (lossless op)", () => {
  fail("export i32 bad(i64 x) { return x as i32; }", "lossy");
});

Deno.test("wacTypeCheck: no valid numeric cast", () => {
  fail("export void bad(bool x) { i64 y = x as i64; }", "no valid cast");
});

Deno.test("wacTypeCheck: redundant same-type cast", () => {
  fail("export i32 bad(i32 x) { return x as i32; }", "redundant");
});

Deno.test("wacTypeCheck: reference upcast with as", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Shape ok(Circle c) { return c as Shape; }`);
});

Deno.test("wacTypeCheck: reference downcast with as! is ok", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Circle ok(Shape s) { return s as! Circle; }`);
});

Deno.test("wacTypeCheck: reference downcast with as is error", () => {
  fail(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Circle bad(Shape s) { return s as Circle; }`, "downcast");
});

Deno.test("wacTypeCheck: i32 -> i31ref uses as!", () => {
  ok("export void ok(i32 x) { i31ref r = x as! i31ref; }");
});

Deno.test("wacTypeCheck: i31ref -> i32 uses as", () => {
  ok("export i32 ok(i31ref r) { return r as i32; }");
});

// ── Is expression ─────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: is null on nullable is bool", () => {
  ok(`struct P { i32 x; }
  export bool ok(P? p) { return p is null; }`);
});

Deno.test("wacTypeCheck: is null on non-ref is error", () => {
  fail("export bool bad(i32 x) { return x is null; }", "reference type");
});

Deno.test("wacTypeCheck: is type test on struct", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export bool ok(Shape s) { return s is Circle; }`);
});

Deno.test("wacTypeCheck: is identity on refs", () => {
  ok(`struct P { i32 x; }
  export bool ok(P a, P b) { return a is b; }`);
});

Deno.test("wacTypeCheck: is type test on non-reference is error", () => {
  // Parser parses 'a is b' as a type test (b treated as struct name)
  // Both a and the type test require a reference type
  fail("export bool bad(i32 a, i32 b) { return a is b; }", "reference type");
});

// ── Subtyping and nullable widening ───────────────────────────────────────────

Deno.test("wacTypeCheck: subtype assignment is ok", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export void ok(Circle c) { Shape s = c; }`);
});

Deno.test("wacTypeCheck: T to T? widening is ok", () => {
  ok(`struct P { i32 x; }
  export void ok(P p) { P? q = p; }`);
});

Deno.test("wacTypeCheck: nullable to non-null is error", () => {
  fail(`struct P { i32 x; }
  export void bad(P? p) { P q = p; }`, "type mismatch");
});

Deno.test("wacTypeCheck: null to non-null is error", () => {
  fail(`struct P { i32 x; }
  export void bad() { P q = null; }`, "type mismatch");
});

Deno.test("wacTypeCheck: null to nullable is ok", () => {
  ok(`struct P { i32 x; }
  export void ok() { P? q = null; }`);
});

Deno.test("wacTypeCheck: unwrap nullable is ok", () => {
  ok(`struct P { i32 x; }
  export P ok(P? p) { return p!; }`);
});

Deno.test("wacTypeCheck: unwrap non-nullable is error", () => {
  fail(`struct P { i32 x; }
  export P bad(P p) { return p!; }`, "unwrap");
});

// ── Operators ─────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: comparison returns bool", () => {
  ok("export bool ok(i32 a, i32 b) { return a < b; }");
});

Deno.test("wacTypeCheck: comparison type mismatch", () => {
  fail("export bool bad(i32 a, f64 b) { return a < b; }", "type mismatch");
});

Deno.test("wacTypeCheck: comparison on refs is error", () => {
  fail(`struct P { i32 x; }
  export bool bad(P a, P b) { return a == b; }`, "reference types");
});

Deno.test("wacTypeCheck: bitwise on integers", () => {
  ok("export i32 ok(i32 a, i32 b) { return a & b | (a ^ b); }");
});

Deno.test("wacTypeCheck: bitwise on non-integer is error", () => {
  fail("export f64 bad(f64 a, f64 b) { return a & b; }", "i32 or i64");
});

Deno.test("wacTypeCheck: shift i32", () => {
  ok("export i32 ok(i32 x) { return x << 2; }");
});

Deno.test("wacTypeCheck: shift i64 << i32 mixed is ok", () => {
  ok("export i64 ok(i64 x, i32 n) { return x << n; }");
});

Deno.test("wacTypeCheck: shift type mismatch", () => {
  fail("export i32 bad(i32 x, i64 n) { return x << n; }", "type mismatch");
});

Deno.test("wacTypeCheck: unary minus on numeric", () => {
  ok("export i32 neg(i32 x) { return -x; }");
});

Deno.test("wacTypeCheck: unary minus on bool is error", () => {
  fail("export void bad(bool b) { bool r = -b; }", "numeric");
});

Deno.test("wacTypeCheck: bitwise not on non-integer is error", () => {
  fail("export f64 bad(f64 x) { return ~x; }", "i32 or i64");
});

Deno.test("wacTypeCheck: logical not on non-bool is error", () => {
  fail("export bool bad(i32 x) { return !x; }", "bool");
});

Deno.test("wacTypeCheck: arithmetic on bool is error", () => {
  fail("export void bad(bool a) { bool r = a + a; }", "numeric");
});

Deno.test("wacTypeCheck: logical && requires bool", () => {
  fail("export void bad(i32 a) { bool r = a && a; }", "bool operands");
});

// ── Incr/decr ─────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: incr on float is error", () => {
  fail("export void bad(f64 x) { x++; }", "i32 or i64");
});

// ── Variable scoping and shadowing ────────────────────────────────────────────

Deno.test("wacTypeCheck: variable shadowing via nested if is ok", () => {
  // Bare blocks { ... } are not a statement form; test shadowing via if/else
  ok(`export i32 shadow(bool flag) {
    i32 x = 1;
    if (flag) { i32 x = 2; x = 3; }
    return x;
  }`);
});

Deno.test("wacTypeCheck: for-loop variable scoping", () => {
  ok(`export i32 loopShadow() {
    i32 i = 99;
    for (i32 i = 0; i < 10; i++) { }
    return i;
  }`);
});

// ── Undefined variable ────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: undefined variable is error", () => {
  fail("export void bad() { i32 x = y; }", "undefined variable");
});

Deno.test("wacTypeCheck: struct type name not a value", () => {
  fail("struct P { i32 x; } export void bad() { i32 x = P; }", "not a variable");
});

// ── Call errors ───────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: call wrong arg count", () => {
  fail("i32 f(i32 x) { return x; } export void bad() { f(1, 2); }", "argument");
});

Deno.test("wacTypeCheck: call wrong arg type", () => {
  fail("i32 f(i32 x) { return x; } export void bad() { f(true); }", "type mismatch");
});

Deno.test("wacTypeCheck: undefined function", () => {
  fail("export void bad() { missing(); }", "undefined function");
});

Deno.test("wacTypeCheck: non-callable variable", () => {
  fail("export void bad(i32 x) { x(); }", "not callable");
});

Deno.test("wacTypeCheck: for-loop variable shadowing is ok", () => {
  ok(`export i32 loopShadow() {
    i32 i = 99;
    for (i32 i = 0; i < 10; i++) { }
    return i;
  }`);
});

// ── Switch ────────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: switch on i32 is ok", () => {
  ok(`export i32 f(i32 x) {
    switch (x) { case 0: { return 1; } default: { return 0; } }
  }`);
});

Deno.test("wacTypeCheck: switch on non-i32 is error", () => {
  fail(`export void bad(bool x) {
    switch (x) { default: { } }
  }`, "i32");
});

Deno.test("wacTypeCheck: switch case value must be i32", () => {
  fail(`export void bad(i32 x) {
    switch (x) { case true: { } default: { } }
  }`, "i32");
});

// ── Inherited fields and methods ──────────────────────────────────────────────

Deno.test("wacTypeCheck: subtype has inherited parent fields", () => {
  ok(`struct Shape { f64 x; f64 y; }
  struct Rect : Shape { f64 w; f64 h; }
  export f64 area(Rect r) { return r.w * r.h; }
  export f64 posX(Rect r) { return r.x; }`);
});

Deno.test("wacTypeCheck: subtype positional construction includes parent fields", () => {
  ok(`struct Shape { f64 x; f64 y; }
  struct Rect : Shape { f64 w; f64 h; }
  export Rect make() { return Rect(0.0, 0.0, 10.0, 20.0); }`);
});

Deno.test("wacTypeCheck: subtype can use parent methods", () => {
  ok(`struct Shape { f64 x; f64 y; f64 getX(const this) { return this.x; } }
  struct Rect : Shape { f64 w; }
  export f64 ok(Rect r) { return r.getX(); }`);
});

// ── Multi-file ────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: multi-file: calling imported function", () => {
  const errs = check("/main.wac", [
    ["/main.wac", `import { helper } from "./util.wac";
    export i32 run() { return helper(); }`],
    ["/util.wac", `export i32 helper() { return 42; }`],
  ]);
  if (errs.length !== 0) throw new Error(errs.map(e => e.message).join("; "));
});

Deno.test("wacTypeCheck: multi-file: calling imported function with wrong type", () => {
  const errs = check("/main.wac", [
    ["/main.wac", `import { helper } from "./util.wac";
    export bool run() { return helper(); }`],
    ["/util.wac", `export i32 helper() { return 42; }`],
  ]);
  if (!errs.some(e => e.message.includes("type mismatch"))) {
    throw new Error(`Expected type mismatch, got: ${errs.map(e => e.message).join("; ")}`);
  }
});

// ── void field / param ────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: void field is error", () => {
  fail("struct Bad { void x; }", "void");
});

Deno.test("wacTypeCheck: void param is error", () => {
  fail("void bad(void x) { }", "void");
});

// ── Compound assignment type checking ─────────────────────────────────────────

Deno.test("wacTypeCheck: compound assign += valid", () => {
  ok("export void ok(i32 x) { x += 5; }");
});

Deno.test("wacTypeCheck: compound assign += type mismatch", () => {
  fail("export void bad(i32 x) { x += 1.5; }", "type mismatch");
});

// ── len() on arrays ───────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: array .len() returns i32", () => {
  ok("export i32 ok(i32[] a) { return a.len(); }");
});

// ── Null checks ───────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: null primitive is error", () => {
  fail("export void bad() { i32 x = null; }", "type mismatch");
});

// ── Recursive struct default check ───────────────────────────────────────────

Deno.test("wacTypeCheck: struct with nullable self-ref has default", () => {
  ok(`struct Node { i32 val; Node? next; }
  export Node make() { return Node(); }`);
});

Deno.test("wacTypeCheck: struct with non-null self-ref has no default", () => {
  fail(`struct Node { i32 val; Node next; }`, "non-null recursive");
});

// ── Array of non-default type ─────────────────────────────────────────────────

Deno.test("wacTypeCheck: array of type with no default is error", () => {
  fail(`struct Node { i32 val; Node next; }
  export void bad() { Node[] arr = Node[5](); }`, "no default");
});

// ── is not ───────────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: is not null on nullable is ok", () => {
  ok(`struct P { i32 x; }
  export bool ok(P? p) { return p is not null; }`);
});

// ── bool -> i32 cast ──────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: bool -> i32 is lossless", () => {
  ok("export i32 ok(bool b) { return b as i32; }");
});

// ── Extra call args still checked ────────────────────────────────────────────

Deno.test("wacTypeCheck: extra call args are still type-checked", () => {
  // Extra arg still has its expression type-checked for errors
  fail("i32 f(i32 x) { return x; } export void bad() { f(1, bad_var); }",
    "undefined variable");
});

// ── lv-index on non-array ────────────────────────────────────────────────────

Deno.test("wacTypeCheck: lv-index on non-array is error", () => {
  fail("export void bad(i32 x) { x[0] = 1; }", "not an array");
});

// ── const in for update ───────────────────────────────────────────────────────

Deno.test("wacTypeCheck: const var in for update is error", () => {
  fail(`export void bad() {
    for (const i32 i = 0; i < 10; i++) { }
  }`, "const");
});

// ── Additional coverage: binary ops ──────────────────────────────────────────

Deno.test("wacTypeCheck: logical && with bool left, non-bool right", () => {
  fail("export bool bad(bool a, i32 b) { return a && b; }", "bool operands");
});

Deno.test("wacTypeCheck: bitwise type mismatch (i32 & i64)", () => {
  fail("export void bad(i32 x, i64 y) { i32 z = x & y; }", "type mismatch");
});

Deno.test("wacTypeCheck: shift on float is error", () => {
  fail("export f64 bad(f64 x) { return x << 1; }", "i32 or i64");
});

// ── String literal type ───────────────────────────────────────────────────────

Deno.test("wacTypeCheck: string literal type is string", () => {
  ok(`export string ok() { return "hello"; }`);
});

Deno.test("wacTypeCheck: string type mismatch", () => {
  fail(`export i32 bad() { return "hello"; }`, "type mismatch");
});

// ── void variable declaration ─────────────────────────────────────────────────

Deno.test("wacTypeCheck: void variable is error", () => {
  fail("export void bad() { void x = 5; }", "void");
});

// ── Unreachable code after return ─────────────────────────────────────────────

Deno.test("wacTypeCheck: code after return is silently ignored", () => {
  // No error for dead code (just silently not checked after termination)
  ok("export i32 ok() { return 1; return 2; }");
});

// ── else-if chain ─────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: else-if chain all paths return", () => {
  ok(`export i32 ok(i32 x) {
    if (x < 0) { return -1; }
    else if (x > 0) { return 1; }
    else { return 0; }
  }`);
});

Deno.test("wacTypeCheck: else-if chain not all paths return", () => {
  fail(`i32 bad(i32 x) {
    if (x < 0) { return -1; }
    else if (x > 0) { return 1; }
  }`, "not all code paths");
});

// ── Integer out of range ──────────────────────────────────────────────────────

Deno.test("wacTypeCheck: i64 literal fits in i64", () => {
  ok("export i64 ok() { return 9000000000000000000; }");
});

// ── Nullable typeName in errors ───────────────────────────────────────────────

Deno.test("wacTypeCheck: nullable type in error message", () => {
  fail(`struct P { i32 x; }
  export void bad(P? p) { P? q = p is null; }`, "type mismatch");
});

// ── Array typeName in errors ──────────────────────────────────────────────────

Deno.test("wacTypeCheck: array type in error message", () => {
  fail("export void bad(i32[] a) { i32 x = a; }", "type mismatch");
});

// ── Ternary with compatible branch types ─────────────────────────────────────

Deno.test("wacTypeCheck: ternary incompatible branches", () => {
  fail("export void bad(bool c) { i32 x = c ? 1 : true; }", "incompatible");
});

// ── Reference cast with unsupported operator ─────────────────────────────────

Deno.test("wacTypeCheck: reference cast with as~ is error", () => {
  fail(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Circle bad(Shape s) { return s as~ Circle; }`, "as' or 'as!'");
});

// ── Method accessed as value is error ────────────────────────────────────────

Deno.test("wacTypeCheck: method accessed as value is error", () => {
  fail(`struct Counter {
    i32 count;
    i32 get(const this) { return this.count; }
  }
  export void bad(Counter c) { i32 x = c.get; }`, "value");
});

// ── Static method field reference from inferFieldAccess ──────────────────────

Deno.test("wacTypeCheck: struct method field ref as value is error", () => {
  fail(`struct S {
    S make() { return S(); }
  }
  export void bad() { i32 x = S.make; }`, "value");
});

// ── lv-field: nullable base ───────────────────────────────────────────────────

Deno.test("wacTypeCheck: lv-field assignment on nullable base is error", () => {
  fail(`struct P { i32 x; }
  export void bad(P? p) { p.x = 1; }`, "nullable");
});

// ── lv-field: field on non-struct ────────────────────────────────────────────

Deno.test("wacTypeCheck: lv-field on non-struct is error", () => {
  fail("export void bad(i32 x) { x.y = 1; }", "no fields");
});

// ── Packed array lval write ───────────────────────────────────────────────────

Deno.test("wacTypeCheck: packed array lval index returns i32 for assignment", () => {
  ok("export void ok(i8[] b) { b[0] = 255; }");
});

// ── Shift i64 with matching types ────────────────────────────────────────────

Deno.test("wacTypeCheck: shift i64 << i64 matching types", () => {
  ok("export i64 ok(i64 x) { return x << 2; }");
});

// ── Ternary with subtype branch ───────────────────────────────────────────────

Deno.test("wacTypeCheck: ternary with subtype branch is compatible", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Shape ok(bool c, Shape s, Circle ci) { return c ? s : ci; }`);
});

// ── funcref type ──────────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: void function returning value is error", () => {
  fail(`export void bad(bool x) { bool y = x; return y; }`, "void function cannot return");
});

// ── Method missing return ─────────────────────────────────────────────────────

Deno.test("wacTypeCheck: method missing return on all paths", () => {
  fail(`struct Counter {
    i32 count;
    i32 bad(const this, bool flag) {
      if (flag) { return this.count; }
    }
  }`, "not all code paths");
});

// ── Static method without hasThis ────────────────────────────────────────────

Deno.test("wacTypeCheck: static method in method body checking", () => {
  ok(`struct Factory {
    i32 value;
    Factory create(i32 v) { return Factory(v); }
  }
  export Factory test() { return Factory.create(42); }`);
});

// ── Positional construction with too many args ────────────────────────────────

Deno.test("wacTypeCheck: positional construction too many args", () => {
  fail(`struct P { i32 x; }
  export void bad() { P p = P(1, 2, 3); }`, "expects 1");
});

// ── checkLval: undefined lval ident ──────────────────────────────────────────

Deno.test("wacTypeCheck: lval undefined ident is error", () => {
  fail("export void bad() { undeclared = 5; }", "undefined variable");
});

// ── shift mismatch that's not i64<<i32 ───────────────────────────────────────

Deno.test("wacTypeCheck: shift i32 << i64 mismatch is error", () => {
  fail("export void bad(i32 x, i64 n) { i32 y = x << n; }", "type mismatch");
});

// ── inferCall via call node with ident callee (rare) ─────────────────────────

Deno.test("wacTypeCheck: struct type name not callable as function", () => {
  // Parser produces call{ callee: field{ident("S"), "make"} } for S.make()
  // and infers type from struct scope correctly
  ok(`struct S {
    i32 value;
    S make(i32 v) { return S(v); }
  }
  export i32 test() {
    S s = S.make(10);
    return s.value;
  }`);
});

// ── dowhile loop scope ────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: dowhile loop with break", () => {
  ok(`export i32 ok() {
    i32 x = 0;
    do { x++; if (x > 5) { break; } } while (true);
    return x;
  }`);
});

// ── isAssignable: nullable-to-nullable (T? to S? where T is subtype of S) ────

Deno.test("wacTypeCheck: nullable subtype assignment is ok", () => {
  ok(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export void ok(Circle? c) { Shape? s = c; }`);
});

// ── anyref widening ───────────────────────────────────────────────────────────

Deno.test("wacTypeCheck: any ref type widens to anyref", () => {
  ok(`struct P { i32 x; }
  export void ok(P p) { anyref r = p; }`);
});

// ── switch case dead code after terminator ────────────────────────────────────

Deno.test("wacTypeCheck: switch case dead code after return is ignored", () => {
  ok(`export i32 ok(i32 x) {
    switch (x) {
      case 0: { return 1; i32 dead = 2; }
      default: { return 0; }
    }
  }`);
});

// ── bitwise not success ───────────────────────────────────────────────────────

Deno.test("wacTypeCheck: bitwise not ~ on i32 is ok", () => {
  ok("export i32 ok(i32 x) { return ~x; }");
});

// ── unary with errored sub-expr ───────────────────────────────────────────────

Deno.test("wacTypeCheck: unary on undefined variable propagates error", () => {
  fail("export void bad() { bool y = !undefined_var; }", "undefined");
});

// ── lv-field: unknown field on valid struct ───────────────────────────────────

Deno.test("wacTypeCheck: lv-field unknown field on struct is error", () => {
  fail(`struct P { i32 x; }
  export void bad(P p) { p.z = 1; }`, "no field");
});

// ── struct with array field has default ──────────────────────────────────────

Deno.test("wacTypeCheck: struct with array field has default", () => {
  ok(`struct S { i32[] items; }
  export S ok() { return S(); }`);
});

// ── funcref parameter call ────────────────────────────────────────────────────

Deno.test("wacTypeCheck: funcref parameter can be called", () => {
  ok(`export i32 ok(fn[i32(i32)] f, i32 x) { return f(x); }`);
});

Deno.test("wacTypeCheck: funcref call wrong arg count", () => {
  fail(`export void bad(fn[void(i32)] f) { f(1, 2); }`, "argument");
});

// ── named args on regular function call ──────────────────────────────────────

Deno.test("wacTypeCheck: named args on regular function call is error", () => {
  fail(`i32 f(i32 x) { return x; }
  export void bad() { i32 y = f { x: 1 }; }`, "named argument");
});

// ── method call on non-struct base ────────────────────────────────────────────

Deno.test("wacTypeCheck: method call on non-struct type is error", () => {
  fail(`export void bad(i32 x) { x.toString(); }`, "no method");
});

// ── len() with arguments ──────────────────────────────────────────────────────

Deno.test("wacTypeCheck: array len() with args is error", () => {
  fail("export void bad(i32[] a) { a.len(1); }", "no arguments");
});

// ── lv-field with erroring base ───────────────────────────────────────────────

Deno.test("wacTypeCheck: lv-field with undefined base propagates error", () => {
  fail("export void bad() { undeclared.field = 1; }", "undefined");
});

// ── field access on erroring expression ──────────────────────────────────────

Deno.test("wacTypeCheck: field access on undefined var propagates error", () => {
  fail("export void bad() { i32 y = undefined_var.field; }", "undefined");
});

// ── method call on erroring base ─────────────────────────────────────────────

Deno.test("wacTypeCheck: method call on undefined var propagates error", () => {
  fail(`struct P { i32 x; void inc(this) { this.x++; } }
  export void bad() { undefined_var.inc(); }`, "undefined");
});

// ── i31ref -> i32 wrong operator ─────────────────────────────────────────────

Deno.test("wacTypeCheck: i31ref -> i32 with as! is error (lossless)", () => {
  fail("export i32 bad(i31ref r) { return r as! i32; }", "lossless");
});

// ── upcast with wrong operator ────────────────────────────────────────────────

Deno.test("wacTypeCheck: reference upcast with as! is error (use as)", () => {
  fail(`struct Shape { f64 x; }
  struct Circle : Shape { f64 r; }
  export Shape bad(Circle c) { return c as! Shape; }`, "safe");
});

// ── Expressions with erroring sub-expressions ─────────────────────────────────

Deno.test("wacTypeCheck: binary with undefined left operand propagates error", () => {
  fail("export void bad() { i32 x = undefined_var + 1; }", "undefined");
});

Deno.test("wacTypeCheck: cast of undefined var propagates error", () => {
  fail("export i32 bad() { return undefined_var as i32; }", "undefined");
});

Deno.test("wacTypeCheck: is-null on undefined var propagates error", () => {
  fail("export bool bad() { return undefined_var is null; }", "undefined");
});

Deno.test("wacTypeCheck: ternary with undefined branch propagates error", () => {
  fail("export void bad(bool c) { i32 x = c ? undefined_var : 1; }", "undefined");
});

Deno.test("wacTypeCheck: index on undefined array propagates error", () => {
  fail("export void bad() { i32 y = undefined_var[0]; }", "undefined");
});

Deno.test("wacTypeCheck: index on non-array expr is error", () => {
  fail("export void bad(i32 x) { i32 y = x[0]; }", "not an array");
});

Deno.test("wacTypeCheck: unwrap of undefined var propagates error", () => {
  fail("export void bad() { i32 y = undefined_var!; }", "undefined");
});

// ── lv-index with undefined base ─────────────────────────────────────────────

Deno.test("wacTypeCheck: lv-index with undefined base propagates error", () => {
  fail("export void bad() { undefined_var[0] = 1; }", "undefined");
});

// ── funcref field has no default ──────────────────────────────────────────────

Deno.test("wacTypeCheck: struct with funcref field has no default", () => {
  fail(`struct S { fn[void()] cb; }
  export void bad() { S s = S(); }`, "no default");
});

// ── right-shift operator ──────────────────────────────────────────────────────

Deno.test("wacTypeCheck: right shift >> on i32 is ok", () => {
  ok("export i32 ok(i32 x) { return x >> 1; }");
});

// ── exprIsConst: unwrap and non-ident/field paths ─────────────────────────────

Deno.test("wacTypeCheck: non-const method through const nullable unwrap is error", () => {
  fail(`struct P {
    i32 x;
    void mutate(this) { this.x = 1; }
  }
  struct Outer {
    P? inner;
    void bad(const this) { this.inner!.mutate(); }
  }`, "non-const method");
});

Deno.test("wacTypeCheck: calling non-const method on construct result is ok (not const)", () => {
  // exprIsConst returns false for construct exprs (default case)
  ok(`struct P {
    i32 x;
    void mutate(this) { this.x = 1; }
  }
  export void ok(P p) { P(0).mutate(); }
  export P makeP() { return P(0); }
  export i32 run() { makeP().x; return 0; }`);
});

// ── funcref type equality and type name ───────────────────────────────────────

Deno.test("wacTypeCheck: funcref type mismatch (typeEq false branch)", () => {
  // fn[i32(i32)] vs fn[i32(bool)] — typeEq(i32, bool) inside params.every
  fail(`export void bad(fn[i32(i32)] f) {
    fn[i32(bool)] g = f;
  }`, "type mismatch");
});

Deno.test("wacTypeCheck: funcref type in error message (typeName funcref)", () => {
  // Using funcref in arithmetic produces error with funcref type name
  fail(`export void bad(fn[i32(i32)] f) { i32 x = f + 1; }`, "numeric");
});

// ── named args on funcref call ────────────────────────────────────────────────

Deno.test("wacTypeCheck: named args on funcref variable call is error", () => {
  fail(`export void bad(fn[void(i32)] f) { f { x: 1 }; }`, "named argument");
});

// ── array of struct field via index lval (lvalIsConst lv-index path) ─────────

Deno.test("wacTypeCheck: write to field via array index lval is ok", () => {
  ok(`struct P { i32 x; }
  export void ok(P[] arr) { arr[0].x = 5; }`);
});
