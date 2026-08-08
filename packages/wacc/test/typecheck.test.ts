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
  ];
  const QUIET = [
    "i32 g(i32 x) { return x; } export i32 ok(i32 a) { return g(a); }",
    "i32 g(i32 x) { return x; } export i32 lit() { return g(1); }",
    "i64 g(i64 x) { return x; } export i64 wide() { return g(1); }",
    // Arity: the reference complains with its own message and we deliberately do not, which is a
    // pass for a subset checker rather than a failure.
    "i32 g(i32 a, i32 b) { return a; } export i32 ar() { return g(1); }",
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
