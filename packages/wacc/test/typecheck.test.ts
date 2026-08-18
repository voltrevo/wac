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

