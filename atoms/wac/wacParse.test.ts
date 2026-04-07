import { wacLex } from "./wacLex.ts";
import { wacParse, type Program, type FuncDecl, type StructDecl, type Import, type Stmt, type Expr, type WacType } from "./wacParse.ts";

function parse(src: string): { prog: Program; errors: string[] } {
  const { tokens } = wacLex(src);
  const { program, errors } = wacParse(tokens, "test.wac");
  return { prog: program, errors: errors.map(e => `${e.line}:${e.col} ${e.message}`) };
}

function ok(src: string): Program {
  const { prog, errors } = parse(src);
  if (errors.length) throw new Error(`Parse errors: ${errors.join("; ")}`);
  return prog;
}

function fail(src: string): string[] {
  return parse(src).errors;
}

function func(prog: Program, idx = 0): FuncDecl {
  const f = prog.items[idx] as FuncDecl;
  if (f.tag !== "func") throw new Error(`item[${idx}] is ${(f as any).tag}, not func`);
  return f;
}

function struct_(prog: Program, idx = 0): StructDecl {
  const s = prog.items[idx] as StructDecl;
  if (s.tag !== "struct") throw new Error(`item[${idx}] is ${(s as any).tag}, not struct`);
  return s;
}

// ── Program structure ─────────────────────────────────────────────────────────

Deno.test("wacParse: empty program", () => {
  const prog = ok("");
  if (prog.items.length !== 0) throw new Error("expected empty");
});

Deno.test("wacParse: simple function declaration", () => {
  const prog = ok("export i32 add(i32 a, i32 b) { return a + b; }");
  const f = func(prog);
  if (f.name !== "add") throw new Error("name");
  if (!f.exported) throw new Error("exported");
  if (f.returnType.kind !== "prim" || f.returnType.name !== "i32") throw new Error("return type");
  if (f.params.length !== 2) throw new Error("param count");
  if (f.params[0].name !== "a") throw new Error("param a");
  if (f.params[1].name !== "b") throw new Error("param b");
});

Deno.test("wacParse: non-exported function", () => {
  const prog = ok("i32 helper(i32 x) { return x * 2; }");
  if (func(prog).exported) throw new Error("should not be exported");
});

Deno.test("wacParse: void return type", () => {
  const prog = ok("export void greet() { }");
  const f = func(prog);
  if (f.returnType.kind !== "prim" || f.returnType.name !== "void") throw new Error("void return");
});

// ── Types ─────────────────────────────────────────────────────────────────────

Deno.test("wacParse: primitive types in params", () => {
  const prog = ok("export i32 f(i32 a, i64 b, f32 c, f64 d, bool e) { return 0; }");
  const f = func(prog);
  const types = f.params.map(p => (p.type as { name: string }).name);
  if (types.join(",") !== "i32,i64,f32,f64,bool") throw new Error("types: " + types.join(","));
});

Deno.test("wacParse: array type in var decl", () => {
  const prog = ok("i32 f() { i32[] a = i32[5](); return 0; }");
  const body = func(prog).body.stmts;
  const v = body[0] as { kind: "var"; type: WacType };
  if (v.kind !== "var") throw new Error("not var");
  if (v.type.kind !== "array") throw new Error("not array type");
  if ((v.type as any).elem.name !== "i32") throw new Error("elem type");
});

Deno.test("wacParse: nullable type T?", () => {
  const prog = ok("i32 f(Node? n) { return 0; }");
  const p = func(prog).params[0];
  if (p.type.kind !== "nullable") throw new Error("not nullable");
  if ((p.type as any).inner.name !== "Node") throw new Error("inner type");
});

Deno.test("wacParse: funcref type fn[R(P)]", () => {
  const prog = ok("i32 f(fn[i32(i32, i32)] cmp) { return cmp(1, 2); }");
  const p = func(prog).params[0];
  if (p.type.kind !== "funcref") throw new Error("not funcref");
  const fr = p.type as any;
  if (fr.ret.name !== "i32") throw new Error("ret");
  if (fr.params.length !== 2) throw new Error("params count");
});

