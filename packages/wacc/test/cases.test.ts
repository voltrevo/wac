// The case corpus, run against wacc.
//
// The same files `compiler/wacCases.test.ts` holds the reference to, and the point of their being
// files rather than TypeScript: two compilers read one corpus, and a third could.
//
// Nothing here compares wacc to the reference. Each case says what it wants, so a disagreement is
// with the *case*, and the case is four lines long — which is the whole reason this exists. Every
// oracle in this package needed the repository standing up to say that something was wrong somewhere;
// these say what, in a program small enough to fix against.
//
// Misses are named, as everywhere else here, so the list fails in both directions.

import { loadCases } from "../../../spec/cases/cases.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as (
  p: string[],
  s: string[],
  e: string,
) => Int32Array;
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;
const enc = new TextEncoder();

const cases = await loadCases();

/**
 * The cases wacc does not meet yet, each with what it is waiting for.
 *
 * Both of these are in `specSingle`'s named misses as well, among 39 that the spec corpus counts and
 * cannot show you: there they are a tally, and here they are four lines each.
 */
const KNOWN_MISSES = new Map<string, string>([
  ["0024-a-literal-that-does-not-fit-is-refused.wac",
   "an integer literal wider than its slot is accepted"],
  ["0025-a-packed-type-cannot-be-nullable.wac",
   "a `u8?` field is accepted"],
]);

Deno.test("cases: wacc against the corpus", async () => {
  const missed: string[] = [];
  const unexpectedlyMet: string[] = [];

  for (const c of cases) {
    const paths = c.files.map(f => f[0]);
    const sources = c.files.map(f => f[1]);
    let met = true;
    let detail = "";

    const parseRefused = sources.some(s => dumpErrors(enc.encode(s)).length > 0);
    const checkRefused = parseRefused ||
      dumpTypeErrorsFiles(paths, sources, c.entry).length > 0;

    if (c.expect.kind === "refused") {
      met = checkRefused;
      if (!met) detail = "accepted";
    } else if (checkRefused) {
      met = false;
      detail = "refused";
    } else {
      const why = blockedFiles(paths, sources, c.entry);
      if (why !== "") {
        met = false;
        detail = why;
      } else if (c.expect.kind === "answers") {
        const bytes = Uint8Array.from(emitFiles(paths, sources, c.entry) as unknown as number[]);
        try {
          const inst = await WebAssembly.instantiate(bytes as BufferSource, {});
          const fn = inst.instance.exports[c.expect.fn];
          if (typeof fn !== "function") {
            met = false;
            detail = `no ${c.expect.fn} export`;
          } else {
            const got = String((fn as () => unknown)());
            if (got !== c.expect.value) {
              met = false;
              detail = `answered ${got}, wanted ${c.expect.value}`;
            }
          }
        } catch (e) {
          met = false;
          detail = `did not run — ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    const known = KNOWN_MISSES.has(c.name);
    if (!met && !known) missed.push(`${c.name}: ${detail} — ${c.why}`);
    if (met && known) unexpectedlyMet.push(c.name);
  }

  console.log(
    `    cases: ${cases.length - missed.length - KNOWN_MISSES.size} of ${cases.length} met by wacc, ` +
      `${KNOWN_MISSES.size} known misses`,
  );
  if (missed.length > 0) throw new Error(`wacc does not meet these cases:\n  ${missed.join("\n  ")}`);
  if (unexpectedlyMet.length > 0) {
    throw new Error(`now met — take them out of KNOWN_MISSES:\n  ${unexpectedlyMet.join("\n  ")}`);
  }
});
