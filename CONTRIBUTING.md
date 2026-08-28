# Contributing to wac

Read [CLAUDE.md](CLAUDE.md) first — it is the orienting document, and it says where things are and
how to run them. This file is the part that is about *how to work*, and it is short on purpose.

**This document described a TypeScript compiler until 2026-08-28.** It defined an "atom"
methodology — one value export per file, pure TypeScript, a `cap` parameter for injected
capabilities — for the reference compiler in `compiler/`, which is deleted. wac is written in wac
now, and the conventions that survived the change are the ones below: they were never about
TypeScript.

## The language is unstable by choice

There are no users outside this repository and no legacy to support, which
[CLAUDE.md](CLAUDE.md) states at length. The rule that follows from it is worth repeating here
because it is the one most often argued with: **when nothing needs a thing, delete it.** Not
deprecate it, not keep it behind a flag, not keep it because a test happens to read it — change the
test. If you propose keeping something, say what would break, and check that it is not just a test
you could edit.

## Spec tags

[The language spec](spec/) carries tagged requirements — `[§wac-int32-dfkqg8u]` and the like. Each
names one testable behaviour, and a test claims it by starting its name with the tag.

- **The spec is the source of truth.** It describes what the code should do, not what the code
  happens to do. Where they disagree, one of them is wrong and saying which is the work.
- **The test must verify what the tag describes.** A tag saying "an error at line 4" needs the test
  to assert the line, not merely that an error happened. If the implementation has no line numbers,
  fix the implementation — a weaker test that skips the check is worse than no test, because it
  reports confidence nobody has.
- A tag that cannot be satisfied because the *spec* is wrong gets a test for the intention, without
  the tag in its name, and an explanation in the commit.

`packages/wacc/test/wac/spectags_test.wac` checks that every clause is claimed somewhere.

## Writing a test

New tests go in wac — `*_test.wac`, run by `wac test` — rather than in TypeScript. The Deno lane
still exists for the things that genuinely need a host, and is shrinking.

1. **Look for an existing test to extend** before writing a new file. A widened oracle catches more
   than a new one beside it.
2. **Exercise the thing with real input before writing assertions.** Edge cases surface from use,
   not from imagination.
3. **Verify a non-obvious expected value independently** — another implementation, an external tool,
   or by hand — before it becomes a test vector. `137 * 429 = 58773` is hard to get right by
   accident; a round number can pass by coincidence.
4. **Say what the test would catch**, in the commit or in the file. A test whose failure mode nobody
   can name is usually asserting that the code ran.

If you took a shortcut, or you are not sure a test proves what it claims, say so rather than letting
it pass. An honest gap is cheaper than a false one.

## Bugs and issues

Anyone may change the compiler. If you are building something in wac and hit a compiler bug or need
a language feature, fixing it is ordinary work.

File an issue in `issues/` when the blocker is a **decision** rather than the work: a change that
would make the shared suite red for everyone, or one where two reasonable answers exist and picking
wrong is expensive to undo. A reproduction is worth more than a patch when you are not going to
write the patch. Each tree has its own README — [issues/lang/README.md](issues/lang/README.md) and
[issues/system/README.md](issues/system/README.md) — saying what belongs in it, and the most useful
part of each is what does *not*.

## Keeping the repository clean

Never commit build output. The seed (`native/v8/seed/`), `.cache/`, cargo's `target/` and the
generated site assets are all ignored, and they are ignored because they are reproducible — if you
find yourself wanting to commit one, the thing to fix is whatever made it hard to reproduce.