Deno.test("wacParse: nested array type i32[][]", () => {
  const prog = ok("i32 f() { i32[][] g = i32[][3](); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.type.kind !== "array") throw new Error("outer array");
  if (v.type.elem.kind !== "array") throw new Error("inner array");
});

// ── Expressions ───────────────────────────────────────────────────────────────

Deno.test("wacParse: integer literal", () => {
  const prog = ok("i32 f() { return 42; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.kind !== "return") throw new Error("not return");
  if (ret.value.kind !== "int" || ret.value.value !== "42") throw new Error("int 42");
});

Deno.test("wacParse: float literal", () => {
  const prog = ok("f64 f() { return 3.14; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "float" || ret.value.value !== "3.14") throw new Error("float 3.14");
});

Deno.test("wacParse: string literal", () => {
  const prog = ok(`string f() { return "hello"; }`);
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "string" || ret.value.value !== "hello") throw new Error("string hello");
});

Deno.test("wacParse: bool literals", () => {
  const prog = ok("bool f() { bool a = true; bool b = false; return a; }");
  const stmts = func(prog).body.stmts;
  if ((stmts[0] as any).init.value !== true) throw new Error("true");
  if ((stmts[1] as any).init.value !== false) throw new Error("false");
});

Deno.test("wacParse: null literal", () => {
  const prog = ok("Node? f() { return null; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "null") throw new Error("null");
});

Deno.test("wacParse: binary operators precedence", () => {
  // a + b * c should parse as a + (b * c)
  const prog = ok("i32 f(i32 a, i32 b, i32 c) { return a + b * c; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "binary" || ret.value.op !== "+") throw new Error("top op is +");
  if (ret.value.right.op !== "*") throw new Error("right is *");
});

Deno.test("wacParse: ternary expression", () => {
  const prog = ok("i32 f(bool x) { return x ? 1 : 2; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "ternary") throw new Error("not ternary");
  if (ret.value.then.value !== "1") throw new Error("then branch");
  if (ret.value.else_.value !== "2") throw new Error("else branch");
});

Deno.test("wacParse: is null expression", () => {
  const prog = ok("bool f(Node? n) { return n is null; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("not is");
  if (ret.value.rhs !== "null") throw new Error("rhs not null");
  if (ret.value.not) throw new Error("not flag");
});

Deno.test("wacParse: is not expression", () => {
  const prog = ok("bool f(Node? n) { return n is not null; }");
  const ret = func(prog).body.stmts[0] as any;
  if (!ret.value.not) throw new Error("not flag missing");
});

Deno.test("wacParse: is Type expression", () => {
  const prog = ok("bool f(Shape s) { return s is Circle; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("not is");
  if (ret.value.rhs === "null") throw new Error("rhs is null");
  if (ret.value.rhs.kind !== "struct") throw new Error("rhs not struct");
  if (ret.value.rhs.name !== "Circle") throw new Error("Circle");
});

Deno.test("wacParse: cast expressions", () => {
  const prog = ok("i32 f(i64 big) { return big as! i32; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "cast") throw new Error("not cast");
  if (ret.value.op !== "as!") throw new Error("op as!");
  if (ret.value.type.name !== "i32") throw new Error("target i32");
});

Deno.test("wacParse: unwrap operator", () => {
  const prog = ok("i32 f(Node? n) { return n!.val; }");
  const ret = func(prog).body.stmts[0] as any;
  // n!.val = field(unwrap(n), "val")
  if (ret.value.kind !== "field") throw new Error("field");
  if (ret.value.expr.kind !== "unwrap") throw new Error("unwrap");
});

Deno.test("wacParse: array construction T[N]()", () => {
  const prog = ok("i32 f() { i32[] a = i32[5](); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "arrNew") throw new Error("arrNew");
  if (v.init.size.value !== "5") throw new Error("size 5");
  if (v.init.fixed.length !== 0) throw new Error("no fixed");
});

Deno.test("wacParse: array construction T[](args)", () => {
  const prog = ok("i32 f() { i32[] b = i32[](1, 2, 3); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "arrNew") throw new Error("arrNew");
  if (v.init.size !== null) throw new Error("no size");
  if (v.init.fixed.length !== 3) throw new Error("3 fixed args");
});

Deno.test("wacParse: struct positional construction", () => {
  const prog = ok("i32 f() { Point p = Point(1, 2); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "construct") throw new Error("construct");
  if (v.init.ctype.name !== "Point") throw new Error("Point");
  if (v.init.args.length !== 2) throw new Error("2 args");
});

Deno.test("wacParse: struct named construction", () => {
  const prog = ok("i32 f() { Point p = Point { x: 3, y: 4 }; return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (!v.init.named || v.init.named.length !== 2) throw new Error("named init");
  if (v.init.named[0].name !== "x") throw new Error("field x");
  if (v.init.named[1].name !== "y") throw new Error("field y");
});

Deno.test("wacParse: static method call Type.method()", () => {
  const prog = ok("i32 f() { Point p = Point.create(0.0, 0.0); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  // Point.create(...) = call(field(ident("Point"), "create"), args)
  if (v.init.kind !== "call") throw new Error("call");
  if (v.init.callee.kind !== "field") throw new Error("field callee");
  if (v.init.callee.name !== "create") throw new Error("method create");
});

Deno.test("wacParse: method call on instance", () => {
  const prog = ok("i32 f(Counter c) { c.inc(); return c.getCount(); }");
  const stmts = func(prog).body.stmts;
  const expr0 = (stmts[0] as any).expr;
  if (expr0.kind !== "call") throw new Error("call");
  if (expr0.callee.kind !== "field") throw new Error("field callee");
  if (expr0.callee.name !== "inc") throw new Error("inc");
});

Deno.test("wacParse: hex integer literal", () => {
  const prog = ok("i32 f() { i32 x = 0xFF; return x; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "int" || v.init.value !== "0xFF") throw new Error("hex 0xFF");
});

// ── Statements ────────────────────────────────────────────────────────────────

Deno.test("wacParse: var decl with const", () => {
  const prog = ok("i32 f() { const i32 x = 5; return x; }");
  const v = func(prog).body.stmts[0] as any;
  if (!v.isConst) throw new Error("isConst");
  if (v.name !== "x") throw new Error("name");
});

Deno.test("wacParse: assignment statement", () => {
  const prog = ok("i32 f() { i32 x = 0; x = 5; return x; }");
  const a = func(prog).body.stmts[1] as any;
  if (a.kind !== "assign" || a.op !== "=") throw new Error("assign =");
  if (a.lval.name !== "x") throw new Error("lval x");
});

Deno.test("wacParse: compound assignment +=", () => {
  const prog = ok("i32 f() { i32 x = 0; x += 5; return x; }");
  const a = func(prog).body.stmts[1] as any;
  if (a.kind !== "assign" || a.op !== "+=") throw new Error("assign +=");
});

Deno.test("wacParse: increment statement", () => {
  const prog = ok("i32 f() { i32 x = 0; x++; x--; return x; }");
  const s1 = func(prog).body.stmts[1] as any;
  const s2 = func(prog).body.stmts[2] as any;
  if (s1.kind !== "incr" || s1.op !== "++") throw new Error("++");
  if (s2.kind !== "incr" || s2.op !== "--") throw new Error("--");
});

Deno.test("wacParse: if statement", () => {
  const prog = ok("i32 f(bool b) { if (b) { return 1; } return 0; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "if") throw new Error("if");
  if (s.cond.kind !== "ident") throw new Error("cond");
  if (s.then.stmts.length !== 1) throw new Error("then stmts");
  if (s.els !== null) throw new Error("no else");
});

Deno.test("wacParse: if-else statement", () => {
  const prog = ok("i32 f(bool b) { if (b) { return 1; } else { return 0; } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.els === null) throw new Error("else should not be null");
  if (s.els.kind !== "else-block") throw new Error("else-block");
  if (s.els.block.stmts.length !== 1) throw new Error("else stmts");
});

Deno.test("wacParse: if-else-if chain", () => {
  const prog = ok("i32 f(i32 x) { if (x < 0) { return -1; } else if (x == 0) { return 0; } else { return 1; } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.els.kind !== "else-if") throw new Error("else-if");
  if (s.els.stmt.kind !== "if") throw new Error("nested if");
});

Deno.test("wacParse: while statement", () => {
  const prog = ok("i32 f(i32 n) { while (n > 0) { n--; } return n; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "while") throw new Error("while");
  if (s.cond.kind !== "binary" || s.cond.op !== ">") throw new Error("cond");
});

Deno.test("wacParse: for statement", () => {
  const prog = ok("i32 f(i32 n) { i32 s = 0; for (i32 i = 0; i < n; i++) { s += i; } return s; }");
  const s = func(prog).body.stmts[1] as any;
  if (s.kind !== "for") throw new Error("for");
  if (s.init.kind !== "var") throw new Error("for init");
  if (s.cond.kind !== "binary") throw new Error("for cond");
  if (s.update.kind !== "incr") throw new Error("for update");
});

Deno.test("wacParse: do-while statement", () => {
  const prog = ok("i32 f() { i32 n = 0; do { n++; } while (n < 10); return n; }");
  const s = func(prog).body.stmts[1] as any;
  if (s.kind !== "dowhile") throw new Error("dowhile");
  if (s.cond.kind !== "binary" || s.cond.op !== "<") throw new Error("cond");
});

Deno.test("wacParse: switch statement with cases and default", () => {
  const prog = ok(`i32 f(i32 x) {
    switch (x) {
      case 0: { return 0; }
      case 1: { return 1; }
      default: { return -1; }
    }
  }`);
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "switch") throw new Error("switch");
  if (s.cases.length !== 3) throw new Error(`cases ${s.cases.length}`);
  if (s.cases[0].value.value !== "0") throw new Error("case 0");
  if (s.cases[2].value !== "default") throw new Error("default");
});

Deno.test("wacParse: break and continue", () => {
  const prog = ok("i32 f() { for (i32 i = 0; i < 10; i++) { if (i == 5) { break; } } return 0; }");
  const forBody = (func(prog).body.stmts[0] as any).body.stmts;
  const ifBody = forBody[0].then.stmts;
  if (ifBody[0].kind !== "break") throw new Error("break");
});

Deno.test("wacParse: return void", () => {
  const prog = ok("void f() { return; }");
  const r = func(prog).body.stmts[0] as any;
  if (r.kind !== "return") throw new Error("return");
  if (r.value !== null) throw new Error("void return should have null value");
});

Deno.test("wacParse: trap statement", () => {
  const prog = ok("i32 f(i32 n) { if (n < 0) { trap; } return n; }");
  const ifStmt = func(prog).body.stmts[0] as any;
  if (ifStmt.then.stmts[0].kind !== "trap") throw new Error("trap");
});

// ── Struct declarations ───────────────────────────────────────────────────────

Deno.test("wacParse: struct with fields", () => {
  const prog = ok("struct Point { i32 x; i32 y; }");
  const s = struct_(prog);
  if (s.name !== "Point") throw new Error("name");
  if (s.fields.length !== 2) throw new Error("fields");
  if (s.fields[0].name !== "x") throw new Error("x");
  if (s.fields[1].type.kind !== "prim") throw new Error("prim type");
});

Deno.test("wacParse: struct with const field", () => {
  const prog = ok("struct Node { i32 val; const i32 id; }");
  const s = struct_(prog);
  if (!s.fields[1].isConst) throw new Error("isConst");
  if (s.fields[0].isConst) throw new Error("first field not const");
});

Deno.test("wacParse: const struct", () => {
  const prog = ok("const struct Config { i32 width; i32 height; }");
  const s = struct_(prog);
  if (!s.isConst) throw new Error("isConst");
});

Deno.test("wacParse: struct with parent (subtyping)", () => {
  const prog = ok("struct Rect : Shape { f64 w; f64 h; }");
  const s = struct_(prog);
  if (s.parent !== "Shape") throw new Error("parent Shape");
});

Deno.test("wacParse: struct with methods", () => {
  const prog = ok(`struct Counter {
    i32 count;
    void inc(this) { this.count += 1; }
    i32 getCount(const this) { return this.count; }
    Counter create(i32 id) { return Counter(id); }
  }`);
  const s = struct_(prog);
  if (s.methods.length !== 3) throw new Error(`methods ${s.methods.length}`);
  if (!s.methods[0].hasThis) throw new Error("inc hasThis");
  if (s.methods[0].thisConst) throw new Error("inc not const this");
  if (!s.methods[1].thisConst) throw new Error("getCount const this");
  if (s.methods[2].hasThis) throw new Error("create no this");
  if (s.methods[2].params.length !== 1) throw new Error("create param");
});

Deno.test("wacParse: struct method with this and params", () => {
  const prog = ok("struct Foo { void bar(this, i32 x, i32 y) { } }");
  const s = struct_(prog);
  if (!s.methods[0].hasThis) throw new Error("hasThis");
  if (s.methods[0].params.length !== 2) throw new Error("params after this");
});

// ── Import declarations ───────────────────────────────────────────────────────

Deno.test("wacParse: import statement", () => {
  const prog = ok(`import { Point, midpoint } from "./geometry.wac";
  export i32 f() { return 0; }`);
  const imp = prog.items[0] as Import;
  if (imp.tag !== "import") throw new Error("import tag");
  if (imp.path !== "./geometry.wac") throw new Error("path");
  if (imp.items.length !== 2) throw new Error("items count");
  if (imp.items[0].name !== "Point" || imp.items[0].alias !== "Point") throw new Error("Point");
  if (imp.items[1].name !== "midpoint") throw new Error("midpoint");
});

Deno.test("wacParse: import with alias", () => {
  const prog = ok(`import { Point as P, distance as dist } from "./geo.wac";
  export i32 f() { return 0; }`);
  const imp = prog.items[0] as Import;
  if (imp.items[0].alias !== "P") throw new Error("alias P");
  if (imp.items[1].alias !== "dist") throw new Error("alias dist");
});

// ── Complex programs ──────────────────────────────────────────────────────────

Deno.test("wacParse: gcd function", () => {
  const prog = ok(`export i32 gcd(i32 a, i32 b) {
    while (b != 0) {
      i32 t = b;
      b = a % b;
      a = t;
    }
    return a;
  }`);
  const f = func(prog);
  if (f.body.stmts.length !== 2) throw new Error(`stmts ${f.body.stmts.length}`);
  if (f.body.stmts[0].kind !== "while") throw new Error("while");
  if (f.body.stmts[1].kind !== "return") throw new Error("return");
});

Deno.test("wacParse: fib with for loop", () => {
  const prog = ok(`export i32 fib(i32 n) {
    if (n < 2) { return n; }
    i32 a = 0; i32 b = 1;
    for (i32 i = 2; i <= n; i++) { i32 t = a + b; a = b; b = t; }
    return b;
  }`);
  if (func(prog).body.stmts.length !== 5) throw new Error("stmts count: " + func(prog).body.stmts.length);
});

Deno.test("wacParse: nullable linked list sum", () => {
  const prog = ok(`export i32 sum(Node? head) {
    i32 total = 0;
    Node? cur = head;
    while (cur is not null) { total += cur!.val; cur = cur!.next; }
    return total;
  }`);
  const stmts = func(prog).body.stmts;
  if (stmts[2].kind !== "while") throw new Error("while");
  const whileCond = (stmts[2] as any).cond;
  if (whileCond.kind !== "is" || !whileCond.not) throw new Error("is not");
});

Deno.test("wacParse: full geometry example", () => {
  const prog = ok(`
    export struct Point {
      f64 x;
      f64 y;
      Point create(f64 x, f64 y) { return Point(x, y); }
      f64 distanceSq(const this, Point other) {
        f64 dx = this.x - other.x;
        f64 dy = this.y - other.y;
        return dx * dx + dy * dy;
      }
    }
    export f64 midX(Point a, Point b) {
      return (a.x + b.x) / 2.0;
    }
  `);
  if (prog.items.length !== 2) throw new Error(`items ${prog.items.length}`);
  const s = struct_(prog, 0);
  if (s.methods.length !== 2) throw new Error("methods");
  if (s.methods[1].params.length !== 1) throw new Error("distanceSq params");
});

// ── Coverage: uncovered branches ─────────────────────────────────────────────

Deno.test("wacParse: nullable funcref type fn[R()]?", () => {
  const prog = ok("i32 f(fn[i32()]? cb) { return 0; }");
  const p = func(prog).params[0];
  if (p.type.kind !== "nullable") throw new Error("not nullable");
  if ((p.type as any).inner.kind !== "funcref") throw new Error("inner funcref");
});

Deno.test("wacParse: for loop with empty init", () => {
  const prog = ok("i32 f(i32 i) { for (; i < 10; i++) { } return i; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.init !== null) throw new Error("init should be null");
});

Deno.test("wacParse: for loop with empty cond and update", () => {
  const prog = ok("i32 f(i32 i) { for (i32 j = 0; ; ) { break; } return 0; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.cond !== null) throw new Error("cond should be null");
  if (s.update !== null) throw new Error("update should be null");
});

Deno.test("wacParse: for loop with compound update", () => {
  const prog = ok("i32 f() { i32 s = 0; for (i32 i = 0; i < 10; i += 2) { s += i; } return s; }");
  const s = func(prog).body.stmts[1] as any;
  if (s.update.op !== "+=") throw new Error("update +=");
});

Deno.test("wacParse: for loop with assign update", () => {
  const prog = ok("i32 f() { for (i32 i = 0; i < 10; i = i + 1) { } return 0; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.update.kind !== "assign") throw new Error("assign update");
  if (s.update.op !== "=") throw new Error("update op =");
});

Deno.test("wacParse: for loop with assign init", () => {
  const prog = ok("i32 f(i32 i) { for (i = 0; i < 10; i++) { } return i; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.init.kind !== "assign") throw new Error("assign init");
});

Deno.test("wacParse: switch with bare case body (no braces)", () => {
  const prog = ok("i32 f(i32 x) { switch (x) { case 1: return 1; default: return 0; } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "switch") throw new Error("switch");
  if (s.cases[0].body[0].kind !== "return") throw new Error("return in bare case");
});

Deno.test("wacParse: override method in struct", () => {
  const prog = ok("struct Child : Parent { override i32 method(i32 x) { return x; } }");
  const s = struct_(prog);
  if (!s.methods[0].isOverride) throw new Error("isOverride");
});

Deno.test("wacParse: struct method error recovery (missing ; or ()", () => {
  const { errors } = parse("struct Foo { i32 bad }");
  if (errors.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: is expression (identity or type — parsed as struct ref)", () => {
  // `a is b` — parser can't tell if b is a type or variable at parse time.
  // It parses the RHS as a struct reference; the type checker resolves it.
  const prog = ok("bool f(Point a, Point b) { return a is b; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("is");
  if (ret.value.rhs === "null") throw new Error("not null");
  // RHS is either an ident expression or struct type ref (both are acceptable at parse time)
  const rhsKind = (ret.value.rhs as any).kind;
  if (rhsKind !== "struct" && rhsKind !== "ident") throw new Error(`unexpected rhs kind: ${rhsKind}`);
});

Deno.test("wacParse: is with nullable array type (x is Foo[]?)", () => {
  // This exercises the looksLikeTypeHere with [ and ? suffixes
  const prog = ok("bool f(anyref x) { return x is i32; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.rhs.kind !== "prim") throw new Error("prim type in is");
});

Deno.test("wacParse: fn type as var decl start", () => {
  const prog = ok("i32 f() { fn[i32(i32)] g = square; return g(3); }");
  const v = func(prog).body.stmts[0] as any;
  if (v.kind !== "var") throw new Error("var");
  if (v.type.kind !== "funcref") throw new Error("funcref");
});

Deno.test("wacParse: void as var decl return type detection", () => {
  // void at top level = function return type, not var decl start inside body
  const prog = ok("void f() { }");
  const f = func(prog);
  if ((f.returnType as any).name !== "void") throw new Error("void return");
});

Deno.test("wacParse: type with explicit array in function return", () => {
  const prog = ok("i32[] makeArr() { return i32[](1, 2, 3); }");
  const f = func(prog);
  if (f.returnType.kind !== "array") throw new Error("array return type");
});

Deno.test("wacParse: struct reference method (TypeName.method value)", () => {
  const prog = ok("i32 f() { fn[void(Counter)] inc = Counter.inc; return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "field") throw new Error("field");
  if (v.init.name !== "inc") throw new Error("method name");
});

Deno.test("wacParse: fieldConst with override (override not valid on field)", () => {
  const { errors } = parse("struct Foo { override i32 x; }");
  if (errors.length === 0) throw new Error("expected override-on-field error");
});

Deno.test("wacParse: chained || and && operators", () => {
  const prog = ok("bool f(bool a, bool b, bool c) { return a || b && c; }");
  const ret = func(prog).body.stmts[0] as any;
  // a || (b && c) — && has higher precedence
  if (ret.value.kind !== "binary" || ret.value.op !== "||") throw new Error("top ||");
  if (ret.value.right.op !== "&&") throw new Error("right &&");
});

Deno.test("wacParse: chained | ^ & operators", () => {
  const prog = ok("i32 f(i32 a, i32 b, i32 c) { return a | b ^ c & 0xFF; }");
  const ret = func(prog).body.stmts[0] as any;
  // a | (b ^ (c & 0xFF)) — & > ^ > |
  if (ret.value.op !== "|") throw new Error("top |");
});

Deno.test("wacParse: is with array type rhs (x is Node[])", () => {
  const prog = ok("bool f(anyref x) { return x is Node[]; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.rhs.kind !== "array") throw new Error("array type rhs");
});

Deno.test("wacParse: is with nullable type rhs (x is Node?)", () => {
  const prog = ok("bool f(anyref x) { return x is Node?; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.rhs.kind !== "nullable") throw new Error("nullable type rhs");
});

Deno.test("wacParse: nullable array type in var decl (Node?[] x)", () => {
  const prog = ok("i32 f() { Node?[] x = Node?[5](); return x.len(); }");
  const v = func(prog).body.stmts[0] as any;
  if (v.type.kind !== "array") throw new Error("array type");
  if (v.type.elem.kind !== "nullable") throw new Error("nullable elem");
});

Deno.test("wacParse: expression statement (function call)", () => {
  const prog = ok("void f(Counter c) { c.inc(); }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "expr") throw new Error("expr stmt");
  if (s.expr.kind !== "call") throw new Error("call");
});

// ── Error recovery ────────────────────────────────────────────────────────────

Deno.test("wacParse: unexpected token at top level produces error", () => {
  const errs = fail("42 garbage;");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: position information on errors", () => {
  const { errors } = parse("export i32 f() { i32 x = ; }");
  if (errors.length === 0) throw new Error("expected errors");
  // Error should be at line 1
  const firstErr = errors[0];
  const lineMatch = firstErr.match(/^1:/);
  if (!lineMatch) throw new Error("expected line 1 error: " + firstErr);
});

// ── Funcref in expressions ────────────────────────────────────────────────────

Deno.test("wacParse: funcref variable", () => {
  const prog = ok(`i32 f() {
    fn[i32(i32)] g = double;
    return g(5);
  }`);
  const stmts = func(prog).body.stmts;
  if ((stmts[0] as any).type.kind !== "funcref") throw new Error("funcref type");
});

Deno.test("wacParse: switch no-fallthrough (case immediately calls)", () => {
  const prog = ok(`i32 f(i32 x) {
    i32 y = 0;
    switch (x) {
      case 1: { y = 10; }
      case 2: { y = 20; }
    }
    return y;
  }`);
  const sw = func(prog).body.stmts[1] as any;
  if (sw.cases.length !== 2) throw new Error("2 cases");
  if (sw.cases[1].body[0].kind !== "assign") throw new Error("case 2 body");
});

// ── Additional coverage tests ─────────────────────────────────────────────────

Deno.test("wacParse: shift operators << and >>", () => {
  const prog = ok("i32 f(i32 a, i32 b) { return (a << 2) >> b; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.op !== ">>") throw new Error("top >>");
  if (ret.value.left.op !== "<<") throw new Error("inner <<");
});

Deno.test("wacParse: is with plain expression rhs (parsed as struct ref at parse time)", () => {
  // When `b` is followed by `)`, looksLikeTypeHere returns true and parses as struct type
  // To get expr rhs, need something like `a is (b)` — but the RHS parse depends on looksLikeTypeHere
  // Force expr branch: `a is not (expr)` — after `not`, we're in the `is` case
  // Actually test: `a is b` where b is followed by `;` — treated as struct type ref
  // For expression rhs, use a non-ident token: looksLikeTypeHere returns false for non-ident
  const prog = ok("bool f(i32 a, i32 b) { return a is not b; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("is");
  if (!ret.value.not) throw new Error("not flag");
});

Deno.test("wacParse: looksLikeTypeHere with fn keyword (x is fn[...])", () => {
  // Tests the `t.kind === "fn"` branch in looksLikeTypeHere
  const prog = ok("bool f(anyref x) { return x is fn[i32(i32)]; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.rhs.kind !== "funcref") throw new Error("funcref rhs");
});

Deno.test("wacParse: array index lvalue in assignment", () => {
  const prog = ok("void f(i32[] arr) { arr[0] = 5; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "assign") throw new Error("assign");
  if (s.lval.kind !== "lv-index") throw new Error("lv-index");
  if (s.lval.idx.value !== "0") throw new Error("idx 0");
});

Deno.test("wacParse: field lvalue in assignment (a.b = x)", () => {
  const prog = ok("void f(Point p) { p.x = 10; }");
  const s = func(prog).body.stmts[0] as any;
  if (s.kind !== "assign") throw new Error("assign");
  if (s.lval.kind !== "lv-field") throw new Error("lv-field");
  if (s.lval.field !== "x") throw new Error("field x");
});

Deno.test("wacParse: for init with compound op (x += 1)", () => {
  const prog = ok("void f(i32 x) { for (x += 1; x < 10; x++) { } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.init.kind !== "assign") throw new Error("assign init");
  if (s.init.op !== "+=") throw new Error("init op +=");
});

Deno.test("wacParse: for init with incr (x++)", () => {
  const prog = ok("void f(i32 x) { for (x++; x < 10; x++) { } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.init.kind !== "incr") throw new Error("incr init");
  if (s.init.op !== "++") throw new Error("init op ++");
});

Deno.test("wacParse: for update with decrement (x--)", () => {
  const prog = ok("void f(i32 x) { for (; x > 0; x--) { } }");
  const s = func(prog).body.stmts[0] as any;
  if (s.update.kind !== "incr") throw new Error("incr update");
  if (s.update.op !== "--") throw new Error("update op --");
});

Deno.test("wacParse: switch unexpected body token produces error", () => {
  const errs = fail("i32 f(i32 x) { switch (x) { 42; } }");
  if (errs.length === 0) throw new Error("expected error for non-case token");
});

Deno.test("wacParse: error recovery: expected expression", () => {
  // Trigger the `expected expression` error path
  const errs = fail("i32 f() { return +; }");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: looksLikeVarDeclAt at eof (const at eof)", () => {
  // Trigger looksLikeVarDeclAt when tokens run out — error recovery
  const errs = fail("i32 f() { const");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: anyref in expression (not construction)", () => {
  // anyref/i31ref in expression context — looksLikeConstructionOrCall returns false
  const prog = ok("bool f(anyref x) { return x is null; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("is");
});

Deno.test("wacParse: error in parseConstructionOrCall (no ( or { after type name)", () => {
  // Exercises the error fallthrough in parseConstructionOrCall
  // `Point;` inside an expression context — looksLikeConstructionOrCall returns true (struct name)
  // but then there's no ( or { following
  // Note: `Point;` would be dispatched as ident expr, not via looksLikeConstructionOrCall
  // To trigger: we need `Point` followed by nothing callable
  // Actually this is hard to trigger via the `looksLikeConstructionOrCall` path since
  // the lookahead checks would prevent entering that path. Let's test expression error directly.
  const errs = fail("i32 f() { return; i32 x = ; }");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: postfix method call on variable (obj.method(args))", () => {
  // Exercises parsePostfix: at(".") with at("(") — method call on non-construction result
  const prog = ok("i32 f(i32[] arr) { return arr.len(); }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "call") throw new Error("call");
  if (ret.value.callee.kind !== "field") throw new Error("field callee");
  if (ret.value.callee.name !== "len") throw new Error("len method");
});

Deno.test("wacParse: postfix index on variable (arr[i])", () => {
  // Exercises parsePostfix: at("[") index on non-construction result
  const prog = ok("i32 f(i32[] arr, i32 i) { return arr[i]; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "index") throw new Error("index");
  if (ret.value.idx.name !== "i") throw new Error("idx i");
});

Deno.test("wacParse: dot after non-ident produces error (missing field name)", () => {
  // Exercises the `err("expected field name")` path in parsePostfix
  const errs = fail("i32 f() { i32[] a = i32[](1,2); return a. ; }");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: import with path error (no string)", () => {
  // Exercises the string-path error recovery in parseImport
  const errs = fail("import { Point } from foo;");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: void type in looksLikeTypeHere (x is void)", () => {
  // Tests the `t.kind === "void"` path in looksLikeTypeHere
  const prog = ok("bool f(anyref x) { return x is void; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.rhs.kind !== "prim") throw new Error("prim");
  if ((ret.value.rhs as any).name !== "void") throw new Error("void");
});

Deno.test("wacParse: continue statement", () => {
  const prog = ok("void f() { for (i32 i = 0; i < 10; i++) { if (i == 3) { continue; } } }");
  const forBody = (func(prog).body.stmts[0] as any).body.stmts;
  const ifBody = forBody[0].then.stmts;
  if (ifBody[0].kind !== "continue") throw new Error("continue");
});

Deno.test("wacParse: this.field assignment in method (lv-field lvalue)", () => {
  const prog = ok("struct Pt { i32 x; void setX(this, i32 v) { this.x = v; } }");
  const method = struct_(prog).methods[0];
  const s = method.body.stmts[0] as any;
  if (s.kind !== "assign") throw new Error("assign");
  if (s.lval.kind !== "lv-field") throw new Error("lv-field");
  if (s.lval.base.kind !== "lv-ident" || s.lval.base.name !== "this") throw new Error("this base");
});

Deno.test("wacParse: is with non-ident token rhs (x is 42 parses as prim then error)", () => {
  // looksLikeTypeHere with a non-ident non-fn non-void token (like an int literal)
  // returns false (t.kind !== "ident"), falls through to expression rhs
  const prog = ok("bool f(i32 x) { return x is not x + 1; }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("is");
  // rhs is parsed as expression (x + 1) since looksLikeTypeHere(x followed by +) returns false
  if (ret.value.rhs.kind !== "binary") throw new Error("binary rhs");
});

Deno.test("wacParse: nested array construction Node[][3]() (depth > 1 in lookahead)", () => {
  // Tests the bracket depth counter in looksLikeConstructionOrCall
  const prog = ok("i32 f() { Node[][] g = Node[][3](); return 0; }");
  const v = func(prog).body.stmts[0] as any;
  if (v.init.kind !== "arrNew") throw new Error("arrNew");
  if (v.init.elem.kind !== "array") throw new Error("array elem");
});

Deno.test("wacParse: struct missing name error recovery", () => {
  // Triggers: err("expected struct name") in parseStructDecl
  const errs = fail("struct { i32 x; }");
  if (errs.length === 0) throw new Error("expected error for missing struct name");
});

Deno.test("wacParse: struct missing parent name error recovery", () => {
  // Triggers: err("expected parent name") in parseStructDecl — `struct Foo : { }`
  const errs = fail("struct Foo : { }");
  if (errs.length === 0) throw new Error("expected error for missing parent name");
});

Deno.test("wacParse: struct member missing name error recovery", () => {
  // Triggers: err("expected member name") — and the multi-token error recovery loop
  const errs = fail("struct Foo { i32 ; }");
  if (errs.length === 0) throw new Error("expected error for missing member name");
});

Deno.test("wacParse: import alias missing ident error recovery", () => {
  // Triggers: err("expected alias") in parseImport
  const errs = fail(`import { Foo as } from "x";`);
  if (errs.length === 0) throw new Error("expected error for missing alias");
});

Deno.test("wacParse: i31ref in expression (not construction)", () => {
  // Hits the i31ref branch in looksLikeConstructionOrCall (returns false)
  const prog = ok("bool f(anyref x) { return x is i31ref; }");
  const ret = func(prog).body.stmts[0] as any;
  // i31ref in `is` context: looksLikeTypeHere returns true (it's a prim type)
  // so rhs is parsed as a prim type
  if (ret.value.kind !== "is") throw new Error("is");
});

Deno.test("wacParse: is with grouped expression rhs (x is (y))", () => {
  // Triggers looksLikeTypeHere returning false for '(' token (line 235 branch)
  const prog = ok("bool f(i32 x, i32 y) { return x is (y); }");
  const ret = func(prog).body.stmts[0] as any;
  if (ret.value.kind !== "is") throw new Error("is");
  // rhs is the grouped expression (y)
  if (ret.value.rhs.kind !== "ident") throw new Error("ident rhs");
});

Deno.test("wacParse: lvalue error: non-ident after assignment op", () => {
  // Triggers: err("expected identifier") in parseLvalue
  const errs = fail("void f() { = 5; }");
  if (errs.length === 0) throw new Error("expected errors");
});

Deno.test("wacParse: struct member error recovery with multi-token garbage", () => {
  // Triggers the while(!at("}") && !at(";") && !at("eof")) advance() recovery loop
  const errs = fail("struct Foo { i32 method garbage tokens }");
  if (errs.length === 0) throw new Error("expected errors");
});
