// Is every node kind actually walked?
//
// Twice in two slots a rule looked broken and was merely unreached: method bodies were not descended
// into at all, and a bare expression statement had no arm in `checkStmt`. Both cost a slot, both
// looked like a wrong rule, and both had the same tell — one case of a family failing while its
// siblings passed.
//
// No rule test can find that, because a rule test puts its subject where the walk already goes. This
// asks the other question: for every statement and expression kind the AST has, put a **known-bad
// construct inside it** and check the diagnostic still comes out. If the kind is not visited, the
// diagnostic disappears and the cell fails by name.
//
// The bad construct is deliberately the same everywhere — `i32 BAD = "s";`, an initialiser mismatch
// this checker has reported since its second slice — so a failing cell means "this kind is not
// walked" and never "that rule is wrong".

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

function reports(src: string): boolean {
  return dumpTypeErrors(enc.encode(src)).length > 0;
}

/** The statement that must be found, wherever it is buried. */
const BAD = 'i32 bad = "s";';

/**
 * Every statement kind, with `BAD` nested inside it.
 *
 * `Break`, `Continue` and `Trap` carry no statements and no expressions, so there is nothing to bury
 * in them — they are listed as `null` rather than left out, so the count below still checks that
 * every kind of the AST was considered rather than that fifteen strings were written.
 */
const STATEMENTS: [string, string | null][] = [
  ["Var", `void f() { ${BAD} }`],
  ["Assign", `void f(i32 n) { n = 1; ${BAD} }`],
  ["IncrStmt", `void f(i32 n) { n++; ${BAD} }`],
  ["If", `void f(bool c) { if (c) { ${BAD} } }`],
  ["If-else", `void f(bool c) { if (c) { } else { ${BAD} } }`],
  ["While", `void f(bool c) { while (c) { ${BAD} } }`],
  ["For", `void f() { for (i32 i = 0; i < 1; i++) { ${BAD} } }`],
  ["For-init", `void f() { for (${BAD} true; ) { break; } }`],
  ["DoWhile", `void f(bool c) { do { ${BAD} } while (c); }`],
  ["Switch", `void f(i32 n) { switch (n) { case 1: { ${BAD} } } }`],
  ["Return", `string f() { return "x"; } void g() { ${BAD} }`],
  ["Break", null],
  ["Continue", null],
  ["Trap", null],
  ["Match", `enum E { A, B } void f(E e) { match (e) { case A: { ${BAD} } case B: { } } }`],
  ["Block", `void f() { { ${BAD} } }`],
  ["ExprStmt", `void g(i32 n) { } void f() { g(1); ${BAD} }`],
];

/**
 * Every expression kind, with a bad *sub-expression* inside it.
 *
 * Here the planted fault is an operand mismatch — `p + q` on an `i32` and an `f64` — because it lives
 * inside an expression rather than being a statement of its own, so burying it proves the expression
 * walk descends rather than that the statement walk does.
 */
const SUB = "(p + q)";
const EXPRESSIONS: [string, string | null][] = [
  ["Unary", `void f(i32 p, f64 q) { i32 r = -${SUB}; }`],
  ["Binary", `void f(i32 p, f64 q) { i32 r = ${SUB} + 1; }`],
  ["Cast", `void f(i32 p, f64 q) { i64 r = ${SUB} as i64; }`],
  ["Ternary", `void f(i32 p, f64 q, bool c) { i32 r = c ? ${SUB} : 0; }`],
  ["Ternary-cond", `void f(i32 p, f64 q, bool c) { i32 r = (${SUB} > 0) ? 1 : 0; }`],
  ["Index", `void f(i32 p, f64 q, i32[] a) { i32 r = a[${SUB}]; }`],
  ["Member", `struct P { i32 x; } void f(i32 p, f64 q, P s) { i32 r = s.x + ${SUB}; }`],
  ["Call", `void g(i32 n) { } void f(i32 p, f64 q) { g(${SUB}); }`],
  ["Call-method", `struct P { i32 x; void m(this, i32 n) { } } void f(i32 p, f64 q, P s) { s.m(${SUB}); }`],
  ["Construct", `struct P { i32 x; } void f(i32 p, f64 q) { P s = P(${SUB}); }`],
  ["Assign-rhs", `void f(i32 p, f64 q, i32 n) { n = ${SUB}; }`],
  ["Return-value", `i32 f(i32 p, f64 q) { return ${SUB}; }`],
  ["Condition", `void f(i32 p, f64 q) { if (${SUB} > 0) { } }`],
  // Added after `Incr` turned out to be unwalked in its expression form: `p.n++;` was checked and
  // `return x++;` was not. The grid had a Return-value cell and it passed, because the fault it
  // buries is always the same `(p + q)` — what it never varied is *which kind of expression holds
  // the fault*, which is the dimension the missing arm lived in.
  ["Incr", `void f(i32 p, f64 q, i32[] a) { a[${SUB}]++; }`],
  ["Unwrap", `void f(i32 p, f64 q, i32[]? a) { i32 r = a![${SUB}]; }`],
  ["Is", `struct B { i32 b; } struct C : B { i32 c; } void f(i32 p, f64 q, B b, i32[] a) { bool r = a[${SUB}] > 0 && (b is C); }`],
  ["ArrNew", `void f(i32 p, f64 q) { i32[] a = i32[2](${SUB}, 1); }`],
  ["ArrNew-size", `void f(i32 p, f64 q) { i32[] a = i32[${SUB}](); }`],
  ["MatchExpr", `enum E { A, B } void f(i32 p, f64 q, E e) { i32 r = match (e) { case A: ${SUB} case B: 0 }; }`],
  // A JSX element holds expressions in two places — an attribute's value and a child — and a walk
  // that descends into one and not the other would be invisible to every other cell here.
  ["Jsx", `import { Attr, Node } from core; void f(i32 p, f64 q) { Node n = <div id={itoa(${SUB})}/>; } string itoa(i32 v) { return ""; }`],
  // Nothing can be buried in these: they are leaves, with no sub-expression to descend into. Listed
  // rather than omitted so the completeness check below sees every kind the AST has.
  // Text between tags holds no expression of its own — it is a span of the source — so there is
  // nothing to bury in it, and it belongs with the leaves rather than the grid.
  ["JsxText", null],
  ["IntLit", null],
  ["FloatLit", null],
  ["StrLit", null],
  ["BoolLit", null],
  ["NullLit", null],
  ["Ident", null],
  // **A real cell now.** This was `null` while the syntax was in flight — a placeholder that kept the
  // completeness check green and covered nothing, with a note to replace it the moment a lambda
  // parsed. It does (`design/lang/0002` tier two), so here is the debt paid: the body is walked, and
  // something wrong inside it is reported.
  //
  // The *expression* body, because that is the form the parser desugars — `() => e` becomes
  // `() => { return e; }` — so a cell on the short form exercises the long one too. `issues/lang/0136`.
  ["Lambda", `void f(i32 p, f64 q) { fn[i32()] g = () => ${SUB}; }`],
  // And the written block form, which reaches the same place by a different route through the parser.
  ["Lambda-block", `void f(i32 p, f64 q) { fn[i32()] g = () => { return ${SUB}; }; }`],
];

