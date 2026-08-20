// The spec's own cases, put through wacc.
//
// `compiler/wacSpec.test.ts` is the reference's conformance suite: 529 tests, each named for the
// `[§tag]` in `spec/spec/*.md` it covers. It is the closest thing this repository has to a
// definition of *done*, and until now nothing asked wacc about it — wacc's oracles were its own
// corpus and its own generated sweep, both of which measure agreement on programs **someone here
// thought to write**.
//
// So this extracts the programs out of that file and asks two questions of each:
//
//   - a case the reference *accepts*: does wacc emit it whole, and does every answer agree?
//   - a case the reference *rejects*: does wacc's checker reject it too?
//
// The second number is the one that says how far rung 3 has to go. wacc's checker is a subset by
// design — it never invents a diagnostic and never contradicts one — so it accepts programs the
// reference refuses, and every one of those is a program a wacc-only toolchain would let through.
//
// Three things are asserted, and none of them is an editable number:
//
//   - every program the reference rejects, wacc rejects — all of them, not a count
//   - no answer differs, `KNOWN_DIFFERENT` being empty and shrink-only
//   - the programs wacc *declines* are exactly `KNOWN_UNEMITTABLE`, by tag and shrink-only
//
// The third was a `console.log` until 2026-08-20. `blocked()` is wacc's decline mechanism, so the loop
// asked it "can you emit this?", got an explicit reason back, and `continue`d before the counter — so
// ten spec behaviours wacc cannot produce were a number in a log line that nothing could fail on. That
// is `issues/lang/0170a`'s silence living in the instrument instead of the compiler.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emit = mod.emit as (src: Uint8Array) => Uint8Array;
const blocked = mod.blocked as (src: Uint8Array) => string;
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/** The single-file cases, by tag. Multi-file ones need a surface this test does not have. */
function extract(text: string): { accept: [string, string][]; reject: [string, string][] } {
  const accept: [string, string][] = [];
  const reject: [string, string][] = [];
  for (const block of text.split(/\nDeno\.test\(/).slice(1)) {
    const tag = block.match(/\[§([a-z0-9-]+)\]/)?.[1] ?? "untagged";
    if (/\b(runMulti|errMulti)\(/.test(block)) continue;
    const run = block.match(/await run\(\s*`([\s\S]*?)`\s*\)/);
    const err = block.match(/\berr\(\s*`([\s\S]*?)`\s*\)/);
    if (run) accept.push([tag, run[1]]);
    else if (err) reject.push([tag, err[1]]);
  }
  return { accept, reject };
}

Deno.test("the spec's own cases, answered by wacc", async () => {
  const { accept, reject } = extract(await Deno.readTextFile("compiler/wacSpec.test.ts"));
  if (accept.length < 250 || reject.length < 80) {
    throw new Error(`extracted only ${accept.length} accept and ${reject.length} reject cases — ` +
      `the shape of wacSpec.test.ts has changed and this is measuring a fraction of it`);
  }

  let whole = 0;
  let compared = 0;
  let agreed = 0;
  const differ: string[] = [];
  /**
   * Programs that emit and then do not instantiate.
   *
   * Reported rather than asserted, and they were invisible until 2026-08-13: they used to go into
   * the same list as the answer differences, which is *counted* by `compared - agreed` — and an
   * instantiation failure never reaches a comparison, so it added nothing to that count and the
   * message it was in never printed. Three of them had been sitting there. `issues/lang/0116`.
   */
  const wontLoad: string[] = [];
  /**
   * Programs wacc **declines**, with the reason it gave.
   *
   * This used to be `if (blocked(...) !== "") continue;` — and `blocked()` is the decline mechanism,
   * so the test asked wacc "can you emit this?", received an explicit *no, because…*, and dropped the
   * sentence on the floor. The skip also came before `whole++`, so a declined program could not make
   * the answer count worse either — they sat behind a `console.log` that nothing asserted, which is
   * the same silence `issues/lang/0170a` is about, in the instrument rather than the compiler.
   *
   * **The gap between 279 and `whole` is not the gap.** 279 minus 248 is 31, and reading that as "31
   * programs wacc cannot emit" is wrong: 21 of them are refused by the *reference* and skipped one
   * line above, because extracting a `run(` block does not guarantee a program that compiles alone.
   * **Ten** are wacc's, which is what this list holds. Counting the wrong subtraction is why the
   * reason is captured rather than the count.
   */
  const declined: string[] = [];
  for (const [tag, src] of accept) {
    const r = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
    if (!r.ok) continue;                       // a case whose program the reference itself refuses
    const why = blocked(enc.encode(src));
    if (why !== "") {
      declined.push(`§${tag}: ${why.slice(0, 90)}`);
      continue;
    }
    whole++;
    let theirs: WebAssembly.Instance;
    let ours: WebAssembly.Instance;
    try {
      theirs = new WebAssembly.Instance(
        new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)),
        {},
      );
      ours = new WebAssembly.Instance(
        new WebAssembly.Module(Uint8Array.from(emit(enc.encode(src)) as unknown as number[])),
        {},
      );
    } catch (e) {
      wontLoad.push(`§${tag}: ${(e as Error).message.slice(0, 70)}`);
      continue;
    }
    // Every export that takes nothing, which is what can be called from here.
    for (const name of Object.keys(theirs.exports)) {
      const a = theirs.exports[name];
      const b = ours.exports[name];
      if (typeof a !== "function" || typeof b !== "function" || a.length !== 0) continue;
      let want: unknown;
      try {
        want = (a as () => unknown)();
        String(want);
      } catch {
        continue;                              // the reference traps, or answers a reference
      }
      let got: unknown;
      try {
        got = (b as () => unknown)();
      } catch (e) {
        got = `threw: ${(e as Error).message.slice(0, 40)}`;
      }
      compared++;
      if (String(want) === String(got)) agreed++;
      else differ.push(`§${tag} ${name}: reference=${want} wacc=${got}`);
    }
  }

  // A rejection is a rejection wherever it comes from: the spec's own harness accepts any
  // diagnostic, and two of these programs are refused by wacc's *parser* — `5++` and an `override`
  // on an enum method — which counting only type errors called a miss.
  let rejected = 0;
  for (const [, src] of reject) {
    const bytes = enc.encode(src);
    if (dumpTypeErrors(bytes).length > 0 || dumpErrors(bytes).length > 0) rejected++;
  }

  console.log(`    spec: ${agreed}/${compared} answers agree (${whole} of ${accept.length} ` +
    `programs emitted whole), ${rejected}/${reject.length} rejections are also wacc's`);
  if (wontLoad.length > 0) {
    console.log(`    and ${wontLoad.length} emit but do not instantiate:\n      ` +
      wontLoad.join("\n      "));
  }

  // The canary: a run that emitted nothing would agree about nothing and say so as a triumph.
  if (compared < 200) throw new Error(`only ${compared} answers were compared`);

  /**
   * Answers that are allowed to differ: none.
   *
   * There was one for a few hours — `§wac-override-dispatch`, where `is` narrowing did not choose the
   * narrowed type's method — and fixing it emptied this set, which is what the check below is for: an
   * entry that stops differing has to be taken out, so the allowance can only shrink.
   */
  const KNOWN_DIFFERENT = new Set<string>([]);
  const keyOf = (d: string) => d.match(/^§([a-z0-9-]+ \w+):/)?.[1] ?? "";
  const unexpected = differ.filter((d) => !KNOWN_DIFFERENT.has(keyOf(d)));
  const stillDiffering = differ.filter((d) => KNOWN_DIFFERENT.has(keyOf(d)));
  if (stillDiffering.length < KNOWN_DIFFERENT.size) {
    throw new Error(
      `a known difference agrees now — take it out of KNOWN_DIFFERENT:\n  ` +
        [...KNOWN_DIFFERENT].join("\n  "),
    );
  }

  // Floors. Both are meant to rise.
  if (unexpected.length > 0) {
    throw new Error(`${unexpected.length} spec answers differ, and only ` +
      `${KNOWN_DIFFERENT.size} is allowed to:\n  ` + unexpected.join("\n  "));
  }
  // **All of them, rather than a number.** This was `rejected < 84`, and 84 was the corpus's size on
  // the day it was written — so withdrawing one rule from `spec/spec` made a green checker fail a
  // floor it still met. `§wac-fnref-nocapture-j4wk8pm` was the rule: `c.inc` is a value in wacc now
  // (`design/lang/0002` tier one), its `err(...)` program left `wacSpec.test.ts`, and the harvested
  // corpus went to 83.
  //
  // The invariant the message always stated is "was all of them", and that is what it asks now —
  // corpus-size independent, so it cannot be wrong for a reason that has nothing to do with the
  // checker. A ratchet whose number has to be edited when the corpus changes teaches people to edit
  // the number.
  if (rejected < reject.length) {
    throw new Error(`wacc rejects only ${rejected} of ${reject.length} programs the reference ` +
      `rejects, was all of them — rung 3 went backwards`);
  }

  /**
   * Spec programs wacc declines, by tag. **Shrink-only, and not a floor.**
   *
   * A count would be the wrong shape here for the reason this file already gives about `rejected`: a
   * ratchet whose number has to be edited when the corpus changes teaches people to edit the number.
   * Keyed by tag it cannot drift with the corpus — a case that leaves `wacSpec.test.ts` takes its
   * entry with it, and a case that starts emitting has to be taken out by hand.
   *
   * Every entry is a spec behaviour a wacc-only toolchain cannot produce, so this list is the thing
   * worth reading in this file. It is not one bug: only six of the accept cases declare a nullable
   * primitive (`issues/lang/0171a`), so the rest are other gaps.
   */
  const KNOWN_UNEMITTABLE = new Set<string>([
    // A nullable primitive, which the emitter has no type for at all — `issues/lang/0171a`. Six of
    // the ten, and `spec/spec/types.md:455` gives one of them as *the* way to read one.
    "wac-nullable-primitive-4mzq7vp",   // "local of an unspelled type"
    "wac-ternary-nullable-9pqk3vm",     //   same
    "wac-packed-nullable-2knq6wv",      //   same
    "untagged",                         // "untyped name" — also a nullable primitive
    // Four gaps of their own, and each reason is the emitter's own sentence:
    "wac-generic-struct-9tkq4wm",       // "a construction of Parented<i32> with 2 of 1 fields"
    "enum-methods-6vkq2wn",             // "a type this emitter names only while emitting"
    "wac-is-undefined-type-6qbn3wr",    // "a test for Q on a P"
    "wac-type-name-scope-8vqk3mn",      // "a test for Other on a P"
  ]);
  const tagOf = (d: string) => d.match(/^§([a-z0-9-]+):/)?.[1] ?? "";
  const declinedTags = new Set(declined.map(tagOf));
  const newly = declined.filter((d) => !KNOWN_UNEMITTABLE.has(tagOf(d)));
  if (newly.length > 0) {
    throw new Error(
      `${newly.length} spec program(s) wacc newly declines — a rule got stricter, or a feature ` +
        `regressed. Each is a spec behaviour wacc cannot emit:\n  ` + newly.join("\n  "),
    );
  }
  const nowEmitting = [...KNOWN_UNEMITTABLE].filter((t) => !declinedTags.has(t));
  if (nowEmitting.length > 0) {
    throw new Error(
      `${nowEmitting.length} known-unemittable case(s) emit now — take them out of ` +
        `KNOWN_UNEMITTABLE:\n  ` + nowEmitting.join("\n  "),
    );
  }
});
