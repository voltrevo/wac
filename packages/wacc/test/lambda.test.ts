// The lambda syntax and its checking: it lexes, it parses, and it is typed against its target.
//
// `design/lang/0002` tier two settled the form — a typed arrow, `(i32 a) => a + 1` and
// `() => { … }`, with an expression body defined as sugar for `{ return e; }`. The grammar and the
// checker have landed; the capture analysis and the emitter have not, and this file is what keeps
// that half-state honest rather than silent.
//
// **Why the wrong programs are listed by their message.** Before `checkLambda` existed, a lambda had
// no signature, so `assignable` compared against unknown — and unknown is compatible with
// everything. All five wrong programs below were *accepted*: wrong arity, wrong return type, wrong
// parameter type, an undeclared name in the body, and one assigned to an `i32`. Each now has its own
// diagnostic, and asserting which one is what stops them collapsing back into a single vague
// refusal, or into silence.
//
// The checker is done; the emitter is not. A correct lambda checks clean and is then declined by
// `unsupportedExpr`, which is the `blocked` channel rather than a diagnostic — so "no diagnostics"
// below means *the checker is satisfied*, not that the program runs.

import { wacBind } from "../../../harness/wacBind.ts";
import { waccArtifacts } from "../../../harness/waccBuild.ts";

const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
  diagnoseGraph(paths: string[], sources: string[], entry: string): string;
};

/** Every diagnostic as `(code, message)`, in order. */
function diagnostics(src: string): { message: string }[] {
  return api.diagnoseGraph(["/m.wac"], [src], "/m.wac")
    .split("\n").filter((l) => l !== "")
    .map((l) => ({ message: l.split("\t")[4] ?? "" }));
}

