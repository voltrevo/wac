// bash naming itself and the line, mapped to our own name — the TypeScript copy.
//
// `differential.test.ts` and `packages/box/test/jobs.test.ts` are TypeScript and cannot import wac,
// so this rule exists twice. The other copy is `packages/sh/test/wac/shname.wac`, and
// `packages/sh/test/wac/shname_test.wac` reads the regex literal below and compares it with that
// one's — because two copies of a rule with nothing checking them is what this repository keeps
// getting bitten by.
//
// **`KNOWN` used to be here and is not.** It moved to `packages/sh/test/wac/knownstderr.wac` on
// 2026-08-30 with its last two readers, which are both wac. A nineteen-row table of exact strings is
// worth more care than a five-line regex: duplicating it across the boundary would cost far more and
// buy the same thing. `issues/system/0289b`.

/** bash naming itself and the line, mapped to our own name — see the note at the top. */
export function sameName(text: string): string {
  // `\S*bash` because bash names itself by however it was invoked: `bash:` from a bare name and
  // `/usr/bin/bash:` from a path, which is what `packages/box/test/jobs.test.ts` gets and what the
  // first version of this missed.
  return text.replace(/^(?:\S*bash|environment)(?:: -c)?: line \d+: /gm, "sh: ");
}
