import { wacLex } from "./wacLex.ts";
import { wacParse } from "./wacParse.ts";
import type { Program, Expr, Stmt, WacType, FuncDecl, StructDecl } from "./ast.ts";

function parse(src: string): Program {
  const { tokens } = wacLex(src);
  const { program, errors } = wacParse(tokens);
  if (errors.length > 0) throw new Error(`Parse errors: ${JSON.stringify(errors)}`);
  return program;
}

function parseWithErrors(src: string) {
  const { tokens } = wacLex(src);
  return wacParse(tokens);
}

function func(src: string): FuncDecl {
  const p = parse(src);
  if (p.funcs.length === 0) throw new Error("no funcs");
  return p.funcs[0];
}

function firstStmt(src: string): Stmt {
  const f = func(src);
  return f.body.stmts[0];
}

function firstExpr(src: string): Expr {
  const s = firstStmt(`export i32 f() { return ${src}; }`);
  if (s.tag !== "return") throw new Error(`expected return, got ${s.tag}`);
  if (!s.value) throw new Error("no value");
  return s.value;
}

// ---- Function declarations ----

Deno.test("wacParse: exported function with params", () => {
  const p = parse("export i32 gcd(i32 a, i32 b) { return a; }");
  if (p.funcs.length !== 1) throw new Error("expected 1 func");
  const f = p.funcs[0];
  if (f.name !== "gcd") throw new Error("name");
  if (f.isExport !== true) throw new Error("isExport");
  if (f.returnType.tag !== "i32") throw new Error("retType");
  if (f.params.length !== 2) throw new Error("params");
  if (f.params[0].name !== "a") throw new Error("param a");
  if (f.params[1].type.tag !== "i32") throw new Error("param b type");
});

Deno.test("wacParse: non-exported function", () => {
  const f = func("i32 helper(i32 x) { return x; }");
  if (f.isExport !== false) throw new Error("should not be exported");
  if (f.name !== "helper") throw new Error("name");
});

Deno.test("wacParse: void function", () => {
  const f = func("void greet() { }");
  if (f.returnType.tag !== "void") throw new Error("void return");
});

// ---- Imports ----

Deno.test("wacParse: import with rename", () => {
  const p = parse(`import { distance as dist, midpoint } from "./geom.wac";`);
  if (p.imports.length !== 1) throw new Error("one import");
  const imp = p.imports[0];
  if (imp.from !== "./geom.wac") throw new Error("path");
  if (imp.items.length !== 2) throw new Error("2 items");
  if (imp.items[0].name !== "distance" || imp.items[0].as !== "dist") throw new Error("rename");
  if (imp.items[1].name !== "midpoint" || imp.items[1].as !== "midpoint") throw new Error("no rename");
});

// ---- Struct declarations ----

Deno.test("wacParse: struct with fields", () => {
  const p = parse(`struct Point { i32 x; i32 y; }`);
  if (p.structs.length !== 1) throw new Error("1 struct");
  const s = p.structs[0];
  if (s.name !== "Point") throw new Error("name");
  if (s.fields.length !== 2) throw new Error("2 fields");
  if (s.fields[0].name !== "x") throw new Error("field x");
  if (s.fields[1].type.tag !== "i32") throw new Error("field y type");
});

Deno.test("wacParse: const struct", () => {
  const p = parse(`const struct Config { i32 w; }`);
  if (!p.structs[0].isConst) throw new Error("isConst");
});

Deno.test("wacParse: struct with parent", () => {
  const p = parse(`struct Rect : Shape { f64 w; f64 h; }`);
  if (p.structs[0].parent !== "Shape") throw new Error("parent");
});

Deno.test("wacParse: struct with method", () => {
  const p = parse(`struct Counter {
    i32 count;
    i32 get(const this) { return this.count; }
    void inc(this) { this.count += 1; }
    Counter create(i32 n) { return Counter(n); }
  }`);
  const s = p.structs[0];
  if (s.methods.length !== 3) throw new Error(`${s.methods.length} methods`);
  if (s.methods[0].thisParam !== "const") throw new Error("const this");
  if (s.methods[1].thisParam !== "mutable") throw new Error("mutable this");
  if (s.methods[2].thisParam !== undefined) throw new Error("static no this");
});

Deno.test("wacParse: const field in struct", () => {
  const p = parse(`struct T { const i32 id; i32 val; }`);
  if (!p.structs[0].fields[0].isConst) throw new Error("const field");
  if (p.structs[0].fields[1].isConst) throw new Error("not const");
});

