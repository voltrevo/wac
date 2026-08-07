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

Through `packages/box/src/bin/sh.wac`, on 2026-08-07: **563/632**, with the 69 in five programs. All five
are fixed and the score is **649/649** — every script in `packages/sh`'s own corpus now agrees with bash
through `packages/box`'s applets, which is the precondition this issue exists to establish.

| program | was | now | what |
| --- | --- | --- | --- |
| `tr` | 44 | 0 | took its sets literally and had no flags at all — **wac-mono 0098**, now closed |
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

## What is left, measured

The deletion is a bigger change than "delete twelve functions", and the numbers say where the work is.
Of the 649 scripts:

| | scripts | |
| --- | ---: | --- |
| need no external program at all | 361 | shell language: quoting, expansion, control flow, builtins |
| need `printf` | 171 | **now a builtin**, see below |
| need one of the other eleven | ~117 | `tr` 71, `seq` 59, `cat` 48, `grep` 39, and the tail |

**`printf` is done and was the trap.** It was one of the twelve, and in bash it is a *builtin* — a script
that writes `printf` gets the shell's, not `/usr/bin/printf`. `packages/box` has **no `printf` at all**,
so deleting the twelve with it among them would have removed a builtin bash has and a quarter of the
corpus uses, and `corpus:through` would not have noticed because it runs box's shell *and* box has no
printf to be missing from. It now lives in `packages/sh/src/printf.wac` and is dispatched beside `echo`
and `test`, where the deletion cannot reach it.

**What actually blocks the rest.** `packages/sh/test/differential.test.ts` builds `packages/sh/src/sh.wac`
and runs all 649 through it. Delete the eleven and 117 of those scripts test a shell with no commands.
The suite cannot simply build `packages/box`'s shell instead: `box` depends on `sh`, so `sh`'s tests
depending on `box` is a cycle. So the deletion needs one of:

1. the 117 scripts move to a corpus that runs through `packages/box/src/bin/sh.wac` — which is what
   `corpus:through` already does, so this is mostly bookkeeping about which suite owns which script; or
2. `packages/sh`'s differential keeps the language cases and `packages/box`'s suite owns the ones that
   name a program, which is the same split said the other way round.

Either way `packages/sh/src/{sealed,imaged}.wac` and `packages/ssh/src/sshd.wac` need applets from
somewhere, and `ssh` does not depend on `box` today — it can, with no cycle, and that is the edge the
deletion adds.

None of that is hard; it is just not one sitting, and doing half of it leaves a shell with no commands.

## Done when

`deno task corpus:through` reports 632/632 through `packages/box/src/bin/sh.wac`, the twelve are deleted,
and `packages/sh` runs the applets it is handed.

## Also found by the same run, and fixed

`packages/box`'s `grep -q` did not stop at the first match — worse, it printed every matching line, which
is the opposite of what the flag asks. The corpus contains `seq 1 100000 | grep -q 5` precisely because
`packages/sh`'s does stop, and measuring through box's ran until it was killed, which is why
`corpusThrough.ts` bounds each script through `timeout(1)` and reports what never finished.

## 2026-08-07, later: the blocker is cleared, and the drift got worse

**The split is done.** `packages/sh/test/corpus.ts` holds the corpus and `needsProgram`;
`packages/box/test/corpus.test.ts` runs the 256 of 673 scripts that name one of the eleven through
`packages/box/src/bin/sh.wac` against bash, on output *and* exit status. `tools/corpusThrough.ts`
imports the corpus instead of scraping it out of the test file with a regular expression.

So the thing this issue said had to happen first has happened: the scripts that need programs are owned
by a suite that runs them against `packages/box`'s applets, and `packages/sh`'s differential can drop to
the language cases in the same commit that deletes its copies.

**Held to the same corpus for the first time, the two halves had drifted both ways.**

