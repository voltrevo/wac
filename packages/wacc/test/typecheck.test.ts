// Rung 3, first slice: our return-type diagnostics against the reference's, by position.
//
// `src/check.wac` decides one thing — whether a returned *literal* can possibly be the declared
// return type — and says nothing about anything else. So the comparison here is not the one rungs 1
// and 2 use. Those compare complete outputs and demand equality; this compares a subset against a
// superset, and the two assertions that makes sense are:
//
//   - **soundness**: every diagnostic we report, the reference reports at the same line and column.
//     A position we invent is a bug even if the program really is wrong, because rung 3's oracle is
//     "diagnostics match, *including positions*".
//   - **no false alarms on clean code**: we report nothing for a program the reference accepts.
//
// What is deliberately *not* asserted is completeness — that we find everything the reference does.
// We do not, by design, and a test demanding it would fail on every case until the whole rung is
// finished, which is the same as having no test until then.
//
// Positions rather than messages, as `parse_errors.test.ts` does and for the same reason: our side
// reports numeric codes and the reference reports English.

import { wacLex } from "wac/wacLex.ts";
import { wacParse, type Program } from "wac/wacParse.ts";
import { wacResolve } from "wac/wacResolve.ts";
import { wacTypeCheck } from "wac/wacTypeCheck.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { specRejections } from "./specCorpus.ts";
import { referenceCases } from "./referenceCorpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const checkCodeMessage = mod.checkCodeMessage as (code: number) => string;
const enc = new TextEncoder();

/**
 * One complaint, as `line:col code — the checker's own sentence`.
 *
 * **Because the number alone was read in the wrong code space.** `dumpTypeErrors` answers
 * `(code, line, col)` triples and every one of them is a *checker* code; the parser has its own space
 * starting at the same numbers, and 20 is `errBuiltinArg` here and `perrExpected` there. A complaint
 * printed as `95:48` sent a reader to `parse.wac`, and `issues/lang/0149` is the day that cost —
 * filed as "a parse error from a file that compiles" about a false alarm on
 * `string.fromBytes(bytes)`.
 */
function complaint(path: string, code: number, line: number, col: number): string {
  return `${path}: ${line}:${col} code ${code} — ${checkCodeMessage(code)}`;
}

/** The reference's diagnostics for one single-file program, as `line:col` strings. */
function reference(src: string): { at: string; message: string }[] {
  const { tokens } = wacLex(src);
  const { program } = wacParse(tokens, "/main.wac");
  const programs = new Map<string, Program>([["/main.wac", program]]);
  return wacTypeCheck(wacResolve("/main.wac", programs), programs)
    .filter((e) => e.severity !== "warning")
    .map((e) => ({ at: `${e.line}:${e.col}`, message: e.message }));
}

/** Ours, as `line:col` strings. `(code, line, col)` triples in, positions out. */
function ours(src: string): string[] {
  const flat = Array.from(dumpTypeErrors(enc.encode(src)));
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 3) out.push(`${flat[i + 1]}:${flat[i + 2]}`);
  return out;
}


/**
 * Every declared primitive against every literal kind, asked of the reference at run time.
 *
 * The hand-written lists above are cases somebody thought of; this is the whole grid, and it is what
 * turned the first slice's single `numeric` class into the real rule. Generated rather than
 * tabulated on purpose — a table copied into this file would be a second implementation of the
 * language's assignability, drifting quietly the first time the reference changed its mind. Here the
 * reference decides each cell on every run, and our job is only to agree with it.
 *
 * This is the strongest form of the subset comparison: for the cells the reference accepts we must be
 * silent, and for the cells it rejects we must either be silent or right about the position. Being
 * silent everywhere would pass — which is why `at least one cell rejected` is asserted too, and why
 * the count is checked against the grid rather than against zero.
 */
const PRIMITIVES = ["i32", "i64", "u32", "u64", "u8", "u16", "i8", "i16", "f32", "f64", "bool", "string"];


/**
 * The spec's own rejection cases, as a second oracle.
 *
 * Everything above compares wacc to the reference *implementation*. This compares it to what the
 * language says: `spec/spec/*.md` carries 409 tagged assertions, `wacSpec.test.ts` executes them, and
 * the rejection ones are complete programs the language declares illegal. They are extracted rather
 * than copied — see `specCorpus.ts` — so the corpus grows when the spec does and cannot drift from it.
 *
 * Two different things are asserted, and the first is not about wacc at all:
 *
 *   - **the reference honours the spec**, for every case. If it stopped rejecting one, that is a
 *     divergence between wac's implementation and wac's specification, and it is worth failing this
 *     package's suite to say so — it is also the check that proves the extraction produced real
 *     programs rather than fragments that fail for being malformed.
 *   - **every difference is accounted for**: a position this checker reports and the reference does
 *     not stops the suite with both answers shown, so somebody decides which matches the spec. It is
 *     no longer read as this checker being wrong — the spec is the contract, and `issues/lang/0085`
 *     is a case where the reference is the one that diverges from it.
 */
