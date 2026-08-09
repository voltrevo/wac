// **The other half of the contract.** Every program `spec/spec` runs, this checker keeps quiet about.
//
// `specCheck.test.ts` holds the language's *rejections*; this holds its *acceptances*, and together
// they are what "implement the spec" means for rung 3. It replaces a question this package used to
// ask instead — *does the reference compile it?* — with the one that decides: **does the language
// permit it?** A program the spec runs is a program that compiles, whatever any implementation
// thinks, and a diagnostic on one is this checker being wrong.
//
// The eight it still reports are named per tag with what each would take. They are not noise to be
// tolerated: each is a rule this checker has that the language does not.

import { wacBind } from "../../../harness/wacBind.ts";
import { specAcceptances } from "./specCorpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/**
 * Empty, and it is meant to stay that way.
 *
 * It held eight tags: a ternary over a subtype and its parent (twice, once nullable), a constant
 * built from an enum variant (twice), a bare generic in a ternary branch, a generic function's
 * return type, and an enum method reached through a narrowed variant. Every one was a rule this
 * checker had that the language does not.
 */
const KNOWN_VIOLATIONS = new Set<string>([]);

Deno.test("rung 3: every program the spec runs, accepted in silence", () => {
  const cases = specAcceptances();
  if (cases.length < 200) throw new Error(`only ${cases.length} spec acceptances extracted`);

  const wrong: string[] = [];
  const fixed: string[] = [];
  let silent = 0;
  for (const c of cases) {
    const bytes = enc.encode(c.src);
    const out = dumpErrors(bytes).length > 0
      ? [-1]
      : Array.from(dumpTypeErrors(bytes));
    const reported = out.length > 0;
    if (!reported) {
      silent++;
      continue;
    }
    if (!KNOWN_VIOLATIONS.has(c.tag)) {
      wrong.push(`[§${c.tag}] code ${out[0]}: ${c.src.replace(/\n/g, " ").trim().slice(0, 90)}`);
    }
  }
  for (const tag of KNOWN_VIOLATIONS) {
    const still = cases.some((c) =>
      c.tag === tag &&
      (dumpErrors(enc.encode(c.src)).length > 0 || dumpTypeErrors(enc.encode(c.src)).length > 0)
    );
    if (!still) fixed.push(tag);
  }
  console.log(`    rung 3 accepting the spec: ${silent} of ${cases.length} silent, ` +
    `${KNOWN_VIOLATIONS.size} tags still refused`);
  if (wrong.length > 0) {
    throw new Error(`the spec runs these and this checker refuses them:\n  ` + wrong.join("\n  "));
  }
  if (fixed.length > 0) {
    throw new Error(`no longer refused — take them out of KNOWN_VIOLATIONS:\n  ` + fixed.join("\n  "));
  }
});
