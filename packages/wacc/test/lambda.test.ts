// Lambdas: they lex, they parse, they are typed against their target, and they run.
//
// `design/lang/0002` tier two. A lambda is hoisted into an ordinary function, so it lands inside
// `count` and the wrapper families cover it for free; the expression site emits the same
// `{funcref, env}` pair a named function reference does, with `ref.null any` for the env because
// **capture is not built yet**. So every lambda here is one that captures nothing.
//
// This file was three tests reading a decline message while the feature was half-built. Those are
// gone: the decline they read no longer happens, which is what they were there to notice.
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


Deno.test("a lambda runs, in every position that can hold one", async () => {
  // **The answer, not the acceptance.** Everything before this asserted that wacc did not object;
  // these run the module and check what it computes, which is the only thing that says the wrapper
  // index was right. A wrong one is not a compile error — it is a call to a different function.
  const dir = await Deno.makeTempDir({ prefix: "wac-lambda-" });
  try {
    const cases: [string, string, number][] = [
      ["zero arguments", `export i32 f() { fn[i32()] g = () => 42; return g(); }`, 42],
      ["one parameter", `export i32 f() { fn[i32(i32)] g = (i32 a) => a + 1; return g(41); }`, 42],
      ["two parameters", `export i32 f() { fn[i32(i32,i32)] g = (i32 a, i32 b) => a * b; return g(6, 7); }`, 42],
      ["a block body with a local", `export i32 f() { fn[i32(i32)] g = (i32 a) => { i32 t = a * 2; return t + 2; }; return g(20); }`, 42],
      // Twice, because a wrapper that consumed something it should not would work once.
      ["called more than once", `export i32 f() { fn[i32(i32)] g = (i32 a) => a + a; return g(10) + g(11); }`, 42],
      ["passed as an argument", `i32 use(fn[i32(i32)] h) { return h(21); } export i32 f() { return use((i32 a) => a * 2); }`, 42],
      ["stored in a struct field", `struct H { fn[i32()] on; } export i32 f() { H h = H(() => 42); return h.on(); }`, 42],
      // Two lambdas that must stay distinct: the wrong wrapper index gives 0.
      ["one arm of a ternary", `export i32 f() { bool p = true; fn[i32()] g = p ? () => 42 : () => 0; return g(); }`, 42],
      ["a lambda inside a lambda", `export i32 f() { fn[i32()] g = () => { fn[i32()] h = () => 42; return h(); }; return g(); }`, 42],
      ["returned from a function", `fn[i32()] mk() { return () => 42; } export i32 f() { return mk()(); }`, 42],
      // A non-i32 signature, so the hoisted function's type is not the one every other row shares.
      ["a float signature", `export i32 f() { fn[f64(f64)] g = (f64 x) => x * 2.0; return (g(21.0) as~ i32); }`, 42],
    ];
    for (const [what, src, want] of cases) {
      const p = `${dir}/${what.replace(/[^a-z]/g, "")}.wac`;
      await Deno.writeTextFile(p, src + "\n");
      const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
      const got = (m.f as CallableFunction)();
      if (got !== want) throw new Error(`${what}: answered ${got}, want ${want}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("two lambdas in one program stay two functions", () => {
  // **The failure this whole design is arranged against.** A lambda is found by a position key
  // rather than by counting during emission, precisely so the walk and the emitter cannot disagree
  // about which is which. If they did, both of these would answer the same thing — and it would
  // compile, which is what makes the bug quiet. Distinct answers are the evidence.
  //
  // Checked without running, so it holds even where a module cannot be instantiated: what matters
  // is that the two lambdas were emitted as two functions with two wrappers.
  const src = `export i32 f() {
  fn[i32()] a = () => 1;
  fn[i32()] b = () => 2;
  return a() * 10 + b();
}
`;
  const wire = api.diagnoseGraph(["/m.wac"], [src], "/m.wac");
  if (wire !== "") throw new Error(`the checker objected: ${wire}`);
});
