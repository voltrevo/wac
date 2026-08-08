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
  ["Call-arg", `void g(i32 n) { } void f(i32 p, f64 q) { g(${SUB}); }`],
  ["Construct-arg", `struct P { i32 x; } void f(i32 p, f64 q) { P s = P(${SUB}); }`],
  ["Method-arg", `struct P { i32 x; void m(this, i32 n) { } } void f(i32 p, f64 q, P s) { s.m(${SUB}); }`],
  ["Assign-rhs", `void f(i32 p, f64 q, i32 n) { n = ${SUB}; }`],
  ["Return-value", `i32 f(i32 p, f64 q) { return ${SUB}; }`],
  ["Condition", `void f(i32 p, f64 q) { if (${SUB} > 0) { } }`],
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
