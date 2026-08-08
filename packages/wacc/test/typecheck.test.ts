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

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

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
 * Programs that are wrong in the one way this slice knows about.
 *
 * Each is a class disagreement — numeric, string and boolean cannot convert into one another — so
 * every one is an error under any widening rule the reference might apply.
 */
const WRONG = [
  'export i32 main() { return "x"; }',
  'export string s() { return 1; }',
  'export bool b() { return "y"; }',
  'export i32 n(bool c) { if (c) { return "a"; } return 0; }',
  'export f64 f() { return true; }',
  'export i32 w(bool c) { while (c) { return "loop"; } return 0; }',
  'export string t(i32 n) { switch (n) { case 1: { return 5; } } return "d"; }',
  'export i32 nested(bool c) { if (c) { if (c) { return "deep"; } } return 0; }',
];

/**
 * Programs that are right.
 *
 * This half is what stops the checker being "report a mismatch whenever the spellings differ", and
 * writing it taught the slice something. Two cases went in on the assumption that an integer
 * literal widens to any numeric type, and the reference rejected both:
 *
 *     export u8  b() { return 1; }   packed type 'u8' cannot be a return type
 *                                    return: expected u8, found i32
 *     export f64 f() { return 1; }   return: expected f64, found i32
 *
 * So an integer literal **is** an `i32` and does not widen — `i64` accepts one, `f64` does not.
 * That makes `src/check.wac`'s numeric *class* coarser than the language: it groups types the
 * reference keeps apart, which costs recall and never precision, so the checker stays a subset and
 * a later slice can tighten it to exact primitive names. The cases below are the ones that are
 * genuinely clean, and the two that are not have been removed rather than made to pass.
 */
const CLEAN = [
  "export i32 main() { return 1; }",
  "export i64 w() { return 1; }",
  "export f64 g() { return 1.5; }",
  'export string s() { return "x"; }',
  "export bool t() { return true; }",
  "export void v() { return; }",
  "export i32 add(i32 a, i32 b) { return a + b; }",
];

Deno.test("rung 3: every return-type diagnostic we report, the reference reports in the same place", () => {
  for (const src of WRONG) {
    const mine = ours(src);
    const theirs = reference(src);
    if (mine.length === 0) {
      throw new Error(`we found nothing in ${JSON.stringify(src)}; the reference found ` +
        `${theirs.length}: ${theirs.map((e) => `${e.at} ${e.message}`).join("; ")}`);
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(
          `we report a diagnostic at ${at} that the reference does not, in ${JSON.stringify(src)}.\n` +
            `  reference: ${theirs.map((e) => `${e.at} ${e.message}`).join("; ") || "(nothing)"}`,
        );
      }
    }
  }
});

Deno.test("rung 3: we report nothing for a program the reference accepts", () => {
  for (const src of CLEAN) {
    const theirs = reference(src);
    if (theirs.length !== 0) {
      throw new Error(
        `this case is meant to be clean but the reference rejects it: ${JSON.stringify(src)}\n` +
          `  ${theirs.map((e) => `${e.at} ${e.message}`).join("; ")}`,
      );
    }
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`we invented ${mine.length} diagnostic(s) at ${mine.join(", ")} in ` +
        JSON.stringify(src));
    }
  }
});

Deno.test("rung 3: the whole repo stays silent, which is the property a subset checker can lose", () => {
  // Every `.wac` file in the repo type-checks cleanly — that is what makes it a corpus — so anything
  // we say about one is a false alarm. This is the cheapest way to catch a rule that looked sound on
  // a dozen hand-written cases and is not, and it has already earned itself twice: the missing-return
  // analysis reported six functions in `check.wac` whose body is a single `match` with a return in
  // every arm, because `match` had not been modelled as leaving.
  //
  // Single-file: this slice reports nothing that depends on another module, so the import graph is
  // not needed to know that *we* should be quiet about all of them.
  let checked = 0;
  const complaints: string[] = [];
  const walk = (dir: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(path);
      } else if (entry.name.endsWith(".wac")) {
        const mine = ours(Deno.readTextFileSync(path));
        if (mine.length !== 0) complaints.push(`${path}: ${mine.join(", ")}`);
        checked++;
      }
    }
  };
  walk("packages");
  if (checked < 250) throw new Error(`only ${checked} .wac files checked — the corpus did not load`);
  if (complaints.length !== 0) {
    throw new Error(`we report diagnostics in ${complaints.length} file(s) that type-check ` +
      `cleanly:\n  ${complaints.slice(0, 12).join("\n  ")}`);
  }
});

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
const LITERALS: [string, string][] = [
  ["integer", "1"],
  ["float", "1.5"],
  ["string", '"x"'],
  ["boolean", "true"],
];

Deno.test("rung 3: every primitive against every literal kind, the reference deciding each cell", () => {
  let rejected = 0;
  let caught = 0;
  for (const type of PRIMITIVES) {
    for (const [kind, lit] of LITERALS) {
      const src = `export ${type} f() { return ${lit}; }`;
      const theirs = reference(src);
      const mine = ours(src);

      if (theirs.length === 0) {
        if (mine.length !== 0) {
          throw new Error(`${type} accepts a ${kind} literal, and we reported ${mine.join(", ")}` +
            ` for ${JSON.stringify(src)}`);
        }
        continue;
      }
      rejected++;
      for (const at of mine) {
        if (!theirs.some((e) => e.at === at)) {
          throw new Error(
            `${type} vs ${kind} literal: we report ${at}, the reference reports ` +
              `${theirs.map((e) => e.at).join(", ")} — ${JSON.stringify(src)}`,
          );
        }
      }
      if (mine.length > 0) caught++;
    }
  }
  // 48 cells, 8 accepted: an integer literal from i32/i64/u32/u64, a float from f32/f64, a boolean
  // from bool, a string from string. The four packed types accept nothing, which is why this is 8
  // and not 12 — the count was written as 10 first, against a ten-type list that was missing i8 and
  // i16, and both the grid and the spec corpus have corrected it since.
  //
  // Asserting the shape rather than a bare "some failed": a reference that started accepting
  // everything would otherwise pass this silently, and so would a `reference()` helper that had
  // quietly stopped returning diagnostics.
  if (rejected !== 40) throw new Error(`expected 40 rejected cells of 48, got ${rejected}`);
  if (caught !== rejected) {
    throw new Error(`the reference rejects ${rejected} cells and we catch ${caught}; ` +
      `this slice is meant to catch every literal-return mismatch`);
  }
});

