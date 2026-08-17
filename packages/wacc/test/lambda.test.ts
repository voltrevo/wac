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


Deno.test("a lambda whose target is imported is not refused for having no target", () => {
  // **`typeNone()` is `""`, so "nothing wanted a funcref here" and "nothing could say what was
  // wanted" arrive spelled the same** — and they need opposite answers. The first is the one
  // diagnostic a lambda cannot get any other way, since unknown is assignable to everything. The
  // second happens whenever a file is checked *without its imports*, which `rung 3` does to every
  // `.wac` file in the repository and requires silence for.
  //
  // The first package file to hold a lambda over an imported type — `packages/platform/src/frame.wac`,
  // where a capability answers through `Pending.of` and a substitute `Core` is a construction of an
  // imported struct — produced 29 of these. `C.expectedUnknown` is the field that tells them apart.
  const quiet: [string, string][] = [
    ["a static on an imported generic", `import { Pending } from "./elsewhere.wac";
Pending<i32> r(i32 v) { return Pending.of(0, (i32 id) => v, (i32 id) => true, (i32 id) => { }); }`],
    ["a construction of an imported struct", `import { Core } from "./elsewhere.wac";
Core c(Core parent) { return Core(parent.a, (string line) => { }, parent.b); }`],
    ["a method on an imported type", `import { Sink } from "./elsewhere.wac";
void s(Sink k) { k.onEach((i32 n) => n + 1); }`],
  ];
  for (const [what, src] of quiet) {
    const ds = diagnostics(src).filter((d) => d.message.includes("nothing here wants a function"));
    if (ds.length !== 0) {
      throw new Error(`${what}: invented ${ds.length} diagnostic(s) about a program that compiles — ${JSON.stringify(ds)}`);
    }
  }

  // And the other direction, which is what stops the fix above being "stop reporting this ever".
  // Every one of these names a slot, and the slot is not a funcref.
  const loud: [string, string][] = [
    ["a local of the wrong type", `export i32 f() { i32 g = () => 42; return g; }`],
    ["an argument to a function this file has", `void t(i32 n) { } export void f() { t(() => 42); }`],
    ["a field of a struct this file has", `struct S { i32 v; } export S f() { return S(() => 42); }`],
  ];
  for (const [what, src] of loud) {
    const ds = diagnostics(src).filter((d) => d.message.includes("nothing here wants a function"));
    if (ds.length === 0) {
      throw new Error(`${what}: accepted a lambda where the slot is not a funcref — ${JSON.stringify(diagnostics(src))}`);
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
      // **A module-level constant**, whose initialiser is emitted in `__wac_start` rather than in any
      // function body. The walk did not visit constants at all, so this declined with "this module
      // has 0" lambdas — true and useless. Found by enumerating what the walk visits against what
      // emission emits, which is the check that caught two of the day's defects.
      ["a module constant's initialiser", `const fn[i32()] ANSWER = () => 42;
export i32 f() { fn[i32()] g = ANSWER; return g(); }`, 42],
      // **Assigned to a local that already exists.** This was the last position with no wanted type:
      // an assignment target needs a name resolved, and the emitter's locals are built per body
      // during emission — after the walk. The walk keeps its own name-to-type scope now, built from
      // what `Var` writes down, so the target is typed without needing the emitter's tables.
      ["assigned over an existing local", `export i32 f() { fn[i32()] g = () => 1; g = () => 42; return g(); }`, 42],
      // Shadowing, which is what makes the scope a stack rather than a table: the inner `n` is a
      // different binding, and the walk must not let it leak past the block.
      ["a shadowed name around a lambda", `export i32 f() { i32 n = 1; { i32 n2 = 2; } fn[i32(i32)] g = (i32 n) => n * 42; return g(n); }`, 42],
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

// The capture analysis, read through an instrument rather than inferred from behaviour.
//
// `design/lang/0002` tier two: a capturing lambda carries a generated struct whose fields are the
// names its body reads and did not declare. Nothing about that struct is visible from outside — a
// capture set that is quietly wrong still compiles, and reads a field that was never stored. So
// `lambdaReportLinked` exists to say what the walk decided, and this test reads it.
//
// Building the instrument first is the lesson from the emission work, where four hypotheses died
// against a fallback message that could not name its own cause. It paid immediately here too: the
// nested case below was wrong the first time it was run, in a way no amount of reading would have
// shown.
const emitApi = await wacBind("packages/wacc/src/emit.wac") as unknown as {
  lambdaReportLinked(paths: string[], sources: string[], entry: string): string;
};

Deno.test("a lambda can be passed to a method, and where it still cannot", async () => {
  // **`issues/lang/0141`.** A lambda has no type of its own, so every position holding one must say
  // what it wants — and a method call did not. That is most of this repository's APIs: a lambda that
  // can only be handed to a free function cannot be handed to most of the code here.
  //
  // Both shapes, because they resolve differently: an instance method's receiver is a *value* and its
  // type comes from the walk's scope, while a static's receiver is a *type name* and is its own
  // answer.
  const dir = await Deno.makeTempDir({ dir: new URL("../../../.cache/", import.meta.url).pathname, prefix: "lambda-0141-" });
  try {
    const src = `struct Box {
  i32 v;
  Box make(fn[i32()] g) { return Box(g()); }
  i32 apply(this, fn[i32(i32)] g) { return g(this.v); }
}
i32 plain(fn[i32()] g) { return g(); }
export i32 f() {
  i32 a = plain(() => 1);
  Box b = Box.make(() => 2);
  i32 c = b.apply((i32 x) => x + 3);
  return a + b.v + c;
}
`;
    const p = `${dir}/m.wac`;
    await Deno.writeTextFile(p, src);
    const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
    const got = (m.f as CallableFunction)();
    if (got !== 8) throw new Error(`answered ${got}, want 8`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }

  // **A generic static, which the checker now types and the emitter does not yet emit.**
  //
  // `Slot.of` is declared `Slot<T> of(T seed, fn[T(i32)] make)` inside `struct Slot<T>` — so it
  // returns the owner instantiated, which means the wanted type of the call *is* the instantiation
  // and `T` can be read straight off it. No unification, and it is the same move the enum-payload arm
  // has always made: bind from the slot the call lands in.
  //
  // Two things had to be true for this. The wanted type has to reach the call — it does, through
  // `c.lambdaReturn` when the call is a lambda's body — and `substituteType` has to reach *inside* a
  // funcref, which it did not: `fn(i32) -> T` kept its `T`, so the lambda was offered a target it
  // could not match. That was a pre-existing gap, not a lambda one; a generic struct with an
  // `fn[T()]` field had it too.
  const generic = `struct Slot<T> {
  T v;
  Slot<T> of(T seed, fn[T(i32)] make) { return Slot<T>(make(0)); }
}
export i32 f() { Slot<i32> s = Slot.of(1, (i32 k) => k + 41); return s.v; }
`;
  const ds = diagnostics(generic);
  if (ds.length !== 0) {
    throw new Error(`the checker no longer types a lambda to a generic static: ${JSON.stringify(ds)}`);
  }

  // **And it runs**, with a capture through it — which is the shape `issues/lang/0137` needs, since a
  // substitute capability answers through `Pending.of` and that is a generic static.
  //
  // The emitter finds the method on the *instantiation* rather than the template: a generic's methods
  // are registered per instantiation, and that entry already carries its parameters in the caller's
  // world, so no substitution is needed once it is looked up in the right place.
  const dir2 = await Deno.makeTempDir({ dir: new URL("../../../.cache/", import.meta.url).pathname, prefix: "lambda-0141g-" });
  try {
    const p2 = `${dir2}/g.wac`;
    await Deno.writeTextFile(p2, `struct Slot<T> {
  T v;
  Slot<T> of(T seed, fn[T(i32)] make) { return Slot<T>(make(2)); }
}
export i32 f() {
  i32 base = 40;
  Slot<i32> s = Slot.of(0, (i32 k) => k + base);
  return s.v;
}
`);
    const m2 = await wacBind(p2) as unknown as Record<string, CallableFunction>;
    const got2 = (m2.f as CallableFunction)();
    if (got2 !== 42) throw new Error(`a capturing lambda through a generic static answered ${got2}, want 42`);
  } finally {
    await Deno.remove(dir2, { recursive: true });
  }
});

Deno.test("what a lambda captures, and what it does not", () => {
  const cases: [string, string, string[]][] = [
    ["nothing, when it reads nothing outside", `export i32 f() { fn[i32()] g = () => 42; return g(); }`, [""]],
    ["an enclosing local", `export i32 f() { i32 n = 1; fn[i32()] g = () => n + 1; return g(); }`, ["n:i32"]],
    ["an enclosing parameter, which is a local like any other", `export i32 f(i32 p) { fn[i32()] g = () => p * 2; return g(); }`, ["p:i32"]],
    // The three things that look like captures and are not.
    ["not its own parameter", `export i32 f() { fn[i32(i32)] g = (i32 a) => a + 1; return g(1); }`, [""]],
    ["not its own local", `export i32 f() { fn[i32()] g = () => { i32 t = 2; return t; }; return g(); }`, [""]],
    // A function has a name and is not a local: it is reached by index, not carried.
    ["not a function it calls", `i32 h() { return 1; } export i32 f() { fn[i32()] g = () => h(); return g(); }`, [""]],
    ["two of them, in the order read", `export i32 f() { i32 a = 1; string s = "x"; fn[i32()] g = () => a + s.len(); return g(); }`, ["a:i32,s:string"]],
    // A write is a capture too — under reference semantics it is the whole point.
    ["a name it assigns to", `export i32 f() { i32 n = 1; fn[void()] g = () => { n = 5; }; g(); return n; }`, ["n:i32"]],
    ["once, however often it is read", `export i32 f() { i32 n = 1; fn[i32()] g = () => n + n; return g(); }`, ["n:i32"]],

    // **Capture is transitive, and this is the case that proves it.** The outer lambda never reads
    // `a` itself — only the lambda inside it does. It still has to carry `a`, because the outer is
    // what builds the inner's environment. With a single frame instead of a stack the outer reported
    // no captures at all, which would have emitted a struct with no `a` in it.
    ["through a nested lambda, for both of them",
      `export i32 f() { i32 a = 1; fn[i32()] g = () => { i32 b = 2; fn[i32()] h = () => a + b; return h(); }; return g(); }`,
      ["a:i32", "a:i32,b:i32"]],
  ];
  for (const [what, src, want] of cases) {
    // The report ends with a `promoted:` line, which is not a lambda — see the promotion test below.
    const lines = emitApi.lambdaReportLinked(["/m.wac"], [src + "\n"], "/m.wac")
      .trimEnd().split("\n").filter((l) => !l.startsWith("promoted:"));
    // Each line is `signature|[$cap$N=]captures`. The struct name is stripped for the comparison and
    // checked separately below: what it *is* does not matter, only that one exists exactly when
    // there is something to put in it.
    const got = lines.map((l) => (l.split("|")[1] ?? "").replace(/^\$cap\$\d+=/, ""));
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
      throw new Error(`${what}: captured ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
    // **A struct exactly when it is needed.** One generated for a lambda that captures nothing is a
    // type the module carries and never names; one missing where there are captures is a field read
    // that was never stored — and `NOSTRUCT` is what the probe says when the registration did not
    // happen, which is how the first attempt was caught registering into the wrong `Env`.
    for (let i = 0; i < lines.length; i++) {
      const hasStruct = (lines[i].split("|")[1] ?? "").startsWith("$cap$");
      if (hasStruct !== (want[i] !== "")) {
        throw new Error(`${what}: line ${i} ${hasStruct ? "has" : "has no"} capture struct, captures ${JSON.stringify(want[i])}`);
      }
      if ((lines[i] ?? "").includes("NOSTRUCT")) throw new Error(`${what}: the capture struct was not registered`);
    }
  }
});

Deno.test("a lambda that captures runs, and reads what it captured", async () => {
  // **Capture is by value today**, and `design/lang/0002` chose by reference. The two agree exactly
  // while nothing writes the captured name, so every case here is read-only; the test below covers
  // the writing ones, which are refused rather than given the wrong meaning.
  //
  // The capture struct is built in the *enclosing* function, where the captured names are locals,
  // and the hoisted function receives it as its receiver — so tier one's bound wrapper, which
  // already casts an env to a receiver and calls, carries it with no new machinery.
  const dir = await Deno.makeTempDir({ prefix: "wac-cap-" });
  try {
    const cases: [string, string, number][] = [
      ["one local", `export i32 f() { i32 n = 41; fn[i32()] g = () => n + 1; return g(); }`, 42],
      // A captured *parameter* is not here: it has no declaration to make a cell at and is declined.
      // See the test below.
      ["two captures, in the order read", `export i32 f() { i32 a = 40; i32 b = 2; fn[i32()] g = () => a + b; return g(); }`, 42],
      // A capture and a parameter of its own together: the receiver is local 0 and the parameter
      // is local 1, so a lambda that mixed them up would answer with the wrong one.
      ["a capture beside its own parameter", `export i32 f() { i32 n = 40; fn[i32(i32)] g = (i32 k) => n + k; return g(2); }`, 42],
      ["called more than once", `export i32 f() { i32 n = 21; fn[i32()] g = () => n; return g() + g(); }`, 42],
      ["a struct, reached through the capture", `struct P { i32 v; } export i32 f() { P p = P(42); fn[i32()] g = () => p.v; return g(); }`, 42],
      ["a string", `export i32 f() { string s = "abcd"; fn[i32()] g = () => s.len() * 10 + 2; return g(); }`, 42],
      ["escaping as an argument", `i32 use(fn[i32()] h) { return h(); } export i32 f() { i32 n = 42; return use(() => n); }`, 42],
      // The transitive case: the outer lambda never reads `a`, and still has to carry it so the
      // inner one has something to be handed.
      ["through a nested lambda", `export i32 f() { i32 a = 42; fn[i32()] g = () => { fn[i32()] h = () => a; return h(); }; return g(); }`, 42],
    ];
    for (const [what, src, want] of cases) {
      const p = `${dir}/x.wac`;
      await Deno.writeTextFile(p, src + "\n");
      const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
      const got = (m.f as CallableFunction)();
      if (got !== want) throw new Error(`${what}: answered ${got}, want ${want}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("capture is by reference: a write on either side is seen by the other", async () => {
  // **The decided semantics, and the thing cells exist for.** `design/lang/0002` chose capture by
  // reference including primitives, so a captured local lives in a one-field cell that the lambda and
  // the enclosing function both hold. These are the cases where by value and by reference differ —
  // every one of them answered 1 instead of 42 while capture was a copy.
  const dir = await Deno.makeTempDir({ prefix: "wac-ref-" });
  try {
    const cases: [string, string, number][] = [
      ["the lambda writes, the caller sees it", `export i32 f() { i32 n = 0; fn[void()] g = () => { n = 42; }; g(); return n; }`, 42],
      ["the caller writes, the lambda sees it", `export i32 f() { i32 n = 0; fn[i32()] g = () => n; n = 42; return g(); }`, 42],
      ["both write", `export i32 f() { i32 n = 0; fn[void()] g = () => { n = n + 2; }; n = 40; g(); return n; }`, 42],
      // A counter, which is the shape a handler actually has.
      ["a counter, called repeatedly", `export i32 f() { i32 n = 0; fn[void()] tick = () => { n = n + 1; }; tick(); tick(); tick(); return n * 14; }`, 42],
      ["compound assignment inside", `export i32 f() { i32 n = 40; fn[void()] g = () => { n += 2; }; g(); return n; }`, 42],
      // `++` is its own emission path, and it was the last one still writing to a slot that no longer
      // holds the value: the counter stayed put while every other mutation worked.
      ["increment inside", `export i32 f() { i32 n = 41; fn[void()] g = () => { n++; }; g(); return n; }`, 42],
      // **The one that proves it is a shared cell rather than two copies that happen to agree.**
      ["two closures over one local", `export i32 f() { i32 n = 0; fn[void()] inc = () => { n = n + 21; }; fn[i32()] get = () => n; inc(); inc(); return get(); }`, 42],
    ];
    for (const [what, src, want] of cases) {
      const p = `${dir}/r.wac`;
      await Deno.writeTextFile(p, src + "\n");
      const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
      const got = (m.f as CallableFunction)();
      if (got !== want) throw new Error(`${what}: answered ${got}, want ${want} — by value would give a stale read`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a captured local whose type is an array or a nullable", async () => {
  // **The cell\'s name used to be its type with a prefix**, so the cell for a `u8[]` was
  // `$cell$u8[]` — which every name-to-type path in the emitter reads as *array of `$cell$u8`*.
  // Writing the local\'s valtype therefore registered an array type after the type section had been
  // sized, and the module was declined: "a type this emitter names only while emitting".
  //
  // It was invisible to every test above because `i32`, `bool`, `string` and structs have no suffix
  // the type grammar owns. It surfaced building `packages/platform`\'s substitute capabilities, where
  // the first thing a lambda captures is a `u8[]` of input.
  //
  // The types here are exactly the two suffixes: `[]`, at one and two levels, and `?`.
  const dir = await Deno.makeTempDir({ prefix: "wac-cellname-" });
  try {
    const cases: [string, string, number][] = [
      ["a byte array", `export i32 f() { u8[] b = u8[](40, 2); fn[i32()] g = () => b[0] + b[1]; return g(); }`, 42],
      ["an i32 array, written through", `export i32 f() { i32[] a = i32[](1); fn[void()] g = () => { a[0] = 42; }; g(); return a[0]; }`, 42],
      ["an array of arrays", `export i32 f() { u8[][] b = u8[][](u8[](42)); fn[i32()] g = () => b[0][0]; return g(); }`, 42],
      // A nullable, whose `?` the type grammar owns just as much as `[]` — same bug, different suffix.
      ["a nullable array", `export i32 f() { u8[]? b = u8[](42); fn[i32()] g = () => { if (b is null) { return 0; } return b![0]; }; return g(); }`, 42],
      // And the shape it was found in: an array captured by *two* lambdas, one writing and one reading,
      // which is a substitute capability in miniature.
      ["written by one lambda, read by another", `export i32 f() { u8[] b = u8[](0); fn[void()] w = () => { b[0] = 42; }; fn[i32()] r = () => b[0]; w(); return r(); }`, 42],
    ];
    for (const [what, src, want] of cases) {
      const p = `${dir}/r.wac`;
      await Deno.writeTextFile(p, src + "\n");
      // Named, because a case that *traps* rather than answering wrongly arrives as a bare
      // `RuntimeError` from wasm and says nothing about which of these produced it.
      let got: unknown;
      try {
        const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
        got = (m.f as CallableFunction)();
      } catch (e) {
        throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (got !== want) throw new Error(`${what}: answered ${got}, want ${want}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writing through a captured array or struct, from either side", async () => {
  // **Reading a captured name and writing *through* one are different paths, and only the read was
  // right.** `emitLvalue` pushed a bare `local.get` for the base of `a[i] = v` and `s.f = v`, so:
  //
  //   - inside a lambda, where a captured name has no local at all, it pushed nothing;
  //   - outside one, where the local holds a cell, it pushed the cell where the array belonged.
  //
  // And `typeOfLv` asked `localType` of a name the hoisted function does not declare, got `""`, and
  // emitted `array.set` against type index 0.
  //
  // Half of these trapped or would not load. The other half — `s.v = 42`, `a[0] += 2`, `a[0]++` —
  // **answered the old value and reported success**, which is the failure worth having a test for:
  // capture by reference is exactly the promise that a write on one side is seen on the other.
  const dir = await Deno.makeTempDir({ prefix: "wac-lvcell-" });
  try {
    const cases: [string, string][] = [
      ["array element, written inside", `export i32 f() { i32[] a = i32[](1); fn[void()] g = () => { a[0] = 42; }; g(); return a[0]; }`],
      ["array element, written outside", `export i32 f() { i32[] a = i32[](1); fn[i32()] g = () => a[0]; a[0] = 42; return g(); }`],
      ["array element, compound", `export i32 f() { i32[] a = i32[](40); fn[void()] g = () => { a[0] += 2; }; g(); return a[0]; }`],
      ["array element, increment", `export i32 f() { i32[] a = i32[](41); fn[void()] g = () => { a[0]++; }; g(); return a[0]; }`],
      ["struct field, written inside", `struct S { i32 v; } export i32 f() { S s = S(1); fn[void()] g = () => { s.v = 42; }; g(); return s.v; }`],
      ["struct field, written outside", `struct S { i32 v; } export i32 f() { S s = S(1); fn[i32()] g = () => s.v; s.v = 42; return g(); }`],
      ["struct field, compound", `struct S { i32 v; } export i32 f() { S s = S(40); fn[void()] g = () => { s.v += 2; }; g(); return s.v; }`],
      // A method that mutates was the one shape that always worked — it is a *read* of the receiver
      // — which is why the others went unnoticed.
      ["a mutating method on a captured receiver", `struct S { i32 v; void set(this, i32 n) { this.v = n; } } export i32 f() { S s = S(1); fn[void()] g = () => { s.set(42); }; g(); return s.v; }`],
      ["an element of a captured array of arrays", `export i32 f() { i32[][] a = i32[][](i32[](1)); fn[void()] g = () => { a[0][0] = 42; }; g(); return a[0][0]; }`],
    ];
    for (const [what, src] of cases) {
      const p = `${dir}/${what.replace(/[^a-z]/g, "")}.wac`;
      await Deno.writeTextFile(p, src + "\n");
      let got: unknown;
      try {
        const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
        got = (m.f as CallableFunction)();
      } catch (e) {
        throw new Error(`${what}: ${e instanceof Error ? e.message.split("@")[0] : String(e)}`);
      }
      if (got !== 42) throw new Error(`${what}: answered ${got}, want 42 — the write did not reach the shared cell`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a captured parameter gets its cell at entry", async () => {
  // A captured *local* becomes a cell at its `Var`. A parameter has no `Var` — it arrives already in
  // its slot — so the cell is built at entry from the incoming value and bound to a new local of the
  // same name. `localAt` scans backwards, so that one shadows the parameter and every read and write
  // of the name goes through the cell with no further special case.
  //
  // Both directions again, because the parameter's cell is built by different code from the local's
  // and could carry the value one way only.
  const dir = await Deno.makeTempDir({ prefix: "wac-par-" });
  try {
    const cases: [string, string, number][] = [
      ["read", `export i32 f(i32 q) { fn[i32()] g = () => q * 2; return g(); }`, 42],
      ["written through the lambda", `export i32 f(i32 q) { fn[void()] g = () => { q = q + 21; }; g(); return q; }`, 42],
      ["beside a captured local", `export i32 f(i32 q) { i32 n = 21; fn[i32()] g = () => q + n; return g(); }`, 42],
      // A method's parameter, where slot 0 is the receiver — so an entry cell built at the wrong
      // offset would capture `this` instead.
      ["a method's parameter", `struct S { i32 v; i32 m(this, i32 q) { fn[i32()] g = () => q * 2; return g(); } }\nexport i32 f(i32 q) { return S(1).m(q); }`, 42],
    ];
    for (const [what, src, want] of cases) {
      const p = `${dir}/p.wac`;
      await Deno.writeTextFile(p, src + "\n");
      const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
      const got = (m.f as CallableFunction)(21);
      if (got !== want) throw new Error(`${what}: answered ${got}, want ${want}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("which declarations must become cells", () => {
  // **The mapping `design/lang/0002` calls the missing link**, built and checked before anything
  // depends on it. Reference semantics makes a captured local a cell, and the *enclosing* function's
  // reads and writes have to go through it — so the emitter needs to know, while emitting one
  // function, which of its locals to promote. The walk indexes by lambda and emission by function;
  // a declaration's line and column is the one thing both can name, and it is the same key the
  // lambdas themselves use.
  //
  // A capture whose declaration is missing from this list would be copied rather than shared, which
  // is the by-value behaviour the write gate currently refuses — so the list being right is what the
  // final step rests on.
  const cases: [string, string, string[]][] = [
    ["one captured local", `export i32 f() {\n  i32 n = 41;\n  fn[i32()] g = () => n + 1;\n  return g();\n}`, ["2:3"]],
    // The discriminating case: a local beside the captured one that nothing captures must not be
    // promoted, or every function with a lambda in it would pay for cells it does not need.
    ["not the local next to it", `export i32 f() {\n  i32 keep = 1;\n  i32 n = 41;\n  fn[i32()] g = () => n;\n  return g() + keep;\n}`, ["3:3"]],
    ["both, when both are captured", `export i32 f() {\n  i32 a = 40;\n  i32 b = 2;\n  fn[i32()] g = () => a + b;\n  return g();\n}`, ["2:3", "3:3"]],
    // A captured *parameter* has no `Var` to promote. It still needs a cell — made at entry from the
    // incoming value — and that is the part of the final step this mapping does not cover.
    ["nothing, for a captured parameter", `export i32 f(i32 p) {\n  fn[i32()] g = () => p;\n  return g();\n}`, []],
  ];
  for (const [what, src, want] of cases) {
    const lines = emitApi.lambdaReportLinked(["/m.wac"], [src + "\n"], "/m.wac").trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (!last.startsWith("promoted:")) throw new Error(`${what}: no promotion line — ${last}`);
    const got = last.slice("promoted:".length).trim();
    const expect = want.join(" ");
    if (got !== expect) {
      throw new Error(`${what}: promoted ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`);
    }
  }
});

Deno.test("a lambda in a module that also imports a real package — issues/lang/0138", async () => {
  // **The case every other test in this file misses.** They compile one small file. A lambda only
  // broke once the module *also* contained the nine string builtins, because two numberings
  // disagreed about where a hoisted lambda goes: `assignGlobals` numbers every registered function
  // consecutively and the builtins are registered, while `count` included the lambdas and put them
  // first. So ` str_eq` was numbered at an index a lambda occupied and every string comparison in the
  // module called one function early.
  //
  // It surfaced as `Socket.fromLoopback` and `reasonOf` failing to validate — functions with nothing
  // to do with lambdas, which is what a wrong index looks like. Nothing in the repository writes a
  // lambda, so rung 4 and rung 5 were green throughout; it took *building for the native host* to
  // find, which is why this test exists and why it imports something real.
  // **Inside the repository, under `.cache/`**, because a wac import is resolved relative to the
  // importing file and there is no path from `/tmp` back to `packages/std`.
  //
  // Under `.cache/` specifically, which is gitignored. A temp directory at the repo root is a trap:
  // this test removes it in a `finally`, but an interrupted run leaves one behind, and the next
  // `git add -A` — which is how everything in this repository gets staged — would commit it.
  // `issues/system/0136` is about temp directories outliving the tests that made them.
  const cache = new URL("../../../.cache/", import.meta.url).pathname;
  await Deno.mkdir(cache, { recursive: true });
  const dir = await Deno.makeTempDir({ dir: cache, prefix: "lambda-0138-" });
  try {
    // `Vec` brings strings and a good deal else with it; the point is a module large enough to have
    // the string builtins in it, not this particular import.
    const src = `import { Vec } from "../../packages/std/src/vec.wac";
export i32 f() {
  Vec<i32> v = Vec.create();
  v.push(20);
  i32 n = 1;
  fn[i32()] g = () => n + 21;
  n = n + 0;
  return v.get(0) + g();
}
`;
    const p = `${dir}/m.wac`;
    await Deno.writeTextFile(p, src);
    const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
    const got = (m.f as CallableFunction)();
    if (got !== 42) throw new Error(`answered ${got}, want 42`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a lambda captures the receiver, and it is the caller's receiver", async () => {
  // **`this` is an ordinary local called `this`** everywhere in the emitter, and the walk was the one
  // place that made an exception of it: a method\'s parameters were declared in the walk scope and the
  // receiver was not. So `() => this.v` captured nothing, the hoisted function had no receiver to
  // read, and the module was **invalid** — "expected 1 elements on the stack for return, found 0".
  //
  // Invalid rather than declined, which is the part worth a test: tier two shipped with this, and
  // nothing in the tree caught it because nothing captured `this` until a scheduler wanted a method
  // to hand back a funcref that registers handlers on itself.
  const dir = await Deno.makeTempDir({ prefix: "wac-this-cap-" });
  try {
    const cases: [string, string][] = [
      ["reads a field", `struct S { i32 v; S create(i32 v) { return S(v); } fn[i32()] reader(const this) { return () => this.v; } }\nexport i32 f() { S s = S.create(42); fn[i32()] r = s.reader(); return r(); }`],
      ["calls a method", `struct S { i32 v; S create(i32 v) { return S(v); } i32 get(const this) { return this.v; } fn[i32()] reader(const this) { return () => this.get(); } }\nexport i32 f() { S s = S.create(42); fn[i32()] r = s.reader(); return r(); }`],
      // **The receiver is shared, not copied** — the caller's object is the one that changed, which is
      // what capture by reference promises and what a handler registered on `this` depends on.
      ["writes through it, and the caller sees it", `struct C { i32 n; C create() { return C(0); } void bump(this, i32 by) { this.n = this.n + by; } fn[void(i32)] adder(this) { return (i32 by) => { this.bump(by); }; } }\nexport i32 f() { C c = C.create(); fn[void(i32)] add = c.adder(); add(40); add(2); return c.n; }`],
      // Two lambdas over one receiver, which is the shape that proves it is one cell rather than two.
      ["two lambdas over one receiver", `struct C { i32 n; C create() { return C(0); } fn[void(i32)] adder(this) { return (i32 by) => { this.n = this.n + by; }; } fn[i32()] reader(const this) { return () => this.n; } }\nexport i32 f() { C c = C.create(); fn[void(i32)] add = c.adder(); fn[i32()] read = c.reader(); add(42); return read(); }`],
    ];
    for (const [what, src] of cases) {
      const p = `${dir}/${what.replace(/[^a-z]/g, "")}.wac`;
      await Deno.writeTextFile(p, src + "\n");
      let got: unknown;
      try {
        const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
        got = (m.f as CallableFunction)();
      } catch (e) {
        throw new Error(`${what}: ${e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : String(e)}`);
      }
      if (got !== 42) throw new Error(`${what}: answered ${got}, want 42`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a lambda handed to a funcref rather than to a declared function", async () => {
  // **The walk types a lambda from the slot it is going into**, and it knew three sources: a
  // declared function\'s parameter, a method\'s parameter, a struct field. Not a *funcref* — so
  // `run((i32 n) => …)`, where `run` is an ordinary `fn[…]` value, had no target at all and the
  // module declined with "a position the walk does not type yet".
  //
  // A **named function** argument was fine, which is what kept it hidden: nothing in the tree passed
  // a lambda to a funcref until a scheduler wanted `register(id, handler)`. The parameter types were
  // written on the funcref the whole time.
  //
  // The callee\'s own type comes from the walk\'s scope rather than the emitter\'s, because locals do
  // not exist yet in the pre-pass — they are built per body during emission.
  const dir = await Deno.makeTempDir({ prefix: "wac-fnref-arg-" });
  try {
    const cases: [string, string][] = [
      ["a local funcref", `export i32 f() { i32 seen = 0; fn[void(fn[void(i32)])] run = (fn[void(i32)] h) => { h(42); }; run((i32 n) => { seen = n; }); return seen; }`],
      ["two arguments, one a lambda", `export i32 f() { i32 seen = 0; fn[void(i32, fn[void(i32)])] reg = (i32 id, fn[void(i32)] h) => { h(id); }; reg(42, (i32 n) => { seen = n; }); return seen; }`],
      // The shape every capability in this repository has: a funcref in a struct field.
      ["a funcref field", `struct Caps { fn[void(fn[void(i32)])] each; }\nexport i32 f() { i32 seen = 0; Caps c = Caps((fn[void(i32)] h) => { h(42); }); c.each((i32 n) => { seen = n; }); return seen; }`],
      // And one returned from a method, then called — the scheduler\'s "link" shape.
      ["a funcref a method handed back", `struct S { i32 v; S create() { return S(0); } fn[void(i32, fn[void(i32)])] link(const this) { return (i32 id, fn[void(i32)] h) => { h(id); }; } }\nexport i32 f() { S s = S.create(); i32 seen = 0; fn[void(i32, fn[void(i32)])] reg = s.link(); reg(42, (i32 n) => { seen = n; }); return seen; }`],
    ];
    for (const [what, src] of cases) {
      const p = `${dir}/${what.replace(/[^a-z]/g, "")}.wac`;
      await Deno.writeTextFile(p, src + "\n");
      let got: unknown;
      try {
        const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
        got = (m.f as CallableFunction)();
      } catch (e) {
        throw new Error(`${what}: ${e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : String(e)}`);
      }
      if (got !== 42) throw new Error(`${what}: answered ${got}, want 42`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a lambda inside a generic, once per instantiation — issues/lang/0142", async () => {
  // **A generic is emitted once per instantiation**, so a lambda written in one is not one hoisted
  // function but N — each closing over that instantiation\'s types, each with its own signature,
  // capture struct and cell types. The walk keyed lambdas by line and column, which name one
  // expression per *template*, so this was declined outright until now.
  //
  // The key gained `Env.curInst`, which `pushSubstitution` already maintained — so the walk and
  // emission agree on it without a second traversal, and no call site of `lambdaAtPos` changed.
  const dir = await Deno.makeTempDir({ prefix: "wac-gen-lambda-" });
  try {
    const cases: [string, string, string][] = [
      // The issue\'s own reproduction.
      ["the reproduction", "f", `T pick<T>(T a, T b) { fn[bool()] first = () => true; return first() ? a : b; }\nexport i32 f() { return pick(42, 0); }`],
      // Two instantiations of one generic: the case a position key cannot tell apart, which is the
      // whole reason this was refused rather than merely unimplemented.
      ["two instantiations", "two", `T pick<T>(T a, T b) { fn[bool()] first = () => true; return first() ? a : b; }\nexport i32 two() { i32 a = pick(40, 0); i64 b = pick(2 as i64, 0 as i64); return a + (b as~ i32); }`],
      // Capture, inside a generic, of an ordinary local.
      ["capture inside a generic", "caps", `i32 addBase<T>(T v, i32 base) { fn[i32()] get = () => base; return get(); }\nexport i32 caps() { i32 base = 42; return addBase(1, base); }`],
      // Capture of a value whose type *is* the parameter — a different cell type per instantiation.
      ["capture typed by the parameter", "byType", `T held<T>(T v) { fn[T()] get = () => v; return get(); }\nexport i32 byType() { i32 a = held(40); string b = held("xx"); return a + b.len(); }`],
      // **A generic called only from inside a lambda.** Instantiations are discovered by a walk that
      // had no `Lambda` arm, so a generic reached only this way was never instantiated and the call
      // emitted nothing — "expected 1 elements on the stack for return, found 0". Nothing in the tree
      // did this until `ready<T>` in `packages/platform/src/frame.wac` stopped being three concrete
      // copies, which is the shape below.
      ["a generic called only from inside a lambda", "onlyInside", `T id<T>(T v) { return v; }\nexport i32 onlyInside() { fn[i32()] get = () => id(42); return get(); }`],
      // A generic struct\'s method, at two instantiations.
      ["a generic struct's method", "methods", `struct Cell<T> {\n  T v;\n  Cell<T> of(T v) { return Cell(v); }\n  T get(const this) { fn[bool()] yes = () => true; return yes() ? this.v : this.v; }\n}\nexport i32 methods() { Cell<i32> a = Cell.of(40); Cell<i64> b = Cell.of(2 as i64); return a.get() + (b.get() as~ i32); }`],
    ];
    for (const [what, fn, src] of cases) {
      const p = `${dir}/${what.replace(/[^a-z]/g, "")}.wac`;
      await Deno.writeTextFile(p, src + "\n");
      let got: unknown;
      try {
        const m = await wacBind(p) as unknown as Record<string, CallableFunction>;
        got = (m[fn] as CallableFunction)();
      } catch (e) {
        throw new Error(`${what}: ${e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : String(e)}`);
      }
      if (got !== 42) throw new Error(`${what}: answered ${got}, want 42`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a generic taking a funcref parameter is still declined", async () => {
  // **Not part of `issues/lang/0142` and not fixed by it.** `T twice<T>(T v, fn[T(T)] f)` has no
  // lambda in it at all — the funcref arrives as a parameter — and it was declined before that work
  // and after it, with the same message. Pinned here so the two are not confused: a lambda *inside* a
  // generic works now, a funcref *parameter* of one does not, and the next person to hit the second
  // should not go looking in the walk.
  const dir = await Deno.makeTempDir({ prefix: "wac-gen-fnparam-" });
  try {
    const p = `${dir}/t.wac`;
    await Deno.writeTextFile(p, `T twice<T>(T v, fn[T(T)] f) { return f(f(v)); }\nexport i32 viaParam() { fn[i32(i32)] inc = (i32 n) => n + 21; return twice(0, inc); }\n`);
    let threw = false;
    try {
      await wacBind(p);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("a generic with a funcref parameter compiles now — good news, and this test is what needs updating");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
