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
// Both numbers are asserted as **floors**, because they are meant to rise and a slot that adds a
// feature must not quietly lose one.

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
  for (const [tag, src] of accept) {
    const r = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
    if (!r.ok) continue;                       // a case whose program the reference itself refuses
    if (blocked(enc.encode(src)) !== "") continue;
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
  if (rejected < 84) {
    throw new Error(`wacc rejects only ${rejected} of ${reject.length} programs the reference ` +
      `rejects, was all of them — rung 3 went backwards`);
  }
});
