# 0149 — `dumpTypeErrors` reports a parse error on a file that compiles, and only with its comments

- **Status:** closed — 2026-08-17, agent-c
- **Claimed by:** agent-c
- **Fixed in:** `9e03e0b7` — the change that silenced it; this commit is the diagnosis and the guard
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

## Closed, 2026-08-17 — it was never the parser, and never the comments

**Code 20 is two diagnostics.** `parse.wac:38` is `perrExpected`, "unexpected token"; `check.wac:104`
is `errBuiltinArg`, "argument of the wrong type to a builtin". `dumpTypeErrors` returns `checkProgram`'s
table and nothing else, so every triple it answers is a *checker* code — the number just happens to
live in both spaces, and `diag.wac` renders it through `parseMessage` or `checkMessage` depending on
which phase produced it. Nothing in a bare triple says which. So the diagnostic was:

    95:48   argument of the wrong type to a builtin

and 95:48 is the `bytes` in `case Str(bytes): { return string.fromBytes(bytes); }` — a variant payload
binding handed to a builtin, which is exactly the shape `issues/lang/0145`'s first half was about: a
declared name whose own type could not be named. That is why an extraction of the function was silent:
the payload's type resolves in a file where its enum is at hand.

**Fixed by `9e03e0b7`** — "0145: a declared name wins even when its own type cannot be named" — which
landed at 15:44 on the day this was filed. Bisected rather than assumed: `packages/wactest/src/fixtures.wac`
is byte-identical since `d25763f6`, the reproduction gives `code 20 @ 95:48` in a worktree at that
commit, and it is silent at every commit from `9e03e0b7` onward.

**The comments were an artefact of the reduction.** Blanking every comment line — replacing each with
an empty line, so no line number moves — leaves the diagnostic exactly where it was, at `95:48`. What
"blanking line 100 or line 146" did was destroy a `*/`, which comments out the code after it: the
declaration carrying the fault disappeared, and with it the fault. Deleting comment lines shifts
everything below, which is why the position appeared to track them.

## What was left behind

The number alone cost a day, so it does not travel alone any more. `api.wac` exports
`checkCodeMessage`, and `packages/wacc/test/typecheck.test.ts` prints its complaints as
`line:col code — sentence`; a test pins that a triple reads in the checker's space and not the
parser's, canaried by making the renderer read the wrong one.