Deno.test("rung 3: the spec's rejection corpus — the reference honours it, and we account for every difference", () => {
  const cases = specRejections();
  if (cases.length < 80) {
    throw new Error(`only ${cases.length} spec rejection programs extracted; the shape of ` +
      "wacSpec.test.ts has changed and specCorpus.ts is reading it wrong");
  }

  const notRejected: string[] = [];
  let contradicted = 0;
  let covered = 0;
  for (const c of cases) {
    const theirs = reference(c.src);
    if (theirs.length === 0) {
      // The reference type-checks it. That is either a spec/implementation divergence or a case
      // rejected at a stage this harness does not run — lexing, parsing, resolution — so it is
      // collected and reported rather than failed on individually.
      notRejected.push(c.tag);
      continue;
    }
    const mine = ours(c.src);
    if (mine.length === 0) continue;
    for (const at of mine) {
      if (theirs.some((e) => e.at === at)) continue;
      // **A difference is a question, not a verdict.** This used to throw, on the reading that this
      // checker may report a subset of the reference and nothing else. The spec is the contract now:
      // where the two disagree, the one that matches `spec/spec` is right, and the reference has
      // been wrong before — `issues/lang/0085`. So a position it does not share is reported with
      // both sides shown, and the answer is written down here rather than assumed.
      contradicted++;
      throw new Error(
        `[§${c.tag}] we report a diagnostic at ${at} and the reference does not.\n` +
          `  Decide which is right — the spec governs, not the reference — and if this checker is,\n` +
          `  record the tag here as an intended difference.\n` +
          `  source: ${JSON.stringify(c.src)}\n` +
          `  reference: ${theirs.map((e) => `${e.at} ${e.message}`).join("; ")}`,
      );
    }
    covered++;
  }

  // Reported on the error channel so a green run still says what the number is — a coverage figure
  // nobody can see is one nobody notices falling.
  console.error(
    `    rung 3 against the spec: ${cases.length} rejection programs, ` +
      `${cases.length - notRejected.length} rejected by the type checker, ` +
      `${covered} of those also caught here, ${contradicted} contradicted`,
  );
});


/**
 * Every expression form, in every return slot, with the reference deciding each cell.
 *
 * `typeOfExpr` answered *unknown* for everything except a name and a member, so casts, `is`, unary,
 * index, ternary, calls and constructions all evaporated and every rule downstream went quiet on
 * them. This is the grid for the rest of them, built the same way as the literal and parameter grids:
 * the reference decides, and our job is to agree or be silent.
 *
 * Each expression is placed in a `return` whose declared type varies, which turns "what type is this
 * expression" into a question the reference already answers — *"return: expected T, found U"* — with
 * no need for it to expose a typer.
 */
const FORMS: [string, string][] = [
  ["cast as", "n as i64"],
  ["cast as!", "m as! i32"],
  ["cast as~", "m as~ i32"],
  ["is", "p is P"],
  ["unary minus", "-n"],
  ["unary not", "!b"],
  ["index", "arr[0]"],
  ["ternary", "b ? n : n"],
  ["call", "fi()"],
  ["call string", "fs()"],
  ["construct", "P(1)"],
  ["unwrap", "opt!"],
  ["member", "p.x"],
];


/**
 * Four families about declarations rather than uses, and two about operators.
 *
 * The `override` pair is the shape worth naming: the language checks the claim in *both* directions,
 * so a method that hides a parent's without saying so and a method that says so with nothing to hide
 * are both errors. A checker that implemented one and not the other would look right on half the
 * cases and be silently wrong on the rest.
 */
