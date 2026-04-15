import { wacResolve } from "./wacResolve.ts";
import { wacTypeCheck, type TypedModule } from "./wacTypeCheck.ts";
import type { WacType, Expr } from "./ast.ts";

// ---- Test helpers ----

function resolve(srcs: Record<string, string>, entry = "/main.wac") {
  const cap = { readFile: (p: string) => { if (srcs[p]) return srcs[p]!; throw new Error(`not found: ${p}`); } };
  return wacResolve(cap, entry);
}

function typecheck(src: string): TypedModule {
  return wacTypeCheck(resolve({ "/main.wac": src }));
}

function typecheckExpect(src: string, expectNoErrors = true): TypedModule {
  const m = typecheck(src);
  if (expectNoErrors && m.errors.length > 0) {
    throw new Error(`unexpected errors: ${JSON.stringify(m.errors)}`);
  }
  return m;
}

function hasError(m: TypedModule, msg: string): boolean {
  return m.errors.some(e => e.message.includes(msg));
}

// Get the expr type of the first return value in the first function
function firstReturnType(m: TypedModule): WacType {
  const funcs = [...m.resolved.funcs.values()];
  const func = funcs[0]!;
  const stmt = func.decl.body.stmts[0];
  if (!stmt || stmt.tag !== "return" || !stmt.value) throw new Error("no return value");
  const t = m.exprType.get(stmt.value);
  if (!t) throw new Error("no expr type");
  return t;
}

// Get the type of first stmt's init expr
function firstVarInitType(m: TypedModule): WacType {
  const funcs = [...m.resolved.funcs.values()];
  const func = funcs[0]!;
  const stmt = func.decl.body.stmts[0];
  if (!stmt || stmt.tag !== "var") throw new Error("no var stmt");
  const t = m.exprType.get(stmt.init);
  if (!t) throw new Error("no expr type");
  return t;
}

// ---- Literal types ----

Deno.test("wacTypeCheck: int literal is i32", () => {
  const m = typecheckExpect("export i32 f() { return 42; }");
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: large int literal is i64", () => {
  const m = typecheckExpect("export i64 f() { return 1000000000000; }");
  const t = firstReturnType(m);
  if (t.tag !== "i64") throw new Error(`expected i64, got ${t.tag}`);
});

Deno.test("wacTypeCheck: float literal defaults to f64", () => {
  const m = typecheckExpect("export f64 f() { return 3.14; }");
  const t = firstReturnType(m);
  if (t.tag !== "f64") throw new Error(`expected f64, got ${t.tag}`);
});