Deno.test("reach: every statement kind is walked", () => {
  const missed: string[] = [];
  let considered = 0;
  for (const [kind, src] of STATEMENTS) {
    considered++;
    if (src === null) continue;
    if (!reports(src)) missed.push(kind);
  }
  // One entry per kind of the AST, plus the two extra placements (`If-else`, `For-init`) that are
  // the same kind reached by a different field — which is exactly where a walk tends to be partial.
  if (considered !== 17) throw new Error(`${considered} placements, expected 17`);
  if (missed.length !== 0) {
    throw new Error(`a bad initialiser inside these statement kinds is not reported, so the walk ` +
      `does not descend into them: ${missed.join(", ")}`);
  }
});

/**
 * The variants of one `enum` in `ast.wac`, so a grid can be checked against the AST it is a grid of.
 *
 * The alternative is a hand-written count, which is what the statement grid had: it asserts "17
 * placements" and is therefore only ever as complete as the day somebody counted. A kind added to the
 * AST tomorrow does not move that number, so the grid silently stops covering the language. Read from
 * the source, a new variant fails this file by name on the first run.
 */
function variantsOf(enumName: string): string[] {
  const src = Deno.readTextFileSync(new URL("../src/ast.wac", import.meta.url));
  const start = src.indexOf(`export enum ${enumName} {`);
  if (start < 0) throw new Error(`no enum ${enumName} in ast.wac`);
  const body = src.slice(start, src.indexOf("\n}", start));
  return [...body.matchAll(/^  ([A-Z][A-Za-z]*)[(,]/gm)].map((m) => m[1]);
}

/** The kind a grid row is about — `Ternary-cond` and `Ternary` are both the `Ternary` kind. */
const kindOf = (label: string) => label.split("-")[0];

Deno.test("reach: every expression kind is walked", () => {
  const missed: string[] = [];
  for (const [kind, src] of EXPRESSIONS) {
    if (src === null) continue;
    if (!reports(src)) missed.push(kind);
  }
  if (missed.length !== 0) {
    throw new Error(`a bad operand inside these expression positions is not reported, so the walk ` +
      `does not descend into them: ${missed.join(", ")}`);
  }
});

Deno.test("reach: the grids cover every kind the AST has", () => {
  for (const [enumName, grid] of [["ExprKind", EXPRESSIONS], ["StmtKind", STATEMENTS]] as const) {
    const covered = new Set(grid.map(([label]) => kindOf(label)));
    const uncovered = variantsOf(enumName).filter((v) => !covered.has(v));
    if (uncovered.length !== 0) {
      throw new Error(`${enumName} has variants no cell of the grid is about, so nothing checks ` +
        `whether the walk reaches them: ${uncovered.join(", ")}`);
    }
  }
});

/**
 * The **containers**, which the two grids above do not cover.
 *
 * They vary where a statement sits *within* a body and where an expression sits within a statement.
 * Neither varies which body — and "which body" is exactly where the method-bodies bug lived, so
 * planting that bug again leaves both of them green. A grid that misses the fault it was written
 * after is worth more as a lesson than as a test: a dimension you did not think to vary is invisible
 * no matter how finely you vary the others.
 */
const CONTAINERS: [string, string][] = [
  ["free function", `void f() { ${BAD} }`],
  ["exported function", `export void f() { ${BAD} }`],
  ["instance method", `struct P { i32 x; void m(this) { ${BAD} } }`],
  ["const-this method", `struct P { i32 x; void m(const this) { ${BAD} } }`],
  ["static method", `struct P { i32 x; void m() { ${BAD} } }`],
  ["method with params", `struct P { i32 x; void m(this, i32 n) { ${BAD} } }`],
  ["method of a child struct", `struct B { i32 b; } struct C : B { void m(this) { ${BAD} } }`],
];

Deno.test("reach: every kind of body is walked", () => {
  const missed: string[] = [];
  for (const [kind, src] of CONTAINERS) {
    if (!reports(src)) missed.push(kind);
  }
  if (missed.length !== 0) {
    throw new Error(`a bad initialiser inside these bodies is not reported, so the walk never ` +
      `enters them: ${missed.join(", ")}`);
  }
});
