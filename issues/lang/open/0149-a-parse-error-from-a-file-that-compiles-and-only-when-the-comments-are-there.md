# 0149 — `dumpTypeErrors` reports a parse error on a file that compiles, and only with its comments

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a diagnostic on correct code

`packages/wacc/test/typecheck.test.ts`'s "the whole repo stays silent" fails on master. The one file
it names compiles cleanly with `wac build`, and the diagnostic is a **parser** code arriving from
`dumpTypeErrors`.

## Reproduction

```ts
const mod = await wacBind("packages/wacc/src/api.wac");
const dump = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
dump(new TextEncoder().encode(Deno.readTextFileSync("packages/wactest/src/fixtures.wac")));
```

    code 20 @ 95:48        // 20 is `perrExpected` — "unexpected token"

Expected: nothing. `wac build packages/wactest/src/fixtures.wac` produces a 323 KB module from 12
files without complaint, and the reference type-checks the file cleanly — which is what makes the
whole-repo check a corpus at all.

## What it is not, which is most of the work

Each of these was measured, and each one rules out an explanation that looks right:

- **Not the line it names.** Column 48 of line 95 is the `bytes` in
  `case Str(bytes): { return string.fromBytes(bytes); }`. Feed the file's **first 100 lines** — which
  contain line 95 in full — and there is no diagnostic at all.
- **Not that construct.** The same function extracted into a standalone file is silent, with a plain
  subject, with a nullable `found!` subject, with two payload fields, and with an `_` binding.
- **Not a stale position.** Prepending ten blank lines moves it to `105:48`; prepending one comment
  line moves it to `96:48`. It tracks the source, so it is a real position and not a leftover.
- **Not the file's size.** Appending fifty blank lines does not change it.
- **It is the comments.** Strip every `//` and `*` line from the reduced file and the diagnostic
  goes. Blanking *either* line 100 or line 146 — the delimiters of two different doc comments, both
  **after** the reported position — clears it on its own.

Delta debugging over the twelve top-level declarations removes ten of them with the diagnostic still
at `95:48`, and what survives is largely the header comment. So the trigger and the reported
position are in different places, and the position is the one that is trustworthy.

## Why it matters more than one file

`ours()` in that test is the *subset* checker's answer, and the property under test is that it stays
quiet about code the reference accepts. A parser code appearing in a type-error dump means the two
phases are not separated where the test assumes they are — so a rule tuned against this failure
would be tuned against the wrong phase.

It is also the only file out of 250-plus that trips it, which is the argument for a real cause
rather than a threshold: something specific in this file's comments is being lexed as code.

## Where to start

`perrExpected()` is `packages/wacc/src/parse.wac:38`. Whatever surfaces parse diagnostics through
`dumpTypeErrors` in `packages/wacc/src/api.wac` is the other end. The two comment delimiters that
each clear it are worth diffing against the doc comments in files that do not trip it — this file's
are unusually long, and one of them is 46 lines.

Not filed against the lexer specifically, because the evidence does not name it: comments are what
the trigger is made of, and where it is decided that they are comments is exactly the open question.