/**
 * The same grid one level up: a returned **name** rather than a returned literal.
 *
 * `return s` where `s` is a parameter needs a scope — the first symbol table in this package — and
 * the grid is the same idea as the literal one, with the reference deciding every cell. It is a
 * stronger test than the literal grid because a name has no intrinsic type: getting this right means
 * the declaration was found and read, not that a token was recognised.
 */
Deno.test("rung 3: a returned parameter, every declared type against every parameter type", () => {
  const usable = PRIMITIVES.filter((t) => !["u8", "u16", "i8", "i16"].includes(t)); // packed: not legal as a return type
  let rejected = 0;
  let caught = 0;
  for (const ret of usable) {
    for (const par of PRIMITIVES) {
      const src = `export ${ret} f(${par} p) { return p; }`;
      const theirs = reference(src);
      const mine = ours(src);
      if (theirs.length === 0) {
        if (mine.length !== 0) {
          throw new Error(`${ret} f(${par} p) is accepted, and we reported ${mine.join(", ")}`);
        }
        continue;
      }
      rejected++;
      for (const at of mine) {
        if (!theirs.some((e) => e.at === at)) {
          throw new Error(`${ret} f(${par} p): we report ${at}, the reference reports ` +
            theirs.map((e) => e.at).join(", "));
        }
      }
      if (mine.length > 0) caught++;
    }
  }
  if (rejected === 0) throw new Error("no cell was rejected — the grid is not being evaluated");
  if (caught !== rejected) {
    throw new Error(`the reference rejects ${rejected} of these and we catch ${caught}`);
  }
});

Deno.test("rung 3: a name this slice cannot resolve is silence, not a guess", () => {
  // Three shapes where the honest answer is nothing, and all three would be easy to get wrong in the
  // direction that matters — a false diagnostic at a position the reference has no diagnostic for.
  const QUIET = [
    // A name from outside the function. There is no cross-module resolution here yet.
    "export i32 fwd() { return later; }",
    // A local shadowing a parameter. wac scopes by block and this slice does not track blocks, so
    // the name is poisoned rather than resolved to whichever declaration was seen last.
    'export i32 sh(i32 a) { if (true) { string a = "x"; } return a; }',
    // Anything that needs an expression typer.
    "export i32 call(i32 a) { return other(a); }",
    "export i32 arith(i32 a, i32 b) { return a + b; }",
  ];
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`we report ${mine.join(", ")} for ${JSON.stringify(src)}, where this slice ` +
        "cannot know the answer");
    }
  }
});

Deno.test("rung 3: a returned local, and a name used before its declaration", () => {
  // Locals are declared in a pass of their own before the body is walked, so a `return` above the
  // declaration still resolves. Both directions are checked because declaring-as-you-walk passes the
  // first and silently fails the second.
  const later = 'export i32 g(bool c) { if (c) { return v; } string v = "x"; return 0; }';
  const theirs = reference(later);
  const mine = ours(later);
  if (theirs.length === 0) throw new Error(`the reference accepts ${JSON.stringify(later)}`);
  if (mine.length === 0) {
    throw new Error("a name declared after its use was not resolved — the declaration pass is not " +
      "running before the check pass");
  }
  for (const at of mine) {
    if (!theirs.some((e) => e.at === at)) {
      throw new Error(`we report ${at}, the reference reports ${theirs.map((e) => e.at).join(", ")}`);
    }
  }
});

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
 *   - **wacc is a subset of it**: silent, or right about the position. Coverage is reported rather
 *     than asserted, because this slice knows about one diagnostic out of roughly 210 and a threshold
 *     would be a number somebody made up.
 */
