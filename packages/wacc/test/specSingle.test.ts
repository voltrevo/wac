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
 * The one program the spec calls illegal that this checker still accepts. It was 47, then 16.
 *
 * And it is not a rule: the case is a *multi-file* program recorded with one file. What the spec
 * writes is `main.wac` importing `foo` from a `b.wac` that does not export it, and the recording
 * kept the file that carries the `// error:` marker — so what reaches this test is an import of a
 * file nobody supplied. Refusing it would mean refusing every import, which is the opposite of
 * right. The multi-file contract next door holds the rule that governs it, and it passes 15 of 15.
 *
 * The 15 that went in one pass were nine rules: `const` initialisers that are not constant, packed
 * nullables below the outermost `[]`, a narrowed name being written in its own branch, template
 * arity, a variant name shared by two enums, a parent struct nobody declared, a string literal used
 * as an operand, a payload written in a type test, laundering a const reference through a field or
 * an element, `core` importing a name it does not export, inference through a funcref call, a
 * generic instantiating itself with a bigger type — and one that was never a checker rule at all:
 * the lexer's errors were computed and then dropped on the floor by `dumpErrors`.
 *
 * None of these were visible before the corpus was recorded rather than read: the text extractor
 * found 101 of the 304 illegal programs the suite runs, and every one of these lives in the other
 * two thirds.
 */
const KNOWN_MISSES = new Set<string>([
  // **A positional key, and it moved.** `#N` is the runner's index over cases sharing a test name,
  // so it names a program only against the sequence that produced it. Withdrawing one `// error:`
  // block from `spec/spec/funcrefs.md` — `c.inc` is a value now, `design/lang/0002` tier one — shifted
  // every block after it down by one, and this entry pointed at its neighbour.
  //
  // What it names is a *multi-file* program: `import { foo } from "./b.wac"` where `b.wac` does not
  // export `foo`. A single-file runner has no `b.wac`, so it cannot refuse it, which is the class the
  // paragraph above calls "`core` importing a name it does not export". The miss is the runner's
  // scope rather than the checker's, which is why it is known rather than fixed.
  "every block the spec marks `// error:` is still an error#28",
]);

/**
 * The legal programs this checker refuses. **None.** It was fourteen when the corpus was recorded.
 *
 * Eleven were one bug: a local aliasing something const could not be *rebound*, so every linked-list
 * walk in the spec was illegal. A twelfth was `match` used as an expression not narrowing its
 * subject. The thirteenth was the parser not accepting `trap` with a message. The last was a generic
 * enum's constructor: `Wrap.W(Box(5))` could not be built, because the payload's written type kept
 * the enum's `T` and the bare `Box(5)` was then asked to be one.
 */
const KNOWN_FALSE_ALARMS = new Set<string>([]);

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
