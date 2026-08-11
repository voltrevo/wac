// **The contract, for the programs a single file states — all 671 of them.**
//
// This replaces what `specCheck.test.ts` and `specAccept.test.ts` measured by reading
// `wacSpec.test.ts` as text. That extractor finds 101 illegal programs; the suite *executes* 304.
// The gap is the ceiling of reading a file whose test data is wac source inside template literals —
// a regular expression finds the calls written in the shape it knows, and the spec does not confine
// itself to one shape. Recording what the compiler was handed finds all of them, and keeps finding
// them when the spec grows.
//
// The widening was worth three times the corpus and immediately worth more than that: it exposed
// **14 legal programs this checker refuses**, none of which any oracle here had ever looked at. A
// false alarm is the failure this package minds most, so they are named individually below rather
// than counted.
//
// Both lists fail in both directions. A new miss breaks this file, and fixing a named one breaks it
// too, which is what makes them shrink instead of rot.

import { wacBind } from "../../../harness/wacBind.ts";
import { assertKeysExist, Case, keyed, singleFileCases } from "./specCases.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/** A program is refused when any phase says no; which phase is not the language's business. */
function refuses(c: Case): boolean {
  const b = enc.encode(c.files[0][1]);
  return dumpErrors(b).length > 0 || dumpTypeErrors(b).length > 0;
}

/**
 * The 17 programs the spec calls illegal that this checker still accepts. It was 47.
 *
 * Named rather than counted, and they are a handful of rules rather than 39 bugs. What is left, in
 * groups: generic inference failures,
 * `§wac-packed-nullable` in the positions the packed type is refused in, and module-level `const`
 * initialisers that are not constant.
 *
 * The eight that went were `match`, and they went together because they are one feature: covering
 * every variant, not naming one twice, not writing an `else` that nothing reaches, not matching a
 * nullable, not rebinding the subject an arm has narrowed, not shadowing it with a binding, and arms
 * whose values disagree.
 *
 * None of these were visible before the corpus was recorded rather than read: the text extractor
 * found 101 of the 304 illegal programs the suite runs, and every one of these lives in the other
 * two thirds.
 */
const KNOWN_MISSES = new Set<string>([
  "[§wac-core-read-6kv4pnx] Read distinguishes an empty read from a failed one#1",
  "every block the spec marks `// error:` is still an error#14",
  "every block the spec marks `// error:` is still an error#30",
  "every block the spec marks `// error:` is still an error#55",
  "[§wac-diag-lex-unterm-comment-r4jn8xq] unterminated block comment is a lex-phase error#0",
  "[§wac-modconst-notconst-r4jn9kq] non-constant initialisers are rejected#4",
  "[§wac-modconst-notconst-r4jn9kq] non-constant initialisers are rejected#10",
  "[§wac-modconst-sized-5wnq8kt] the length must be constant and the elements defaultable#1",
  "[§wac-generic-fn-5hvq3mt] inference failures and misuse are compile errors#3",
  "[§wac-generic-fn-5hvq3mt] inference failures and misuse are compile errors#5",
  "[§wac-generic-template-check-2wkq7nm] a mistake independent of T is caught at the definition#1",
  "[§wac-generic-struct-9tkq4wm] the errors a generic can raise#1",
  "[§wac-narrow-if-2mkq8vp] what does not narrow, and the const rule#1",
  "[§enum-is-qualified-8jkq4wp] a payload written in a type test is rejected#0",
  "[§wac-const-deep-j6b1nyg] what deep const does refuse#5",
  "[§wac-const-deep-j6b1nyg] what deep const does refuse#6",
  "[§wac-packed-nullable-2knq6wv] an array of them is refused too#3",
]);

/**
 * The one legal program this checker refuses. It was fourteen when the corpus was first recorded.
 *
 * Eleven were one bug: a local aliasing something const could not be *rebound*, so every linked-list
 * walk in the spec was illegal. A twelfth was `match` used as an expression not narrowing its
 * subject, which is fixed here — only the statement form narrowed, so `case Circle: s.radius` looked
 * for a field on the un-narrowed subject. The two left are two features: a generic enum's
 * constructor is not callable, and the parser does not accept `trap` with a message.
 */
const KNOWN_FALSE_ALARMS = new Set<string>([
  "[§wac-generic-enum-7dkq2mv] a generic enum works, with methods and several arguments#0",
]);

Deno.test("rung 3: every single-file program the spec calls illegal, refused", () => {
  const cases = singleFileCases().filter(c => !c.ok);
  if (cases.length < 280) throw new Error(`only ${cases.length} single-file rejections recorded`);
  const keys = keyed();
  assertKeysExist(KNOWN_MISSES, keys, "KNOWN_MISSES");

  const missed: string[] = [];
  const unexpectedlyCaught: string[] = [];
  for (const c of cases) {
    const key = keys.get(c)!;
    const refused = refuses(c);
    if (!refused && !KNOWN_MISSES.has(key)) missed.push(`"${key}",`);
    if (refused && KNOWN_MISSES.has(key)) unexpectedlyCaught.push(key);
  }
  console.log(
    `    rung 3, one file: ${cases.length - missed.length - KNOWN_MISSES.size} of ${cases.length} refused, ` +
      `${KNOWN_MISSES.size} known misses`,
  );
  if (missed.length) throw new Error(`the spec calls these illegal and wacc accepts them:\n  ${missed.join("\n  ")}`);
  if (unexpectedlyCaught.length) {
    throw new Error(`now refused — take them out of KNOWN_MISSES:\n  ${unexpectedlyCaught.join("\n  ")}`);
  }
});

Deno.test("rung 3: every single-file program the spec calls legal, accepted", () => {
  const cases = singleFileCases().filter(c => c.ok);
  if (cases.length < 340) throw new Error(`only ${cases.length} single-file acceptances recorded`);
  const keys = keyed();
  assertKeysExist(KNOWN_FALSE_ALARMS, keys, "KNOWN_FALSE_ALARMS");

  const alarms: string[] = [];
  const nowSilent: string[] = [];
  for (const c of cases) {
    const key = keys.get(c)!;
    const refused = refuses(c);
    if (refused && !KNOWN_FALSE_ALARMS.has(key)) alarms.push(`"${key}",`);
    if (!refused && KNOWN_FALSE_ALARMS.has(key)) nowSilent.push(key);
  }
  console.log(
    `    rung 3, one file: ${cases.length - alarms.length - KNOWN_FALSE_ALARMS.size} of ${cases.length} silent, ` +
      `${KNOWN_FALSE_ALARMS.size} known false alarms`,
  );
  if (alarms.length) throw new Error(`the spec calls these legal and wacc refuses them:\n  ${alarms.join("\n  ")}`);
  if (nowSilent.length) {
    throw new Error(`now silent — take them out of KNOWN_FALSE_ALARMS:\n  ${nowSilent.join("\n  ")}`);
  }
});
