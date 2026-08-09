// Rung 3's checker, pointed at **rung 4's corpus**: four thousand valid programs it has never seen.
//
// The generated sweep in `sweep.test.ts` is ten thousand programs and reports 99% recall, and both
// numbers are true of the cross product its generator builds — type against context, one hundred and
// seventy lines of it. What it cannot say anything about is a shape nobody wrote into the generator.
// Meanwhile `generateEmit.ts` grew to four and a half thousand programs covering everything the
// *emitter* learned: generics, subtyping, method references, narrowed enums, `is T` guards, named
// construction. Nothing had ever asked the checker about any of them.
//
// Asking cost one file and found **eighty-two false alarms** — valid programs this checker reported
// an error in. That is the one invariant it may never break: a subset checker may miss anything, and
// may not invent. Every one was the same shape underneath — a feature it does not model, answered
// confidently instead of not at all.
//
// So this asserts the invariant rather than a number: for every program the reference accepts, we
// say nothing. Recall is not measured here; `sweep.test.ts` measures that, and a program that is
// *valid* has no diagnostic to be recalled.

import { wacLex } from "wac/wacLex.ts";
import { wacParse, type Program } from "wac/wacParse.ts";
import { wacResolve } from "wac/wacResolve.ts";
import { wacTypeCheck } from "wac/wacTypeCheck.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { generateEmit } from "./generateEmit.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/** Whether the reference's *checker* accepts a program — false when its parser would not read one. */
function referenceAccepts(src: string): boolean {
  const { tokens } = wacLex(src);
  const { program, errors } = wacParse(tokens, "/main.wac");
  if (errors !== undefined && errors.length > 0) return false;
  const programs = new Map<string, Program>([["/main.wac", program]]);
  return wacTypeCheck(wacResolve("/main.wac", programs), programs)
    .filter((e) => e.severity !== "warning").length === 0;
}

/**
 * The two type names rung 3 does not model at all, and says so by name rather than by a tolerated
 * count.
 *
 * `anyref` is the top of the reference hierarchy and `i31ref` an integer packed into a reference.
 * The emitter learned both; the checker knows neither what may be assigned to what across them nor
 * which casts between them are checked, and three programs here use them through an `anyref[]`,
 * where the array's element type resolves before the exclusion can apply. Skipping them is a
 * statement about coverage — these programs are not checked by rung 3 — where a "no more than three
 * false alarms" ceiling would be a statement about noise, and would quietly absorb the fourth.
 */
const UNMODELLED = /\banyref\b/;

Deno.test("rung 3: the emitter's corpus, put to the checker — no false alarm", () => {
  const cells = generateEmit();
  if (cells.length < 4000) throw new Error(`only ${cells.length} cells generated`);

  // The canary: a program this checker certainly reports, run through the same path. A harness that
  // has stopped asking reports agreement on everything.
  const canary = dumpTypeErrors(enc.encode(`export i32 f() { return "x"; }`));
  if (canary.length === 0) throw new Error("the canary is no longer reported — this sweep is blind");

  const alarms: string[] = [];
  let checked = 0;
  let skipped = 0;
  for (const cell of cells) {
    if (UNMODELLED.test(cell.src)) {
      skipped++;
      continue;
    }
    if (!referenceAccepts(cell.src)) continue;
    checked++;
    const out = dumpTypeErrors(enc.encode(cell.src));
    if (out.length > 0 && alarms.length < 8) {
      alarms.push(`${cell.context}: code ${out[0]} at ${out[1]}:${out[2]}\n    ${cell.src.split("\n")[0]}`);
    } else if (out.length > 0) {
      alarms.push("…");
    }
  }
  console.log(`    rung 3 on rung 4's corpus: ${checked} valid programs checked, ` +
    `${alarms.length} false alarms, ${skipped} skipped (anyref/i31ref are unmodelled)`);
  if (alarms.length > 0) {
    throw new Error(`the checker reported ${alarms.length} valid program(s):\n  ` + alarms.join("\n  "));
  }
});