Deno.test("rung 3: the spec's rejection corpus — the reference honours it, and we never contradict it", () => {
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
      if (!theirs.some((e) => e.at === at)) {
        contradicted++;
        throw new Error(
          `[§${c.tag}] we report a diagnostic at ${at} the reference does not.\n` +
            `  source: ${JSON.stringify(c.src)}\n` +
            `  reference: ${theirs.map((e) => `${e.at} ${e.message}`).join("; ")}`,
        );
      }
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
 * The second kind of thing rung 3 does: control flow, not types.
 *
 * *"not all code paths return a value"* is the largest family in the spec's rejection corpus after
 * plain type mismatches, and it needs no expression typer at all — only the statement walk that was
 * already here. The reference reports it at the **function declaration** rather than at the closing
 * brace, because the fault is the function's and not any one statement's.
 *
 * The interesting rule is `while (true)`. A loop with no exit never reaches the statement after it,
 * so a function ending in one needs no return; give it a reachable `break` and the closing brace is
 * reachable again and a return is required. Four of the spec's seven cases are that, with the break
 * hidden in a block, an `else if`, and a `match` arm.
 */
Deno.test("rung 3: a function that can reach its closing brace, against the reference", () => {
  // Two lists rather than one filtered on `all code paths`. A filter on message text is a second
  // opinion about which diagnostics count — it makes a program the reference rejects for some other
  // reason look accepted, which is how `i32 && i32` sat in the operator test as "left alone".
  const CAUGHT = [
    "i32 bad(bool x) { if (x) { return 1; } }",
    "i32 noElse(bool x) { if (x) { return 1; } else { } }",
    "i32 brk(i32 n) { while (true) { if (n > 0) { break; } n++; } }",
    "i32 deep(i32 n) { while (true) { { break; } } }",
    "i32 elseIf(i32 n) { while (true) { if (n > 10) { n++; } else if (n > 5) { break; } } }",
    "i32 empty() { }",
  ];
  const QUIET = [
    "i32 ok(bool x) { if (x) { return 1; } return 0; }",
    "i32 both(bool x) { if (x) { return 1; } else { return 2; } }",
    "i32 inf(i32 n) { while (true) { n++; } }",
    "i32 nestedBreak(i32 n) { while (true) { while (n > 0) { break; } } }",
    "i32 trapping() { trap; }",
    "void nothing() { }",
    "void early(bool x) { if (x) { return; } }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference wants a return in ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * The same question one position over: a variable's declared type against its initialiser.
 *
 * Reusing the return rules exactly — a literal is polymorphic over a family, a name has one type —
 * which is the point: if the second position needed different rules, one of the two would be wrong.
 *
 * `null` is the new part, and it covers two spellings. `i32 z;` and `i32 x = null;` parse to the same
 * `NullLit` initialiser and the reference gives both *"expected i32, got null"*, so a missing
 * initialiser needs no rule of its own. A `T?` declaration is nullable and legitimately takes one,
 * and `primOfType` answers `primNone` for a nullable type, so those stay silent rather than being
 * wrongly refused.
 */
Deno.test("rung 3: a variable's initialiser against its declared type", () => {
  const CASES = [
    "export void a() { i32 x = null; }",
    "export void b() { i32 z; }",
    "export void c() { i8 x = 5; }",
    'export void d() { i32 x = "s"; }',
    "export void e() { f64 x = 1; }",
    'export void f(string s) { i32 x = s; }',
    "export void g(i64 n) { i32 x = n; }",
    // Accepted, and each is a way the rule could be wrong in the other direction.
    "export void h() { i32 x = 5; }",
    "export void i() { i64 x = 5; }",
    "export void j() { f64 x = 1.5; }",
    "export void k() { i32? n = null; }",
    'export void l() { string s = "x"; }',
    "export void m(i32 a) { i32 b = a; }",
  ];
  for (const src of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    if (theirs.length === 0) {
      if (mine.length !== 0) {
        throw new Error(`the reference accepts ${JSON.stringify(src)} and we report ${mine.join(", ")}`);
      }
      continue;
    }
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
});

/**
 * The operands of `+ - * / %`, which must be the same type.
 *
 * Only those five, and the restraint is the point. Shifts deliberately accept mixed widths —
 * `i64 << i32` is legal, and the friction log records a compiler bug from assuming otherwise — while
 * `&& || & | ^` and the comparisons answer *differently worded* diagnostics when their operands
 * disagree, which a comparison by code would merge with this one. The operators left out cost recall
 * rather than correctness.
 *
 * A literal operand is skipped rather than typed: `x + 1` is legal for any numeric `x`, because the
 * literal takes the other side's type. Demanding they agree would report the code everybody writes.
 */
Deno.test("rung 3: same-type operands, and the operators that answer something else", () => {
  // Two lists, because a subset checker has two obligations and they are not the same one. What this
  // rule owns must be caught, at the reference's position. What it does not own must be silent — and
  // "the reference rejects this and we say nothing" is a *pass* there, not a failure.
  //
  // Splitting them was forced. A single list with "reference rejects it, so we must report" folded
  // both obligations into one and made `i32 == string` a failure for being correctly quiet.
  const CAUGHT = [
    "export f64 bad(i32 x, f64 y) { return x + y; }",
    "export void b2(i32 x, i64 y) { i32 r = x - y; }",
    "export void b3(f64 x, i32 y) { f64 r = x * y; }",
    "export void x1(i32 p, i64 q) { i32 r = p & q; }",
    "export void x2(i32 p, f64 q) { i32 r = p | q; }",
    "export void x3(i32 p, f64 q) { bool r = p < q; }",
    "export void x4(i32 p, i64 q) { bool r = p >= q; }",
    // A mixed comparison against a string. The reference's *message* depends on which side the
    // string is — `i32 == string` is "not allowed on reference type", `string == i32` is a type
    // mismatch — but both sit at the operator, so reporting there is right either way.
    "export void x5(i32 p, string q) { bool r = p == q; }",
    "export void x5b(string p, i32 q) { bool r = p == q; }",
  ];
  const QUIET = [
    // Accepted outright.
    "export i32 ok(i32 x, i32 y) { return x + y; }",
    "export i32 lit(i32 x) { return x + 1; }",
    "export void sh(i64 a, i32 b) { i64 r = a << b; }",
    "export void sh2(i32 a, i32 b) { i32 r = a >> b; }",
    "export void x7(bool p, bool q) { bool r = p || q; }",
    // Two strings compared is *allowed*, and stays silent because the two agree — not because of any
    // rule about strings. Both spellings, since an earlier version had a rule about strings and this
    // is what it would break.
    "export void x8(string p, string q) { bool r = p == q; }",
    "export void x9(string p, string q) { bool r = p < q; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects the operands of ${JSON.stringify(src)} and we said ` +
        "nothing: " + theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * A call's arguments against the parameters of what it calls.
 *
 * The first table in this checker that outlives one function: a call names something declared
 * elsewhere in the file, often further down, so signatures are collected in a pass of their own — the
 * same argument as collecting locals before walking a body, one scope up.
 *
 * `g(a)` is a **Construct**, not a Call. The parser cannot tell a call from a struct construction —
 * `Point(1, 2)` and `g(a)` are the same syntax — so both are `Construct` with a `Named` type and the
 * resolver decides later. A checker matching `case Call` reports nothing at all, which is what the
 * first version of this did.
 *
 * Arity is left to the reference, which answers it with its own message; pairing arguments with
 * parameters positionally when the counts differ would report the wrong ones anyway.
 */
Deno.test("rung 3: a call's arguments against its parameters", () => {
  const CAUGHT = [
    "f64 g(f64 x) { return x; } export f64 bad(f32 a) { return g(a); }",
    'i32 g(i32 x) { return x; } export i32 sl() { return g("s"); }',
    "i32 g(i32 x) { return x; } export i32 tw(i64 a) { return g(a); }",
    // Arity, which is a rule of its own: one complaint about the call rather than one per argument
    // that happened to line up with the wrong parameter. All three directions.
    "i32 g(i32 a, i32 b) { return a; } export i32 ar() { return g(1); }",
    "i32 g() { return 1; } export i32 ar2() { return g(1); }",
    "i32 g(i32 a) { return a; } export i32 ar3() { return g(1, 2); }",
  ];
  const QUIET = [
    "i32 g(i32 x) { return x; } export i32 ok(i32 a) { return g(a); }",
    "i32 g(i32 x) { return x; } export i32 lit() { return g(1); }",
    "i64 g(i64 x) { return x; } export i64 wide() { return g(1); }",
    // A struct construction is the same syntax as a call and must not be read as one.
    "struct P { i32 x; } export i32 st() { P p = P(1); return p.x; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects the arguments of ${JSON.stringify(src)} and we said ` +
        "nothing: " + theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * Where only a boolean will do.
 *
 * Two of the reference's messages and one rule: *"'&&' requires bool operands, got i32"* and
 * *"condition must be bool"*. Both say an expression is used where only a boolean can go, and
 * nothing a caller does with the diagnostic would tell them apart, so they share a code.
 *
 * Different from the same-type rule above in a way worth stating: here a **literal counts**. `p && 1`
 * is an error and `p && true` is not, because the question is what each operand *is* rather than
 * whether the two agree — and unlike `x + 1`, there is no other side for the literal to take its type
 * from.
 */
Deno.test("rung 3: operands and conditions that have to be boolean", () => {
  const CASES = [
    "export void a(i32 p, bool q) { bool r = p && q; }",
    "export void b(bool p, i32 q) { bool r = p || q; }",
    "export void c(bool p) { bool r = p && 1; }",
    "export void d(i32 p) { if (p) { } }",
    "export void e2(i32 p) { while (p) { } }",
    "export i32 rejected(i32 x) { if (x) { return 1; } return 0; }",
    // Accepted.
    "export void f(bool p) { bool r = p && true; }",
    "export void g(bool p, bool q) { bool r = p || q; }",
    "export void h(bool p) { if (p) { } }",
    "export void i(i32 p) { if (p > 0) { } }",
  ];
  for (const src of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    if (theirs.length === 0) {
      if (mine.length !== 0) {
        throw new Error(`the reference accepts ${JSON.stringify(src)} and we report ${mine.join(", ")}`);
      }
      continue;
    }
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
});

/**
 * Types that are not primitives.
 *
 * The checker's type model was a small integer per primitive, which was enough while every type was
 * one. A type is its canonical **name** now — `"i32"`, `"P"`, `""` for unknown — which costs a string
 * compare where an id cost an integer one and buys the rest of the type system: two struct types
 * differ exactly when their names do.
 *
 * That alone made the return and initialiser rules work for structs, with no new rule. What is new is
 * identity: `==` and `!=` are not allowed on a struct at all, *even when both sides are the same
 * struct*, because the question is identity rather than equality. `string` is the exception the
 * language makes, so the rule asks about the name rather than about reference-ness.
 *
 * Restricted to structs **declared in this file**. An enum, an imported type or a generic parameter
 * is also not a primitive, and nobody has measured what the reference says about comparing those — so
 * they stay unknown rather than being swept in by a rule about everything else.
 */
Deno.test("rung 3: struct types, and identity rather than equality", () => {
  const D = "struct P { i32 x; } struct Q { i32 y; } ";
  const CAUGHT = [
    D + "export void a(P p, Q q) { bool r = p == q; }",
    D + "export void b(P p, P q) { bool r = p == q; }",
    D + "export void b2(P p, P q) { bool r = p != q; }",
    D + "export P c(Q q) { return q; }",
    D + "export void d(P p) { Q q = p; }",
    D + "export void e2() { P p = null; }",
  ];
  const QUIET = [
    D + "export void f(P p) { P q = p; }",
    D + "export P g(P p) { return p; }",
    // Two strings compare by value: the language's exception, and the reason this asks about the
    // name rather than about reference-ness.
    "export void h(string a, string b) { bool r = a == b; }",
    // A void function has no value to return and must not be asked for one. Under the old model
    // `void` came back as "unknown" and was excluded by accident; now it is excluded on purpose.
    "export void i() { }",
    "export void j(bool c) { if (c) { return; } }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * Arrays and nullables, which are names built from the name inside.
 *
 * `i32[]` and `P?` spell out, so the existing rules reach them: two array types differ exactly when
 * their element types do. An element this slice cannot spell makes the whole thing unspellable rather
 * than half-named — `Box<i32>[]` is not `[]`.
 *
 * Nullables needed a rule rather than a name, because assignment is not symmetric. A non-null value
 * goes into a nullable slot (`P? q = p;` is legal for a `P`), and the other direction is rejected
 * under a *different* message — `cannot assign nullable to non-null` — which this slice does not own
 * and stays quiet about. A `T?` also takes whatever `T` takes: `i32? n = null;` and `i32? n = 5;` are
 * both legal.
 */
Deno.test("rung 3: arrays and nullables", () => {
  const D = "struct P { i32 x; } ";
  const CAUGHT = [
    "export void a(i32[] x) { i64[] y = x; }",
    "export void b(i32[] x) { i32 y = x; }",
    "export void c(i32[] x, i32[] y) { bool r = x == y; }",
    D + "export void d(P[] x) { bool r = x == x; }",
  ];
  const QUIET = [
    "export void e2(i32[] x) { i32[] y = x; }",
    "export void f() { i32? n = null; }",
    "export void g() { i32? n = 5; }",
    D + "export void h(P p) { P? q = p; }",
    "export void j(i32? a) { i32? b = a; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * Member access, typed from the struct's field declarations.
 *
 * The largest widening of what an expression can be typed from since names arrived: `p.x` has a type
 * now, so every rule already built reaches field reads without knowing anything about fields. The
 * receiver is typed by the same function, so `a.b.c` works by recursion for as long as every step is
 * nameable.
 *
 * Inheritance is one hop per lookup up the `parentTok` chain, bounded by the number of structs so a
 * cycle — which the reference rejects separately — terminates rather than hangs.
 *
 * A field the chain does not have is **unknown**, not an error: *"struct 'P' has no field 'nope'"* is
 * the reference's own diagnostic and a family this slice does not own.
 */
Deno.test("rung 3: member access, and fields inherited from a parent", () => {
  const D = "struct P { i32 x; string s; } struct B { i32 b; } struct C : B { f64 c; } ";
  const CAUGHT = [
    "export string a(P p) { return p.x; }",
    "export void c(P p) { string t = p.x; }",
    "export f64 d(C q) { return q.b; }",
    "export void f(P p) { i32 n = p.s; }",
    "export void g(P p, i32 n) { i32 r = p.s + n; }",
  ];
  const QUIET = [
    "export i32 b(P p) { return p.x; }",
    "export i32 e2(C q) { return q.b; }",
    "export f64 h(C q) { return q.c; }",
    "export string i(P p) { return p.s; }",
    // An unknown field is the reference's own diagnostic and not this rule's.
    "export i32 j(P p) { return p.nope; }",
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
      throw new Error(`${JSON.stringify(t)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * Method bodies, which were not walked at all.
 *
 * Every rule this checker has stopped at the edge of a struct: `checkProgram` descended into `Func`
 * declarations and nothing else, so a method's returns, initialisers, operands and conditions went
 * entirely unchecked. That is a bigger hole than any single rule, and it was invisible because every
 * hand-written case in this file is a free function.
 *
 * `this` is an ordinary `Ident` whose text is `this`, so typing it is one entry in the scope — the
 * struct's own name — and `this.x` then resolves through the field table that already existed. A
 * method without `this` is static, and `this` means nothing in it.
 *
 * Missing return is reported at the **return type**. A `Method` carries no position of its own, and
 * the return type is the first thing it has that does, which is also where the reference puts it.
 */
Deno.test("rung 3: method bodies, and this", () => {
  const CAUGHT = [
    "struct P { i32 x; string bad(this) { return this.x; } }",
    "struct P { i32 x; void v(this, string s) { i32 n = s; } }",
    "struct P { i32 x; i32 sh(this, bool c) { if (c) { return 1; } } }",
    "struct P { i32 x; string s; void w(this) { i32 n = this.s; } }",
    "struct P { i32 x; bool cmp(this, P other) { return this == other; } }",
  ];
  const QUIET = [
    "struct P { i32 x; i32 ok(this) { return this.x; } }",
    "struct P { i32 x; i32 st() { return 1; } }",
    "struct P { i32 x; void nov(this) { } }",
    "struct P { i32 x; i32 arg(this, i32 n) { return n; } }",
    // `this` in a static method is not the struct — it is nothing, and must not resolve.
    "struct P { i32 x; i32 stat(i32 this2) { return this2; } }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * Assignment, which no rule reached.
 *
 * The initialiser question with the declared type coming from the *target* rather than from a `Ty`
 * node — so it needed an lvalue walk, which is its own node family: a name, a field of one, an
 * element of one, or an unwrapped nullable. `LIndex` is the one place a type gets narrower going
 * down the tree (`i32[]` to `i32`), and `LUnwrap` the other (`T?` to `T`).
 *
 * Only plain `=`. A compound assignment is the operator's rule rather than this one — the reference
 * accepts `n += 1` for an `i32` exactly as it accepts `n + 1` — and folding the two would report the
 * literal cases that rule deliberately skips.
 */
Deno.test("rung 3: assignment, through names, fields and elements", () => {
  const D = "struct P { i32 x; string s; } ";
  const CAUGHT = [
    "export void a(i32 n, string t) { n = t; }",
    "export void c(i32 n) { n = 1.5; }",
    "export void f(i32 n, i64 m) { n = m; }",
    D + "export void d(P p, string t) { p.x = t; }",
    "export void e2(i32[] a, string t) { a[0] = t; }",
    D + "export void h(P p, i32 n) { p.s = n; }",
  ];
  const QUIET = [
    "export void b(i32 n) { n = 5; }",
    "export void i(i64 n) { n = 5; }",
    "export void j(i32 n, i32 m) { n = m; }",
    D + "export void k(P p) { p.x = 1; }",
    "export void l(i32[] a) { a[0] = 1; }",
    // Compound assignment belongs to the operator rule, which skips literals on purpose.
    "export void g(i32 n) { n += 1; }",
    "export void m(i32 n, i32 o) { n += o; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is accepted and we said ${mine.join(", ")}`);
    }
  }
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

Deno.test("rung 3: every expression form, against every return type", () => {
  const D = 'struct P { i32 x; } i32 fi() { return 1; } string fs() { return "a"; } ';
  const PARAMS = "i32 n, i64 m, bool b, P p, i32[] arr, i32? opt";
  let cells = 0;
  let rejected = 0;
  let caught = 0;
  for (const [label, expr] of FORMS) {
    for (const ret of ["i32", "i64", "bool", "string", "f64", "P"]) {
      const src = `${D}export ${ret} probe(${PARAMS}) { return ${expr}; }`;
      const theirs = reference(src);
      const mine = ours(src);
      cells++;
      if (theirs.length === 0) {
        if (mine.length !== 0) {
          throw new Error(`${label} is a valid ${ret} and we report ${mine.join(", ")} — ` +
            JSON.stringify(src));
        }
        continue;
      }
      rejected++;
      for (const at of mine) {
        if (!theirs.some((e) => e.at === at)) {
          throw new Error(`${label} into ${ret}: we report ${at}, the reference reports ` +
            theirs.map((e) => `${e.at} ${e.message}`).join("; "));
        }
      }
      if (mine.length > 0) caught++;
    }
  }
  if (cells !== FORMS.length * 6) throw new Error(`grid did not run: ${cells} cells`);
  if (rejected < 60) throw new Error(`only ${rejected} rejected cells — the grid is too easy`);
  // **Asserted, not reported.** Every form in the list above is typed, so every rejection in this
  // grid is one this slice owns and every one must be caught. Reporting the number instead was the
  // first version, and untyping casts moved it from 65 to 50 without failing anything — a recall
  // regression that printed itself and passed. If a form is ever deliberately left untyped, it comes
  // out of `FORMS` and the removal is the decision, rather than a count quietly dropping.
  if (caught !== rejected) {
    throw new Error(`the reference rejects ${rejected} of ${cells} cells and we catch ${caught}; ` +
      "every form in FORMS is meant to be typed");
  }
  console.error(`    expression grid: ${cells} cells, ${rejected} rejected, all caught`);
});

/**
 * Struct construction, argument by argument against the fields they fill.
 *
 * Positional only, and only when the arity matches — both the reference's restrictions rather than
 * conveniences. A wrong count is *"positional construction of 'P' expects 2 arguments"*, its own
 * family. And `P(x: 1)` is **not** named-argument syntax: the reference answers *"expects 2
 * arguments"* and *"undefined variable 'x'"*, so whatever that spelling means it is not this, and
 * assuming otherwise would have produced a rule for something the language does not have.
 *
 * Inherited fields come **first**, which is measured rather than guessed: `C(1.0, 2.0)` for
 * `struct C : B` puts the reference's complaint on the first argument, where `B`'s `i32 b` is.
 */
Deno.test("rung 3: struct construction against field types", () => {
  const D = "struct P { i32 x; string s; } struct B { i32 b; } struct C : B { f64 c; } ";
  const CAUGHT = [
    'export void b() { P p = P("y", 1); }',
    "export void g() { C q = C(1.0, 2.0); }",
    'export void k(i64 n) { P p = P(n, "y"); }',
    "export void l(string t) { C q = C(1, t); }",
    // Arity is a family of its own rather than this rule, but it is implemented now, so these are no
    // longer silent — and what they assert here is that the two rules do not fight: a wrong count is
    // reported once, at the construction, and not also as a field mismatch.
    "export void c() { P p = P(1); }",
    'export void m() { P p = P(1, "y", 3); }',
  ];
  const QUIET = [
    'export void a() { P p = P(1, "y"); }',
    "export void f() { C q = C(1, 2.0); }",
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
      throw new Error(`${JSON.stringify(t)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * A nullable value where a non-null one is required.
 *
 * Its own diagnostic rather than a type mismatch, because the reference words it that way — *"cannot
 * assign nullable to non-null"* — and a caller can tell them apart: one says the types are unrelated,
 * the other says they are the same type and one of them might not be there.
 *
 * `assignable` still answers `true` for this shape, so the mismatch rules stay quiet and exactly one
 * diagnostic lands at the position rather than two.
 */
Deno.test("rung 3: nullable into non-null, in every position that assigns", () => {
  const D = "struct P { i32 x; } i32 takes(i32 n) { return n; } ";
  const CAUGHT = [
    "export void a(P? p) { P q = p; }",
    "export P b(P? p) { return p; }",
    "export void c(P? p, P q) { q = p; }",
    "export void d(i32? n) { i32 m = n; }",
    "export i32 e2(i32? n) { return takes(n); }",
  ];
  const QUIET = [
    // Unwrapped, which is the whole point of `!`.
    "export void f(P? p) { P q = p!; }",
    "export i32 g(i32? n) { return n!; }",
    // The other direction widens and is legal.
    "export void h(P p) { P? q = p; }",
    "export void i(P? p) { P? q = p; }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(D + src);
    const mine = ours(D + src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(D + src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src)} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * The const family: three refusals, kept apart because the reference keeps them apart.
 *
 * *"cannot assign to const variable 'n'"*, *"cannot write to const field 'k'"* and *"cannot write
 * through const reference"* say different things about where the constness lives — on the binding, on
 * the field, or on the path to it — and a caller fixing one would not fix the others.
 *
 * Every write counts, not just `=`: `n += 1` and `n++` are refused on a const exactly as `n = 1` is.
 *
 * All three report at the **root of the path**, which is measured rather than assumed: for
 * `p.k = 1` the reference names the `p`, not the field node one column later. Reporting at the node
 * that is actually const would have been the obvious choice and is off by one against every compound
 * target.
 */
Deno.test("rung 3: const variables, const fields and const references", () => {
  const D = "struct P { i32 x; const i32 k; } struct Q { P p; } ";
  const CAUGHT = [
    "export void a() { const i32 n = 1; n = 2; }",
    "export void b() { const i32 n = 1; n += 1; }",
    "export void c() { const i32 n = 1; n++; }",
    "export void h(const i32 n) { n = 2; }",
    "export void e2(P p) { p.k = 1; }",
    "export void g(const P p) { p.x = 1; }",
    "export void n(const Q q) { q.p.x = 1; }",
    "export void o(const i32[] a) { a[0] = 1; }",
  ];
  const QUIET = [
    "export void d() { i32 n = 1; n = 2; }",
    "export void f(P p) { p.x = 1; }",
    "export void i(i32 n) { n = 2; }",
    "export void j(Q q) { q.p.x = 1; }",
    "export void k2(i32[] a) { a[0] = 1; }",
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

Deno.test("rung 3: a const this refuses writes through the receiver", () => {
  // The same rule as a `const P p` parameter, reusing it exactly: `this` is declared with the
  // method's own constness, and everything else follows.
  const bad = "struct R { i32 y; void w(const this) { this.y = 1; } }";
  const good = "struct R { i32 y; void w(this) { this.y = 1; } }";
  const theirs = reference(bad);
  const mine = ours(bad);
  if (mine.length === 0) {
    throw new Error("a write through a const this was not refused: " +
      theirs.map((e) => `${e.at} ${e.message}`).join("; "));
  }
  for (const at of mine) {
    if (!theirs.some((e) => e.at === at)) {
      throw new Error(`we report ${at}, the reference reports ${theirs.map((e) => e.at).join(", ")}`);
    }
  }
  if (ours(good).length !== 0) throw new Error("a non-const method may write through this");
});

/**
 * Method calls: does the struct have it, and may this receiver call it?
 *
 * Static and instance calls are the same syntax — `P.mk()` and `p.mk()` differ only in whether the
 * receiver names a struct or a value — so the receiver decides which question is asked, and a local
 * shadowing a struct name is a value, which is why the scope is consulted first.
 *
 * Three things had to be excluded, and all three were found by the corpus rather than reasoned out:
 *
 *   - a **generic**'s methods are not recorded, so an empty answer means "not modelled" rather than
 *     "not there" — `this.hash(k)` inside `Map<K, V>` is an ordinary call;
 *   - a **funcref field** is called like a method: `sh.externalNames()` calls a field, and four of
 *     them live in `packages/sh`;
 *   - and a field's *existence* is the question there, not its type — a funcref field has no name
 *     this slice can spell, so asking its type says "no such field" about a field that is right
 *     there.
 */
Deno.test("rung 3: method calls, static and through a const receiver", () => {
  const D = "struct P { i32 x; i32 get(const this) { return this.x; } " +
    "void set(this, i32 v) { this.x = v; } i32 mk() { return 1; } } ";
  const CAUGHT = [
    "export void a(const P p) { p.set(1); }",
    "export i32 e2() { return P.nope(); }",
    "export i32 f(P p) { return p.nope(); }",
    // A static called on an instance, and an instance called on the struct.
    "export i32 h(P p) { return p.mk(); }",
    "export i32 i() { return P.get(); }",
  ];
  const QUIET = [
    "export i32 b(const P p) { return p.get(); }",
    "export void c(P p) { p.set(1); }",
    "export i32 d() { return P.mk(); }",
    "export i32 j(P p) { return p.get(); }",
    // A generic's methods are not modelled, so nothing is said about them.
    "struct Box<T> { T v; i32 get(const this) { return 1; } } export i32 k2() { return 1; }",
  ];
  for (const t of CAUGHT) {
    const src = t.startsWith("struct") ? t : D + t;
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
    const src = t.startsWith("struct") ? t : D + t;
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(t)} is not this rule's to report, and we said ` +
        mine.join(", "));
    }
  }
});

/**
 * Every conversion against every cast operator, with the reference deciding each cell.
 *
 * `losslessCast` and `rawCast` in the checker are **tables**, not formulas, because no formula fits.
 * `u32 -> u64` is lossless and `i32 -> u64` is not, since the first cannot be negative;
 * `f32 -> f64` is and `i64 -> f64` is not, since 53 bits of mantissa do not hold 64 of integer; and
 * `as@` is close to "an integer target no wider than the source" except for `f64 -> i64`, which the
 * reference refuses while allowing `f64 -> i32`. A rule invented to cover most of that would be wrong
 * about the rest.
 *
 * So the tables are carried, and this re-derives them from the reference on every run. That is the
 * arrangement for anything measured rather than reasoned: the table is the implementation, the grid
 * is the proof, and drift in the language fails here rather than being discovered later.
 */
Deno.test("rung 3: every conversion against every cast operator", () => {
  const TYPES = ["i32", "u32", "i64", "u64", "f32", "f64"];
  const OPS = ["as", "as!", "as~", "as@"];
  let cells = 0;
  let rejected = 0;
  let caught = 0;
  for (const from of TYPES) {
    for (const to of TYPES) {
      if (from === to) continue;
      for (const op of OPS) {
        const src = `export ${to} f(${from} x) { return x ${op} ${to}; }`;
        const theirs = reference(src);
        const mine = ours(src);
        cells++;
        if (theirs.length === 0) {
          if (mine.length !== 0) {
            throw new Error(`${from} ${op} ${to} is accepted and we report ${mine.join(", ")}`);
          }
          continue;
        }
        rejected++;
        for (const at of mine) {
          if (!theirs.some((e) => e.at === at)) {
            throw new Error(`${from} ${op} ${to}: we report ${at}, the reference reports ` +
              theirs.map((e) => `${e.at} ${e.message}`).join("; "));
          }
        }
        if (mine.length > 0) caught++;
      }
    }
  }
  if (cells !== 120) throw new Error(`${cells} cells, expected 120`);
  if (caught !== rejected) {
    throw new Error(`the reference rejects ${rejected} of ${cells} conversions and we catch ` +
      `${caught}; the tables in check.wac have drifted from the language`);
  }
  console.error(`    cast grid: ${cells} cells, ${rejected} rejected, all caught`);
});

/**
 * Two things the method rules had wrong, both found by re-tallying what the corpus still misses.
 *
 * **Statics are not inherited.** `Sub.make()` is an error even when `Base` declares `make` and `Sub`
 * extends it — *"struct 'Sub' has no static method 'make'"*. That is the opposite of instance
 * methods, which are inherited, and a single lookup with a flag would have got one of them wrong.
 *
 * **Constness travels through field access.** `this.inner.mutate()` inside a `const this` method is
 * refused, and seeing that means following the receiver rather than looking only at a plain name.
 *
 * What is still uncaught, on purpose: `Counter c = this; c.mutate();`, which the reference also
 * refuses. Knowing that needs to track where `c` came from — flow analysis rather than a walk — and
 * uncaught is the safe direction.
 */
Deno.test("rung 3: statics do not inherit, and constness follows the receiver", () => {
  const CAUGHT = [
    "struct Base { i32 b; Base make() { return Base(1); } } struct Sub : Base { i32 e2; } " +
      "export void bad() { Sub s = Sub.make(); }",
    "struct Inner { i32 v; void mutate(this) { this.v = 1; } } " +
      "struct Outer { Inner inner; void tryMutate(const this) { this.inner.mutate(); } }",
  ];
  const QUIET = [
    // An instance method *is* inherited.
    "struct Base { i32 b; i32 get(const this) { return this.b; } } struct Sub : Base { i32 e2; } " +
      "export i32 ok(Sub s) { return s.get(); }",
    // A static on the struct that declares it.
    "struct Base { i32 b; Base make() { return Base(1); } } export void ok2() { Base b = Base.make(); }",
    // Non-const receiver, deep.
    "struct Inner { i32 v; void mutate(this) { this.v = 1; } } " +
      "struct Outer { Inner inner; void ok3(this) { this.inner.mutate(); } }",
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

// Three families that share nothing but the slot they were found in: an array literal's elements,
// a parameter list read for its own sake, and a scope wider than a function. The last is why the
// other two arrived late — nothing before this walked a declaration that was not a body.
Deno.test("rung 3: array elements, duplicate parameters, and module-level consts", () => {
  const CAUGHT = [
    // Elements and fills carry the element type, not their own.
    "export void f() { i8[] b = i8[](1.5); }",
    "export void f() { i32[] b = i32[](, 1); }",
    "struct E { i32 v; } export void f() { E[] e = E[2](fill: 5); }",
    // A parameter list is checked without looking at a single use.
    "export void f(i32 a, i32 a) { }",
    "struct S { i32 v; void m(this, i32 a, f64 a) { } }",
    // A module-level const is const everywhere, including through a field.
    "const i32 K = 1; export void f() { K = 2; }",
    "struct P { i32 v; } const P S = P(1); export void f() { S.v = 9; }",
  ];
  const QUIET = [
    // The element type accepts a literal the same way an initialiser does.
    "export void f() { i8[] b = i8[](1); }",
    // An integer literal widens to `i64` but not to `f64` — an element is no more permissive than
    // an initialiser, and `f64[2](fill: 1)` is a mismatch for the same reason `f64 x = 1` is.
    "export void f() { i64[] b = i64[](1); }",
    "export void f() { f64[] b = f64[2](fill: 1.0); }",
    "struct E { i32 v; } export void f() { E[] e = E[2](fill: E(1)); }",
    // Two names that only look alike, and a shadow in an inner scope rather than a repeat.
    "export void f(i32 a, i32 b) { }",
    "struct S { i32 v; void m(this, i32 a) { } void n(this, i32 a) { } }",
    // Reading a module-level const, and a local of the same name in a body.
    "const i32 K = 1; export i32 f() { return K; }",
    "struct P { i32 v; } const P S = P(1); export i32 f() { return S.v; }",
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

// The builtin surface on primitive types, which no signature in a file describes. This was the
// largest single uncaught cluster: a receiver that is a type name but not a struct was silently
// skipped by every rule, so `f64.nope()` and `string.fromBytes(5)` both passed unremarked.
Deno.test("rung 3: builtin statics and methods on primitive types", () => {
  const CAUGHT = [
    // Arity, at the call.
    "export string bad() { return string.fromCodepoint(); }",
    "export string bad() { return string.fromBytes(); }",
    "export u64 bad() { return f64.toBits(); }",
    "export i32 bad() { return \"hi\".toBytes(1).len(); }",
    // Argument type, at the argument. Exact, not assignable: an f32 widens to an f64 everywhere
    // else, and still cannot be the argument of `f32.toBits`.
    "export string bad() { return string.fromCodepoint(1.5); }",
    "export f64 bad() { return f64.fromBits(1.0); }",
    "export u32 bad(f64 x) { return f32.toBits(x); }",
    "export f32 bad(u64 b) { return f32.fromBits(b); }",
    "export string bad() { return string.fromBytes(5); }",
    "export string bad(i8[] b) { return string.fromBytes(b); }",
    // A name that is not on the surface at all.
    "export void bad() { f64.nope(1.0); }",
    "export void bad() { string.nosuch(1); }",
  ];
  const QUIET = [
    "export string ok() { return string.fromCodepoint(65); }",
    "export string ok(u8[] b) { return string.fromBytes(b); }",
    "export u64 ok(f64 x) { return f64.toBits(x); }",
    "export f64 ok(u64 b) { return f64.fromBits(b); }",
    "export u32 ok(f32 x) { return f32.toBits(x); }",
    "export f32 ok(u32 b) { return f32.fromBits(b); }",
    "export i32 ok() { return \"hi\".toBytes().len(); }",
    // A local of that name is a variable, not a type: the scope is consulted before the surface.
    "export i32 ok(i32 f64) { return f64; }",
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
 * in it, which is why the checker carries a loop depth at all. Switches count for both — including
 * `continue`, which the reference accepts inside one despite a message that says otherwise. Measured,
 * not inferred: the message is not the rule.
 */
Deno.test("rung 3: arity, loop depth, representation, and compile-time constants", () => {
  const CAUGHT = [
    // `break` and `continue` with nothing to leave.
    "export void f() { break; }",
    "export void f() { continue; }",
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
    // Every enclosing form that makes `break` legal, and `continue` in a switch, which the reference
    // accepts. A checker that read the message instead of measuring would have rejected this one.
    "export void f() { while (true) { break; } }",
    "export void f() { for (i32 i = 0; i < 2; i++) { continue; } }",
    "export void f(i32 x) { switch (x) { case 1: break; } }",
    "export void f(i32 x) { switch (x) { case 1: continue; } }",
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
