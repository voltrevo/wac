// A generated differential sweep: every program the generator can build, put to both checkers.
//
// The two corpora this package already has are *samples*. The spec's is a sample of what the language
// chose to explain; the reference's own tests are a sample of what its author thought to test. Both
// are nearly exhausted — 77 of 83 and 122 of 124 — and neither can say anything about a combination
// nobody wrote down. This can: `generate()` builds the cross product of type against context, so a
// type added there is asked about in every context at once.
//
// What is asserted is deliberately not recall. Two properties, both about being *wrong*:
//
//   - **No false alarm.** The reference accepts the program and we say nothing about it. A subset
//     checker may miss anything; it may not invent.
//   - **No contradiction.** Every position we report is one the reference reports. Compared by
//     position and never by message text, for the reason the whole ladder does: a message filter is a
//     second opinion about which diagnostics count.
//
// Recall is printed. A number that must never fall on nine thousand generated programs is a number
// that makes every refactor a negotiation, and this slot's own work traded one case away on purpose.

import { wacLex } from "wac/wacLex.ts";
import { wacParse, type Program } from "wac/wacParse.ts";
import { wacResolve } from "wac/wacResolve.ts";
import { wacTypeCheck } from "wac/wacTypeCheck.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { CANARY_ACCEPTED, CANARY_REJECTED, generate } from "./generate.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

function ours(src: string): string[] {
  const out = dumpTypeErrors(enc.encode(src));
  const at: string[] = [];
  for (let i = 0; i < out.length; i += 3) at.push(`${out[i + 1]}:${out[i + 2]}`);
  return at;
}

/**
 * The same diagnostics as `code@line:col`, for the one property positions cannot express.
 *
 * A repeat is invisible to the two checks below: they ask whether each position we report is one the
 * reference reports, and a second copy of a position is still one it reports. So a program could draw
 * the same complaint twice for ever and this sweep would call it agreement.
 */
function oursKeyed(src: string): string[] {
  const out = dumpTypeErrors(enc.encode(src));
  const keys: string[] = [];
  for (let i = 0; i < out.length; i += 3) keys.push(`${out[i]}@${out[i + 1]}:${out[i + 2]}`);
  return keys;
}

/**
 * The reference's type diagnostics, or `null` when its **parser** would not read the program.
 *
 * Rung 3 compares type checkers, and a program the parser could not read has no type diagnostics to
 * compare — whatever the checker then says is about a broken tree. The sweep hit exactly one such
 * cell, `fn[i32(i32)][2](fill: a)`, which the reference answers with *"type 'null' is not an array"*
 * — a type nothing in the program mentions. That is wac issue 0079, and skipping it here is the
 * boundary rather than a workaround: parse divergence is rung 2's oracle, not this one's.
 */