Deno.test("wacParse: method with override", () => {
  const p = parse(`struct Circle : Shape {
    f64 r;
    override string name(const this) { return "circle"; }
  }`);
  if (!p.structs[0].methods[0].isOverride) throw new Error("override");
});

// ---- Types ----

Deno.test("wacParse: array type and nullable", () => {
  const p = parse("i32[] f() { return i32[](1,2); }");
  if (p.funcs[0].returnType.tag !== "array") throw new Error("array return");
  const arr = p.funcs[0].returnType;
  if (arr.tag !== "array") throw new Error("array");
  if (arr.elem.tag !== "i32") throw new Error("elem");
});

Deno.test("wacParse: nullable type T?", () => {
  const p = parse("Point? f() { return null; }");
  const rt = p.funcs[0].returnType;
  if (rt.tag !== "nullable") throw new Error("nullable");
  if (rt.inner.tag !== "named" || rt.inner.name !== "Point") throw new Error("inner");
});

Deno.test("wacParse: funcref type", () => {
  const p = parse("fn[bool(i32,i32)] f() { return null; }");
  const rt = p.funcs[0].returnType;
  if (rt.tag !== "funcref") throw new Error("funcref");
  if (rt.ret.tag !== "bool") throw new Error("ret bool");
  if (rt.params.length !== 2) throw new Error("2 params");
});

// ---- Statements ----

Deno.test("wacParse: var declaration", () => {
  const s = firstStmt(`export void f() { i32 x = 5; }`);
  if (s.tag !== "var") throw new Error(`${s.tag}`);
  if (s.name !== "x") throw new Error("name");
  if (s.type.tag !== "i32") throw new Error("type");
  if (s.init.tag !== "int") throw new Error("init");
});

Deno.test("wacParse: const var declaration", () => {
  const s = firstStmt(`export void f() { const i32 y = 10; }`);
  if (s.tag !== "var") throw new Error(`${s.tag}`);
  if (!s.isConst) throw new Error("isConst");
});

Deno.test("wacParse: assignment", () => {
  const s = firstStmt(`export void f() { i32 x = 0; x = 5; }`);
  const s2 = func(`export void f() { i32 x = 0; x = 5; }`).body.stmts[1];
  if (s2.tag !== "assign") throw new Error(`${s2.tag}`);
  if (s2.lval.name !== "x") throw new Error("lval");
});

Deno.test("wacParse: compound assignment", () => {
  const stmts = func(`export void f() { i32 x = 0; x += 5; x -= 1; }`).body.stmts;
  const add = stmts[1];
  if (add.tag !== "compound" || add.op !== "+=") throw new Error(`${add.tag} ${add.tag === "compound" ? add.op : ""}`);
});

Deno.test("wacParse: increment decrement", () => {
  const stmts = func(`export void f() { i32 x = 0; x++; x--; }`).body.stmts;
  const inc = stmts[1];
  if (inc.tag !== "incr" || inc.op !== "++") throw new Error("++");
  const dec = stmts[2];
  if (dec.tag !== "incr" || dec.op !== "--") throw new Error("--");
});

Deno.test("wacParse: if-else", () => {
  const s = firstStmt(`export void f() { if (true) { } else { } }`);
  if (s.tag !== "if") throw new Error("if");
  if (!s.else_) throw new Error("else");
});

Deno.test("wacParse: if-else-if chain", () => {
  const s = firstStmt(`export void f() { if (true) { } else if (false) { } }`);
  if (s.tag !== "if") throw new Error("if");
  if (!s.else_ || typeof s.else_ === "object" && "stmts" in s.else_) {
    // else_ should be an if stmt, not a block
  }
  const else_ = s.else_;
  if (!else_ || !("tag" in else_) || else_.tag !== "if") throw new Error("else if");
});

Deno.test("wacParse: while loop", () => {
  const s = firstStmt(`export void f() { while (true) { break; } }`);
  if (s.tag !== "while") throw new Error("while");
  if (s.body.stmts[0].tag !== "break") throw new Error("break");
});

Deno.test("wacParse: for loop", () => {
  const s = firstStmt(`export void f() { for (i32 i = 0; i < 10; i++) { } }`);
  if (s.tag !== "for") throw new Error("for");
  if (!s.init || s.init.tag !== "var") throw new Error("init");
  if (!s.cond) throw new Error("cond");
  if (!s.update || s.update.tag !== "incr") throw new Error("update");
});

Deno.test("wacParse: do-while", () => {
  const s = firstStmt(`export void f() { do { } while (true); }`);
  if (s.tag !== "dowhile") throw new Error("dowhile");
});