- `packages/box`'s grep had no `-x`, which `packages/sh`'s has always had. Four scripts. Implemented.
- `packages/sh`'s `wc` does **not** pad its counts into a column when given several files, and GNU and
  `packages/box`'s do:

  ```
  $ wc -l big.txt small.txt      bash: "120 big.txt / ␣␣4 small.txt / 124 total"
                                 sh:   "120 big.txt / 4 small.txt / 124 total"
  ```

  Not fixed, deliberately: `countWidth` and `rightAlign` are already in `program.wac`, so the machinery
  is there and something about `sizeKnown` is wrong — and fixing a copy that this issue exists to delete
  is the work this issue exists to stop doing. It is written here as the third piece of evidence in one
  week that two implementations with two suites drift silently.
- Also found by hand: `sort -u` and `uniq -c` are not implemented in `packages/sh` and are in
  `packages/box`.

## What is left, exactly

1. Delete the eleven from `program.wac`, keeping `optionRefusal` — `exec.wac`'s `ls` builtin uses it and
   it is not a program. It wants its own file.
2. `exec.wac` dispatches externals through `run`/`names`; with no programs left, that becomes
   `Shell.external` or "command not found". `sh.wac` imports `isProgram`, `programNames` and
   `runStreaming`, and `sealed.wac` imports `programNames`.
3. `packages/sh/test/differential.test.ts` runs `CORPUS.filter((s) => !needsProgram(s))`.
4. `packages/ssh/src/sshd.wac` serves a session with sh's shell and would serve one with no commands.
   `ssh` does not depend on `box` today; it can, with no cycle, and that is the edge this adds.

None of it is hard and none of it can be done half way: a shell with no commands and a suite that still
expects them is a red tree, so it is one commit.

## 2026-08-07, later still: two down, nine to go, and the method

They cannot all go at once — half of `packages/sh`'s own tests use `wc` and `seq` as *incidental*
commands rather than as subjects, so the tree would be red for as long as it took to convert them. So
they go a few at a time, and the machinery for that is in place:

- `packages/sh/test/corpus.ts` has `DELETED` and `usesDeleted`. Every script list in
  `differential.test.ts` is filtered through it, including the `cd`-wrapped ones built at run time.
- `packages/box/test/corpus.test.ts` runs every script naming any of the eleven, so nothing is lost as
  names move over.
- `packages/box/test/programs.test.ts` holds the error-wording cases for the ones already gone.

**One step is: add the name to `DELETED`, delete the function and its dispatch line from `program.wac`,
drop it from `gnuHas` and from `gaps.test.ts`'s tool list, and fix whatever incidental use turns up.**
`nl` and `rev` took about forty minutes including the four bugs they found in `packages/box` on the way
(carry-on after an unreadable operand, three error wordings, two exit statuses, and `rev -`).

Nine left: `cat`, `wc`, `head`, `tail`, `sort`, `uniq`, `grep`, `tr`, `seq`. `cat`, `wc` and `seq` are
the heavily-used ones and are best left until last. When the last goes, `program.wac` loses `run`,
`runStreaming`, `isProgram`, `programNames`, `names` and `dispatchProgram`; `Output` and `optionRefusal`
stay and want a file of their own; and `packages/ssh`'s `sshd` needs `boxRun` — the `ssh` → `box` edge,
which is still the one new dependency this whole thing adds.

## 2026-08-07, later: the last step has a second blocker, and it is a seam

`packages/ssh`'s `sshd` needs the applets once the last of the eleven goes, and that edge is blocked
twice over:

- **wac 0076** — adding the import makes an untouched function fail to compile, and the module is
  rejected at instantiate.
- **wac-mono 0109** — applets take a `Cli` and the shell holds an `Fs`, so an applet in an imaged session
  would read the *host*. Wiring them together would give one session two filesystems.

Neither is a reason to stop deleting: five are gone and the remaining six are still duplicates. It does
mean the last one cannot simply be followed by "and now sshd uses box".
