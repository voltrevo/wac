// **The contract, where it takes more than one file to state it.**
//
// `specCheck.test.ts` and `specAccept.test.ts` hold this checker to the programs a single file
// states. They cannot reach the rules that are *about* files — export visibility, re-export,
// cross-file type identity and type-name scope — because none of those can be written down in one
// file. Those 56 programs sit in `wacSpec.test.ts` as `Map`s, and nothing here looked at them until
// the corpus started being recorded rather than read: `§wac-no-reexport-f7kn4wq` had no oracle at
// all, so a rule written to satisfy it would have been a rule nothing could measure.
//
// Both lists below are empty. They are kept rather than deleted because a list fails in both
// directions and an empty one still says so — a case that starts being missed lands here as a
// failure rather than as a quietly smaller number.

import { wacBind } from "../../../harness/wacBind.ts";
import { assertKeysExist, Case, keyed, multiFileCases, recordedHash } from "./specCases.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as (
  paths: string[],
  sources: string[],
  entry: string,
) => Int32Array;
const enc = new TextEncoder();

/**
 * **Empty**, and it started at nine.
 *
 * They were two rules rather than nine bugs, and each closed its whole group at once. Four were
 * export visibility: a name declared without `export`, or one the file merely imports, is not that
 * file's to give away. Five were `§wac-type-name-scope-8vqk3mn`: writing a type's name requires
 * bringing it into scope, variants included.
 */
const KNOWN_MISSES = new Set<string>([]);

/**
 * **Empty.** It held one: two modules each declaring a `Dup`, one imported as `Dup as DupB`. Names
 * were declared under the name the *declaring* file gave them, so the alias was never a type and the
 * second module's fields were looked up on the first module's struct.
 */
const KNOWN_FALSE_ALARMS = new Set<string>([]);

/** A program is refused when any phase says no; which phase is not the language's business. */
function refuses(c: Case): boolean {
  for (const [, src] of c.files) {
    if (dumpErrors(enc.encode(src)).length > 0) return true;
  }
  try {
    return dumpTypeErrorsFiles(c.files.map(f => f[0]), c.files.map(f => f[1]), c.entry).length > 0;
  } catch {
    return true;
  }
}

Deno.test("the recorded corpus is the one the spec suite currently states", async () => {
  const src = await Deno.readTextFile(new URL("../../../compiler/wacSpec.test.ts", import.meta.url));
  const hash = [...new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src)),
  )].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== recordedHash()) {
    throw new Error(
      "compiler/wacSpec.test.ts has changed since this corpus was taken — regenerate it:\n" +
        "  deno run -A packages/wacc/tools/specCases.ts",
    );
  }
});

Deno.test("rung 3: every multi-file program the spec calls illegal, refused", () => {
  const cases = multiFileCases().filter(c => !c.ok);
  if (cases.length < 12) throw new Error(`only ${cases.length} multi-file rejections found`);
  const keys = keyed();
  assertKeysExist(KNOWN_MISSES, keys, "KNOWN_MISSES");

  const missed: string[] = [];
  const unexpectedlyCaught: string[] = [];
  for (const c of cases) {
    const key = keys.get(c)!;
    const refused = refuses(c);
    if (!refused && !KNOWN_MISSES.has(key)) missed.push(`${key}\n      spec says: ${c.message}`);
    if (refused && KNOWN_MISSES.has(key)) unexpectedlyCaught.push(key);
  }
  console.log(
    `    rung 3 across files: ${cases.length - missed.length - KNOWN_MISSES.size} of ${cases.length} refused, ` +
      `${KNOWN_MISSES.size} known misses`,
  );
  if (missed.length) throw new Error(`the spec calls these illegal and wacc accepts them:\n  ${missed.join("\n  ")}`);
  if (unexpectedlyCaught.length) {
    throw new Error(`now refused — take them out of KNOWN_MISSES:\n  ${unexpectedlyCaught.join("\n  ")}`);
  }
});

Deno.test("rung 3: every multi-file program the spec calls legal, accepted", () => {
  const cases = multiFileCases().filter(c => c.ok);
  if (cases.length < 35) throw new Error(`only ${cases.length} multi-file acceptances found`);
  const keys = keyed();
  assertKeysExist(KNOWN_FALSE_ALARMS, keys, "KNOWN_FALSE_ALARMS");

  const alarms: string[] = [];
  const nowSilent: string[] = [];
  for (const c of cases) {
    const key = keys.get(c)!;
    const refused = refuses(c);
    if (refused && !KNOWN_FALSE_ALARMS.has(key)) alarms.push(key);
    if (!refused && KNOWN_FALSE_ALARMS.has(key)) nowSilent.push(key);
  }
  console.log(
    `    rung 3 across files: ${cases.length - alarms.length - KNOWN_FALSE_ALARMS.size} of ${cases.length} silent, ` +
      `${KNOWN_FALSE_ALARMS.size} known false alarms`,
  );
  if (alarms.length) throw new Error(`the spec calls these legal and wacc refuses them:\n  ${alarms.join("\n  ")}`);
  if (nowSilent.length) {
    throw new Error(`now silent — take them out of KNOWN_FALSE_ALARMS:\n  ${nowSilent.join("\n  ")}`);
  }
});