Deno.test("wacParse: switch", () => {
  const s = firstStmt(`export void f() { switch (x) { case 0: { } default: { } } }`);
  if (s.tag !== "switch") throw new Error("switch");
  if (s.cases.length !== 1) throw new Error("1 case");
  if (!s.default_) throw new Error("default");
});

Deno.test("wacParse: return with value", () => {
  const s = firstStmt(`export i32 f() { return 42; }`);
  if (s.tag !== "return" || !s.value) throw new Error("return");
  if (s.value.tag !== "int" || s.value.value !== 42) throw new Error("42");
});

Deno.test("wacParse: return void", () => {
  const s = firstStmt(`export void f() { return; }`);
  if (s.tag !== "return" || s.value) throw new Error("void return");
});

Deno.test("wacParse: trap statement", () => {
  const s = firstStmt(`export void f() { trap; }`);
  if (s.tag !== "trap") throw new Error("trap");
});

// ---- Expressions ----

Deno.test("wacParse: integer literal", () => {
  const e = firstExpr("42");
  if (e.tag !== "int" || e.value !== 42) throw new Error("42");
});

Deno.test("wacParse: hex literal", () => {
  const e = firstExpr("0xFF");
  if (e.tag !== "int" || e.value !== 255) throw new Error("0xFF");
});

Deno.test("wacParse: float literal", () => {
  const e = firstExpr("3.14");
  if (e.tag !== "float" || Math.abs(e.value - 3.14) > 1e-10) throw new Error("3.14");
});

Deno.test("wacParse: string literal decoded", () => {
  const e = firstExpr('"hello\\nworld"');
  if (e.tag !== "str") throw new Error("str");
  if (e.value !== "hello\nworld") throw new Error(`val: ${e.value}`);
});

Deno.test("wacParse: bool literals", () => {
  const t = firstExpr("true");
  const f = firstExpr("false");
  if (t.tag !== "bool" || t.value !== true) throw new Error("true");
  if (f.tag !== "bool" || f.value !== false) throw new Error("false");
});

Deno.test("wacParse: null literal", () => {
  const e = firstExpr("null");
  if (e.tag !== "null") throw new Error("null");
});

Deno.test("wacParse: binary expressions with precedence", () => {
  // 2 + 3 * 4 should parse as 2 + (3 * 4)
  const e = firstExpr("2 + 3 * 4");
  if (e.tag !== "binary" || e.op !== "+") throw new Error("outer +");
  const right = e.right;
  if (right.tag !== "binary" || right.op !== "*") throw new Error("inner *");
});

Deno.test("wacParse: unary minus", () => {
  const e = firstExpr("-42");
  if (e.tag !== "unary" || e.op !== "-") throw new Error("unary -");
  if (e.operand.tag !== "int" || e.operand.value !== 42) throw new Error("42");
});

Deno.test("wacParse: logical not", () => {
  const e = firstExpr("!flag");
  if (e.tag !== "unary" || e.op !== "!") throw new Error("!");
});

Deno.test("wacParse: cast expressions", () => {
  const e = firstExpr("x as i64");
  if (e.tag !== "cast" || e.op !== "as") throw new Error("as");
  if (e.toType.tag !== "i64") throw new Error("i64");

  const e2 = firstExpr("big as! i32");
  if (e2.tag !== "cast" || e2.op !== "as!") throw new Error("as!");

  const e3 = firstExpr("x as~ bool");
  if (e3.tag !== "cast" || e3.op !== "as~") throw new Error("as~");

  const e4 = firstExpr("big as@ i32");
  if (e4.tag !== "cast" || e4.op !== "as@") throw new Error("as@");
});

Deno.test("wacParse: is / is not", () => {
  const e = firstExpr("s is Circle");
  if (e.tag !== "is" || e.not) throw new Error("is");
  const check = e.checkType;
  if (typeof check === "string") throw new Error("not string");
  if (typeof check === "object" && "tag" in check && check.tag !== "named") throw new Error("named");

  const e2 = firstExpr("s is not Rect");
  if (e2.tag !== "is" || !e2.not) throw new Error("is not");

  const e3 = firstExpr("q is null");
  if (e3.tag !== "is" || e3.checkType !== "null") throw new Error("is null");
});

Deno.test("wacParse: ternary", () => {
  const e = firstExpr("a > b ? a : b");
  if (e.tag !== "ternary") throw new Error("ternary");
  if (e.cond.tag !== "binary") throw new Error("cond");
});

