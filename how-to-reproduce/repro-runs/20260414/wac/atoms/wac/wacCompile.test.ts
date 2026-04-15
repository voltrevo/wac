// Tests for wacCompile: full pipeline (wacResolve → wacTypeCheck → wasmBuildBin).
// Spec tag tests verify exact CompileError fields required by the error spec.

import { wacCompile, type CompileError } from "./wacCompile.ts";

// ---- Helpers ----

function cap(sources: Record<string, string>) {
  return { readFile: (p: string) => sources[p] ?? "" };
}
function compile(src: string, file = "/main.wac") {
  return wacCompile(cap({ [file]: src }), file);
}
function errors(src: string, file = "/main.wac"): CompileError[] {
  const r = compile(src, file);
  return r.ok ? [] : r.errors;
}
function hasError(errs: CompileError[], msg: string): boolean {
  return errs.some(e => e.message.includes(msg));
}
function findError(errs: CompileError[], msg: string): CompileError | undefined {
  return errs.find(e => e.message.includes(msg));
}

// ---- Successful compilation ----

Deno.test("wacCompile: factorial compiles and runs correctly", async () => {
  const r = compile(`export i32 fact(i32 n) {
  if (n <= 1) { return 1; }
  return n * fact(n - 1);
}`);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  const fact = inst.exports.fact as (n: number) => number;
  // Independently verified: 5! = 120, 10! = 3628800
  if (fact(0) !== 1)       throw new Error("fact(0) != 1");
  if (fact(1) !== 1)       throw new Error("fact(1) != 1");
  if (fact(5) !== 120)     throw new Error("fact(5) != 120");
  if (fact(10) !== 3628800) throw new Error("fact(10) != 3628800");
});

Deno.test("wacCompile: struct field access compiles and runs", async () => {
  const r = compile(`struct Point { i32 x; i32 y; }
export i32 sumCoords(i32 ax, i32 ay) {
  Point p = Point(ax, ay);
  return p.x + p.y;
}`);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  const f = inst.exports.sumCoords as (a: number, b: number) => number;
  // 3 + 4 = 7, -5 + 5 = 0
  if (f(3, 4) !== 7) throw new Error("f(3,4) != 7");
  if (f(-5, 5) !== 0) throw new Error("f(-5,5) != 0");
});

Deno.test("wacCompile: multi-file import chains correctly", async () => {
  const sources: Record<string, string> = {
    "/main.wac": `import { triple } from "./math.wac";
export i32 nineX(i32 n) { return triple(triple(n)); }`,
    "/math.wac": `export i32 triple(i32 n) { return n * 3; }`,
  };
  const r = wacCompile({ readFile: (p) => sources[p] ?? "" }, "/main.wac");
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  const nineX = inst.exports.nineX as (n: number) => number;
  // triple(triple(7)) = triple(21) = 63
  if (nineX(7) !== 63) throw new Error("nineX(7) != 63");
  if (nineX(0) !== 0)  throw new Error("nineX(0) != 0");
});

Deno.test("wacCompile: exports metadata contains correct names and types", () => {
  const r = compile(`export i32 add(i32 a, i32 b) { return a + b; }
export void greet(i32 n) { }`);
  if (!r.ok) throw new Error("compile failed");
  const names = r.exports.map(e => e.name);
  if (!names.includes("add")) throw new Error("missing add export");
  if (!names.includes("greet")) throw new Error("missing greet export");
  const add = r.exports.find(e => e.name === "add")!;
  if (add.ret !== "i32") throw new Error("add.ret != i32");
  if (add.params.length !== 2) throw new Error("add params count");
  if (add.params[0]?.type !== "i32" || add.params[0]?.name !== "a") throw new Error("add param 0");
});

// ---- Error propagation ----

Deno.test("wacCompile: lex error returns phase=lex and ok=false", () => {
  const r = compile(`export i32 f() { return @; }`);
  if (r.ok) throw new Error("should fail");
  if (r.errors[0]?.phase !== "lex") throw new Error("wrong phase: " + r.errors[0]?.phase);
  if (!r.errors[0]?.message.includes("unexpected")) throw new Error("wrong message");
});

