// **The contract, where it takes more than one file to state it.**
//
// `specCheck.test.ts` and `specAccept.test.ts` hold this checker to the spec's single-file programs.
// They cannot reach the rules that are *about* files — export visibility, re-export, cross-file type
// identity and type-name scope — because none of those can be written down in one file. Those 56
// programs sit in `wacSpec.test.ts` as `Map`s, and until now nothing in wacc looked at them: the
// clause `§wac-no-reexport-f7kn4wq` had no oracle at all, so a rule written to satisfy it would have
// been a rule nothing could measure.
//
// The corpus is generated rather than parsed — `tools/specMultiCases.ts` says why, and the hash below
// is what notices when the spec suite has moved on.
//
// Misses are named, not counted, so the list fails in both directions: a new one breaks this file
// and fixing an old one breaks it too, which is what makes it shrink instead of rot.

import { wacBind } from "../../../harness/wacBind.ts";

type Case = { test: string; entry: string; files: [string, string][]; ok: boolean; message: string };
type Corpus = { source: string; sha256: string; cases: Case[] };

const corpus: Corpus = JSON.parse(
  await Deno.readTextFile(new URL("./specMultiCases.json", import.meta.url)),
);

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as (
  paths: string[],
  sources: string[],
  entry: string,
) => Int32Array;
const enc = new TextEncoder();

/**
 * The nine the spec calls illegal that this checker still accepts, and the one legal program it
 * wrongly refuses.
 *
 * They are two rules rather than nine bugs. Four are **export visibility**: a name that is declared
 * without `export`, or merely imported, is not the file's to give away. Five are
 * `§wac-type-name-scope-8vqk3mn`: writing a type's name requires importing it, which this checker
 * does not model because a declaration table keyed by bare name has no idea which file a name came
 * from — the same gap that makes `§wac-samename-struct-4jhq7wn` the one false alarm here, where two
 * modules each declare a `Point` and only the first is kept.
 */
const KNOWN_MISSES = new Set<string>([
  "[§wac-struct-export-m3kq8wp] only an exported struct can be imported#1",
  "(audit-16) importing a non-exported struct is a compile error#0",
  "[§wac-no-reexport-f7kn4wq] (audit-17) importing a symbol doesn't implicitly re-export it#0",
  "[§wac-modconst-import-p7fm2wj] constants obey export#1",
  "[§wac-type-name-scope-8vqk3mn] a type name must be in scope in the file that writes it#0",
  "[§wac-type-name-scope-8vqk3mn] a type name must be in scope in the file that writes it#1",
  "[§wac-type-name-scope-8vqk3mn] a type name must be in scope in the file that writes it#2",
  "[§wac-type-name-scope-8vqk3mn] a type name must be in scope in the file that writes it#3",
  "[§wac-type-name-scope-8vqk3mn] the wrong answer that came of it#0",
]);

const KNOWN_FALSE_ALARMS = new Set<string>([
  "[§wac-samename-struct-4jhq7wn] same-named structs in two modules stay distinct#2",
]);

/**
 * A named case that no longer exists is worse than an unnamed one: it reads as coverage and asserts
 * nothing. The first version of this file had three such keys — a test states several programs and
 * the illegal one is rarely the first, so `#0` quietly named a case that was already passing.
 */
function assertKeysExist(ledger: Set<string>, keys: Map<Case, string>, what: string): void {
  const live = new Set(keys.values());
  const stale = [...ledger].filter(k => !live.has(k));
  if (stale.length) {
    throw new Error(`${what} names cases the corpus does not contain:\n  ${stale.join("\n  ")}`);
  }
}

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

function keyed(cases: Case[]): Map<Case, string> {
  const seen = new Map<string, number>();
  const out = new Map<Case, string>();
  for (const c of cases) {
    const nth = seen.get(c.test) ?? 0;
    seen.set(c.test, nth + 1);
    out.set(c, `${c.test}#${nth}`);
  }
  return out;
}

Deno.test("the multi-file corpus is the one the spec suite currently states", async () => {
  const src = await Deno.readTextFile(new URL("../../../compiler/wacSpec.test.ts", import.meta.url));
  const hash = [...new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src)),
  )].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== corpus.sha256) {
    throw new Error(
      "compiler/wacSpec.test.ts has changed since this corpus was taken — regenerate it:\n" +
        "  deno run -A packages/wacc/tools/specMultiCases.ts",
    );
  }
});

Deno.test("rung 3: every multi-file program the spec calls illegal, refused", () => {
  const cases = corpus.cases.filter(c => !c.ok);
  if (cases.length < 12) throw new Error(`only ${cases.length} multi-file rejections found`);
  const keys = keyed(corpus.cases);
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
    throw new Error(
      `now refused — take them out of KNOWN_MISSES:\n  ${unexpectedlyCaught.join("\n  ")}`,
    );
  }
});

Deno.test("rung 3: every multi-file program the spec calls legal, accepted", () => {
  const cases = corpus.cases.filter(c => c.ok);
  if (cases.length < 35) throw new Error(`only ${cases.length} multi-file acceptances found`);
  const keys = keyed(corpus.cases);
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