Deno.test("a correct lambda checks clean, in both body forms and when it captures", () => {
  // Each of these exercises something the checker had to be taught separately. The parameters have
  // to be in scope for the body; the body's own locals have to be *collected* before it is walked,
  // which the enclosing function's pass does not do because a lambda is an expression; `return` has
  // to answer to the target's return type rather than the enclosing function's; and a lambda has to
  // be able to sit inside a lambda without the inner one's return type escaping when it finishes.
  const good: [string, string][] = [
    ["zero-arg expression body", `export i32 f() { fn[i32()] g = () => 42; return g(); }`],
    ["one typed parameter", `export i32 f() { fn[i32(i32)] g = (i32 a) => a + 1; return g(1); }`],
    ["block body", `export i32 f() { fn[i32(i32)] g = (i32 a) => { return a + 1; }; return g(1); }`],
    ["two parameters", `export i32 f() { fn[i32(i32,i32)] g = (i32 a, i32 b) => a + b; return g(1, 2); }`],
    ["a void lambda with an empty body", `export i32 f() { fn[void()] g = () => { }; g(); return 0; }`],
    // The capture itself is the emitter's problem; that the *checker* sees the outer name is this
    // file's. `n` resolves because the lambda's scope is pushed on top of the function's, not
    // instead of it.
    ["capturing an enclosing local", `export i32 f() { i32 n = 1; fn[i32()] g = () => n + 1; return g(); }`],
    // A local declared *inside* a lambda body reported "undefined name" until `declareAll` ran over
    // it: locals are collected in a pass of their own, and that pass walks statements, so it never
    // descended into an expression.
    ["a local declared inside the body", `export i32 f() { fn[i32()] g = () => { i32 x = 2; return x; }; return g(); }`],
    ["a lambda inside a lambda", `export i32 f() { fn[i32()] g = () => { fn[i32()] h = () => 2; return h(); }; return g(); }`],
    ["a parameter shadowing an outer local", `export i32 f() { i32 a = 5; fn[i32(i32)] g = (i32 a) => a + 1; return g(1) + a; }`],
  ];
  for (const [what, src] of good) {
    const ds = diagnostics(src);
    if (ds.length !== 0) throw new Error(`${what}: refused a correct lambda — ${JSON.stringify(ds)}`);
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

Deno.test("every wrong lambda gets its own diagnostic, not a shared one", () => {
  // All five were accepted before `checkLambda`. Asserting the *message* rather than merely "some
  // error" is the point: a single catch-all refusal would satisfy a count-only test while telling
  // whoever hit it nothing, and three of these are reported by machinery that has to be wired up
  // separately — the signature comparison, the body walk, and `c.lambdaReturn`.
  const wrong: [string, string, string][] = [
    ["wrong arity", `export i32 f() { fn[i32(i32)] g = () => 42; return g(1); }`,
      "parameters do not match"],
    ["wrong parameter type", `export i32 f() { fn[i32(i32)] g = (f64 a) => 1; return g(1); }`,
      "parameters do not match"],
    // Reported through `c.lambdaReturn`: `checkStmt` is handed the enclosing function's return type
    // as an AST `Ty`, and a lambda writes none, so without that field this said nothing.
    ["wrong return type", `export i32 f() { fn[i32()] g = () => "x"; return g(); }`,
      "return type"],
    // Proves the body is walked at all rather than merely typed.
    ["undeclared name in the body", `export i32 f() { fn[i32()] g = () => nope; return g(); }`,
      "undefined name"],
    // The one the ordinary mismatch machinery cannot reach, since unknown is assignable to anything.
    ["assigned to a non-funcref", `export i32 f() { i32 g = () => 42; return g; }`,
      "nothing here wants a function"],
  ];
  for (const [what, src, expect] of wrong) {
    const ds = diagnostics(src);
    if (ds.length === 0) throw new Error(`${what}: accepted a program that cannot work`);
    if (!ds.some((d) => d.message.includes(expect))) {
      throw new Error(`${what}: expected a message containing ${JSON.stringify(expect)}, got ${JSON.stringify(ds)}`);
    }
  }
});

Deno.test("the lambda walk finds one in every position a lambda can occupy", async () => {
  // **The walk is the sharp part of tier two, so it is measured before anything depends on it.**
  // `design/lang/0002`: a lambda is hoisted into an ordinary function, so it must be counted before
  // the function section is sized and found again to be emitted. The wrappers escape the equivalent
  // problem by being emitted always, one per function — available to them because a wrapper needs
  // nothing from the walk. A lambda has to be *found* to exist, so there is no such escape, and a
  // form the walk fails to descend into is a function index that never exists. That failure is
  // silent, and it produced invalid modules across 96 corpus files when the wrappers were written.
  //
  // Emission is not built, so the count is read out of the decline message. That is the only channel
  // it has today and it is a real one: the number comes from the walk, so a missed form reads as a
  // smaller count here rather than as nothing at all.
  const cases: [string, string, number][] = [
    ["a variable initialiser", `export i32 f() { fn[i32()] g = () => 1; return g(); }`, 1],
    ["an argument", `i32 use(fn[i32()] h) { return h(); } export i32 f() { return use(() => 1); }`, 1],
    ["a return", `export fn[i32()] f() { return () => 1; }`, 1],
    // Nested: the inner one is recorded after the outer, which is the order emission will read.
    ["a lambda inside a lambda", `export i32 f() { fn[i32()] g = () => { fn[i32()] h = () => 2; return h(); }; return g(); }`, 2],
    // The three statement forms with bodies of their own — the ones a walk over expressions alone
    // would miss entirely, and the reason this walk covers statements too.
    ["if, while and for bodies", `export i32 f(i32 n) {
       if (n > 0) { fn[i32()] a = () => 1; n = a(); }
       while (n > 5) { fn[i32()] b = () => 2; n = n - b(); }
       for (i32 i = 0; i < 2; i++) { fn[i32()] c = () => 3; n = n + c(); }
       return n; }`, 3],
    ["both arms of a ternary", `export i32 f(bool p) { fn[i32()] g = p ? () => 1 : () => 2; return g(); }`, 2],
    // A method body is reached through StructDecl, not Func — a separate arm, and it was the one
    // that read 0 while every other position read correctly.
    ["a struct method", `struct S { i32 v; i32 m(this) { fn[i32()] g = () => 7; return g(); } }
       export i32 f() { return S(1).m(); }`, 1],
    ["an array literal", `export i32 f() { fn[i32()][] xs = fn[i32()][](() => 1, () => 2); return xs[0](); }`, 2],
  ];

  for (const [what, src, want] of cases) {
    let message = "";
    try {
      await waccArtifacts(new Map([["/t/main.wac", src + "\n"]]), "/t/main.wac");
      throw new Error(`${what}: emitted a lambda — if emission has landed, this file needs rewriting`);
    } catch (e) {
      message = String(e instanceof Error ? e.message : e);
      if (message.includes("emitted a lambda")) throw e;
    }
    const m = message.match(/this module has (\d+)/);
    if (m === null) throw new Error(`${what}: the decline did not report a count — ${message.slice(0, 200)}`);
    if (Number(m[1]) !== want) {
      throw new Error(`${what}: the walk found ${m[1]} lambda(s), and there are ${want}`);
    }
  }
});