Deno.test("wacCompile: parse error returns phase=parse and ok=false", () => {
  const r = compile(`export i32 f() { i32 x = ; return x; }`);
  if (r.ok) throw new Error("should fail");
  if (r.errors[0]?.phase !== "parse") throw new Error("wrong phase: " + r.errors[0]?.phase);
});

Deno.test("wacCompile: resolve error (missing file) returns phase=resolve", () => {
  const sources: Record<string, string> = {
    "/main.wac": `import { f } from "./missing.wac";
export i32 g() { return f(); }`,
  };
  const r = wacCompile({ readFile: (p) => sources[p] ?? "" }, "/main.wac");
  if (r.ok) throw new Error("should fail");
  if (r.errors[0]?.phase !== "resolve") throw new Error("wrong phase: " + r.errors[0]?.phase);
});

Deno.test("wacCompile: typecheck error returns phase=typecheck and ok=false", () => {
  const r = compile(`export i32 bad(i32 x) { if (x) { return 1; } return 0; }`);
  if (r.ok) throw new Error("should fail");
  if (r.errors[0]?.phase !== "typecheck") throw new Error("wrong phase: " + r.errors[0]?.phase);
});

Deno.test("wacCompile: lex errors stop pipeline (no typecheck on broken tokens)", () => {
  const r = compile(`export i32 f() { return @@@@@; }`);
  if (r.ok) throw new Error("should fail");
  if (r.errors.some(e => e.phase === "typecheck")) throw new Error("typecheck ran despite lex errors");
});

Deno.test("wacCompile: typecheck errors stop pipeline (no wasm on type errors)", () => {
  const r = compile(`export i32 f() { return true; }`);
  if (r.ok) throw new Error("should fail");
  if (r.errors.some(e => e.phase !== "typecheck")) throw new Error("unexpected phase");
});

// ---- [§wac-sound-k3fn9wp] Wasm binary passes V8 validation ----

Deno.test("[§wac-sound-k3fn9wp] compiled binary instantiates in V8 without validation error", async () => {
  // A non-trivial program with structs, methods, recursion, arrays
  const r = compile(`struct Node { i32 val; }
export i32 fib(i32 n) {
  if (n <= 1) { return n; }
  return fib(n - 1) + fib(n - 2);
}
export i32 makeNode(i32 v) {
  Node nd = Node(v);
  return nd.val;
}`);
  if (!r.ok) throw new Error("compile failed: " + JSON.stringify(r.errors));
  // This will throw if V8 rejects the binary
  const inst = ((await WebAssembly.instantiate(r.wasm as any)) as any).instance;
  const fib = inst.exports.fib as (n: number) => number;
  const makeNode = inst.exports.makeNode as (v: number) => number;
  // fib(10) = 55 (Fibonacci sequence, verified independently)
  if (fib(10) !== 55) throw new Error(`fib(10) = ${fib(10)}, expected 55`);
  if (makeNode(42) !== 42) throw new Error("makeNode failed");
});

// ---- [§wac-diag-bool-r8kn4wp] Boolean condition error ----

Deno.test("[§wac-diag-bool-r8kn4wp] non-bool condition emits correct diagnostic", () => {
  const errs = errors(`export i32 bad(i32 x) {
  if (x) { return 1; }
  return 0;
}`);
  const e = errs.find(e => e.message === "condition must be bool");
  if (!e) throw new Error("missing error");
  if (e.span !== 1) throw new Error(`span=${e.span}, expected 1`);
  if (e.annotation !== "expected bool, found i32") throw new Error(`annotation: ${e.annotation}`);
  if (!e.hint?.includes("use a comparison")) throw new Error(`hint: ${e.hint}`);
});

// ---- [§wac-diag-assign-j3qm7xf] Type mismatch in assignment ----

