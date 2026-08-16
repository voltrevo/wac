// The lambda syntax: it lexes, it parses, and the checker refuses it by name.
//
// `design/lang/0002` tier two settled the form — a typed arrow, `(i32 a) => a + 1` and
// `() => { … }`, with an expression body defined as sugar for `{ return e; }`. The grammar landed
// before the capture analysis and the emitter did, and this file is what keeps that half-state
// honest rather than silent.
//
// **The reason it is refused rather than accepted-for-now.** Without a signature for a lambda, the
// checker's `assignable` compares against unknown, and unknown is compatible with everything. Every
// one of the five wrong programs below was accepted when the arm was missing: wrong arity, wrong
// return type, wrong parameter type, an undeclared name in the body, and one assigned to an `i32`.
// A feature that agrees with all five is worse than one that says it is not implemented, which is
// why `errLambdaUnsupported` exists and why this file asserts the refusal by code rather than by
// prose.
//
// When emission lands these expectations invert: the refusals become answers, and the five wrong
// programs become five *different* diagnostics. That is the point — the day this file needs
// rewriting is the day the feature works, and it names what each row should become.

import { wacBind } from "../../../harness/wacBind.ts";

const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
  diagnoseGraph(paths: string[], sources: string[], entry: string): string;
};

/** Every diagnostic as `(code, message)`, in order. */
function diagnostics(src: string): { message: string }[] {
  return api.diagnoseGraph(["/m.wac"], [src], "/m.wac")
    .split("\n").filter((l) => l !== "")
    .map((l) => ({ message: l.split("\t")[4] ?? "" }));
}

const UNSUPPORTED = "a lambda is not supported yet";

Deno.test("a lambda lexes and parses, and is refused by name rather than accepted", () => {
  // If `=>` did not lex, or the parser did not recognise the form, the complaint would be about a
  // token — "expected ';', found '='" was the message before any of this — and never this one. So
  // one assertion covers the whole front end: reaching a *semantic* refusal means the syntax arrived.
  const src = `export i32 f() {\n  fn[i32()] g = () => 42;\n  return g();\n}\n`;
  const ds = diagnostics(src);
  if (ds.length !== 1 || ds[0].message !== UNSUPPORTED) {
    throw new Error(`expected exactly the lambda refusal, got ${JSON.stringify(ds)}`);
  }
});

Deno.test("a block body parses too, and reaches the same refusal", () => {
  // The two bodies are one shape by the time anything downstream sees them — the parser desugars
  // `=> e` into `{ return e; }` — so this asserts the *other* branch of that split actually parses,
  // which the expression case cannot.
  const src = `export i32 f() {\n  fn[i32(i32)] g = (i32 a) => { return a + 1; };\n  return g(1);\n}\n`;
  const ds = diagnostics(src);
  if (ds.length !== 1 || ds[0].message !== UNSUPPORTED) {
    throw new Error(`expected exactly the lambda refusal, got ${JSON.stringify(ds)}`);
  }
});

Deno.test("the shapes that look like a lambda and are not", () => {
  // **The direction that matters for a lookahead.** `(` opens a lambda and a group, and only the
  // token after the matching `)` tells them apart — so the risk is a parenthesised expression read
  // as a parameter list. Each of these has a `(` that must stay a group; if `atLambda` said yes to
  // one, it would fail to parse rather than fail to check, which is why they are here and not in a
  // checker test.
  const legal: [string, string][] = [
    ["a parenthesised expression", `export i32 f(i32 n) { return (n + 1) * 2; }`],
    // `i64 cap`, so the cast is a real one: `(cap as~ i32)` where `cap` is already an `i32` is a
    // cast between a type and itself, which wac refuses on its own account and which would have made
    // this row fail for a reason that has nothing to do with lambdas.
    ["a parenthesised cast, the shape issues/lang/0113 was about", `export bool f(i32 n, i64 cap) { return n < 0 || n > (cap as~ i32); }`],
    ["a struct literal in parentheses", `struct P { i32 x; }\nexport i32 f() { return (P { x: 1 }).x; }`],
    ["nested groups", `export i32 f(i32 n) { return ((n)); }`],
    ["a call whose argument is parenthesised", `i32 g(i32 a) { return a; }\nexport i32 f(i32 n) { return g((n)); }`],
    // `>=` must not lex as `=` `>`, and `==` must not become `=` `>` either — the `=>` branch sits
    // between them in the lexer and could have eaten both.
    ["comparisons next to the arrow's characters", `export bool f(i32 a, i32 b) { return a >= b == (a > b); }`],
  ];
  for (const [what, src] of legal) {
    const ds = diagnostics(src);
    if (ds.length !== 0) throw new Error(`${what}: refused legal code — ${JSON.stringify(ds)}`);
  }
});

Deno.test("every wrong lambda is refused, and none is accepted", () => {
  // These are the five that were *accepted* before the checker had an arm — the measurement that
  // decided refusing was better than deferring. Each should become its own diagnostic when the
  // feature lands; today the assertion is only that not one of them compiles.
  const wrong: [string, string][] = [
    ["wrong arity", `export i32 f() { fn[i32(i32)] g = () => 42; return g(1); }`],
    ["wrong return type", `export i32 f() { fn[i32()] g = () => "x"; return g(); }`],
    ["wrong parameter type", `export i32 f() { fn[i32(i32)] g = (f64 a) => 1; return g(1); }`],
    ["undeclared name in the body", `export i32 f() { fn[i32()] g = () => nope; return g(); }`],
    ["assigned to a non-funcref", `export i32 f() { i32 g = () => 42; return g; }`],
  ];
  for (const [what, src] of wrong) {
    const ds = diagnostics(src);
    if (ds.length === 0) throw new Error(`${what}: accepted a program that cannot work`);
  }
});
