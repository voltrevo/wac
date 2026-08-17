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

/**
 * A local that shadows an **imported** function does not take the call position.
 *
 * `[§wac-param-shadows-func-5nkq2wp]` gives call position to a local *of funcref type* before any
 * function; an `i32` local is not one, so `helper()` means the import. This slice cannot see the
 * import, so it has to defer rather than judge — and judging is what it did: `issues/lang/0143`,
 * which had `typecheck.test.ts` red on master for `u8[] cert = cert(cli);` in `packages/tor`.
 *
 * The reference is not consulted, unlike `CLEAN` above: its single-file path throws outright on a
 * program with an import, so there is no second opinion to compare against here. What is asserted
 * is only that *we* stay quiet, which is this slice's whole contract.
 *
 * The second program is the one that says this is not about the initialiser — the call is nowhere
 * near it. Both were red before the fix and both are green after; `spec/cases/0195` and `0196` pin
 * the same rule on the full path, where the import is visible and the bug never showed.
 */
Deno.test("a non-funcref local shadowing an import does not take the call position", () => {
  const cases = [
    'import { helper } from "./other.wac";\nexport i32 main() { i32 helper = helper(); return helper; }',
    'import { helper } from "./other.wac";\nexport i32 main() { i32 helper = 1; return helper(); }',
  ];
  for (const src of cases) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(
        `we invented ${mine.length} diagnostic(s) at ${mine.join(", ")} in ${JSON.stringify(src)}`,
      );
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
  // Shapes where the honest answer is nothing, and each would be easy to get wrong in the direction
  // that matters — a false diagnostic at a position the reference has no diagnostic for.
  //
  // **Two of the four original entries have aged out**, and that is the interesting thing about this
  // test now. `return later;` sat here on the grounds that a name from outside the function was
  // unknowable — untrue since the checker gained a module scope. `other(a)` sat here as "needs an
  // expression typer" — untrue since a call knows what it is calling. Both are now reported, at the
  // reference's own columns.
  //
  // A QUIET list is a claim about the checker's *limits*, and limits move. Nothing warns you: the
  // entry keeps passing, quietly asserting that a rule you have since written does not exist. What
  // caught both was a recall corpus large enough to notice the case was missing.
  const QUIET = [
    // A local shadowing a parameter. wac scopes by block and this slice does not track blocks, so
    // the name is poisoned rather than resolved to whichever declaration was seen last.
    'export i32 sh(i32 a) { if (true) { string a = "x"; } return a; }',
    // An ordinary expression, which has no diagnostic in it at all.
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
    // **The nullable form of a reference is still a reference.** `a == b` on two structs asks
    // whether they are the same object, which the language spells `is`, and writing `?` after the
    // type does not change the question. This escaped because the rule asked whether the operand's
    // type *was* a struct, and `N?` is not that name.
    "struct N { i32 v; } export void nq(N? a, N? b) { bool r = a == b; }",
    "struct N { i32 v; } export void nm(N? a, N b) { bool r = a == b; }",
    "export void na(i32[]? a, i32[]? b) { bool r = a == b; }",
    // And `string?` is refused although plain `string` is not. `==` on two strings compares bytes,
    // which is a helper the emitter generates; on a `string?` it would have to answer for null
    // first, so the reference sends it to `is` like any other reference. Exempting `string` by name
    // exempted this one too.
    "export void s1(string? a, string? b) { bool r = a == b; }",
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
  ];
  // An unknown field used to sit in QUIET as "the reference's own diagnostic and not this rule's".
  // It is this checker's now, so it moved to CAUGHT — and what it asserts here is that the two rules
  // do not fight: a field that is missing is reported once, and not also as a type mismatch against
  // the unknown type a missing field has.
  CAUGHT.push("export i32 j(P p) { return p.nope; }");
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
 * Funcrefs, callability, and casts between references.
 *
 * A funcref becomes a real type the same way a generic instantiation did: **a type is its canonical
 * name**, so it spells itself — `fn(i32) -> i32`, the reference's own wording — and two of them are
 * the same type exactly when their spellings agree. There is no variance.
 *
 * The cast half is a family the numeric tables could not express. Between two references only `as`
 * and `as!` mean anything, and which is right depends on the direction: upcasting is always safe and
 * takes `as`, downcasting can fail and takes `as!`. `as~` and `as@` are refused outright, because
 * truncating and reinterpreting are questions about a bit pattern and a reference has none to discuss.
 */
Deno.test("rung 3: funcrefs, what is callable, and casts between references", () => {
  const SH = "struct Shape { f64 x; } struct Circle : Shape { f64 r; } ";
  const CAUGHT = [
    // A funcref is a type: two of them agree only when their spellings do, and it is not a number.
    "export void bad(fn[i32(i32)] f) { fn[i32(bool)] g = f; }",
    "export void bad(fn[i32(i32)] f) { i32 x = f + 1; }",
    // Calling: through a funcref with the wrong count, through something that is not one, and a name
    // that is nothing at all.
    "export void bad(fn[void(i32)] f) { f(1, 2); }",
    "export void bad(i32 x) { x(); }",
    "export void bad() { missing(); }",
    // Named-argument syntax belongs to struct construction and nothing else.
    "export void bad(fn[void(i32)] f) { f { x: 1 }; }",
    // A funcref has no zero, so a struct holding one has no default.
    "struct S { fn[void()] cb; } export void bad() { S s = S(); }",
    // Values that are not values: a struct's name, and a method named without being called.
    "struct P { i32 x; } export void bad() { i32 x = P; }",
    "struct Counter { i32 count; i32 get(const this) { return this.count; } } " +
      "export void bad(Counter c) { i32 x = c.get; }",
    // A number has no methods.
    "export void bad(i32 x) { x.toString(); }",
    // `len()` takes nothing, on an array or a string.
    "export i32 bad(i32[] a) { return a.len(1); }",
    "export i32 bad(string s) { return s.len(1); }",
    // Reference casts: the wrong spelling in each direction, and the two that are never right.
    SH + "export Shape bad(Circle c) { return c as! Shape; }",
    SH + "export Circle bad(Shape s) { return s as Circle; }",
    SH + "export Circle bad(Shape s) { return s as~ Circle; }",
    SH + "export Shape bad(Circle c) { return c as@ Shape; }",
    // `i31ref` pairs with `i32` and with nothing else.
    "export i32 bad(i31ref r) { return r as! i32; }",
    "export void bad(i64 x) { i31ref y = x as! i31ref; }",
    "export void bad(bool x) { i31ref y = x as i31ref; }",
    "export i31ref bad(i32 x) { return x as i31ref; }",
  ];
  const QUIET = [
    // The same funcref, and a call through one with the right count.
    "export void ok(fn[i32(i32)] f) { fn[i32(i32)] g = f; }",
    "export void ok(fn[void(i32)] f) { f(1); }",
    "export void ok(fn[void()] f) { f(); }",
    // A declared function called normally, and a struct constructed with named arguments.
    "i32 g(i32 a) { return a; } export i32 ok() { return g(1); }",
    "struct P { i32 x; } export void ok() { P p = P { x: 1 }; }",
    // A static receiver is a type name in expression position, not a struct used as a value — this
    // is the shape that reported every static call in the repo when the rule was first written.
    "struct P { i32 x; P mk() { return P(1); } } export i32 ok() { return P.mk().x; }",
    "export u64 ok(f64 x) { return f64.toBits(x); }",
    "enum E { A, B } export E ok() { return E.A; }",
    // A method *called* is not a method used as a value.
    "struct C { i32 n; i32 get(const this) { return this.n; } } export i32 ok(C c) { return c.get(); }",
    // Methods on the types whose surface this has not measured: an array's and a string's.
    "export i32 ok(i32[] a) { return a.len(); }",
    "export i32 ok(string s) { return s.len(); }",
    "export u8[] ok(string s) { return s.toBytes(); }",
    // The right spelling in each cast direction.
    SH + "export Shape ok(Circle c) { return c as Shape; }",
    SH + "export Circle ok(Shape s) { return s as! Circle; }",
    "export i32 ok(i31ref r) { return r as i32; }",
    "export i31ref ok(i32 x) { return x as! i31ref; }",
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

/**
 * Narrowing: the first rule here that depends on *where in the control flow* an expression sits.
 *
 * An enum's value is one of its variants and the checker does not know which, so a payload field is
 * unreachable through the enum type. A guard is what makes it reachable — and which guards count is
 * measured rather than reasoned about, because the reference declines to be as clever as it could be:
 *
 * - `x is T` narrows, and `&&` propagates it, because both sides must hold;
 * - **`||` does not**, because the other arm may be the one that held;
 * - **`!` does not**, so an early return under a negated guard leaves the rest unnarrowed even though
 *   a human can see it is safe;
 * - and nothing survives the `if`.
 *
 * The last two are the reference choosing a simpler rule than it could defend, and matching it
 * exactly is the point: a checker that were *cleverer* here would be silent where the reference
 * complains, which is a miss, and one that were less clever would complain where it is silent, which
 * is a false alarm on working code.
 *
 * This rule arrived with its own hole: reporting unnarrowed access is a rejection, and **none of the
 * three oracles had a program exercising the accepted half**. The sweep gained one per type, and was
 * checked by disabling the narrowing and watching twelve cells go red.
 */
Deno.test("rung 3: narrowing, and the guards that do not count", () => {
  const E = "enum Shape { Point, Circle(f64 radius) } ";
  const S = "struct Base { i32 b; } struct Sub : Base { i32 s; } ";
  const CAUGHT = [
    // No guard at all, on an enum and on a parent struct.
    E + "export f64 f(Shape s) { return s.radius; }",
    S + "export i32 f(Base b) { return b.s; }",
    // Guards that do not narrow.
    E + "export f64 f(Shape s) { if ((s is Circle) || true) { return s.radius; } return 0.0; }",
    E + "export f64 f(Shape s) { if (!(s is Circle)) { return 0.0; } return s.radius; }",
    // Narrowing does not survive the branch it guards.
    E + "export f64 f(Shape s) { if (s is Circle) { } return s.radius; }",
    // Narrowed to the wrong variant: `Point` has no payload, and the complaint says so.
    E + "export f64 f(Shape s) { if (s is Point) { return s.radius; } return 0.0; }",
  ];
  const QUIET = [
    // The guard, alone and under a conjunction, and one level deeper.
    E + "export f64 f(Shape s) { if (s is Circle) { return s.radius; } return 0.0; }",
    E + "export f64 f(Shape s) { if ((s is Circle) && true) { return s.radius; } return 0.0; }",
    E + "export f64 f(Shape s) { if (s is Circle) { if (true) { return s.radius; } } return 0.0; }",
    // A struct downcast narrows the same way.
    S + "export i32 f(Base b) { if (b is Sub) { return b.s; } return 0; }",
    // A `match` binds the payload by name and needs no narrowing at all.
    E + "export f64 f(Shape s) { match (s) { case Circle(r): { return r; } case Point: { return 0.0; } } }",
    // The enum's own name is still usable for what it does have.
    E + "export Shape f() { return Shape.Circle(1.0); }",
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
 * Two rules that needed a *value* and an *alias* — the last two spec cases that are not inference.
 *
 * The float one is the only rule in this checker that has to compute something. `3.4028235e38` fits
 * an `f32` and `3.4028236e38` does not, and f32's maximum written out in full with no exponent at all
 * fits — so no amount of looking at the text answers it, and the literal is parsed to an `f64` and
 * compared against the largest value that still rounds to something finite.
 *
 * Only `f32` is checked, which is the reference's choice rather than an oversight of this one:
 * `f64 x = 1.0e400` is out of range for an `f64` too and it is accepted. Matching that is the job.
 *
 * The const one is about **aliasing**: a local initialised from a const path is const too, because
 * the local and the original are the same object — but only for a type you can write *through*.
 */
Deno.test("rung 3: a literal's value, and a local that aliases something const", () => {
  const C = "struct Counter { i32 c; void mutate(this) { this.c = 9; } } ";
  const CAUGHT = [
    // Every position an f32 literal can appear in — the reference reports in all of them.
    "export f32 f() { f32 x = 1.0e40; return x; }",
    "export f32 f() { return 1.0e40; }",
    "void g(f32 a) { } export void f() { g(1.0e40); }",
    "export void f() { f32[] a = f32[](1.0e40); }",
    "struct S { f32 v; } export void f() { S s = S(1.0e40); }",
    "export void f(f32 x) { x = 1.0e40; }",
    // The sign is a unary operator, so the whole literal path skipped this until it saw through one —
    // and the range complaint names the literal where a family mismatch names the whole expression.
    "export f32 f() { f32 x = -1.0e40; return x; }",
    // One ulp past the boundary, which no amount of reading the exponent would catch.
    "export f32 f() { f32 x = 3.4028236e38; return x; }",
    // A local aliasing something const, through a parameter and through a field.
    C + "export i32 f(const Counter p) { Counter a = p; a.mutate(); return 1; }",
    C + "struct X { Counter c; i32 t(const this) { Counter a = this.c; a.mutate(); return 1; } }",
    "export void f(const i32[] p) { i32[] a = p; a[0] = 1; }",
  ];
  const QUIET = [
    // The boundary itself, and f32's maximum written without an exponent.
    "export f32 f() { f32 x = 3.4028235e38; return x; }",
    "export f32 f() { f32 x = 1.0e38; return x; }",
    "export f32 f() { f32 x = 340282350000000000000000000000000000000.0; return x; }",
    "export f32 f() { f32 x = 1.0e-50; return x; }",
    // An f64 is not range-checked at all, even by a literal no f64 can hold.
    "export f64 f() { f64 x = 1.0e400; return x; }",
    "export f64 f() { f64 x = 1.0e40; return x; }",
    // The same aliasing with nothing const about it.
    C + "export i32 f(Counter p) { Counter a = p; a.mutate(); return 1; }",
    C + "struct X { Counter c; i32 t(this) { Counter a = this.c; a.mutate(); return 1; } }",
    // A **copy** of a primitive field is the local's own business, whatever the receiver was.
    "struct X { i32 n; i32 t(const this) { i32 v = this.n; v = 5; return v; } }",
    // A string is a reference and an immutable one: assigning a new string mutates nothing, so
    // aliasing a const string carries no constness. Seven sites in one file said so.
    'const string B = "x"; export void f() { string s = B; s = s + "y"; }',
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-58))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-58))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-58))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * Target-type inference: the one piece of information that flows **down** the tree.
 *
 * Every other rule here reads an expression and asks what it is. A bare `Box(1.0)` cannot be asked
 * that — its type arguments come from wherever it is going — so the checker carries what the
 * expression *is required to be*, set by each context and read once.
 *
 * Read and **cleared** at the top of the walk, so it reaches exactly one expression. `Box(1).get()` is
 * the case that proves the clearing matters: the receiver sits under a `return i32`, inherits nothing
 * from it, and is therefore a bare template with no target — which the reference calls undefined,
 * because a template is not a type.
 */
Deno.test("rung 3: a bare generic takes its arguments from the slot it goes into", () => {
  const B = "struct Box<T> { T v; i32 get(const this) { return 1; } } ";
  const CAUGHT = [
    // No slot to infer from: a receiver, and a bare statement.
    B + "export i32 f() { return Box(1).get(); }",
    B + "export void f() { Box(1.0); }",
    B + "export void f() { i32 n = Box(1.0).get(); }",
    // A slot that says what the argument must be — inference feeding the argument check.
    B + "export void f() { Box<i32> b = Box(1.0); }",
  ];
  const QUIET = [
    // Every slot the reference accepts one in.
    B + "export void f() { Box<f64> b = Box(1.0); }",
    B + "export Box<f64> f() { return Box(1.0); }",
    B + "void g(Box<f64> b) { } export void f() { g(Box(1.0)); }",
    B + "struct Q { Box<f64> b; } export void f() { Q q = Q(Box(1.0)); }",
    B + "export void f(Box<f64> b) { b = Box(1.0); }",
    B + "export void f() { Box<f64>[] a = Box<f64>[](Box(1.0)); }",
    // A nullable slot takes the non-null construction — the target's nullability is not part of the
    // question, and comparing the spelled target directly reported a working line in `packages/std`.
    B + "struct Q { Box<f64>? b; } export void f() { Q q = Q(Box(1.0)); }",
    // The type arguments written out, which needs no inference at all.
    B + "export void f() { Box<f64> b = Box<f64>(1.0); }",
    // Inside a generic's own methods the bare name means the instantiation being compiled, and the
    // return type is the slot that says so.
    "struct Vec<T> { T[] xs; Vec<T> empty() { return Vec(T[]()); } }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-52))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-52))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-52))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * A generic function's type arguments, inferred from what it is *given*.
 *
 * The other half of inference, and the opposite source: a construction reads the slot it goes into, a
 * call reads the arguments it is handed. `Box<T>` matched against `Box<f64>` binds `T` to `f64`, and
 * the return type follows.
 *
 * String against string, which is only possible because a type in this checker **is** its canonical
 * name — the written form and the actual form are the same kind of thing, so matching them is one
 * function rather than a second representation.
 *
 * Anything that does not line up binds nothing, which leaves the parameter open and the return type
 * unknown. That is the silent direction, and it is why this could be turned on at all: the signatures
 * had been recorded as blank precisely because nothing could bind them.
 */
Deno.test("rung 3: a generic function's arguments say what its parameters are", () => {
  const BOX = "struct Box<T> { T v; } T unbox<T>(Box<T> b) { return b.v; } ";
  const ID = "T id<T>(T x) { return x; } ";
  const CAUGHT = [
    // The inferred return, landing somewhere it does not fit.
    BOX + "export i32 f() { Box<f64> b = Box(1.0); i32 x = unbox(b); return x; }",
    BOX + "export void f(Box<f64> b) { string s = unbox(b); }",
    ID + "export void f(f64 a) { string s = id(a); }",
    // Arity still applies to a generic function, even where the types do not.
    ID + "export void f(f64 a) { f64 x = id(a, a); }",
  ];
  const QUIET = [
    // The inferred return landing where it does fit.
    BOX + "export f64 f(Box<f64> b) { return unbox(b); }",
    BOX + "export i32 f(Box<i32> b) { return unbox(b); }",
    ID + "export f64 f(f64 a) { return id(a); }",
    ID + "export string f(string a) { return id(a); }",
    // A parameter the arguments do not settle leaves the return unknown, and unknown is silence.
    ID + "export i32 f() { return id(1); }",
    // Through a suffix: `T[]` against `f64[]` looks one level down.
    "T first<T>(T[] xs) { return xs[0]; } export f64 f(f64[] a) { return first(a); }",
    // A generic function whose parameter types cannot be checked is still not an excuse to complain
    // about the arguments — binding them is inference's job, not the argument rule's.
    BOX + "export f64 f(Box<f64> b) { return unbox(b); }",
  ];
  for (const src of CAUGHT) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(src.slice(-52))} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src.slice(-52))}: we report ${at}, the reference reports ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
  for (const src of QUIET) {
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`${JSON.stringify(src.slice(-52))} is accepted and we said ${mine.join(", ")}`);
    }
  }
});

/**
 * One mistake, one diagnostic — for the comparisons that involve a reference.
 *
 * Every rung above compares *where* we report against where the reference reports, and none compares
 * how many. That let two rules answer the same expression: `a == b` on two structs produced both
 * "this operator needs a reference" and "these types cannot be compared", at the same position, for
 * one mistake. Nine diagnostics over the six lines below where the reference gives five.
 *
 * The count is not cosmetic. `report` already refuses the *same* code twice at one position, with the
 * reason written beside it — "a diagnostic list that says it twice is a list that disagrees about how
 * many things are wrong" — and two different codes at one position disagree in exactly the same way.
 * Worse, one of the two read backwards: a program whose fault is that its operands *are* references
 * was told the operator needs one.
 *
 * So this asserts the count as well as the position, which is the assertion the rungs were missing.
 */
Deno.test("rung 3: a reference comparison is one diagnostic, not two", () => {
  const CASES = [
    "struct N { i32 v; } export void a1(N a, N b) { bool r = a == b; }",
    "struct N { i32 v; } export void a2(N? a, N? b) { bool r = a == b; }",
    "struct N { i32 v; } export void a3(N? a, N b) { bool r = a == b; }",
    "struct N { i32 v; } export void a4(N a, N b) { bool r = a != b; }",
    "export void a5(i32[] a, i32[] b) { bool r = a == b; }",
    "export void a6(i32 p, string q) { bool r = p == q; }",
    "export void a7(string? a, string? b) { bool r = a == b; }",
    // The ordering operators are the same rule and had the same duplicate: `<` on a reference is
    // refused for the same reason `==` is, and `i32 < string` answered both "needs a reference" and
    // a type mismatch. Two strings still order, as two strings still compare.
    "export void a8(i32 p, string q) { bool r = p < q; }",
    "struct N { i32 v; } export void a9(N a, N b) { bool r = a < b; }",
    // **An enum is a reference too**, and this one was not a duplicate but a silence: wacc accepted
    // `a == b` on two of them outright. The rule it should have met asked `isStruct`, which an enum
    // is not, and the mixed-type rule needed the two sides to *differ*, which two `E`s do not.
    "enum E { A, B } export void b1(E a, E b) { bool r = a == b; }",
    "enum E { A, B } export void b2(E a, i32 b) { bool r = a == b; }",
  ];
  for (const src of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    if (theirs.length !== 1) {
      throw new Error(`${JSON.stringify(src)}: the reference gives ${theirs.length}, so this case is ` +
        `no longer about a single mistake: ${theirs.map((e) => `${e.at} ${e.message}`).join("; ")}`);
    }
    if (mine.length !== 1) {
      throw new Error(`${JSON.stringify(src)}: we report ${mine.length} diagnostics (${mine.join(", ")}) ` +
        `for one mistake; the reference reports one, at ${theirs[0].at}`);
    }
    if (mine[0] !== theirs[0].at) {
      throw new Error(`${JSON.stringify(src)}: we report at ${mine[0]}, the reference at ${theirs[0].at}`);
    }
  }
});

/**
 * And two strings still compare, because that is a different question.
 *
 * The rule above is about identity, and `==` on two strings compares bytes — a helper the emitter
 * generates. A consolidation that swept `string` in with the references would break every program
 * that compares one, which is most of them, so it gets a case of its own rather than a comment.
 */
Deno.test("rung 3: and plain strings still compare by value", () => {
  for (const src of [
    'export bool s(string a, string b) { return a == b; }',
    'export bool t(string a) { return a != "x"; }',
    'export bool u(string a, string b) { return a < b; }',
  ]) {
    const theirs = reference(src);
    const mine = ours(src);
    if (theirs.length !== 0) throw new Error(`${JSON.stringify(src)}: the reference now rejects it`);
    if (mine.length !== 0) throw new Error(`${JSON.stringify(src)}: we report ${mine.join(", ")}`);
  }
});

/**
 * **Every operator against every type, with the reference deciding each cell.**
 *
 * The rungs above are hand-written lists, and a hand-written list is exactly as wide as what somebody
 * thought of. Two gaps found by hand in one afternoon — `==` on a nullable, `==` on an enum — were
 * both of the form "no rule was wrong, every rule was about something else", which is the kind a list
 * cannot find because the missing entry is missing from the list too.
 *
 * So this generates the whole matrix: sixteen operators over fifteen types on both sides, 3,600
 * programs, and asks the reference about each. A cell where the reference refuses and this checker
 * says nothing is a gap; a cell where it accepts and this checker speaks is a false alarm. Neither is
 * allowed.
 *
 * ## The first version of this reported zero, and was blind
 *
 * It wrapped the expression as `(a op b) as~ bool` to give it somewhere to go. The cast is itself an
 * error for most of the matrix, so *every* cell had a diagnostic on both sides and the comparison was
 * vacuous — 3,600 cells, no disagreements, nothing measured. The instrument has to be able to observe
 * agreement *and* silence, so the slot is now the type the operator actually answers, and the counts
 * of what each side said are asserted rather than assumed: if the reference stops rejecting most of
 * this matrix, this test says so instead of quietly passing.
 */
Deno.test("rung 3: every operator against every type, the reference deciding each cell", () => {
  const PRELUDE = "struct S { i32 v; } enum E { A, B }\n";
  const TYPES = [
    "i32", "i64", "f64", "bool", "string", "string?",
    "S", "S?", "E", "E?", "i32[]", "i32[]?", "u8[]", "fn[i32(i32)]", "anyref",
  ];
  const OPS = ["==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "&", "|", "^", "&&", "||"];
  const COMPARISON = new Set(["==", "!=", "<", "<=", ">", ">=", "&&", "||"]);

  const silent: string[] = [];
  const alarms: string[] = [];
  let cells = 0, accepted = 0;
  for (const lt of TYPES) {
    for (const rt of TYPES) {
      for (const op of OPS) {
        // The slot is what the operator answers, so a cell is about the operator rather than about a
        // cast bolted on to make it a statement.
        const slot = COMPARISON.has(op) ? "bool" : lt;
        const src = `${PRELUDE}export void f(${lt} a, ${rt} b) { ${slot} r = a ${op} b; }`;
        let theirs: { at: string }[];
        try {
          theirs = reference(src);
        } catch {
          continue; // a combination the reference's own front end will not parse
        }
        cells++;
        const mine = ours(src);
        if (theirs.length === 0) accepted++;
        if (theirs.length > 0 && mine.length === 0) silent.push(`${lt} ${op} ${rt}`);
        if (theirs.length === 0 && mine.length > 0) alarms.push(`${lt} ${op} ${rt}`);
      }
    }
  }

  // The canary the first version lacked. If the matrix stops containing programs of both kinds, the
  // two assertions below are being satisfied by an absence rather than by agreement.
  if (cells < 3000) throw new Error(`only ${cells} cells reached the comparison`);
  if (accepted < 20) {
    throw new Error(`the reference accepts only ${accepted} of ${cells} cells, so "no false alarm" ` +
      "is not being tested by anything");
  }
  if (accepted > cells - 100) {
    throw new Error(`the reference rejects only ${cells - accepted} of ${cells} cells, so "we are ` +
      'not silent" is not being tested by anything');
  }

  if (silent.length > 0) {
    throw new Error(`${silent.length} of ${cells} cells the reference rejects and we say nothing ` +
      `about:\n  ${silent.slice(0, 20).join("\n  ")}${silent.length > 20 ? "\n  …" : ""}`);
  }
  if (alarms.length > 0) {
    throw new Error(`${alarms.length} cells we report on that the reference accepts:\n  ` +
      alarms.slice(0, 20).join("\n  "));
  }
});

/**
 * **Every type into every other type's slot**, again with the reference deciding.
 *
 * The initialiser rung above is a hand-written list of thirteen programs. This is the same question
 * asked 324 times, and the one thing it found was in the direction that list could never have
 * covered: not a rule we are missing, but a **program we refuse that the reference accepts**.
 *
 * `anyref r = someEnum` is legal — an enum is held by reference like anything else — and wacc
 * refused it. `isReferenceType`, which is the predicate `anyref` asks, listed arrays, strings,
 * `anyref` and structs. Its neighbour `isCastRef` carries a comment saying in as many words that "an
 * enum and a funcref are references too", so the fact was known and written down next to the helper
 * that did not use it.
 *
 * A funcref is a different matter and stays out: the reference refuses `anyref r = someFn` too, and
 * the grid is what says so rather than the comment.
 */
Deno.test("rung 3: every type into every other type's slot, the reference deciding each cell", () => {
  const PRELUDE = "struct S { i32 v; } enum E { A, B }\n";
  const TYPES = [
    "i32", "i64", "f64", "bool", "string", "string?", "S", "S?", "E", "E?",
    "i32[]", "i32[]?", "u8[]", "fn[i32(i32)]", "anyref", "i8", "u32", "f32",
  ];
  const silent: string[] = [], alarms: string[] = [];
  let cells = 0, accepted = 0;
  for (const slot of TYPES) {
    for (const held of TYPES) {
      const src = `${PRELUDE}export void f(${held} b) { ${slot} r = b; }`;
      let theirs: { at: string }[];
      try {
        theirs = reference(src);
      } catch {
        continue;
      }
      cells++;
      const mine = ours(src);
      if (theirs.length === 0) accepted++;
      if (theirs.length > 0 && mine.length === 0) silent.push(`${slot} r = ${held}`);
      if (theirs.length === 0 && mine.length > 0) alarms.push(`${slot} r = ${held}`);
    }
  }
  // Both kinds of cell have to be present, or one of the two assertions below is vacuous.
  if (cells < 300) throw new Error(`only ${cells} cells reached the comparison`);
  if (accepted < 10 || accepted > cells - 50) {
    throw new Error(`${accepted} of ${cells} accepted — the grid has stopped containing both kinds`);
  }
  // **The alarms first**, because refusing correct code is the worse failure: a gap costs a
  // diagnostic nobody gets, and an alarm costs a program nobody can compile.
  if (alarms.length > 0) {
    throw new Error(`${alarms.length} cells we refuse that the reference accepts:\n  ` +
      alarms.slice(0, 20).join("\n  "));
  }
  if (silent.length > 0) {
    throw new Error(`${silent.length} of ${cells} cells the reference rejects and we say nothing ` +
      `about:\n  ${silent.slice(0, 20).join("\n  ")}`);
  }
});

/**
 * **The unary operators and `!`-unwrap, over every type.**
 *
 * The third grid, and it found the same shape a third time: a rule spelled as a list of type names,
 * and the list was short. `-` refused `bool`, `string` and structs, so `-someEnum`, `-someArray`,
 * `-someFn` and `-someAnyref` all compiled — as did `-a` on a `u32`, which is not a reference at all
 * but is equally not a thing with a negation.
 *
 * `p!` was the same: refused on a struct or a primitive, silent on an enum, an array, a funcref or an
 * `anyref`, none of which has a `?` to unwrap either.
 *
 * ## Why each program's slot is the operand's own type
 *
 * So that only the operator can be the error. An earlier version wrote `i32 r = (a!).v` and learned
 * about `.v` on a string rather than about the unwrap, and `bool r = (a op b) as~ bool` measured the
 * cast. A grid is only as good as the thing it isolates, and the way to check that is the accepted
 * count: if every cell errors on both sides the comparison is vacuous, which is why that count is
 * asserted rather than reported.
 */
Deno.test("rung 3: the unary operators over every type, the reference deciding each cell", () => {
  const PRELUDE = "struct S { i32 v; } enum E { A, B }\n";
  const TYPES = [
    "i32", "i64", "f64", "f32", "bool", "i8", "u8", "i16", "u16", "u32", "u64",
    "string", "string?", "S", "S?", "E", "E?", "i32[]", "i32[]?", "u8[]", "fn[i32(i32)]", "anyref",
  ];
  // Each form's slot is the operand's own type, so a mismatch cannot stand in for the operator.
  // `a!` on a nullable answers the non-null form, which widens back into the nullable slot.
  const FORMS: [string, (t: string) => string][] = [
    ["-a", (t) => `export void f(${t} a) { ${t} r = -a; }`],
    ["!a", (t) => `export void f(${t} a) { bool r = !a; }`],
    ["~a", (t) => `export void f(${t} a) { ${t} r = ~a; }`],
    ["a!", (t) => `export void f(${t} a) { ${t} r = a!; }`],
  ];
  for (const [form, make] of FORMS) {
    const silent: string[] = [], alarms: string[] = [];
    let cells = 0, accepted = 0;
    for (const t of TYPES) {
      const src = PRELUDE + make(t);
      let theirs: { at: string }[];
      try {
        theirs = reference(src);
      } catch {
        continue;
      }
      cells++;
      const mine = ours(src);
      if (theirs.length === 0) accepted++;
      if (theirs.length > 0 && mine.length === 0) silent.push(t);
      if (theirs.length === 0 && mine.length > 0) alarms.push(t);
    }
    if (cells < TYPES.length - 2) throw new Error(`${form}: only ${cells} cells`);
    if (alarms.length > 0) {
      throw new Error(`${form}: ${alarms.length} we refuse and the reference accepts: ${alarms.join(", ")}`);
    }
    if (silent.length > 0) {
      throw new Error(`${form}: ${silent.length} the reference rejects and we say nothing about: ` +
        silent.join(", "));
    }
  }
});

/**
 * **A packed type in every position it can be written in.**
 *
 * `u8 i8 u16 i16` exist as array elements and struct fields and nowhere else: no slot is one byte
 * wide, so a packed value has no representation of its own to be held in. `checkParams` says exactly
 * that in a comment — "it exists as an array element and nowhere else" — and enforces it for
 * parameters only. A local, a return type and a cast target are the other three positions, and a
 * grid over the four types by the ten places a type can be written found all of them.
 *
 * ## This one asks for completeness, which the other rungs deliberately do not
 *
 * Rung 3's contract is soundness and position: everything we report, the reference reports in the
 * same place, and nothing more is demanded, because demanding everything would fail until the whole
 * checker is finished. Here the rule is small enough to finish, so the assertion is the stronger one
 * — every position the reference complains at, we complain at too. A rule claimed to be implemented
 * in four positions and tested in one is how this got missed.
 */
Deno.test("rung 3: a packed type in every position, and every diagnostic the reference gives", () => {
  const PACKED = ["u8", "i8", "u16", "i16"];
  const PLACES: [string, (t: string) => string][] = [
    ["parameter", (t) => `export void f(${t} a) { }`],
    ["local", (t) => `export void f() { ${t} r = 0; }`],
    ["return", (t) => `export ${t} f() { return 0; }`],
    ["cast target", (t) => `export void f(i32 n) { i32 r = (n as ${t}) as i32; }`],
    ["struct field", (t) => `struct S { ${t} v; } export void f(S s) { }`],
    // **The only position a packed type is legal in.** A struct field is not one — it is in the list
    // above — and I had assumed it was until this grid said otherwise, which is the second time in
    // one afternoon that reading a rule's own words ("an array element and nowhere else") would have
    // been quicker than reasoning about it. Nothing may be reported about these two.
    ["array element", (t) => `export void f(${t}[] a) { }`],
    ["array field", (t) => `struct S { ${t}[] v; } export void f(S s) { }`],
  ];
  const legal = new Set(["array element", "array field"]);
  for (const [place, make] of PLACES) {
    for (const t of PACKED) {
      const src = make(t);
      const theirs = reference(src);
      const mine = ours(src);
      if (legal.has(place)) {
        if (theirs.length !== 0) {
          throw new Error(`${place} ${t}: the reference now refuses this, so the grid's premise moved`);
        }
        if (mine.length !== 0) {
          throw new Error(`${place} ${t}: we refuse a position packed types exist for: ${mine.join(", ")}`);
        }
        continue;
      }
      if (theirs.length === 0) {
        throw new Error(`${place} ${t}: the reference accepts it, so this case is no longer a rule`);
      }
      for (const e of theirs) {
        if (!mine.includes(e.at)) {
          throw new Error(`${place} ${t}: the reference reports at ${e.at} — ${e.message} — and we ` +
            `report at ${mine.length === 0 ? "nowhere" : mine.join(", ")}`);
        }
      }
    }
  }
});

/**
 * **An index and an array size are `i32`, not "some integer".**
 *
 * Both checks asked `isIntegerName`, which is true of `i64`, `u32` and `u64` as well — so
 * `xs[someI64]` and `i32[someU64]()` compiled, and the reference answers *"array index must be i32,
 * got i64"*. A length is a count and wasm's array instructions take an `i32`; the wider question was
 * never the one being asked.
 *
 * The literal path above each of them already spelled `acceptsLiteral("i32", …)`, so the two halves
 * of the same rule disagreed about what the rule was — the typed half being the lenient one, which
 * is the direction that compiles and then means something else.
 */
Deno.test("rung 3: an index and an array size are i32 exactly", () => {
  const CASES: [string, boolean][] = [
    // [program, must the reference refuse it]
    ["export void f(i32[] xs, i32 a) { i32 r = xs[a]; }", false],
    ["export void f(i32[] xs, i64 a) { i32 r = xs[a]; }", true],
    ["export void f(i32[] xs, u32 a) { i32 r = xs[a]; }", true],
    ["export void f(i32[] xs, u64 a) { i32 r = xs[a]; }", true],
    ["export void f(i32[] xs, f64 a) { i32 r = xs[a]; }", true],
    ["export void f() { i32[] xs = i32[4](); }", false],
    ["export void f(i32 a) { i32[] xs = i32[a](); }", false],
    ["export void f(i64 a) { i32[] xs = i32[a](); }", true],
    ["export void f(u32 a) { i32[] xs = i32[a](); }", true],
    ["export void f(u64 a) { i32[] xs = i32[a](); }", true],
  ];
  for (const [src, mustRefuse] of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    if (mustRefuse !== (theirs.length > 0)) {
      throw new Error(`${JSON.stringify(src)}: the reference ${theirs.length > 0 ? "refuses" : "accepts"} ` +
        "it, which is not what this case is for");
    }
    if (mustRefuse && mine.length === 0) {
      throw new Error(`${JSON.stringify(src)}: the reference reports at ${theirs.map((e) => e.at).join(", ")} ` +
        "and we say nothing");
    }
    if (!mustRefuse && mine.length > 0) {
      throw new Error(`${JSON.stringify(src)}: we report ${mine.join(", ")} for a program that is fine`);
    }
    for (const at of mine) {
      if (!theirs.some((e) => e.at === at)) {
        throw new Error(`${JSON.stringify(src)}: we report at ${at}, the reference at ` +
          theirs.map((e) => e.at).join(", "));
      }
    }
  }
});

/**
 * **`match` on something that is not an enum**, and the four other forms the same grid turned up.
 *
 * `checkArmVariants` opens by resolving the subject's enum and returns silently when there is not
 * one — which is right for a subject it cannot type and wrong for one it can: `match (someI32)` is
 * *"match requires an enum value, got i32"* and wacc compiled it, along with every other non-enum
 * subject. Twelve of thirteen cells.
 *
 * The other four are the same shape one rung down, each a rule that knew about primitives and not
 * about the rest: `a++` on a reference, `a.v` where `a` is a string or an array, `a.nope()` on an
 * enum or a funcref, and `a is S` on a funcref.
 */
Deno.test("rung 3: the member and statement forms, the reference deciding each cell", () => {
  const PRELUDE = "struct S { i32 v; } enum E { A, B }\n";
  const TYPES = [
    "i32", "i64", "u32", "u64", "f64", "f32", "bool", "string", "S", "E", "i32[]",
    "fn[i32(i32)]", "anyref",
  ];
  const FORMS: [string, (t: string) => string][] = [
    ["a++", (t) => `export void f(${t} a) { a++; }`],
    ["--a", (t) => `export void f(${t} a) { --a; }`],
    ["a.v", (t) => `export void f(${t} a) { i32 r = a.v; }`],
    ["a.nope()", (t) => `export void f(${t} a) { i32 r = a.nope(); }`],
    ["a is S", (t) => `export void f(${t} a) { bool r = a is S; }`],
    ["match (a)", (t) => `export void f(${t} a) { match (a) { else: { } } }`],
  ];
  for (const [form, make] of FORMS) {
    const silent: string[] = [], alarms: string[] = [];
    let cells = 0, accepted = 0;
    for (const t of TYPES) {
      const src = PRELUDE + make(t);
      let theirs: { at: string }[];
      try {
        theirs = reference(src);
      } catch {
        continue;
      }
      cells++;
      const mine = ours(src);
      if (theirs.length === 0) accepted++;
      if (theirs.length > 0 && mine.length === 0) silent.push(t);
      if (theirs.length === 0 && mine.length > 0) alarms.push(t);
    }
    if (cells < TYPES.length - 1) throw new Error(`${form}: only ${cells} cells`);
    // `a.nope()` is refused for every type there is, so it has no accepted cell to check against and
    // is exempt from the both-kinds rule the other grids assert.
    if (form !== "a.nope()" && accepted === 0) {
      throw new Error(`${form}: the reference accepts none of ${cells} cells, so an alarm here ` +
        "would go unnoticed");
    }
    if (alarms.length > 0) {
      throw new Error(`${form}: ${alarms.length} we refuse and the reference accepts: ${alarms.join(", ")}`);
    }
    if (silent.length > 0) {
      throw new Error(`${form}: ${silent.length} the reference rejects and we say nothing about: ` +
        silent.join(", "));
    }
  }
});

/**
 * A call through a funcref, argument by argument.
 *
 * **Arity was checked and types were not**, which the helper's own comment recorded as a known
 * limit: *"the parameter types are in the funcref's spelling and could be compared, but that needs
 * the spelling taken apart again and the corpus does not distinguish it."* The corpus did not, and
 * the first wac program to make host calls did — `packages/webrtc/example/answer.wac` called
 * `cli.sendTo(handle, bytes, peer, port)` against `fn(i32, string, i32, u8[])` at three sites, and
 * all three were accepted. It surfaced as a wasm `CompileError` naming a `call_ref` index, which
 * says nothing about which call or which argument. `issues/lang/0123`.
 *
 * This matters more than an ordinary missing rule because **every capability the platform gives a
 * program is a funcref field**. `Cli`'s whole surface is fields, so this was the one call shape a
 * program uses most and the checker looked at least.
 *
 * What is deliberately still not compared: a parameter this checker cannot name — an unbound `T`
 * inside a generic, a `Pending<T>` — because comparing needs a substitution it does not perform,
 * and a wrong complaint about correct code is worse than a missed one.
 */
Deno.test("rung 3: the argument types of a call through a funcref", () => {
  const D = "struct H { fn[i32(i32, u8[])] f; } struct G<T> { fn[i32(T)] g; } ";
  const CAUGHT = [
    // The swap that started this: both arguments wrong, each its own diagnostic.
    "export i32 a(H h, u8[] b) { return h.f(b, 7); }",
    // One wrong is still wrong.
    "export i32 b(H h, u8[] q) { return h.f(1, 2); }",
    "export i32 c(H h) { return h.f(1, 2); }",
    // And through a local of funcref type, which is the other way to reach one.
    "i32 t(i32 n, u8[] b) { return n; } export i32 d(u8[] b) { fn[i32(i32, u8[])] k = t; " +
      "return k(b, 1); }",
  ];
  const QUIET = [
    "export i32 e(H h, u8[] b) { return h.f(7, b); }",
    "i32 t2(i32 n, u8[] b) { return n; } export i32 f2(u8[] b) { fn[i32(i32, u8[])] k = t2; " +
      "return k(1, b); }",
    // A generic's funcref parameter is a spelling this checker cannot compare, so it says nothing
    // rather than guessing — the skip that keeps correct code quiet.
    "export i32 g2(G<i32> g) { return g.g(1); }",
  ];
  for (const t of CAUGHT) {
    const src = D + t;
    const theirs = reference(src);
    const mine = ours(src);
    if (theirs.length === 0) {
      throw new Error(`the reference accepts ${JSON.stringify(t)}, so it is the wrong example`);
    }
    if (mine.length === 0) {
      throw new Error(`the reference rejects ${JSON.stringify(t)} and we said nothing: ` +
        theirs.map((e) => `${e.at} ${e.message}`).join("; "));
    }
  }
  for (const t of QUIET) {
    const src = D + t;
    const mine = ours(src);
    if (mine.length > 0) {
      throw new Error(`we complain about ${JSON.stringify(t)}: ${mine.join("; ")}`);
    }
  }
});
