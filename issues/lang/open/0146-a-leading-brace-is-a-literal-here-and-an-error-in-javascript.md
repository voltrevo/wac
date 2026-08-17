# 0146 — a leading `{2}` is a literal in `packages/regex` and an error in JavaScript

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { compile } from "packages/regex/src/regex.wac";

// Accepted, and matches the three literal characters `{`, `2`, `}`.
export i32 run() { return compile("{2}".toBytes()) is null ? 0 : 1; }   // returns 1
```

```js
new RegExp("{2}");   // SyntaxError: Invalid regular expression: /{2}/: Nothing to repeat
```

Expected: `compile` refuses it, because `packages/regex`'s own README says the dialect is
JavaScript's and this file's oracle is `RegExp`.
Actual: it compiles to three literal bytes and `/{2}/` matches `a{2}b` at 1..4.

## How it was found

Porting `packages/regex/test/regex.test.ts` to wac (`issues/system/0161`). The host-side version has

```ts
// And things that look similar but are in the subset.
for (const p of ["(?:a)", "a{2,3}", "[a-z]", "\\d", "\\.", "\\\\", "a{,2}", "{2}"]) {
  if (!mod.accepts(b(p))) bad.push(`/${p}/ was rejected and should not be`);
}
```

and never asks the oracle about that list — the `RegExp` comparison only runs on patterns both sides
accept, so a pattern *only we* accept was asserted as correct behaviour by a hand-written list.
The wac port sends every one of them to the oracle, and this is the one that came back.

`a{,2}` is the interesting neighbour: JavaScript compiles it (as a literal, per Annex B) and so do we,
so the two agree there. The divergence is only the leading brace with a valid count in it.

## Why it is filed rather than fixed

`packages/box`'s grep and `packages/sh`'s reach this package through `compileBasic` and
`compileExtended`, where a leading brace **is** a literal in both POSIX dialects — GNU grep matches
`{2}` as three characters and `packages/regex/test/wac/basic_test.wac` compares against it byte for
byte. So the fix is not "reject `{2}`" but "reject it in the JavaScript entry point only", and the
three entry points share `compilePattern`. That is a change to which callers accept what, which is
the kind `CLAUDE.md` says to file rather than guess at.

## What it is worth

Small but real. The rule that makes this package's oracle meaningful is *the dialect is JavaScript's*,
and a pattern JavaScript refuses being accepted here means it was parsed as something else — which is
the exact failure the "patterns outside the subset are rejected, not mis-parsed" test exists to catch,
arriving through the list of exceptions rather than through the check.

Recorded as a divergence in `packages/regex/test/wac/regex_test.wac` —
`test_a_leading_brace_is_a_known_divergence` asserts both halves, so the day JavaScript starts
accepting it, or this starts refusing it, the test says the note can go.
