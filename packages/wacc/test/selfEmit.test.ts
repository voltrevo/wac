// Rung 5's tracker: how much of `wacc` can `wacc` compile?
//
// The ladder's last rung is the bootstrap — this compiler compiling its own source — and the useful
// version of that question is not yes or no but *how far*. Eight files, and this reports how many of
// them produce a whole module, so the number moves as the emitter grows rather than staying at "no"
// until the day it becomes "yes".
//
// What it asserts is the same invariant the corpus test asserts, on the sources that matter most: a
// module this emitter produces validates, and a file it declines is declined **by name**. The count
// is asserted only as a floor, so a slot that adds a feature cannot quietly lose one.

import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;

Deno.test("rung 5: how much of wacc can wacc compile", async () => {
  const entries = await loadCorpus("packages/wacc/test/selfEmit.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  const own = paths.filter((p) => p.startsWith("packages/wacc/src/"));
  if (own.length < 8) throw new Error(`expected wacc's sources, found only ${own.length}`);

  let whole = 0;
  let invalid = 0;
  const declined: string[] = [];
  for (const name of own) {
    const bytes = Uint8Array.from(emitFiles(paths, sources, name) as unknown as number[]);
    if (!WebAssembly.validate(bytes)) {
      invalid++;
      continue;
    }
    const why = blockedFiles(paths, sources, name);
    if (why === "") whole++;
    else declined.push(`${name.replace("packages/wacc/src/", "")} — ${why}`);
  }
  console.log(`    rung 5: ${whole} of ${own.length} of wacc's own sources compile whole` +
    (declined.length === 0 ? "" : `; ${declined.join(", ")}`));

  // The same invariant as the corpus, on the files that decide the last rung.
  if (invalid !== 0) {
    throw new Error(`${invalid} of wacc's own sources produced an invalid module — the ` +
      `emittability walk approved something the emitter cannot do`);
  }
  // A floor rather than an equality: this is meant to rise, and a slot that adds a feature must not
  // quietly lose one.
  if (whole < own.length) {
    throw new Error(`only ${whole} of wacc's ${own.length} sources compile whole`);
  }
});
