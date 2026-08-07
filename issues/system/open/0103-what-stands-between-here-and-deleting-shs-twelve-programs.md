# What stands between here and deleting `packages/sh`'s twelve programs

**Status**: open
**Filed**: 2026-08-07

## What

`packages/sh/README.md` has said for a while that the sensible end state is to delete the twelve programs
built into the shell and let `packages/box`'s applets serve instead — "once something checks that `box`'s
pass the same differential scripts against bash". Nothing checked, so the paragraph had no number in it
and the deletion never had a next step.

`deno task corpus:through <shell>` is that check. It reads `packages/sh/test/differential.test.ts`'s own
corpus — so it cannot go stale — and runs every script through some other shell against bash.

Through `packages/box/src/bin/sh.wac`, on 2026-08-07: **563/632**, with the 69 in five programs. Four of
the five are now fixed and the score is **588/632**; everything left is `tr`.

| program | was | now | what |
| --- | --- | --- | --- |
| `tr` | 44 | 44 | backslash escapes are taken literally — **wac-mono 0098**, filed independently, and left to it |
| `cat` | 17 | 0 | all nine flags were accepted and ignored, and `-Q` — not a GNU flag — was accepted too |
| `seq` | 6 | 0 | usage errors exited 0 or 2 where GNU exits 1, and a word was read as zero rather than refused |
| `uniq`, `sort` | 1 each | 0 | a lone `-` was read as a filename |
| `grep -q` | (a hang) | 0 | printed every matching line and read the whole input |

**A lone `-` is standard input** now, in `lib/input.wac` where the convention belongs rather than in each
applet — and *not* in `rev` or `strings`, which are util-linux and binutils and do not take it. That
distinction was measured on the real tools; applying the convention everywhere would have traded one wrong
answer for another, which is what wac-mono 0096 records about the last time an operand rule was assumed
universal.

## Why this is worth doing rather than leaving

Two implementations of `grep` disagreed for months and nobody knew: `packages/sh`'s matched substrings
while `packages/box`'s had the regex engine wired in, so `grep '^h'` in the shell answered *nothing
matched*. It was found by using the shell by hand, not by any test, because both suites passed — each was
testing its own half. Every day the twelve stay is another day two answers can drift apart with nothing
comparing them.

The corpus check is what makes the deletion safe rather than hopeful: it measures the replacement against
the same 632 scripts the originals are held to, and the README's own reason for keeping them is that
"swapping the implementation under a passing suite without measuring it first is how a green suite starts
lying".

## What is left

`tr`, and only `tr`: 44 scripts, all of them wac-mono 0098, which another agent filed while this was being
measured. Nothing here should touch it.

## Done when

`deno task corpus:through` reports 632/632 through `packages/box/src/bin/sh.wac`, the twelve are deleted,
and `packages/sh` runs the applets it is handed.

## Also found by the same run, and fixed

`packages/box`'s `grep -q` did not stop at the first match — worse, it printed every matching line, which
is the opposite of what the flag asks. The corpus contains `seq 1 100000 | grep -q 5` precisely because
`packages/sh`'s does stop, and measuring through box's ran until it was killed, which is why
`corpusThrough.ts` bounds each script through `timeout(1)` and reports what never finished.
