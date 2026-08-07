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

Through `packages/box/src/bin/sh.wac`, on 2026-08-07:

    563/632 agree with bash

and the 69 that do not are concentrated in three programs:

| program | scripts | what |
| --- | --- | --- |
| `tr` | 44 | backslash escapes are taken literally — **wac-mono 0098**, filed independently |
| `cat` | 17 | `-n`, `-b`, `-s` are not implemented, and a lone `-` is read as a filename rather than as standard input |
| `seq` | 6 | usage errors exit 0 or 2 where GNU exits 1, and `seq` with no operand does not refuse |
| `uniq`, `sort` | 1 each | a lone `-` again |

Two of the three are one fix each. **A lone `-` meaning standard input** accounts for the `uniq` and
`sort` scripts and some of `cat`'s, and it is a convention every one of these tools shares, so it belongs
in `packages/box/src/lib/input.wac` rather than in each applet.

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

## Done when

`deno task corpus:through` reports 632/632 through `packages/box/src/bin/sh.wac`, the twelve are deleted,
and `packages/sh` runs the applets it is handed.

## Also found by the same run

`packages/box`'s `grep -q` does not stop at the first match. The corpus contains
`seq 1 100000 | grep -q 5` precisely because `packages/sh`'s does stop, and measuring through box's ran
until it was killed — which is why `corpusThrough.ts` bounds each script and reports what never finished
rather than hanging.
