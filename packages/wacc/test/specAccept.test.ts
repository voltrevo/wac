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
 * Programs the spec runs and this checker still refuses, by tag.
 *
 * — `wac-ternary-lca`: a ternary whose branches are a subtype and its parent. The branches "agree"
 *   through the hierarchy, and this checker compares them for equality.
 * — `wac-nullable-primitive`: `i32?` fields and the shapes around them.
 * — `wac-shadow-param` (twice): a local shadowing a parameter, which this checker poisons to unknown
 *   and then complains about.
 * — `wac-generic-expected-position`: a bare `Box` in a position that supplies its argument.
 * — `wac-generic-fn`: `T max<T>(T a, T b) { return a > b ? a : b; }` — comparison on two values of a
 *   type parameter.
 * — `wac-inherited-method-type`: a method reached through a parent, typed as missing.
 */
const KNOWN_VIOLATIONS = new Set([
  "wac-ternary-lca-q7fk3wn",
  "wac-nullable-primitive-4mzq7vp",
  "wac-shadow-param-7apc0wt",
  "wac-generic-expected-position-3qmz8vk",
  "wac-generic-fn-5hvq3mt",
  "wac-inherited-method-type-9dkq3wv",
  // A ternary whose branches are a nullable and its base — the same shape as `wac-ternary-lca`, one
  // nullable along.
  "wac-ternary-nullable-9pqk3vm",
]);

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
