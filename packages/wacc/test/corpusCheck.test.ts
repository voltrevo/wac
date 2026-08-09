// Rung 3's checker, pointed at the **repository's own code**: 338 files nobody wrote for a test.
//
// The other two rung-3 oracles feed it programs that exist to be fed to it — a generated cross
// product in `sweep.test.ts`, the emitter's corpus in `checkSweep.test.ts`. Both are synthetic, both
// are single-file, and both are written by the same hands that wrote the checker. This one is the
// packages: a Tor relay, an SSH server, a shell, a JSON parser, the compiler itself. Real code is a
// different distribution — longer functions, deeper types, every feature at once — and it is the
// input that took rung 4 from 31 whole files to 335.
//
// **The two sides are not given the same thing, and that is the point.** The reference gets the whole
// corpus as its file map, so its imports resolve and its verdict is about the program as written.
// This checker gets the one file, with no imports resolved at all — it sees strictly *less*. Seeing
// less can make it miss a diagnostic; it cannot make it invent one. So "the reference compiles this
// cleanly and we said nothing" is a fair question to ask of an asymmetric pair, and it is the only
// invariant this package treats as absolute.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

Deno.test("rung 3: the repository's own code, checked — no false alarm", async () => {
  const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
  if (entries.length < 300) throw new Error(`only ${entries.length} corpus files`);
  const map = new Map(entries.map(([name, src]) => [`/${name}`, src]));

  // The canary: something this checker certainly reports, through the same call.
  if (dumpTypeErrors(enc.encode(`export i32 f() { return "x"; }`)).length === 0) {
    throw new Error("the canary is no longer reported — this sweep is blind");
  }

  // **Ours first, theirs only to adjudicate.** Asking the reference about all 341 files costs four
  // and a half minutes — each compile re-reads the whole map — and in the green case its answer is
  // needed for none of them: a file this checker says nothing about cannot be a false alarm whatever
  // the reference thinks. So the expensive question is asked only where the cheap one found
  // something, which is zero times when the suite is passing and once when it is not.
  const alarms: string[] = [];
  let reported = 0;
  for (const [name, src] of entries) {
    const out = dumpTypeErrors(enc.encode(src));
    if (out.length === 0) continue;
    reported++;
    if (!wacCompile(map, `/${name}`).ok) continue;   // the reference refuses it too — not an alarm
    const line = src.split("\n")[out[1] - 1] ?? "";
    alarms.push(`${name}:${out[1]}:${out[2]} code ${out[0]} — ${line.trim().slice(0, 90)}`);
  }
  console.log(`    rung 3 on the repository: ${entries.length} files, ` +
    `${reported} this checker reports on, ${alarms.length} of them the reference compiles cleanly`);
  if (alarms.length > 0) {
    throw new Error(`the checker reported ${alarms.length} working file(s):\n  ` +
      alarms.slice(0, 8).join("\n  "));
  }
});