Deno.test("wacParse: function call", () => {
  const e = firstExpr("gcd(48, 18)");
  if (e.tag !== "call") throw new Error("call");
  if (e.func !== "gcd") throw new Error("func");
  if (e.args.length !== 2) throw new Error("args");
});

Deno.test("wacParse: static method call Type.method(args)", () => {
  const e = firstExpr("Counter.create(1)");
  if (e.tag !== "call") throw new Error("call");
  if (e.func !== "create") throw new Error("func");
  if (e.typeQual !== "Counter") throw new Error("typeQual");
  if (e.args.length !== 1) throw new Error("args");
});

Deno.test("wacParse: method call on object", () => {
  const e = firstExpr("c.getCount()");
  if (e.tag !== "method") throw new Error(`method, got ${e.tag}`);
  if (e.name !== "getCount") throw new Error("name");
});

Deno.test("wacParse: field access", () => {
  const e = firstExpr("p.x");
  if (e.tag !== "field") throw new Error(`field, got ${e.tag}`);
  if (e.name !== "x") throw new Error("x");
});

Deno.test("wacParse: index expression", () => {
  const e = firstExpr("arr[5]");
  if (e.tag !== "index") throw new Error("index");
});

Deno.test("wacParse: unwrap operator", () => {
  const e = firstExpr("q!");
  if (e.tag !== "unwrap") throw new Error("unwrap");
});

Deno.test("wacParse: array construction sized T[n]()", () => {
  const e = firstExpr("i32[5]()");
  if (e.tag !== "array_new") throw new Error(`array_new, got ${e.tag}`);
  if (e.elemType.tag !== "i32") throw new Error("elem i32");
  if (!e.size) throw new Error("size");
});

Deno.test("wacParse: array construction literal T[](elems)", () => {
  const e = firstExpr("i32[](1, 2, 3)");
  if (e.tag !== "array_new") throw new Error(`array_new, got ${e.tag}`);
  if (e.elemType.tag !== "i32") throw new Error("elem i32");
  if (!e.elems || e.elems.length !== 3) throw new Error("3 elems");
});

Deno.test("wacParse: array construction named type Point[n]()", () => {
  const e = firstExpr("Point[10]()");
  if (e.tag !== "array_new") throw new Error(`array_new, got ${e.tag}`);
  if (e.elemType.tag !== "named") throw new Error("named");
  if (e.elemType.tag === "named" && e.elemType.name !== "Point") throw new Error("Point");
});

Deno.test("wacParse: named struct construction", () => {
  const e = firstExpr("Point { x: 3, y: 4 }");
  if (e.tag !== "construct") throw new Error("construct");
  if (e.form !== "named") throw new Error("named");
  if (e.fields?.length !== 2) throw new Error("2 fields");
  if (e.fields![0].name !== "x") throw new Error("x");
});

Deno.test("wacParse: grouped expression", () => {
  const e = firstExpr("(a + b)");
  if (e.tag !== "paren") throw new Error("paren");
  if (e.expr.tag !== "binary") throw new Error("binary inside");
});

Deno.test("wacParse: chained postfix", () => {
  const e = firstExpr("list.head!.val");
  // Should be: field(unwrap(field(ident "list", "head")), "val")
  if (e.tag !== "field" || e.name !== "val") throw new Error("outer field");
  if (e.object.tag !== "unwrap") throw new Error("unwrap");
});

// ---- Error recovery ----

Deno.test("wacParse: missing semicolon reports error", () => {
  const { errors } = parseWithErrors("export i32 f() { i32 x = 5 }");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: unexpected token in expression", () => {
  const { errors } = parseWithErrors("export i32 f() { i32 x = ; return x; }");
  if (errors.length === 0) throw new Error("expected error");
});

// ---- Source location ----

Deno.test("wacParse: function has correct line/col", () => {
  const p = parse("export i32 f() { return 1; }");
  if (p.funcs[0].line !== 1) throw new Error("line");
  if (p.funcs[0].col !== 1) throw new Error("col");
});

// ---- Additional coverage tests ----

// export struct / export const struct
Deno.test("wacParse: export struct", () => {
  const p = parse("export struct Point { i32 x; i32 y; }");
  if (p.structs.length !== 1) throw new Error("1 struct");
  if (p.structs[0].name !== "Point") throw new Error("name");
});

Deno.test("wacParse: export const struct", () => {
  const p = parse("export const struct Config { i32 n; }");
  if (p.structs.length !== 1 || !p.structs[0].isConst) throw new Error("const struct");
});