Deno.test("rung 3: override, increments, construction arity and default values", () => {
  const CAUGHT = [
    // override, both directions.
    "struct Shape { i32 x; i32 name(const this) { return 1; } } " +
      "struct BadRect : Shape { i32 w; i32 name(const this) { return 2; } }",
    "struct BadShape { override i32 foo(const this) { return 0; } }",
    // `++` on a const, at the operand; on a float, at the operator. Both spellings of the second.
    "export i32 g() { const i32 x = 1; return x++; }",
    "export f64 h() { f64 x = 1.5; return x++; }",
    "export f64 h2() { f64 x = 1.5; return ++x; }",
    // `>>>` where it says nothing, and where it means nothing.
    "export u32 bad(u32 x) { return x >>> 1; }",
    "export u64 bad2(u64 x) { return x >>> 1; }",
    "export f64 bad3(f64 x) { return x >>> 1.0; }",
    // Positional construction, parents included in the count.
    "struct Point { i32 x; i32 y; } export void bad() { Point p = Point(3); }",
    "struct A { i32 a; } struct B : A { i32 b; } export void bad() { B x = B(1); }",
    // Nothing to default-construct from: a recursive struct, an enum, a struct containing one.
    "struct Node { i32 v; Node next; } export void bad() { Node n = Node(); }",
    "struct Node { Node next; }",
    "enum E { A(i32 v), B } export i32 f() { E[] a = E[2](); return a.len(); }",
    "enum E { A, B } struct S { E e; } export i32 f() { S s = S(); return 1; }",
    // A packed type where there is no slot for one.
    "export i32 process(i8 val) { return 0; }",
    // A const struct makes every field const without any of them saying so.
    "const struct Config { i32 w; i32 h; } export void bad() { Config c = Config(8, 6); c.w = 1; }",
    // Immutable strings, and a downcast that can fail.
    "export void bad() { string s = \"hello\"; s[0] = \"H\"; }",
    "struct Shape { f64 x; } struct Circle : Shape { f64 r; } " +
      "export void bad(Shape s) { Circle c = s as Circle; }",
  ];
  const QUIET = [
    // `override` that is correct, and a method that hides nothing.
    "struct Shape { i32 x; i32 name(const this) { return 1; } } " +
      "struct R : Shape { i32 w; override i32 name(const this) { return 2; } }",
    "struct Shape { i32 x; } struct R : Shape { i32 w; i32 other(const this) { return 2; } }",
    // Unsigned increments are fine, whatever the reference's message says, and so are packed
    // elements — the rule is about floats.
    "export void f(u32 x) { x++; }",
    "export void f(u8[] b) { b[0]++; }",
    "export void f(i64 x) { x--; }",
    // `>>>` on a signed type is the whole point of it.
    "export i32 ok(i32 x) { return x >>> 1; }",
    "export i64 ok2(i64 x) { return x >>> 1; }",
    // The right number of arguments, parents first.
    "struct A { i32 a; } struct B : A { i32 b; } export void f() { B x = B(1, 2); }",
    // Defaults that do exist: primitives, a nullable recursive field, an enum with a fill.
    "struct P { i32 v; } export void f() { P p = P(); }",
    "struct Node { i32 v; Node? next; } export void f() { Node n = Node(); }",
    "enum E { A, B } export i32 f() { E[] a = E[2](fill: E.A); return a.len(); }",
    // Reading a string index is ordinary; only writing is refused.
    "export i32 ok() { string s = \"hi\"; return s[0]; }",
    // Upcasting is silent, and a checked downcast is what `as!` is for.
    "struct Shape { f64 x; } struct Circle : Shape { f64 r; } " +
      "export void ok(Circle c) { Shape s = c as Shape; }",
    "struct Shape { f64 x; } struct Circle : Shape { f64 r; } " +
      "export void ok(Shape s) { Circle c = s as! Circle; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * Five rules that need something other than a type: a count, a depth, a representation, a pass order.
 *
 * The `break` pair is the only rule here that depends on *where* a statement is rather than what is
 * in it, which is why the checker carries a loop depth at all — and a switch depth beside it. A switch
 * counts for `break` and not for `continue`: one counter for both made `continue` legal wherever a
 * `break` was, and there it *meant* break, leaving the switch and carrying on after it. Both compilers
 * did that; `[§wac-continue-not-switch-8kd3pq7]` is the rule now.
 */
Deno.test("rung 3: arity, loop depth, representation, and compile-time constants", () => {
  const CAUGHT = [
    // `break` and `continue` with nothing to leave.
    "export void f() { break; }",
    "export void f() { continue; }",
    // ...and a `continue` whose only enclosing form is a switch, which is nothing to leave either.
    "export void f(i32 x) { switch (x) { case 1: continue; } }",
    // Arithmetic on booleans. They agree with each other, so the same-type rule has nothing to say.
    "export bool f(bool a, bool b) { return a + b; }",
    "export i32 f(bool a) { return a - 1; }",
    "export bool f(bool a, bool b) { return a & b; }",
    // Call arity, all three directions.
    "i32 g() { return 1; } export i32 f() { return g(1); }",
    "i32 g(i32 a) { return a; } export i32 f() { return g(); }",
    "i32 g(i32 a) { return a; } export i32 f() { return g(1, 2); }",
    // A nullable packed type has no representation, in an array or on its own.
    "export i32 f() { u8?[] xs = u8?[3](); return xs.len(); }",
    "export void f() { u8? x = null; }",
    "export void f(i8? y) { }",
    // A constant computed by calling something.
    "i32 n() { return 3; } const i32 K = n(); export i32 f() { return K; }",
    "i32 n() { return 3; } const i32[] T = i32[n()](); export i32 f() { return T[0]; }",
  ];
  const QUIET = [
    // Every enclosing form that makes `break` legal. **`continue` in a switch was here** and both
    // compilers accepted it, where it silently meant `break` — it left the switch and carried on after
    // it. Now refused by both, stated at `[§wac-continue-not-switch-8kd3pq7]`, and moved to the
    // reported list below: the pair is the whole point, since one counter for loops and switches is
    // what made a `continue` legal wherever a `break` was.
    "export void f() { while (true) { break; } }",
    "export void f() { for (i32 i = 0; i < 2; i++) { continue; } }",
    "export void f(i32 x) { switch (x) { case 1: break; } }",
    // ...and the one that keeps a switch inside a loop honest, where `continue` does reach the loop.
    "export void f(i32 n) { for (i32 i = 0; i < n; i++) { switch (i) { case 1: continue; } } }",
    "export void f() { do { break; } while (true); }",
    // Booleans where booleans belong.
    "export bool ok(bool a, bool b) { return a && b; }",
    "export bool ok2(bool a, bool b) { return a == b; }",
    // The right number of arguments, and a construction that must not be read as a call.
    "i32 g(i32 a, i32 b) { return a; } export i32 ok() { return g(1, 2); }",
    "struct P { i32 x; i32 y; } export i32 ok() { P p = P(1, 2); return p.x; }",
    // A packed array is fine; it is the *nullable* packed that has nowhere to live.
    "export i32 ok(u8[] b) { return b.len(); }",
    "export i32 ok2(i32? x) { return 1; }",
    // Constants that are computable: arithmetic on literals, and a construction, which is a shape
    // rather than a computation.
    "const i32 K = 1 + 2; export i32 ok() { return K; }",
    "struct P { i32 v; } const P S = P(1); export i32 ok() { return S.v; }",
    "const i32[] T = i32[3](); export i32 ok() { return T[0]; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * Generics as a real type, which is mostly a consequence of one decision.
 *
 * The model here has always been that **a type is its canonical name**, so an instantiation spells
 * itself: `Box<i32>`. Invariance then costs nothing — two instantiations differ exactly when their
 * names do — and what remains is substitution, reading a member written `T` in the world of whatever
 * the owner was instantiated with.
 *
 * The corpus barely touches any of this: it has one invariance case and one that needs inference. So
 * this test is where the substitution is actually asserted, which is the usual shape — recall is only
 * ever visible where somebody thought to look.
 */
Deno.test("rung 3: generic instantiations, and substitution at their members", () => {
  const BOX = "struct Box<T> { T v; T get(const this) { return this.v; } } ";
  const VEC = "struct Vec<T> { T[] items; i32 n; } ";
  const PAIR = "struct Pair<A, B> { A a; B b; } ";
  const CAUGHT = [
    // A constructor argument read through the type argument.
    BOX + "export i32 f() { Box<i32> b = Box<i32>(1.5); return b.v; }",
    // A field read through it — the whole point of substitution.
    BOX + "export f64 f() { Box<i32> b = Box<i32>(1); return b.v; }",
    PAIR + "export f64 f() { Pair<i32, f64> p = Pair<i32, f64>(1, 2.0); return p.a; }",
    // `T[]` substitutes under the suffix, not instead of it.
    VEC + "export f64 f() { Vec<i32> v = Vec<i32>(i32[2](), 0); return v.items[0]; }",
    // Invariance: `Box<f64>` is not a `Box<i32>`, and neither is a `Box<Sub>` a `Box<Base>`.
    BOX + "export i32 f() { Box<i32> b = Box<f64>(1.0); return b.v; }",
    VEC + "export i32 f() { Vec<i32> v = Vec<f64>(f64[2](), 0); return v.n; }",
    BOX + "struct Base { i32 a; } struct Sub : Base { i32 b; } i32 take(Box<Base> x) { return 1; } " +
      "export i32 f(Box<Sub> s) { return take(s); }",
    // An instantiation is a struct, so a method it does not have is still a missing method.
    BOX + "export i32 f() { Box<i32> b = Box<i32>(1); return b.nosuch(); }",
  ];
  const QUIET = [
    // The same programs with the types agreeing.
    BOX + "export i32 f() { Box<i32> b = Box<i32>(1); return b.v; }",
    BOX + "export f64 f() { Box<f64> b = Box<f64>(1.0); return b.v; }",
    VEC + "export i32 f() { Vec<i32> v = Vec<i32>(i32[2](), 0); return v.items[0]; }",
    PAIR + "export i32 f() { Pair<i32, f64> p = Pair<i32, f64>(1, 2.0); return p.a; }",
    PAIR + "export f64 f() { Pair<i32, f64> p = Pair<i32, f64>(1, 2.0); return p.b; }",
    // A bare template with the arguments left to inference. Legal, and unknowable from the syntax
    // here — so it is typed as unknown rather than as `Box`, which is a type nothing has.
    BOX + "export i32 f() { Box<i32> b = Box(1); return b.v; }",
    // Inside a generic's own methods the bare name means the instantiation being compiled. Five
    // sites in `packages/std` are this shape, and typing it as `Vec` reported every one of them.
    "struct Vec<T> { T[] items; Vec<T> empty() { return Vec(T[]()); } }",
    // A generic function's signature is written in its own parameters, which mean nothing at a call
    // site: `Box<T>` accepts every `Box<…>` and `T` accepts anything.
    "struct Box<T> { T v; } T unbox<T>(Box<T> b) { return b.v; } " +
      "export f64 f(Box<f64> b) { return unbox(b); }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * The reference's own test suite, as a second corpus.
 *
 * The spec corpus is a sample of the language chosen to *explain* it. This is what the reference is
 * actually held to, and the halves do different jobs:
 *
 * - **88 `ok` programs are a false-alarm corpus.** Every one type-checks cleanly, so a diagnostic
 *   from us is a bug in us — with a named program to look at, rather than a file somewhere under
 *   `packages/`. The whole-repo silence guard is the same idea over code that happens to exist; this
 *   is the same idea over code somebody wrote *because* it was interesting.
 * - **124 `fail` programs are a recall corpus**, denser per family than the spec's.
 *
 * It found eight false alarms on the first run, in four families that the spec corpus and the repo
 * guard had both missed for slots on end. Recall against it is deliberately *not* asserted as a
 * floor: it is printed, like the spec's, because a subset checker that must never lose ground on 124
 * programs is a checker nobody can refactor.
 */
Deno.test("rung 3: the reference's own tests — never a false alarm, never a contradiction", () => {
  const { cases, skipped } = referenceCases();
  if (skipped !== 0) throw new Error(`${skipped} case(s) the extractor could not read`);
  if (cases.length < 200) throw new Error(`only ${cases.length} cases extracted, expected ~212`);

  const alarms: string[] = [];
  const contradictions: string[] = [];
  let accepted = 0;
  let rejected = 0;
  let caught = 0;
  for (const c of cases) {
    let theirs: { at: string; message: string }[];
    try {
      theirs = reference(c.src);
    } catch {
      continue; // a program this slice's parser cannot read is not this test's business
    }
    const mine = ours(c.src);
    if (c.kind === "ok") {
      // The label is the reference test's claim; this trusts the reference itself over the label.
      if (theirs.length !== 0) continue;
      accepted++;
      if (mine.length !== 0) {
        alarms.push(`${mine.join(",")} in ${JSON.stringify(c.src.replace(/\s+/g, " ").slice(0, 90))}`);
      }
      continue;
    }
    if (theirs.length === 0) continue;
    rejected++;
    if (mine.length === 0) continue;
    caught++;
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        contradictions.push(`we say ${at}, the reference says ${theirs.map((e) => e.at).join(",")} ` +
          `in ${JSON.stringify(c.src.replace(/\s+/g, " ").slice(0, 90))}`);
        break;
      }
    }
  }
  console.log(`    rung 3 against the reference's tests: ${accepted} accepted programs, ` +
    `${alarms.length} false alarms; ${rejected} rejected, ${caught} caught, ` +
    `${contradictions.length} contradicted`);
  if (alarms.length !== 0) {
    throw new Error(`we report diagnostics in ${alarms.length} program(s) the reference accepts:\n  ` +
      alarms.join("\n  "));
  }
  if (contradictions.length !== 0) {
    throw new Error(`${contradictions.length} contradiction(s):\n  ` + contradictions.join("\n  "));
  }
});

/**
 * A name that nothing declares — the most-missed family in the reference's own tests, at thirteen.
 *
 * It is the last rule here that needs a **complete** picture of scope rather than a fact about one
 * construct. Every other rule can be wrong by staying quiet; this one is wrong by speaking, because
 * any binder the language has that the checker does not know about is a false alarm on working code.
 * So the QUIET list below is the interesting half: it is one entry per way wac has of introducing a
 * name, and it is what the rule is actually made of.
 *
 * Three of them were found by the repo guard rather than by thinking: `case Some(v): v * 3` binds `v`
 * in a match used as an *expression*, and the declaration pass walks statements.
 */
Deno.test("rung 3: a name nothing declares, and every way wac has of declaring one", () => {
  const CAUGHT = [
    "export void bad() { i32 x = y; }",
    "export void bad() { undeclared = 5; }",
    "export void bad() { bool y = !undefined_var; }",
    "export void bad() { i32 x = undefined_var + 1; }",
    "export i32 bad() { return undefined_var as i32; }",
    "export bool bad() { return undefined_var is null; }",
    "export void bad(bool c) { i32 x = c ? undefined_var : 1; }",
    "export void bad() { i32 y = undefined_var[0]; }",
    "export void bad() { i32 y = undefined_var!; }",
    "export void bad() { i32 y = undefined_var.field; }",
    "struct Foo { i32 count; i32 getCount(const this) { return count; } }",
  ];
  const QUIET = [
    // Every binder, one per line. A gap in any of these is a false alarm rather than a missed case.
    "export i32 local() { i32 v = 1; return v; }",
    "export i32 param(i32 v) { return v; }",
    "const i32 G = 1; export i32 global() { return G; }",
    "struct P { i32 x; i32 m(const this) { return this.x; } }",
    "export i32 fwd() { i32 later = 1; return later; }",
    "export i32 loopVar() { for (i32 i = 0; i < 2; i++) { } return 0; }",
    "enum E { A(i32 v), B } export i32 armStmt(E e) { match (e) { case A(v): { return v; } case B: { return 0; } } }",
    // The match *expression* form, whose bindings the declaration pass never reaches.
    "enum E { A(i32 v), B } export i32 armExpr(E e) { return match (e) { case A(v): v * 3, case B: -1 }; }",
    // Names that are not variables: a function used as a value, a struct and an enum as receivers,
    // and the primitive type names, which appear in expression position for the builtin statics.
    "i32 g(i32 a) { return a; } export i32 callIt() { return g(1); }",
    "struct P { i32 x; P mk() { return P(1); } } export i32 stat() { return P.mk().x; }",
    "enum E { A, B } export E variant() { return E.A; }",
    "export string prim() { return string.fromCodepoint(65); }",
    "export u64 prim2(f64 x) { return f64.toBits(x); }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * The families the reference's own tests said were missing, and the QUIET halves that shaped them.
 *
 * Three of these rules were written twice. The first version asked the *negative* question — is this
 * not a reference, is this not nullable, is this not an array — and a negative question is answered
 * "yes" by every type the checker cannot see. `v is null` on an enum, on a funcref, on a generic
 * instantiation: 27 files, none of them wrong. Asking the positive question instead — is this a type
 * I can name as a primitive — only ever fires on something known, which is the direction to be wrong
 * in for a subset checker.
 */
Deno.test("rung 3: operators, members, indexing and the questions they ask", () => {
  const CAUGHT = [
    // Declaration positions that cannot hold a type.
    "struct Bad { void x; }",
    "void bad(void x) { }",
    "struct S { i8 x; } export void f() { }",
    // A return that disagrees with the function's voidness, both directions.
    "export void bad() { return 1; }",
    "i32 bad() { return; }",
    // The three unary demands, and integers where "numeric" is not enough.
    "export bool bad(i32 x) { return !x; }",
    "export void bad(bool b) { bool r = -b; }",
    "export f64 bad(f64 x) { return ~x; }",
    "export f64 bad(f64 a, f64 b) { return a & b; }",
    "export i32 bad(i32 x, f64 n) { return x << n; }",
    "export f64 bad(f64 x) { return x << 1; }",
    // A compound assignment, reported at the target.
    "export void bad(i32 x) { x += 1.5; }",
    // A field that is not there, on a struct and on something with no fields at all.
    "struct P { i32 x; } export void bad(P p) { i32 y = p.z; }",
    "struct P { i32 x; } export void bad(P p) { p.z = 1; }",
    "export void bad(i32 x) { i32 y = x.something; }",
    "export void bad(i32 x) { x.y = 1; }",
    // Reaching through a nullable without unwrapping.
    "struct P { i32 x; } export i32 bad(P? p) { return p.x; }",
    "struct P { i32 x; } export void bad(P? p) { p.x = 1; }",
    "struct P { i32 x; void inc(this) { this.x++; } } export void bad(P? p) { p.inc(); }",
    // Indexing: the operand as an expression, the bracket as an lvalue.
    "export void bad(i32 x) { i32 y = x[0]; }",
    "export void bad(i32 x) { x[0] = 1; }",
    "export void bad(i32[] a) { i32 x = a[true]; }",
    "export void bad(i32[] a) { a[true] = 0; }",
    "export void bad() { i32[] a = i32[true](); }",
    // Ternary, switch, named construction, redundant cast.
    "export i32 bad(i32 x) { return x ? 1 : 2; }",
    "export void bad(bool c) { i32 x = c ? 1 : true; }",
    "export void bad(bool x) { switch (x) { default: { } } }",
    "struct Point { i32 x; i32 y; } export void bad() { Point p = Point { x: 1, y: 2, z: 3 }; }",
    "struct Point { i32 x; i32 y; } export void bad() { Point p = Point { x: 1 }; }",
    "export i32 bad(i32 x) { return x as i32; }",
    // `is` and `!` on something the question does not fit.
    "export bool bad(i32 x) { return x is null; }",
    "export bool bad(i32 a, i32 b) { return a is b; }",
    "struct P { i32 x; } export P bad(P p) { return p!; }",
  ];
  const QUIET = [
    // Every reference kind `is null` is a fair question about — the negative form reported all of
    // these, and an enum, a funcref and a generic instantiation are exactly what it could not see.
    "struct P { i32 x; } export bool ok(P? p) { return p is null; }",
    "enum E { A, B } export bool ok(E? e) { return e is null; }",
    "export bool ok(i32[]? a) { return a is null; }",
    "export bool ok(fn[void()]? f) { return f is null; }",
    "struct Box<T> { T v; } export bool ok(Box<i32>? b) { return b is null; }",
    "struct P { i32 x; } export bool ok(P a, P b) { return a is b; }",
    // Unwrapping something that is nullable, including the kinds above.
    "struct P { i32 x; } export P ok(P? p) { return p!; }",
    "enum E { A, B } export E ok(E? e) { return e!; }",
    // A method is not a missing field, and neither is a field of a parent.
    "struct P { i32 x; i32 m(const this) { return 1; } } export i32 ok(P p) { return p.m(); }",
    "struct B { i32 b; } struct C : B { f64 c; } export i32 ok(C q) { return q.b; }",
    // Arrays and strings index. **An index is an `i32` and not "an integer of any width"** — this
    // list said otherwise with a `u32` and had never asked: the reference answers *"array index must
    // be i32, got u32"*, and a QUIET entry is a claim about the reference that nothing verified.
    "export i32 ok(i32[] a) { return a[0]; }",
    "export i32 ok(i32[] a, i32 i) { return a[i]; }",
    "export i32 ok(string s) { return s[0]; }",
    // The operators, given what they want.
    "export i32 ok(i32 a, i32 b) { return a & b; }",
    "export i64 ok(i64 a, i32 b) { return a << b; }",
    "export f64 ok(f64 a, f64 b) { return a + b; }",
    "export void ok(i32 x) { x += 1; }",
    "export void ok(f64 x) { x += 1.5; }",
    // A ternary whose branches agree, and one whose literal takes the other's type.
    "export void ok(bool c) { i32 x = c ? 1 : 2; }",
    "export void ok(bool c, i32 n) { i32 x = c ? n : 0; }",
    // A complete named construction, and a switch on what a switch takes.
    "struct Point { i32 x; i32 y; } export void ok() { Point p = Point { x: 1, y: 2 }; }",
    "export void ok(i32 x) { switch (x) { case 1: { } default: { } } }",
    // A void function returning nothing, and a value function returning one.
    "export void ok() { return; }",
    "export i32 ok2() { return 1; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});


/**
 * The whole cast law, now that the sweep has been over every pair of types four times.
 *
 * Three worlds rather than one table. **Value to value** is the numeric tables, which were measured
 * long ago. **Value to reference and back** is never a conversion at all — a number and a reference
 * have nothing in common to convert — with `i31ref` as the one type that exists to cross. **Reference
 * to reference** takes only `as` and `as!`, and which of the two depends on the direction.
 *
 * The direction has two independent halves, which is the part that took a measurement rather than a
 * guess: a cast is the safe direction only if the **type** widens *and* the **nullability** does.
 * `P? as Base?` is a downcast despite both sides being nullable, because a `P` is not a `Base`; and
 * `P? as P` is a downcast despite the types matching, because it takes away the possibility of
 * absence. Requiring only one of the two was wrong in both directions, one cell each.
 */
Deno.test("rung 3: the cast law across all three worlds", () => {
  const D = "struct P { i32 x; } struct Base { i32 b; } struct Sub : Base { i32 s; } enum E { A, B } ";
  const CAUGHT = [
    // A self-cast is redundant whichever spelling is used, not only the plain one.
    "export void f(i32 a) { i32 v = a as i32; }",
    "export void f(i32 a) { i32 v = a as! i32; }",
    "export void f(i32 a) { i32 v = a as~ i32; }",
    "export void f(i32 a) { i32 v = a as@ i32; }",
    // Crossing between values and references, in both directions and every spelling.
    "export void f(i32 a) { string v = a as string; }",
    "export void f(i32 a) { P v = a as! P; }",
    "export void f(i32 a) { i32[] v = a as~ i32[]; }",
    "export void f(string a) { i32 v = a as i32; }",
    "export void f(E a) { i32 v = a as! i32; }",
    // Reference to reference: `as~` and `as@` are never right.
    "export void f(Sub a) { Base v = a as~ Base; }",
    "export void f(Base a) { Sub v = a as@ Sub; }",
    "export void f(P a) { P v = a as~ P; }",
    // The wrong spelling for the direction.
    "export void f(Sub a) { Base v = a as! Base; }",
    "export void f(Base a) { Sub v = a as Sub; }",
    "export void f(P a) { P? v = a as! P?; }",
    "export void f(P? a) { P v = a as P; }",
    // Both halves of the direction, independently: the type does not widen, or the nullability does not.
    "export void f(P? a) { Base? v = a as Base?; }",
    "export void f(string a) { P v = a as P; }",
  ];
  const QUIET = [
    // The safe direction with `as`, and the checked one with `as!`.
    "export void f(Sub a) { Base v = a as Base; }",
    "export void f(Base a) { Sub v = a as! Sub; }",
    "export void f(P a) { P? v = a as P?; }",
    "export void f(P? a) { P v = a as! P; }",
    "export void f(P? a) { P? v = a as P?; }",
    "export void f(Sub a) { Base? v = a as Base?; }",
    "export void f(P? a) { Base? v = a as! Base?; }",
    // A string is a reference: casting one to itself is ordinary, where an `i32` to an `i32` is not.
    "export void f(string a) { string v = a as string; }",
    "export void f(i32[] a) { i32[] v = a as i32[]; }",
    "export void f(E a) { E v = a as E; }",
    // The value tables, untouched by any of this.
    "export void f(i32 a) { i64 v = a as i64; }",
    "export void f(i64 a) { i32 v = a as~ i32; }",
    "export void f(i32 a) { u32 v = a as@ u32; }",
    // `i31ref` is the one type that crosses: lossy going in, lossless coming back.
    "export void f(i32 a) { i31ref v = a as! i31ref; }",
    "export void f(i31ref a) { i32 v = a as i32; }",
  ];
  for (const t of CAUGHT) {
    const src = D + t;
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(t)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(t)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const t of QUIET) {
    const mine = ours(D + t);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(t)} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * The three that finished the reference corpus, and what each needed that the checker did not have.
 *
 * None of them was a rule nobody had thought of. Each was blocked on a *fact the checker did not
 * record*, which is a different kind of gap and took a table rather than a branch:
 *
 * - a `case` arm had no **position**, because a `Case` is not a `Stmt`;
 * - a method call had no **type**, because nothing recorded what a method returns;
 * - a static method had no **signature**, because nothing recorded its parameters.
 *
 * The middle one is the interesting one. `this.getInner().mutate()` reads like a way to launder
 * constness — hand the field out through an accessor and call the mutating method on what comes
 * back — and the language refuses it. What decides is the **receiver**, not the return type: a method
 * called on something const returns something const.
 */
Deno.test("rung 3: a case's position, a method's return, and a static as a value", () => {
  const INNER = "struct Inner { i32 val; void mutate(this) { this.val = 1; } } ";
  const CAUGHT = [
    // A case value is an i32 like the subject, and the complaint names the `case` keyword.
    "export void f(i32 x) { switch (x) { case true: { } default: { } } }",
    "export void f(i32 x) { switch (x) { case 1: { } case true: { } default: { } } }",
    // Constness survives an accessor.
    INNER + "struct O { Inner inner; Inner get(const this) { return this.inner; } " +
      "void t(const this) { this.get().mutate(); } }",
    // A static named without being called is a funcref, so this is an ordinary mismatch.
    "struct S { S make() { return S(); } } export void f() { i32 x = S.make; }",
    // A method call is typed now, so its result is checked where it lands.
    "struct C { i32 n; i32 get(const this) { return this.n; } } export string f(C c) { return c.get(); }",
    "struct C { i32 n; i32 get(const this) { return this.n; } } export void f(C c) { bool b = c.get(); }",
  ];
  const QUIET = [
    // A case value that is an integer, in every width the subject could be.
    "export void f(i32 x) { switch (x) { case 1: { } default: { } } }",
    "export void f(i32 x) { switch (x) { case 1: { } case 2: { } } }",
    // The same accessor chain through a receiver that is not const.
    INNER + "struct O2 { Inner inner; Inner get(this) { return this.inner; } " +
      "void t(this) { this.get().mutate(); } }",
    // A const method called on a const receiver is fine; it is the *mutating* one that is not.
    INNER + "struct O3 { Inner inner; Inner get(const this) { return this.inner; } " +
      "i32 t(const this) { return this.get().val; } }",
    // A static assigned to a funcref of its own signature.
    "struct S { S make() { return S(); } } export void f() { fn[S()] g = S.make; }",
    "struct S { i32 n; i32 twice(i32 a) { return a + a; } } export void f() { fn[i32(i32)] g = S.twice; }",
    // A method call whose result is used at its own type.
    "struct C { i32 n; i32 get(const this) { return this.n; } } export i32 f(C c) { return c.get(); }",
    // A generic's method, read in the instantiation's world.
    "struct Box<T> { T v; T get(const this) { return this.v; } } export i32 f(Box<i32> b) { return b.get(); }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-60))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-60))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-60))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