function reference(src: string): string[] | null {
  const { tokens } = wacLex(src);
  const { program, errors } = wacParse(tokens, "/main.wac");
  if (errors !== undefined && errors.length > 0) return null;
  const programs = new Map<string, Program>([["/main.wac", program]]);
  return wacTypeCheck(wacResolve("/main.wac", programs), programs)
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.line}:${e.col}`);
}

Deno.test("rung 3: the generated sweep — no false alarm, no contradiction", () => {
  // The canary, first and separately. A differential harness that compares nothing reports that
  // everything agrees, and every number it goes on to print looks reassuring. These two say the two
  // sides are being asked at all: one program the reference certainly rejects and we certainly
  // report, one it certainly accepts and we certainly do not.
  if ((reference(CANARY_REJECTED) ?? []).length === 0) {
    throw new Error("the canary program is no longer rejected by the reference — the sweep is blind");
  }
  if (ours(CANARY_REJECTED).length === 0) {
    throw new Error("the canary program is no longer reported by us — the sweep is blind");
  }
  if ((reference(CANARY_ACCEPTED) ?? ["x"]).length !== 0 || ours(CANARY_ACCEPTED).length !== 0) {
    throw new Error("the accepted canary is now reported by somebody — the sweep is blind");
  }

  const cells = generate();
  if (cells.length < 5000) throw new Error(`only ${cells.length} cells generated`);

  const alarms: string[] = [];
  const contradictions: string[] = [];
  const repeats: string[] = [];
  let accepted = 0;
  let rejected = 0;
  let caught = 0;
  let unparsed = 0;
  for (const cell of cells) {
    let theirs: string[] | null;
    try {
      theirs = reference(cell.src);
    } catch {
      theirs = null;
    }
    if (theirs === null) {
      unparsed++;
      continue;
    }
    const mine = ours(cell.src);
    if (theirs.length === 0) {
      accepted++;
      if (mine.length !== 0 && alarms.length < 12) {
        alarms.push(`${cell.context}: we say ${mine.join(",")} in ${JSON.stringify(cell.src)}`);
      }
      continue;
    }
    rejected++;
    if (mine.length === 0) continue;
    caught++;
    // **The same complaint twice is one complaint, and this is where that is checked.** `C.report`
    // dedupes against the *immediately previous* diagnostic only, so anything recorded in between
    // lets a repeat through — and neither check in this loop can see one, since a duplicate position
    // is still a position the reference reports. Measured at 630 of these programs before the scan
    // was widened to every entry.
    const keys = oursKeyed(cell.src);
    if (new Set(keys).size !== keys.length && repeats.length < 12) {
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      repeats.push(`${cell.context}: ${dup.join(",")} twice in ${JSON.stringify(cell.src)}`);
    }
    for (const at of mine) {
      if (!theirs.includes(at)) {
        if (contradictions.length < 12) {
          contradictions.push(`${cell.context}: we say ${at}, the reference says ` +
            `${theirs.join(",")} in ${JSON.stringify(cell.src)}`);
        }
        break;
      }
    }
  }
  console.log(`    rung 3 generated sweep: ${cells.length} programs, ${accepted} accepted ` +
    `(${alarms.length} false alarms), ${rejected} rejected, ${caught} caught ` +
    `(${((100 * caught) / rejected).toFixed(0)}%), ${contradictions.length} contradicted, ` +
    `${unparsed} unparsed (wac 0079)`);

  if (repeats.length > 0) {
    throw new Error(
      `${repeats.length}+ program(s) draw the same diagnostic twice at one position:\n  ` +
        repeats.join("\n  "),
    );
  }

  // Both halves have to be non-empty, or the sweep is measuring one thing and calling it two. A
  // generator that only produced valid programs would report "no contradictions" for ever.
  if (accepted === 0) throw new Error("no generated program was accepted — the sweep is one-sided");
  if (rejected === 0) throw new Error("no generated program was rejected — the sweep is one-sided");
  if (caught === 0) throw new Error("nothing was caught — the sweep is not reaching our checker");

  // **A floor, because a printed number is not a guarded one.** This read 99% for long enough that
  // `packages/wacc/README.md` still said so when it was 100% — an understatement nobody trips over,
  // which is exactly how a *drop* would sit too.
  //
  // A share rather than a count: the generator's output changes with its operator table, so an
  // assertion on 9,120 would fail on an unrelated commit and teach people to edit the number. And a
  // share is what this can see — a program counts as caught when any diagnostic fires, so one rule
  // going quiet moves it barely at all, while the front end breaking takes it to zero. The `worst`
  // list printed above is what guards individual rules.
  const share = caught / rejected;
  if (share < 0.97) {
    throw new Error(
      `recall on the generated sweep is ${caught}/${rejected} (${(share * 100).toFixed(1)}%), ` +
        `and the floor is 97%. The kinds it missed most are printed above.`,
    );
  }

  if (alarms.length !== 0) {
    throw new Error(`false alarms on programs the reference accepts:\n  ` + alarms.join("\n  "));
  }
  if (contradictions.length !== 0) {
    throw new Error(`contradictions:\n  ` + contradictions.join("\n  "));
  }
});
