// **The contract.** Every program `spec/spec` says is illegal, this checker refuses.
//
// The other rung-3 oracles compare wacc against the TypeScript compiler, and that comparison is a
// *guide*: it is cheap, it covers far more programs than the spec writes down, and it points at real
// rules. It is not the contract. The contract is the language definition — 101 `err(...)` programs
// carrying the tag of the clause that governs them — and where the two disagree, the spec wins and
// the reference is the one with the bug. `issues/lang/0085` is that already: `as! i31ref` truncates
// there and traps here, because `casts.md` says checked.
//
// So this file asserts what the language says, and the reference-shaped tests stay as instruments.
//
// The three that are still missed are named rather than counted. A named set fails in both
// directions: a new miss breaks it, and *fixing* one breaks it too, which is what makes the list
// shrink instead of rotting.

import { wacBind } from "../../../harness/wacBind.ts";
import { specRejections } from "./specCorpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/**
 * The one program the spec calls illegal that this compiler still accepts.
 *
 * `import { Read } from cor;` — an unquoted module name that is not `core`. It is a rule about
 * *where* a name comes from, which this slice does not model at all: it has no notion of module
 * identity, so it cannot tell `cor` from `core`.
 *
 * The list started at three. The other two — a generic struct that instantiates itself for ever, and
 * an enum with a method named after one of its variants — turned out to be refused by the **parser**,
 * which a first measurement missed by asking only the type checker. Which phase says no is not the
 * language's business, and asking one phase is how a compiler gets credited with a gap it does not
 * have.
 */
const KNOWN_MISSES = new Set([
  "wac-core-unquoted-3nqk7vd#0",
  "wac-generic-struct-9tkq4wm#1",
  "wac-narrow-if-2mkq8vp#3",
]);

Deno.test("rung 3: every program the spec calls illegal, refused", () => {
  const cases = specRejections();
  if (cases.length < 90) throw new Error(`only ${cases.length} spec rejections found`);

  // **Keyed per case, not per tag.** A tag governs more than one program — `wac-narrow-if` has two —
  // and a list keyed by tag let a refused one stand in for an allowed one, which is how the first
  // version of this file reported the same programs as both caught and missed on consecutive runs.
  const seen = new Map<string, number>();
  const missed: string[] = [];
  const unexpectedlyCaught: string[] = [];
  for (const c of cases) {
    const nth = seen.get(c.tag) ?? 0;
    seen.set(c.tag, nth + 1);
    const key = `${c.tag}#${nth}`;
    const bytes = enc.encode(c.src);
    // The parser counts: a program it will not read is one this compiler refuses, which is what the
    // spec asked for. Which phase says no is not the language's business.
    const refused = dumpErrors(bytes).length > 0 || dumpTypeErrors(bytes).length > 0;
    if (!refused && !KNOWN_MISSES.has(key)) missed.push(`${key}: ${c.src.replace(/\n/g, " ").slice(0, 80)}`);
    if (refused && KNOWN_MISSES.has(key)) unexpectedlyCaught.push(key);
  }
  console.log(`    rung 3 against the spec: ${cases.length - missed.length - KNOWN_MISSES.size} of ` +
    `${cases.length} refused, ${KNOWN_MISSES.size} known misses`);
  if (missed.length > 0) {
    throw new Error(`the spec calls these illegal and this checker allows them:\n  ` + missed.join("\n  "));
  }
  if (unexpectedlyCaught.length > 0) {
    throw new Error(`now caught — take them out of KNOWN_MISSES:\n  ` + unexpectedlyCaught.join("\n  "));
  }
});