Deno.test("[§wac-diag-assign-j3qm7xf] float-to-i32 mismatch points to RHS with span 4", () => {
  // "3.14" at line 4, col 11 in this source
  const src = `export i32 bad(i32 x) {
  bool a = true;
  bool b = false;
  i32 n = 3.14;
  return 0;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "type mismatch in assignment" && e.annotation?.includes("f64"));
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 4) throw new Error(`span=${e.span}, expected 4`);
  if (e.line !== 4) throw new Error(`line=${e.line}, expected 4`);
  if (e.col !== 11) throw new Error(`col=${e.col}, expected 11`);
  if (e.annotation !== "expected i32, found f64") throw new Error(`annotation: ${e.annotation}`);
  if (!e.hint?.includes("as!")) throw new Error(`hint: ${e.hint}`);
});

// ---- [§wac-diag-cast-p5fn2rk] Lossy cast not needed ----

Deno.test("[§wac-diag-cast-p5fn2rk] lossless cast points to operand with full span", () => {
  // "x as~ i64" starts at col 9 (no indent), span=9
  const src = `export i64 f(i32 x) {
i64 a = x as~ i64;
return a;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "lossy cast not needed");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 9) throw new Error(`span=${e.span}, expected 9`);
  if (e.col !== 9) throw new Error(`col=${e.col}, expected 9`);
  if (e.annotation !== "i32 -> i64 is lossless") throw new Error(`annotation: ${e.annotation}`);
  if (!e.hint?.includes("use `as`")) throw new Error(`hint: ${e.hint}`);
});

// ---- [§wac-diag-null-h6kp9wn] Nullable-to-non-null assignment ----

Deno.test("[§wac-diag-null-h6kp9wn] nullable-to-non-null emits correct message and hint", () => {
  // "q" at line 5, col 13 in this source
  const src = `struct Point { i32 x; i32 y; }
export void bad(Point? q) {
  bool a = true;
  bool b = false;
  Point p = q;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "cannot assign nullable to non-null");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 1) throw new Error(`span=${e.span}, expected 1`);
  if (e.line !== 5) throw new Error(`line=${e.line}, expected 5`);
  if (e.col !== 13) throw new Error(`col=${e.col}, expected 13`);
  if (e.annotation !== "expected Point, found Point?") throw new Error(`annotation: ${e.annotation}`);
  if (!e.hint?.includes("unwrap with `!`")) throw new Error(`hint: ${e.hint}`);
  if (!e.hint?.includes("q!")) throw new Error(`hint missing variable name: ${e.hint}`);
});

// ---- [§wac-diag-const-w2jm5xf] Write through const reference ----

Deno.test("[§wac-diag-const-w2jm5xf] field write on const struct emits correct diagnostic", () => {
  // "p.x" at line 8, col 3 in this source, span=3
  const src = `struct Point { i32 x; i32 y; }
export void bad(Point q) {
  bool a = true;
  bool b = false;
  bool c2 = true;
  bool d = false;
  const Point p = q;
  p.x = 5;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "cannot write through const reference");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 3) throw new Error(`span=${e.span}, expected 3`);
  if (e.line !== 8) throw new Error(`line=${e.line}, expected 8`);
  if (e.col !== 3) throw new Error(`col=${e.col}, expected 3`);
  if (e.annotation !== "p is const") throw new Error(`annotation: ${e.annotation}`);
});

// ---- [§wac-diag-wide-k4rn8wp] Wide gutter + bool-to-i32 hint ----

Deno.test("[§wac-diag-wide-k4rn8wp] return bool span and hint at high line numbers", () => {
  // Build a function with 46 lines of declarations so the return is at line 47
  const decls = Array.from({ length: 44 }, (_, i) => `  i32 x${i} = ${i};`).join("\n");
  const src = `export i32 algo() {\n${decls}\n  i32 sum = x0 + x1;\n  return sum > 0;\n}`;
  const errs = errors(src);
  const e = errs.find(e => e.message.includes("return:"));
  if (!e) throw new Error("missing return error, got: " + JSON.stringify(errs));
  // "sum > 0" = 3 + 1 + 1 + 1 + 1 = 7 chars
  if (e.span !== 7) throw new Error(`span=${e.span}, expected 7`);
  if (e.annotation !== "expected i32, found bool") throw new Error(`annotation: ${e.annotation}`);
  if (!e.hint?.includes("as i32")) throw new Error(`hint: ${e.hint}`);
  if (!e.hint?.includes("sum > 0")) throw new Error(`hint missing expr: ${e.hint}`);
});

// ---- [§wac-diag-parse-unexpected-q3kn8wp] Unexpected token ----

