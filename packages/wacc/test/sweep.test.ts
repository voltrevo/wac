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

function reference(src: string): string[] {
  const { tokens } = wacLex(src);
  const { program } = wacParse(tokens, "/main.wac");
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
  if (reference(CANARY_REJECTED).length === 0) {
    throw new Error("the canary program is no longer rejected by the reference — the sweep is blind");
  }
  if (ours(CANARY_REJECTED).length === 0) {
    throw new Error("the canary program is no longer reported by us — the sweep is blind");
  }
  if (reference(CANARY_ACCEPTED).length !== 0 || ours(CANARY_ACCEPTED).length !== 0) {
    throw new Error("the accepted canary is now reported by somebody — the sweep is blind");
  }

  const cells = generate();
  if (cells.length < 5000) throw new Error(`only ${cells.length} cells generated`);

  const alarms: string[] = [];
  const contradictions: string[] = [];
  let accepted = 0;
  let rejected = 0;
  let caught = 0;
  for (const cell of cells) {
    let theirs: string[];
    try {
      theirs = reference(cell.src);
    } catch {
      continue; // a program the reference's own parser rejects is not this test's business
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
    `(${((100 * caught) / rejected).toFixed(0)}%), ${contradictions.length} contradicted`);

  // Both halves have to be non-empty, or the sweep is measuring one thing and calling it two. A
  // generator that only produced valid programs would report "no contradictions" for ever.
  if (accepted === 0) throw new Error("no generated program was accepted — the sweep is one-sided");
  if (rejected === 0) throw new Error("no generated program was rejected — the sweep is one-sided");
  if (caught === 0) throw new Error("nothing was caught — the sweep is not reaching our checker");

  if (alarms.length !== 0) {
    throw new Error(`false alarms on programs the reference accepts:\n  ` + alarms.join("\n  "));
  }
  if (contradictions.length !== 0) {
    throw new Error(`contradictions:\n  ` + contradictions.join("\n  "));
  }
});
