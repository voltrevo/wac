// The reference's own type-checker test suite, read as a corpus.
//
// `specCorpus.ts` reads the *spec's* tests: 101 rejection programs across 63 tags, which is a sample
// of the language chosen to illustrate it. This reads the thing the reference is actually held to —
// `wacTypeCheck.test.ts`, 88 `ok` programs and 124 `fail` programs — and it is a different oracle in
// a way that matters:
//
//   - the `ok` half is a **false-alarm** corpus. Every one of those programs type-checks cleanly, so
//     a diagnostic from us is a bug in us, with a named program to look at rather than a file
//     somewhere in `packages/`.
//   - the `fail` half is a **recall** corpus, and three times the size of the spec's per-family
//     coverage in the places the reference cares most about.
//
// Neither is a specification of the language, and the spec corpus stays: what a compiler's own tests
// cover is what its author thought to test, which is a different bias from what the spec chose to
// explain. Two biases disagree in more places than one does.

/** Where the reference's checked-in test lives, relative to this file, as `specCorpus.ts` does it. */
const REF_TEST = new URL(
  "../../../../wac/atoms/wac/wacTypeCheck.test.ts",
  import.meta.url,
).pathname;

export type RefCase = { kind: "ok" | "fail"; src: string; at: number };

/**
 * Every single-file `ok(…)` and `fail(…)` program, in document order.
 *
 * Scanned rather than parsed, and anchored at the start of a line, which is what keeps it honest:
 * `export Shape ok(Circle c)` appears *inside* several of the programs, and `function ok(src)` is the
 * helper's own definition. Both are `ok(` and neither is a call. Anchoring costs nothing and excludes
 * both without a list of exceptions to maintain.
 *
 * A call whose first argument is not a literal is skipped and counted — see `skipped` — because a
 * corpus that silently drops what it cannot read reports full coverage of a subset of itself.
 */
export function referenceCases(): { cases: RefCase[]; skipped: number } {
  const text = Deno.readTextFileSync(REF_TEST);
  const cases: RefCase[] = [];
  let skipped = 0;

  // `^[ \t]*(ok|fail)\(` — a call at statement position. The literal is read by hand from the quote
  // onwards because a regex for a string literal with escapes is the kind of thing that is wrong once
  // and then wrong forever.
  const call = /^[ \t]*(ok|fail)\(\s*/gm;
  for (const m of text.matchAll(call)) {
    const open = m.index! + m[0].length;
    const quote = text[open];
    if (quote !== '"' && quote !== "`" && quote !== "'") {
      skipped++;
      continue;
    }
    let i = open + 1;
    let out = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") {
        // The programs use `\n` and `\"` and nothing more exotic; anything else is passed through as
        // written, which is what a wac lexer would see anyway.
        const next = text[i + 1];
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
        continue;
      }
      out += text[i];
      i++;
    }
    if (i >= text.length) {
      skipped++;
      continue;
    }
    cases.push({ kind: m[1] as "ok" | "fail", src: out, at: m.index! });
  }
  return { cases, skipped };
}
