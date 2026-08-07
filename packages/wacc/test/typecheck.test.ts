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

Deno.test("rung 3: the corpus stays silent, which is the property a subset checker can lose", () => {
  // Every `.wac` file in the repo type-checks cleanly under the reference — that is what makes them
  // a corpus. So anything we say about one is a false alarm, and this is the cheapest way to catch a
  // rule that looked sound on eight hand-written cases and is not.
  //
  // Single-file only: `wacResolve` would need the whole import graph to judge these, and this slice
  // reports nothing that depends on another module. The files are read as text and checked by us
  // alone; the reference's verdict on them is not needed to know that *we* should be quiet.
  let checked = 0;
  for (const entry of Deno.readDirSync("packages/wacc/src")) {
    if (!entry.name.endsWith(".wac")) continue;
    const src = Deno.readTextFileSync(`packages/wacc/src/${entry.name}`);
    const mine = ours(src);
    if (mine.length !== 0) {
      throw new Error(`we report ${mine.length} diagnostic(s) at ${mine.join(", ")} in ` +
        `packages/wacc/src/${entry.name}, which type-checks cleanly`);
    }
    checked++;
  }
  if (checked < 6) throw new Error(`only ${checked} files checked — the corpus did not load`);
});