// Top-level declaration error
Deno.test("wacParse: unexpected top-level token reports error", () => {
  const { errors } = parseWithErrors("42;");
  if (errors.length === 0) throw new Error("expected error");
});

// Import trailing comma
Deno.test("wacParse: import with trailing comma", () => {
  const p = parse(`import { a, b, } from "./x.wac";`);
  if (p.imports[0].items.length !== 2) throw new Error("2 items");
});

// Import error paths
Deno.test("wacParse: import without from keyword", () => {
  const { errors } = parseWithErrors(`import { a } "./x.wac";`);
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: import without string path", () => {
  const { errors } = parseWithErrors(`import { a } from 42;`);
  if (errors.length === 0) throw new Error("expected error");
});

// Struct with bad field triggers sync (must use a non-type token, not an ident)
Deno.test("wacParse: struct bad member triggers error recovery", () => {
  const { errors } = parseWithErrors("struct T { return; i32 x; }");
  if (errors.length === 0) throw new Error("expected error");
});

// Struct method with this + extra params
Deno.test("wacParse: struct method const-this with extra params", () => {
  const p = parse("struct T { i32 get(const this, i32 off) { return off; } }");
  const m = p.structs[0].methods[0];
  if (m.thisParam !== "const") throw new Error("const this");
  if (m.params.length !== 1) throw new Error("1 extra param");
  if (m.params[0].name !== "off") throw new Error("off");
});

Deno.test("wacParse: struct method mutable-this with extra params", () => {
  const p = parse("struct T { void add(this, i32 n) { } }");
  const m = p.structs[0].methods[0];
  if (m.thisParam !== "mutable") throw new Error("mutable this");
  if (m.params.length !== 1) throw new Error("1 extra param");
});

// Override on field reports error
Deno.test("wacParse: override field reports error", () => {
  const { errors } = parseWithErrors("struct T { override i32 x; }");
  if (errors.length === 0) throw new Error("expected error");
});

// Types
Deno.test("wacParse: anyref return type", () => {
  const p = parse("anyref f() { return null; }");
  if (p.funcs[0].returnType.tag !== "anyref") throw new Error("anyref");
});

Deno.test("wacParse: i31ref return type", () => {
  const p = parse("i31ref f() { return null; }");
  if (p.funcs[0].returnType.tag !== "i31ref") throw new Error("i31ref");
});

Deno.test("wacParse: funcref type with no params", () => {
  const p = parse("fn[void()] f() { return null; }");
  const rt = p.funcs[0].returnType;
  if (rt.tag !== "funcref") throw new Error("funcref");
  if (rt.params.length !== 0) throw new Error("no params");
});

Deno.test("wacParse: funcref type trailing comma", () => {
  const p = parse("fn[bool(i32,)] f() { return null; }");
  const rt = p.funcs[0].returnType;
  if (rt.tag !== "funcref") throw new Error("funcref");
  if (rt.params.length !== 1) throw new Error("1 param");
});

Deno.test("wacParse: i8 and i16 types", () => {
  const p = parse("i8 f8() { return 0; } i16 f16() { return 0; }");
  if (p.funcs[0].returnType.tag !== "i8") throw new Error("i8");
  if (p.funcs[1].returnType.tag !== "i16") throw new Error("i16");
});

Deno.test("wacParse: invalid type reports error", () => {
  const { errors } = parseWithErrors("export ( f() { }");
  if (errors.length === 0) throw new Error("expected error");
});

// Unclosed block at EOF
Deno.test("wacParse: unclosed block at EOF reports error", () => {
  const { errors } = parseWithErrors("export void f() {");
  if (errors.length === 0) throw new Error("expected error");
  if (!errors.some((e) => e.message.includes("}"))) throw new Error("missing } in message");
});

// continue statement
Deno.test("wacParse: continue statement", () => {
  const stmts = func("export void f() { while (true) { continue; } }").body.stmts;
  const ws = stmts[0];
  if (ws.tag !== "while") throw new Error("while");
  if (ws.body.stmts[0].tag !== "continue") throw new Error("continue");
});