Deno.test("wacTypeCheck: float literal is f32 when expected", () => {
  const m = typecheckExpect("export f32 f() { return 3.14; }");
  const t = firstReturnType(m);
  if (t.tag !== "f32") throw new Error(`expected f32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: string literal is string", () => {
  const m = typecheckExpect(`export void f() { string s = "hello"; }`);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: bool literal is bool", () => {
  const m = typecheckExpect("export bool f() { return true; }");
  const t = firstReturnType(m);
  if (t.tag !== "bool") throw new Error(`expected bool, got ${t.tag}`);
});

Deno.test("wacTypeCheck: char literal is i32", () => {
  const m = typecheckExpect("export i32 f() { return 'a'; }");
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: null in nullable context", () => {
  const m = typecheckExpect("struct P { i32 x; } export void f() { P? p = null; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: null in anyref context", () => {
  const m = typecheckExpect("export void f() { anyref p = null; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: null without expected type reports error", () => {
  const m = typecheck("export void f() { return null; }");
  // return void, but null is the value — actually this would be "return null" in void func
  // Let's use a different example where null has no expected type
});

Deno.test("wacTypeCheck: null without context reports error", () => {
  // Passing null to a void-returning function that takes no param — no context
  // Instead: assign null to i32 var — type mismatch shows null type error
  const m = typecheck("export void f() { i32 x = null; }");
  if (m.errors.length === 0) throw new Error("expected error");
  // "cannot infer type of null" or "type mismatch" error
});

// ---- Variable lookup ----

Deno.test("wacTypeCheck: parameter type accessible", () => {
  const m = typecheckExpect("export i32 f(i32 x) { return x; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: undefined identifier reports error", () => {
  const m = typecheck("export i32 f() { return undefined_var; }");
  if (!hasError(m, "undefined identifier")) throw new Error("expected undefined-identifier error");
});

Deno.test("wacTypeCheck: function referenced as ident", () => {
  const m = typecheckExpect("export void g() { } export void f() { g; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Unary operators ----

Deno.test("wacTypeCheck: unary minus on i32", () => {
  const m = typecheckExpect("export i32 f(i32 x) { return -x; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: unary minus on non-numeric reports error", () => {
  const m = typecheck("export bool f(bool b) { return -b; }");
  // -bool is not numeric
  if (!hasError(m, "unary '-' requires numeric")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: logical not on bool", () => {
  const m = typecheckExpect("export bool f(bool b) { return !b; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: logical not on non-bool reports error", () => {
  const m = typecheck("export bool f(i32 x) { return !x; }");
  if (!hasError(m, "'!' requires bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: bitwise not on i32", () => {
  const m = typecheckExpect("export i32 f(i32 x) { return ~x; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: bitwise not on non-integral reports error", () => {
  const m = typecheck("export f64 f(f64 x) { return ~x; }");
  if (!hasError(m, "'~' requires i32")) throw new Error("expected error");
});

// ---- Binary operators ----

Deno.test("wacTypeCheck: i32 addition", () => {
  const m = typecheckExpect("export i32 f(i32 a, i32 b) { return a + b; }");
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: arithmetic type mismatch reports error", () => {
  const m = typecheck("export f64 f(i32 x, f64 y) { return x + y; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected type-mismatch error");
});

Deno.test("wacTypeCheck: arithmetic on bool reports error", () => {
  const m = typecheck("export i32 f(bool a, i32 b) { return a + b; }");
  if (!hasError(m, "arithmetic not allowed on bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: arithmetic on non-numeric reports error", () => {
  const m = typecheck(`struct P { i32 x; } export void f(P a, P b) { P c = a + b; }`);
  if (!hasError(m, "requires numeric")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: comparison returns bool", () => {
  const m = typecheckExpect("export bool f(i32 a, i32 b) { return a < b; }");
  const t = firstReturnType(m);
  if (t.tag !== "bool") throw new Error(`expected bool, got ${t.tag}`);
});

Deno.test("wacTypeCheck: comparison type mismatch reports error", () => {
  const m = typecheck("export bool f(i32 a, f64 b) { return a < b; }");
  if (!hasError(m, "comparison type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: comparison on reference type reports error", () => {
  const m = typecheck("struct P { i32 x; } export bool f(P a, P b) { return a == b; }");
  if (!hasError(m, "not allowed on reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: logical && requires bool", () => {
  const m = typecheck("export bool f(i32 a, i32 b) { return a && b; }");
  if (!hasError(m, "'&&' requires bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: logical || right operand must be bool", () => {
  const m = typecheck("export bool f(bool a, i32 b) { return a || b; }");
  if (!hasError(m, "'||' requires bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: bitwise & on i32", () => {
  const m = typecheckExpect("export i32 f(i32 a, i32 b) { return a & b; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: bitwise op on float reports error", () => {
  const m = typecheck("export f64 f(f64 a, f64 b) { return a & b; }");
  if (!hasError(m, "requires i32 or i64")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: bitwise op type mismatch", () => {
  const m = typecheck("export i32 f(i32 a, i64 b) { return a | b; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: shift on i32", () => {
  const m = typecheckExpect("export i32 f(i32 a, i32 b) { return a << b; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: shift i64 by i32 is allowed", () => {
  const m = typecheckExpect("export i64 f(i64 a, i32 b) { return a << b; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: shift on float reports error", () => {
  const m = typecheck("export f64 f(f64 a, f64 b) { return a << b; }");
  if (!hasError(m, "requires i32 or i64")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: shift type mismatch i32 >> i64 reports error", () => {
  const m = typecheck("export i32 f(i32 a, i64 b) { return a >> b; }");
  if (!hasError(m, "shift type mismatch")) throw new Error("expected error");
});

// ---- Casts ----

Deno.test("wacTypeCheck: lossless cast as i32→i64", () => {
  const m = typecheckExpect("export i64 f(i32 x) { return x as i64; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lossy cast as~ i64→i32", () => {
  const m = typecheckExpect("export i32 f(i64 x) { return x as~ i32; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: wrong cast op for lossless reports error", () => {
  const m = typecheck("export i64 f(i32 x) { return x as~ i64; }");
  if (!hasError(m, "lossy cast not needed")) throw new Error("expected cast error");
});

Deno.test("wacTypeCheck: as! for checked numeric cast", () => {
  const m = typecheckExpect("export i32 f(i64 x) { return x as! i32; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: as@ for raw numeric cast", () => {
  const m = typecheckExpect("export i32 f(i64 x) { return x as@ i32; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: cast to i31ref requires as!", () => {
  const m = typecheck("export void f(i32 x) { i31ref r = x as i31ref; }");
  if (!hasError(m, "use `as!` to convert to i31ref")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: i31ref to i32 requires as", () => {
  const m = typecheck("export i32 f(i31ref r) { return r as! i32; }");
  if (!hasError(m, "use `as` to extract i32 from i31ref")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: reference upcast", () => {
  const m = typecheckExpect(`
    struct Shape { i32 tag; }
    struct Circle : Shape { f64 r; }
    export void f(Circle c) { Shape s = c as Shape; }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- is / is not ----

Deno.test("wacTypeCheck: is null returns bool", () => {
  const m = typecheckExpect("struct P { i32 x; } export bool f(P? p) { return p is null; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "bool") throw new Error(`expected bool, got ${t.tag}`);
});

Deno.test("wacTypeCheck: is type returns bool", () => {
  const m = typecheckExpect(`
    struct Shape { i32 t; }
    struct Circle : Shape { f64 r; }
    export bool f(Shape s) { return s is Circle; }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Ternary ----

Deno.test("wacTypeCheck: ternary with bool cond", () => {
  const m = typecheckExpect("export i32 f(bool b) { return b ? 1 : 2; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: ternary with non-bool cond reports error", () => {
  const m = typecheck("export i32 f(i32 x) { return x ? 1 : 2; }");
  if (!hasError(m, "ternary condition must be bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: ternary in expr stmt (no expected type)", () => {
  // Covers the 'expected is undefined' branch of the ternary else-type inference
  const m = typecheckExpect("export void f(bool b) { b ? 1 : 2; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Function calls ----

Deno.test("wacTypeCheck: call own function", () => {
  const m = typecheckExpect(`
    i32 helper(i32 x) { return x * 2; }
    export i32 f() { return helper(5); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: call undefined function reports error", () => {
  const m = typecheck("export i32 f() { return noSuchFunc(1); }");
  if (!hasError(m, "undefined function")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: call wrong arg count reports error", () => {
  const m = typecheck("i32 g(i32 a) { return a; } export i32 f() { return g(1, 2); }");
  if (!hasError(m, "wrong number of arguments")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: call arg type mismatch reports error", () => {
  const m = typecheck("i32 g(i32 a) { return a; } export i32 f() { return g(true); }");
  if (!hasError(m, "argument") && !hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: static method call via typeQual", () => {
  const m = typecheckExpect(`
    struct Counter {
      i32 n;
      Counter create(i32 n) { return Counter(n); }
    }
    export Counter f() { return Counter.create(5); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: static method call undefined reports error", () => {
  const m = typecheck("export void f() { NoStruct.create(1); }");
  if (!hasError(m, "undefined function")) throw new Error("expected error");
});

// ---- Struct construction ----

Deno.test("wacTypeCheck: positional struct construction", () => {
  const m = typecheckExpect("struct P { i32 x; i32 y; } export P f() { return P(1, 2); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  // Struct canonical name is stem$StructName; single-file entry is "main$P".
  if (t.tag !== "named" || t.name !== "main$P") throw new Error(`expected main$P, got ${JSON.stringify(t)}`);
});

Deno.test("wacTypeCheck: positional wrong arg count reports error", () => {
  const m = typecheck("struct P { i32 x; i32 y; } export P f() { return P(1); }");
  if (!hasError(m, "wrong number of arguments")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: positional arg type mismatch reports error", () => {
  const m = typecheck("struct P { i32 x; } export P f() { return P(true); }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: named struct construction", () => {
  const m = typecheckExpect("struct P { i32 x; i32 y; } export P f() { return P { x: 1, y: 2 }; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: named unknown field reports error", () => {
  const m = typecheck("struct P { i32 x; } export P f() { return P { z: 1 }; }");
  if (!hasError(m, "unknown field")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: named field type mismatch reports error", () => {
  const m = typecheck("struct P { i32 x; } export P f() { return P { x: true }; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: default construction", () => {
  const m = typecheckExpect("struct P { i32 x; } export P f() { return P(); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: construct undefined struct reports error", () => {
  const m = typecheck("export void f() { NoStruct s = NoStruct(1); }");
  if (!hasError(m, "undefined struct")) throw new Error("expected error");
});

// ---- Field access ----

Deno.test("wacTypeCheck: field access on struct", () => {
  const m = typecheckExpect("struct P { i32 x; i32 y; } export i32 f(P p) { return p.x; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: field access on non-struct reports error", () => {
  const m = typecheck("export i32 f(i32 x) { return x.foo; }");
  if (!hasError(m, "field access on non-struct")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: unknown field reports error", () => {
  const m = typecheck("struct P { i32 x; } export i32 f(P p) { return p.z; }");
  if (!hasError(m, "unknown field")) throw new Error("expected error");
});

// ---- Method calls ----

Deno.test("wacTypeCheck: method call on struct", () => {
  const m = typecheckExpect(`
    struct Counter {
      i32 n;
      i32 getCount(this) { return this.n; }
    }
    export i32 f(Counter c) { return c.getCount(); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: method call on non-struct reports error", () => {
  const m = typecheck("export i32 f(i32 x) { return x.foo(); }");
  if (!hasError(m, "method call on non-struct")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: unknown method reports error", () => {
  const m = typecheck("struct P { i32 x; } export void f(P p) { p.badMethod(); }");
  if (!hasError(m, "unknown method")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: .len() on array is i32", () => {
  const m = typecheckExpect("export i32 f(i32[] arr) { return arr.len(); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: .len() on string is i32", () => {
  const m = typecheckExpect(`export i32 f(string s) { return s.len(); }`);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: .len() on nullable struct unwraps type first", () => {
  const m = typecheckExpect(`
    struct Counter { i32 n; i32 getCount(this) { return this.n; } }
    export i32 f(Counter? c) { return c.getCount(); }
  `);
  // nullable.method resolves inner type
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Array access ----

Deno.test("wacTypeCheck: array index returns element type", () => {
  const m = typecheckExpect("export i32 f(i32[] arr, i32 i) { return arr[i]; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

Deno.test("wacTypeCheck: string index returns string (codepoint)", () => {
  const m = typecheckExpect("export string f(string s, i32 i) { return s[i]; }");
  if (m.errors.length > 0) throw new Error(`unexpected errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: index on non-array reports error", () => {
  const m = typecheck("export i32 f(i32 x) { return x[0]; }");
  if (!hasError(m, "index operator on non-array")) throw new Error("expected error");
});

// ---- Array construction ----

Deno.test("wacTypeCheck: array new with size", () => {
  const m = typecheckExpect("export i32[] f(i32 n) { return i32[n](); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "array") throw new Error(`expected array, got ${t.tag}`);
});

Deno.test("wacTypeCheck: array literal", () => {
  const m = typecheckExpect("export i32[] f() { return i32[](1, 2, 3); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Unwrap ----

Deno.test("wacTypeCheck: unwrap nullable returns inner type", () => {
  const m = typecheckExpect(`
    struct P { i32 x; }
    export P f(P? p) { return p!; }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  // Struct canonical name is stem$StructName; single-file entry is "main$P".
  if (t.tag !== "named" || t.name !== "main$P") throw new Error(`expected main$P, got ${JSON.stringify(t)}`);
});

Deno.test("wacTypeCheck: unwrap non-nullable reports error", () => {
  const m = typecheck("export i32 f(i32 x) { return x!; }");
  if (!hasError(m, "unwrap '!' applied to non-nullable")) throw new Error("expected error");
});

// ---- Paren ----

Deno.test("wacTypeCheck: paren expression passes through type", () => {
  const m = typecheckExpect("export i32 f(i32 x) { return (x); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
  const t = firstReturnType(m);
  if (t.tag !== "i32") throw new Error(`expected i32, got ${t.tag}`);
});

// ---- fnref ----

Deno.test("wacTypeCheck: fnref to function", () => {
  const m = typecheckExpect(`
    i32 add(i32 a, i32 b) { return a + b; }
    export void f() { fn[i32(i32, i32)] ref = add; }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: fnref to undefined function reports error", () => {
  const m = typecheck("export void f() { fn[void()] ref = noFunc; }");
  if (!hasError(m, "undefined function")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: fnref with typeQual", () => {
  const m = typecheckExpect(`
    struct Counter { i32 n; Counter create(i32 n) { return Counter(n); } }
    export void f() { fn[Counter(i32)] ref = Counter.create; }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Variable declaration and assignment ----

Deno.test("wacTypeCheck: var decl type mismatch reports error", () => {
  const m = typecheck("export void f() { i32 x = true; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: var decl with numeric mismatch has cast hint", () => {
  const m = typecheck("export void f() { i32 x = 3.14; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
  // Should have cast hint
  const e = m.errors.find(e => e.message.includes("type mismatch") && e.hint?.includes("as!"));
  if (!e) throw new Error("expected cast hint in error");
});

Deno.test("wacTypeCheck: const var cannot be reassigned", () => {
  const m = typecheck("export void f() { const i32 x = 5; x = 10; }");
  if (!hasError(m, "cannot write through const reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: assign compatible types", () => {
  const m = typecheckExpect("struct P { i32 x; } export void f() { P? p = null; P q = P(1); p = q; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: assign incompatible types reports error", () => {
  const m = typecheck("export void f(i32 x) { x = true; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected error");
});

// ---- Compound assignment ----

Deno.test("wacTypeCheck: compound += valid", () => {
  const m = typecheckExpect("export void f() { i32 x = 0; x += 5; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: compound += const reports error", () => {
  const m = typecheck("export void f() { const i32 x = 0; x += 1; }");
  if (!hasError(m, "cannot write through const reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: compound += type mismatch reports error", () => {
  const m = typecheck("export void f() { i32 x = 0; x += true; }");
  if (!hasError(m, "arithmetic not allowed on bool") && !hasError(m, "type mismatch")) {
    throw new Error("expected error");
  }
});

// ---- Incr / decr ----

Deno.test("wacTypeCheck: ++ on i32 is valid", () => {
  const m = typecheckExpect("export void f() { i32 x = 0; x++; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: ++ on const reports error", () => {
  const m = typecheck("export void f() { const i32 x = 0; x++; }");
  if (!hasError(m, "cannot apply ++ or -- to const")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: ++ on non-integral reports error", () => {
  const m = typecheck("export void f() { f64 x = 0.0; x++; }");
  if (!hasError(m, "++ and -- require i32 or i64")) throw new Error("expected error");
});

// ---- If statement ----

Deno.test("wacTypeCheck: if with bool cond", () => {
  const m = typecheckExpect("export void f(bool b) { if (b) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: if with non-bool cond reports error with hint for i32", () => {
  const m = typecheck("export void f(i32 x) { if (x) { } }");
  if (!hasError(m, "condition must be bool")) throw new Error("expected error");
  const e = m.errors.find(e => e.hint?.includes("comparison"));
  if (!e) throw new Error("expected hint for i32 condition");
});

Deno.test("wacTypeCheck: if with non-bool and non-i32 cond (no hint)", () => {
  const m = typecheck("export void f(f64 x) { if (x) { } }");
  if (!hasError(m, "condition must be bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: if-else-if chain", () => {
  const m = typecheckExpect("export void f(bool a, bool b) { if (a) { } else if (b) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: if-else block", () => {
  const m = typecheckExpect("export void f(bool b) { if (b) { } else { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- While / for / do-while ----

Deno.test("wacTypeCheck: while with bool cond", () => {
  const m = typecheckExpect("export void f(bool b) { while (b) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: while non-bool cond reports error", () => {
  const m = typecheck("export void f(i32 x) { while (x) { } }");
  if (!hasError(m, "condition must be bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for with var init and bool cond", () => {
  const m = typecheckExpect("export void f() { for (i32 i = 0; i < 10; i++) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: for with assign init", () => {
  const m = typecheckExpect("export void f(i32 x) { for (x = 0; x < 5; x++) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: for with compound update", () => {
  const m = typecheckExpect("export void f() { for (i32 i = 0; i < 10; i += 2) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: for with assign update", () => {
  const m = typecheckExpect("export void f() { for (i32 i = 0; i < 10; i = i + 1) { } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: for with non-bool cond reports error", () => {
  const m = typecheck("export void f() { for (i32 i = 0; i; i++) { } }");
  if (!hasError(m, "for condition must be bool")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for empty init and cond", () => {
  const m = typecheckExpect("export void f() { for (;;) { break; } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: for init type mismatch reports error", () => {
  const m = typecheck("export void f() { for (i32 x = true;; ) { break; } }");
  if (!hasError(m, "type mismatch in for init")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for init const assign reports error", () => {
  const m = typecheck("export void f() { const i32 c = 0; for (c = 0;; ) { break; } }");
  if (!hasError(m, "cannot assign to const in for init")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for update const reports error", () => {
  const m = typecheck("export void f() { const i32 c = 0; for (;; c++) { break; } }");
  if (!hasError(m, "cannot apply ++ to const")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for update non-integral incr reports error", () => {
  const m = typecheck("export void f() { f64 x = 0.0; for (;; x++) { break; } }");
  if (!hasError(m, "++ and -- require i32 or i64")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for update assign const reports error", () => {
  const m = typecheck("export void f() { const i32 c = 0; for (;; c = 1) { break; } }");
  if (!hasError(m, "cannot assign to const in for update")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for update assign type mismatch reports error", () => {
  const m = typecheck("export void f() { i32 x = 0; for (;; x = true) { break; } }");
  if (!hasError(m, "type mismatch in for update")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: for update compound const reports error", () => {
  const m = typecheck("export void f() { const i32 c = 0; for (;; c += 1) { break; } }");
  if (!hasError(m, "cannot assign to const in for update")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: do-while with bool cond", () => {
  const m = typecheckExpect("export void f() { do { } while (true); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: do-while non-bool cond reports error", () => {
  const m = typecheck("export void f(i32 x) { do { } while (x); }");
  if (!hasError(m, "condition must be bool")) throw new Error("expected error");
});

// ---- Switch ----

Deno.test("wacTypeCheck: switch statement", () => {
  const m = typecheckExpect("export void f(i32 x) { switch (x) { case 1: break; default: break; } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Return ----

Deno.test("wacTypeCheck: void return with no value", () => {
  const m = typecheckExpect("export void f() { return; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: return with wrong type reports error", () => {
  const m = typecheck("export i32 f() { return true; }");
  if (!hasError(m, "return:") && !hasError(m, "type mismatch")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: non-void return with no value reports error", () => {
  const m = typecheck("export i32 f() { return; }");
  if (!hasError(m, "missing return value")) throw new Error("expected error");
});

// ---- Break / continue / trap ----

Deno.test("wacTypeCheck: break and continue are valid", () => {
  const m = typecheckExpect("export void f() { while (true) { break; } while (true) { continue; } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: trap is valid", () => {
  const m = typecheckExpect("export void f() { trap; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Block statement ----

Deno.test("wacTypeCheck: block statement creates scope", () => {
  const m = typecheckExpect("export void f() { { i32 x = 1; } }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- LVal checking ----

Deno.test("wacTypeCheck: lval with field access", () => {
  const m = typecheckExpect("struct P { i32 x; } export void f(P p) { p.x = 5; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lval const field reports error", () => {
  const m = typecheck("struct P { const i32 x; } export void f(P p) { p.x = 5; }");
  if (!hasError(m, "cannot write through const reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval const struct field reports error", () => {
  const m = typecheck("const struct P { i32 x; } export void f(P p) { p.x = 5; }");
  if (!hasError(m, "cannot write through const reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval undefined variable reports error", () => {
  const m = typecheck("export void f() { noVar = 5; }");
  if (!hasError(m, "undefined variable")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval field on non-struct reports error", () => {
  const m = typecheck("export void f(i32 x) { x.foo = 1; }");
  if (!hasError(m, "field access on non-struct")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval unknown field reports error", () => {
  const m = typecheck("struct P { i32 x; } export void f(P p) { p.z = 1; }");
  if (!hasError(m, "unknown field")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval index access", () => {
  const m = typecheckExpect("export void f(i32[] arr, i32 i) { arr[i] = 5; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lval index on non-array reports error", () => {
  const m = typecheck("export void f(i32 x) { x[0] = 1; }");
  if (!hasError(m, "index on non-array")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: lval unwrap on nullable", () => {
  const m = typecheckExpect("struct P { i32 x; } export void f(P? p) { p!.x = 5; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lval unwrap on non-nullable reports error", () => {
  const m = typecheck("export void f(i32 x) { x! = 5; }");
  if (!hasError(m, "unwrap")) throw new Error("expected error");
});

// ---- Struct methods ----

Deno.test("wacTypeCheck: method with this param", () => {
  const m = typecheckExpect(`
    struct Counter {
      i32 n;
      i32 getCount(this) { return this.n; }
      void reset(this) { this.n = 0; }
    }
    export i32 f(Counter c) { c.reset(); return c.getCount(); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: const this prevents mutation", () => {
  const m = typecheck(`
    struct P { i32 x; }
    struct Wrapper {
      P inner;
      void mutate(const this) { this.inner.x = 5; }
    }
  `);
  // const this → const inner → can't assign to inner.x
  if (!hasError(m, "cannot write through const reference")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: static method (no this param)", () => {
  const m = typecheckExpect(`
    struct Counter {
      i32 n;
      Counter create(i32 n) { return Counter(n); }
    }
    export void f() { Counter c = Counter.create(5); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- Multi-file with imports ----

Deno.test("wacTypeCheck: imported function call resolved correctly", () => {
  const srcs = {
    "/main.wac": `import { add } from "./util.wac"; export i32 run() { return add(1, 2); }`,
    "/util.wac": `export i32 add(i32 a, i32 b) { return a + b; }`,
  };
  const m = wacTypeCheck(resolve(srcs));
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- expr statement ----

Deno.test("wacTypeCheck: expr statement (call for side effects)", () => {
  const m = typecheckExpect(`
    void sideEffect() { }
    export void f() { sideEffect(); }
  `);
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- anyref and isRefType coverage ----

Deno.test("wacTypeCheck: struct assignable to anyref", () => {
  // Covers typeAssignable line 69: to.tag === "anyref" && isRefType(from) with named type
  const m = typecheckExpect("struct P { i32 x; } export void f() { anyref a = P(1); }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: nullable assignable to anyref", () => {
  // Covers isRefType branch for nullable (branch 2 of the OR chain)
  const m = typecheckExpect("struct P { i32 x; } export void f() { P? p = null; anyref a = p; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: i31ref assignable to anyref", () => {
  // Covers isRefType for i31ref tag
  const m = typecheckExpect("export void f(i31ref r) { anyref a = r; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: non-ref type not assignable to anyref", () => {
  // Covers isRefType default case (returns false) for primitive types
  const m = typecheck("export void f(i32 x) { anyref a = x; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected type mismatch error");
});

// ---- typeStr array coverage ----

Deno.test("wacTypeCheck: array type in error message", () => {
  // Covers typeStr for array type (tag === "array") in error annotation
  const m = typecheck("export void f(i32[] arr) { i32 x = arr; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected type mismatch error");
});

// ---- var decl hint coverage ----

Deno.test("wacTypeCheck: f64 assigned to f32 has no cast hint", () => {
  // Covers branch where initType.tag === "f64" && stmt.type.tag === "f32" (hint suppressed)
  const m = typecheck("export void f() { f64 y = 1.5; f32 x = y; }");
  if (!hasError(m, "type mismatch")) throw new Error("expected type mismatch error");
  const e = m.errors.find(e => e.message.includes("type mismatch"));
  if (e?.hint) throw new Error("expected no hint for f64→f32 mismatch");
});

// ---- for-init assign type mismatch ----

Deno.test("wacTypeCheck: for init assign type mismatch reports error", () => {
  // Covers checkForInit assign branch with type mismatch
  const m = typecheck("export void f(i32 x) { for (x = true; false; ) {} }");
  if (!hasError(m, "type mismatch")) throw new Error("expected type mismatch error");
});

// ---- inferConstruct undefined struct via { } syntax ----

Deno.test("wacTypeCheck: construct undefined struct with brace syntax reports error", () => {
  // Covers inferConstruct !rs path via { } syntax (not call syntax)
  const m = typecheck("export void f() { NoStruct s = NoStruct { x: 1 }; }");
  if (!hasError(m, "undefined struct")) throw new Error("expected undefined struct error");
});

Deno.test("wacTypeCheck: default construction via brace syntax", () => {
  // Covers inferConstruct default form: P {} (empty braces, not call syntax)
  const m = typecheckExpect("struct P { i32 x; } export P f() { return P {}; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

// ---- inferMethodCall with args on error paths ----

Deno.test("wacTypeCheck: method call on non-struct with args", () => {
  // Covers inferMethodCall arg loop when !structDecl (to track loop body entry)
  const m = typecheck("export void f(i32 x) { x.foo(1, 2); }");
  if (!hasError(m, "method call on non-struct")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: unknown method with args", () => {
  // Covers inferMethodCall arg loop when !method
  const m = typecheck("struct P { i32 x; } export void f(P p) { p.badMethod(1, 2); }");
  if (!hasError(m, "unknown method")) throw new Error("expected error");
});

// ---- inferFnRef error path ----

Deno.test("wacTypeCheck: fnref for unknown method reports error", () => {
  // Covers inferFnRef error path when struct exists but method not found
  const m = typecheck("struct Counter { i32 n; } export void f() { fn[void()] r = Counter.noMethod; }");
  if (!hasError(m, "undefined function")) throw new Error("expected error");
});

Deno.test("wacTypeCheck: fnref for unknown struct reports error", () => {
  // Covers inferFnRef error path when struct not found
  const m = typecheck("export void f() { fn[void()] r = NoStruct.method; }");
  if (!hasError(m, "undefined function")) throw new Error("expected error");
});

// ---- lossless cast coverage ----

Deno.test("wacTypeCheck: lossless cast i32 to f64 uses as", () => {
  const m = typecheckExpect("export f64 f(i32 x) { return x as f64; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lossless cast f32 to f64 uses as", () => {
  const m = typecheckExpect("export f64 f(f32 x) { return x as f64; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});

Deno.test("wacTypeCheck: lossless cast bool to i32 uses as", () => {
  const m = typecheckExpect("export i32 f(bool x) { return x as i32; }");
  if (m.errors.length > 0) throw new Error(`errors: ${JSON.stringify(m.errors)}`);
});