Deno.test("[§wac-diag-parse-unexpected-q3kn8wp] missing expression emits correct diagnostic", () => {
  // ";" at col 11 in "  i32 w = ;" (line 5)
  const src = `export i32 f() {
  i32 x = 5;
  i32 y = 6;
  i32 z = 7;
  i32 w = ;
  return 0;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "unexpected token");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 1) throw new Error(`span=${e.span}, expected 1`);
  if (e.line !== 5) throw new Error(`line=${e.line}, expected 5`);
  if (e.col !== 11) throw new Error(`col=${e.col}, expected 11`);
  if (e.annotation !== "expected expression") throw new Error(`annotation: ${e.annotation}`);
});

// ---- [§wac-diag-parse-missing-semi-r7jm4xf] Missing semicolon ----

Deno.test("[§wac-diag-parse-missing-semi-r7jm4xf] missing ';' points to end of expression", () => {
  // "2" is the last char of "5 + 2" at col 15; ';' should be at col 16
  const src = `export i32 f() {
  i32 x = 5 + 2
  i32 y = 3;
  return x;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "expected ';'");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.line !== 2) throw new Error(`line=${e.line}, expected 2`);
  if (e.col !== 16) throw new Error(`col=${e.col}, expected 16`);
  if (e.annotation !== "expected ';' after statement") throw new Error(`annotation: ${e.annotation}`);
});

// ---- [§wac-diag-parse-missing-brace-w5hd2jk] Missing closing brace ----

Deno.test("[§wac-diag-parse-missing-brace-w5hd2jk] unclosed block emits '}' error at EOF", () => {
  const src = `export i32 foo() {
  i32 x = 1;
  return x;

`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "expected '}'");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.phase !== "parse") throw new Error(`phase=${e.phase}`);
  // Error at EOF — any line/col is acceptable as long as the error is present
});

// ---- [§wac-diag-parse-missing-paren-k8fn3qp] Missing closing paren ----

Deno.test("[§wac-diag-parse-missing-paren-k8fn3qp] missing ')' emits correct annotation", () => {
  // ";" at col 19 in "  i32 x = add(1, 2;" (line 2)
  const src = `export i32 f() {
  i32 x = add(1, 2;
  return x;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "expected ')'");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.line !== 2) throw new Error(`line=${e.line}, expected 2`);
  if (e.col !== 19) throw new Error(`col=${e.col}, expected 19`);
  if (e.annotation !== "expected ')' to close argument list") throw new Error(`annotation: ${e.annotation}`);
});

// ---- [§wac-diag-parse-bad-type-n7qm3xf] Unknown type name ----

Deno.test("[§wac-diag-parse-bad-type-n7qm3xf] unknown type name emits span=3 annotation", () => {
  // "foo" at col 3 in "  foo x = 5;" (line 2), span = length("foo") = 3
  const src = `export i32 f() {
  foo x = 5;
  return x;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "expected type" && e.annotation?.startsWith("unknown type"));
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.span !== 3) throw new Error(`span=${e.span}, expected 3`);
  if (e.annotation !== "unknown type 'foo'") throw new Error(`annotation: ${e.annotation}`);
});

// ---- [§wac-diag-parse-bad-struct-h9pd5wn] Bad struct syntax ----

Deno.test("[§wac-diag-parse-bad-struct-h9pd5wn] invalid struct member emits correct annotation", () => {
  const src = `struct S {
  i32 x;
  = 5;
}`;
  const errs = errors(src);
  const e = errs.find(e => e.message === "expected field or method declaration");
  if (!e) throw new Error("missing error, got: " + JSON.stringify(errs));
  if (e.line !== 3) throw new Error(`line=${e.line}, expected 3`);
  if (e.col !== 3) throw new Error(`col=${e.col}, expected 3`);
  if (e.annotation !== "expected type name") throw new Error(`annotation: ${e.annotation}`);
});

// ---- Multiple errors returned ----

Deno.test("wacCompile: multiple type errors all returned", () => {
  const errs = errors(`export void f(i32 a, i32 b) {
  if (a) { }
  if (b) { }
}`);
  // Both non-bool conditions should be reported
  const boolErrors = errs.filter(e => e.message === "condition must be bool");
  if (boolErrors.length !== 2) throw new Error(`expected 2 bool errors, got ${boolErrors.length}`);
});