// for loop variants
Deno.test("wacParse: for loop no init cond update", () => {
  const s = firstStmt("export void f() { for (;;) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && (s.init || s.cond || s.update)) throw new Error("should be empty");
});

Deno.test("wacParse: for loop with assign init", () => {
  const s = firstStmt("export void f() { for (x = 0; x < 10; x++) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && (!s.init || s.init.tag !== "assign")) throw new Error("assign init");
});

Deno.test("wacParse: for loop update compound", () => {
  const s = firstStmt("export void f() { for (i32 i = 0; i < 10; i += 2) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && (!s.update || s.update.tag !== "compound")) throw new Error("compound update");
});

Deno.test("wacParse: for loop update assign", () => {
  const s = firstStmt("export void f() { for (i32 i = 0; i < 10; x = i) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && (!s.update || s.update.tag !== "assign")) throw new Error("assign update");
});

Deno.test("wacParse: for loop update error recovery", () => {
  const { errors } = parseWithErrors("export void f() { for (;;i + 1) { } }");
  if (errors.length === 0) throw new Error("expected error");
});

// switch unexpected token
Deno.test("wacParse: switch unexpected token in body", () => {
  const { errors } = parseWithErrors("export void f() { switch (x) { 42; } }");
  if (errors.length === 0) throw new Error("expected error");
});

// var decl with funcref type (exercises looksLikeVarDecl fn path)
Deno.test("wacParse: var decl with funcref type", () => {
  const s = firstStmt("export void f() { fn[void()] cb = null; }");
  if (s.tag !== "var") throw new Error(`var, got ${s.tag}`);
  if (s.type.tag !== "funcref") throw new Error("funcref type");
});

// Invalid lval error paths
Deno.test("wacParse: invalid assignment lval reports error", () => {
  const { errors } = parseWithErrors("export void f() { 3 = 5; }");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: invalid compound assignment lval reports error", () => {
  const { errors } = parseWithErrors("export void f() { 3 += 5; }");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: invalid increment lval reports error", () => {
  const { errors } = parseWithErrors("export void f() { 3++; }");
  if (errors.length === 0) throw new Error("expected error");
});

// parseLVal with ops (used in for-loop init/update)
Deno.test("wacParse: for loop with field lval", () => {
  const s = firstStmt("export void f() { for (a.x = 0; a.x < 10; a.x++) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && s.init) {
    if (s.init.tag !== "assign") throw new Error("assign");
    if (s.init.lval.ops.length !== 1 || s.init.lval.ops[0].tag !== "field") throw new Error("field op");
  }
});

Deno.test("wacParse: for loop with index lval in update", () => {
  const s = firstStmt("export void f() { for (i32 i = 0; i < 10; arr[i] = i) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && s.update) {
    if (s.update.tag !== "assign") throw new Error("assign update");
    if (s.update.lval.ops.length !== 1 || s.update.lval.ops[0].tag !== "index") throw new Error("index op");
  }
});

Deno.test("wacParse: for loop with unwrap lval", () => {
  const s = firstStmt("export void f() { for (p! = null; true;) { } }");
  if (s.tag !== "for") throw new Error("for");
  if (s.tag === "for" && s.init) {
    if (s.init.tag !== "assign") throw new Error("assign");
    if (s.init.lval.ops.length !== 1 || s.init.lval.ops[0].tag !== "unwrap") throw new Error("unwrap op");
  }
});

// int64 literal
Deno.test("wacParse: int64 large integer literal", () => {
  const e = firstExpr("9999999999");
  if (e.tag !== "int64") throw new Error(`int64, got ${e.tag}`);
  if (e.tag === "int64" && e.value !== 9999999999n) throw new Error("value");
});

// char literal expressions
Deno.test("wacParse: char literal expression", () => {
  const e = firstExpr("'a'");
  if (e.tag !== "char" || e.value !== "a") throw new Error("char a");
});

Deno.test("wacParse: char escape sequences in expression", () => {
  const cases: [string, string][] = [
    ["'\\n'", "\n"], ["'\\t'", "\t"], ["'\\r'", "\r"],
    ["'\\\\'" , "\\"], ["'\\0'", "\0"],
  ];
  for (const [src, expected] of cases) {
    const e = firstExpr(src);
    if (e.tag !== "char") throw new Error(`not char: ${src}`);
    if (e.value !== expected) throw new Error(`wrong value ${src}: got ${JSON.stringify(e.value)}`);
  }
});

// fn array construction in expression
Deno.test("wacParse: fn funcref array construction", () => {
  const e = firstExpr("fn[void()][3]()");
  if (e.tag !== "array_new") throw new Error(`array_new, got ${e.tag}`);
  if (e.elemType.tag !== "funcref") throw new Error("funcref elem");
  if (!("size" in e) || !e.size) throw new Error("size");
});

// fnref with type qualifier (no call parens)
Deno.test("wacParse: type-qualified function reference", () => {
  const e = firstExpr("Counter.factory");
  if (e.tag !== "fnref") throw new Error(`fnref, got ${e.tag}`);
  if (e.tag === "fnref" && e.func !== "factory") throw new Error("func");
  if (e.tag === "fnref" && e.typeQual !== "Counter") throw new Error("typeQual");
});

// Named type array literal
Deno.test("wacParse: named type array literal construction", () => {
  const e = firstExpr("Point[](a, b)");
  if (e.tag !== "array_new") throw new Error(`array_new, got ${e.tag}`);
  if (e.elemType.tag !== "named") throw new Error("named elem");
  if (!("elems" in e) || !e.elems || e.elems.length !== 2) throw new Error("2 elems");
});

// exprToLVal chain — field, index, unwrap lvalues
Deno.test("wacParse: field lval assignment", () => {
  const s = func("export void f() { obj.field = 5; }").body.stmts[0];
  if (s.tag !== "assign") throw new Error("assign");
  if (s.tag === "assign") {
    if (s.lval.name !== "obj") throw new Error("name");
    if (s.lval.ops.length !== 1 || s.lval.ops[0].tag !== "field") throw new Error("field op");
  }
});

Deno.test("wacParse: index lval assignment", () => {
  const s = func("export void f() { arr[0] = 5; }").body.stmts[0];
  if (s.tag !== "assign") throw new Error("assign");
  if (s.tag === "assign") {
    if (s.lval.ops.length !== 1 || s.lval.ops[0].tag !== "index") throw new Error("index op");
  }
});

Deno.test("wacParse: unwrap lval assignment", () => {
  const s = func("export void f() { p! = null; }").body.stmts[0];
  if (s.tag !== "assign") throw new Error("assign");
  if (s.tag === "assign") {
    if (s.lval.ops.length !== 1 || s.lval.ops[0].tag !== "unwrap") throw new Error("unwrap op");
  }
});

Deno.test("wacParse: non-lval assignment reports error", () => {
  const { errors } = parseWithErrors("export void f() { gcd(1, 2) = 5; }");
  if (errors.length === 0) throw new Error("expected error");
});

// block statement in function body
Deno.test("wacParse: block statement", () => {
  const s = firstStmt("export void f() { { i32 x = 1; } }");
  if (s.tag !== "block") throw new Error(`block, got ${s.tag}`);
  if (s.tag === "block" && s.block.stmts.length !== 1) throw new Error("1 stmt");
});

// expect() custom messages
Deno.test("wacParse: missing closing paren in call", () => {
  const { errors } = parseWithErrors("export void f() { g(1 2; }");
  if (!errors.some((e) => e.message.includes(")"))) throw new Error("no ) msg");
});

Deno.test("wacParse: missing function name", () => {
  const { errors } = parseWithErrors("export i32 () { return 0; }");
  if (errors.length === 0) throw new Error("expected error");
});

// expect("}") failure
Deno.test("wacParse: missing closing brace in struct", () => {
  const { errors } = parseWithErrors("struct T { i32 x; )");
  if (!errors.some((e) => e.message.includes("}"))) throw new Error("no } error");
});

// expectName() error (import item with non-ident name)
Deno.test("wacParse: import item non-ident name", () => {
  const { errors } = parseWithErrors(`import { 42 } from "./x.wac";`);
  if (errors.length === 0) throw new Error("expected error");
});

// parseParamList trailing comma
Deno.test("wacParse: function params trailing comma", () => {
  const f = func("export void g(i32 x, i32 y,) { }");
  if (f.params.length !== 2) throw new Error("2 params");
});

// for-init lval without =
Deno.test("wacParse: for-init lval without = reports error", () => {
  const { errors } = parseWithErrors("export void f() { for (x;; ) { } }");
  if (errors.length === 0) throw new Error("expected error");
});

// skipTypeTokens array/nullable suffixes on primitive type
Deno.test("wacParse: var decl with array type", () => {
  const s = firstStmt("export void f() { i32[] arr = null; }");
  if (s.tag !== "var") throw new Error("var");
  if (s.type.tag !== "array") throw new Error("array type");
});

Deno.test("wacParse: var decl with nullable primitive type", () => {
  const s = firstStmt("export void f() { i32? x = null; }");
  if (s.tag !== "var") throw new Error("var");
  if (s.type.tag !== "nullable") throw new Error("nullable type");
});

// skipTypeTokens fn type variants
Deno.test("wacParse: var decl funcref with nested array type", () => {
  const s = firstStmt("export void f() { fn[bool[](i32)] cb = null; }");
  if (s.tag !== "var") throw new Error("var");
  if (s.type.tag !== "funcref") throw new Error("funcref type");
});

Deno.test("wacParse: var decl funcref array type", () => {
  const s = firstStmt("export void f() { fn[void()][] cbs = null; }");
  if (s.tag !== "var") throw new Error("var");
  if (s.type.tag !== "array") throw new Error("array type");
  if (s.type.tag === "array" && s.type.elem.tag !== "funcref") throw new Error("funcref elem");
});

Deno.test("wacParse: var decl nullable funcref type", () => {
  const s = firstStmt("export void f() { fn[void()]? cb = null; }");
  if (s.tag !== "var") throw new Error("var");
  if (s.type.tag !== "nullable") throw new Error("nullable type");
});

// typeQual fallback — uppercase ident followed by . then non-ident
Deno.test("wacParse: uppercase ident dot non-ident falls back to ident", () => {
  const { program } = parseWithErrors("export i32 f() { return Counter.42; }");
  // Counter is emitted as ident, .42 fails gracefully
  if (program.funcs.length === 0) throw new Error("no funcs");
});

// parseArgList trailing comma
Deno.test("wacParse: call with trailing comma in args", () => {
  const e = firstExpr("gcd(48, 18,)");
  if (e.tag !== "call") throw new Error("call");
  if (e.args.length !== 2) throw new Error("2 args");
});

// parseFieldInitList: empty construction and trailing comma
Deno.test("wacParse: empty named struct construction", () => {
  const e = firstExpr("Counter {}");
  if (e.tag !== "construct") throw new Error("construct");
  if (!e.fields || e.fields.length !== 0) throw new Error("no fields");
});

Deno.test("wacParse: named struct construction trailing comma", () => {
  const e = firstExpr("Point { x: 1, y: 2, }");
  if (e.tag !== "construct") throw new Error("construct");
  if (!e.fields || e.fields.length !== 2) throw new Error("2 fields");
});

// decodeStrLiteral — various escape sequences
Deno.test("wacParse: string escape sequences tab cr backslash quote null", () => {
  const t = firstExpr('"\\t"');
  if (t.tag !== "str" || t.value !== "\t") throw new Error("tab");
  const r = firstExpr('"\\r"');
  if (r.tag !== "str" || r.value !== "\r") throw new Error("cr");
  const bs = firstExpr('"\\\\"');
  if (bs.tag !== "str" || bs.value !== "\\") throw new Error("backslash");
  const q = firstExpr('"\\""');
  if (q.tag !== "str" || q.value !== '"') throw new Error("quote");
  const nul = firstExpr('"\\0"');
  if (nul.tag !== "str" || nul.value !== "\0") throw new Error("null");
});

// decodeCharLiteral — single quote escape
Deno.test("wacParse: char literal single quote escape", () => {
  const e = firstExpr("'\\''");
  if (e.tag !== "char") throw new Error("char");
  if (e.value !== "'") throw new Error("single quote");
});

// EOF in error positions — exercises t.value.length || 1 fallback (branch 0 = length 0)
Deno.test("wacParse: expectIdent with EOF token", () => {
  // "struct" alone — after consuming struct keyword, EOF is where ident is expected
  const { errors } = parseWithErrors("struct");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: parseCoreType error with EOF token", () => {
  // truncated param list — EOF where a type is expected
  const { errors } = parseWithErrors("export void f(");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacParse: parsePrimary unexpected EOF token", () => {
  // return with no value and no semicolon — EOF as expression start
  const { errors } = parseWithErrors("export i32 f() { return");
  if (errors.length === 0) throw new Error("expected error");
});

// looksLikeVarDecl: named type followed by ident (var decl, branch 548 false-branch)
Deno.test("wacParse: named type var decl", () => {
  // Counter c = Counter(0) — named type followed by ident → looksLikeVarDecl returns true
  const s = firstStmt("export void f() { Counter c = Counter(0); }");
  if (s.tag !== "var") throw new Error(`expected var, got ${s.tag}`);
  if (s.type.tag !== "named") throw new Error("named type");
  if (s.name !== "c") throw new Error("name c");
});

// looksLikeVarDecl: named type not followed by ident (branch 548 true-branch)
Deno.test("wacParse: named type followed by non-ident is not var decl", () => {
  // MyType; as a statement — ident followed by ; (not ident), looksLikeVarDecl returns false
  // The statement is then parsed as an expression-statement
  const p = parseWithErrors("export void f() { MyType; }");
  if (p.program.funcs.length === 0) throw new Error("no func");
  const s = p.program.funcs[0].body.stmts[0];
  if (s.tag !== "expr") throw new Error(`expected expr-stmt, got ${s.tag}`);
});
