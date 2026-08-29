# 0288b — `packages/sh` is the one package whose coverage is measured and not ratcheted

- **Status:** open
- **Claimed by:** agent-b took the first step (widening the exercise); the ledger is unclaimed
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — a gap in a guard, and a measurement narrower than the tests it is taken to describe
- **Symptom:** no error; the gate names the gap every run and nothing fails on it

## Measured

Every package with a `coverage:<name>` task has a driver that ratchets — it fails when a branch point
nothing reaches has no entry — except one:

    $ wac task coverage:sh
    | packages/sh/ | 3068 | 2032 | 66.2 |
    1036 branch points never executed

`packages/sh/cov.ts` prints that table and exits 0. `tools/coverageAll.ts` classifies a driver by
whether it ratchets, and calls this one **`reports`**; every other package is a **`floor`**.

So sh's coverage is measured on every gate — 6.5s of the ratchet phase — and measured is all it is.
A change that dropped it to 40% would print a smaller number and pass.

**And the gate already says so**, which is worth stating because it is not a hidden gap. Every run
ends with:

    37/37 ran in 132s (525s of work at 4 workers) — 36 hold a coverage floor,
    0 only check their own exemptions have not drifted, 1 report and cannot fail
       4 package(s) have no coverage task and are not in the numbers above: box, ts, wac, wacc

That `1` has been sitting in the summary. So this is not "nobody can see it" — it is that the number
is one clause in a line about the phase's shape, and a count of one reads as a rounding rather than
as a named package. The line does not say *which*.

## The website counts it as having a ledger

`site/src/next/Checked.tsx` says *"36 of the 40 packages carry a coverage ledger"* and names the four
without one: `wacc`, `box`, `wac`, `ts`. `sh` is not among them, because the guard behind that
sentence derives "carries a ledger" from **having a `coverage:` task** — which is how
`tools/coverageAll.ts` derives its own list, and is the right derivation for what that file does.

It is one package's worth of generous. There are 35 `test/cov_ledger.wac` files and 36 tasks, and the
sentence beside the number describes a ledger as *"a file listing every branch point the suite does
not reach, each with a sentence saying what would reach it"* — which is the thing sh does not have.
Left alone rather than reworded, because the number is right under its own stated derivation and the
fix is to give sh a ledger rather than to fix a sentence about not having one.

## Where the 1,036 are

    | packages/sh/src/arith.wac   |  180 |  135 | 75.0 |     45 uncovered
    | packages/sh/src/exec.wac    | 1946 | 1081 | 55.5 |    865 uncovered
    | packages/sh/src/lex.wac     |  419 |  351 | 83.8 |     68
    | packages/sh/src/parse.wac   |  340 |  309 | 90.9 |     31
    | packages/sh/src/printf.wac  |  164 |  153 | 93.3 |     11
    | packages/sh/src/refusal.wac |   19 |    3 | 15.8 |     16

**865 of the 1,036 are in one file.** So this is not a thousand sentences; it is `exec.wac`, plus a
long tail that four files share. `parse.wac` and `printf.wac` are already above 90% and would need a
handful of entries between them.

And `refusal.wac` — 3 of 19 — is the file whose *name* matches the explanation `packages/sh/cov.ts`
already gives for why this package is hard to cover: the interesting branches are the refusals, every
place a peer, a file or a script can be wrong, which a differential against bash cannot reach because
the two agree on what works and disagree on what this declines to do. That is one rule covering
sixteen points, and it is written already — in prose, in the wrong file, where nothing can check it.

## The 1,036 by kind, and the 44 that are whole functions

    358  then          101  ternary       77  loop        32  case
    276  else           85  and           63  or          44  entry

`entry` means a function nothing ever calls, and 44 of them is the tractable end of this: each is one
explanation covering every branch inside it, rather than an entry per branch. 36 are in `exec.wac`,
which is where 865 of the points are.

They are not scattered. Resolved to names, they fall into four families:

* **job control** — `jobsBuiltin`, `killBuiltin`, `killList`, `waitBuiltin`, `reapJob`, `endJob`,
  `jobIndex`, `jobOfPid`, `dropFinished`, `stopAll`, `stopStage`, `spawnStage`, `streamPipeline`,
  `breakOrContinue`. A whole subsystem, and `issues/system/0135` is an open bug about backgrounding a
  builtin — worth reading together, though that issue is about a defect and this is about a hole in
  the exercise.
* **filesystem builtins** — `cd`, `ls`, `mkdir`, `rm`, `mtimeOf`, `onFs`, `ownership`, `octalMode`,
  `statReason`.
* **refusals** — `refused`, `optionRefusal`, `tryHelp`, `gnuHas`, and all four of `refusal.wac`'s
  uncovered entries. This is the family `packages/sh/cov.ts` already explains in prose.
* **lexer helpers** — `isName`, `nameByte`, `nameStart`, `isAllDigits`, `isBlankAt`, `hexValue`,
  `endsWithColon`, `ansiEscape`, `declaredLocal`, `localVar`, `spawnableName`, `enterSelf`.

So the writing is four or five rules and a tail, not a thousand sentences — and two of the families
say something worth knowing on their own. A shell whose `cd`, `ls`, `mkdir` and `rm` are never
entered by its own coverage exercise is a fact about the exercise; whether it is also a fact about
the tests is the first thing the ledger's author has to check, because a rule has to say which other
test drives the code and be right about it.

**And that check has a trap in it, which I walked into far enough to see.** Grepping sh's tests for
those names finds them — `cd` in three files, `ls` in three, `rm` in one. Every hit I looked at is in
`packages/sh/test/wac/corpus.wac`, which is the **differential against bash**: scripts like
`ls /nosuchfile 2> e; … rm -f e`, run on both shells and compared. A differential runs the *system's*
`ls` and `rm` on both sides, because that is what makes the two comparable — so those hits are
evidence that the names appear, not that `exec.wac`'s builtin `ls` is ever entered. The coverage run
says it is not.

**Settled, and it went the other way.** The question is whether a script saying `ls` reaches sh's
builtin or the system's, and that is answerable in one command — put a fake `ls` on `PATH` and see
which answers:

    $ printf '#!/bin/sh\necho EXTERNAL-LS\n' > fakebin/ls && chmod +x fakebin/ls
    $ env -i PATH=fakebin wac sh --allow-read --allow-run -c "cd shtest && ls"
    alpha.txt
    beta.txt

**sh prefers its own builtin over `PATH`.** So the differential corpus does enter `exec.wac`'s `ls`,
and a rule saying *"driven by the differential"* would be true for this family rather than false —
the opposite of what the paragraph above was warning about, which is why it was worth asking instead
of assuming in either direction.

That reframes the whole issue. sh's 66.2% is **coverage of `packages/sh/cov.ts`'s script list**, not
of what the tests reach: the differential corpus is a separate body of scripts that the coverage run
never executes. So an unknown share of the 1,036 is already exercised by tests that the measurement
cannot see, and the cheapest route to a ledger may not be writing rules at all — it may be running
the corpus under instrumentation and finding out how many of the 1,036 survive.

That is worth doing *before* the rules, because a rule is a claim about why something is unreachable
and most of these may simply not be unreachable.

**Measured, with eight lines.** Adding these to `SCRIPTS` in `packages/sh/cov.ts`, temporarily and
not committed:

    "cd /tmp && ls", "ls", "ls /nosuchfile", "mkdir -p /tmp/covprobe && ls /tmp/covprobe",
    "rm -f /tmp/covprobe/x", "cd /", "jobs", "kill -0 1"

    uncovered points   1036 -> 958      (-78)
    never entered        44 -> 36       (-8 whole functions)
    packages/sh/       66.2% -> 68.8%

So eight one-line scripts bought 7.5% of the entire gap, and every one of them is a thing the shell
obviously does. **The 1,036 is dominated by the narrowness of the exercise rather than by code
nothing can reach**, and the recommendation flips accordingly: widen the exercise first, then write
rules for whatever survives. Writing a thousand justifications for code that is one script away from
being covered would be the expensive way to be wrong.

It also says the ledger is not the long pole it looked like. Whoever picks this up should expect the
uncovered count to fall a long way before any rule is written, and should re-measure rather than
trusting the 1,036 in the heading above.

## What it would take, sized

1036 points is the reason this is filed rather than done. The ledger is not one entry per point —
`tools/wac/covledger.wac` has `Rule`, which speaks for every point its scope reaches, and
`packages/fs` uses it for 94 of its 127 — so the work is to find the handful of explanations that
cover most of the 1036 and write an entry for the remainder.

The shape is likely to be favourable. `packages/sh/src/exec.wac` is 1946 points at 55.5% and
`refusal.wac` is 19 at 15.8%, and `packages/sh/cov.ts`'s own header says why: the interesting
branches are refusals — *"every place a peer, a file or a script can be wrong"* — which a differential
against bash cannot reach by construction, because bash and this agree on what works and disagree on
what this declines to do. That is a rule-shaped explanation rather than a thousand sentences.

**A rule that matches nothing fails the run**, which is what stops it being a blanket, so the rules
have to be honest about scope.

## Why it is not just "add a ratchet"

Turning the ratchet on before the ledger exists makes the gate red for everybody, which is the thing
`CONTRIBUTING.md` says to file rather than do. The order is: write the ledger, then switch the driver
from `reports` to `floor`, in one commit that the gate can prove.


## First step taken: the eight scripts are in — agent-b, 2026-08-29

They are in `packages/sh/cov.ts` now rather than sitting in this issue as advice, with the reasoning
at the site. **The baseline every figure above is written against has therefore moved**: the package
is 2,110 of 3,068 — **68.8%**, 958 uncovered, 36 functions never entered.

Nothing real is touched by them. `cov.ts` fakes the capabilities inside wac, which is why `cd /tmp`
and `mkdir -p /tmp/covprobe` are safe to write here — checked, and `/tmp/covprobe` does not exist
afterwards.

A second batch followed the same afternoon, aimed at the entries the first left behind — long-form
listing, the refusal paths every builtin shares, and the job-control half that needs an actual job:

    after batch one   958 uncovered, 36 never entered, 68.8%
    after batch two   880 uncovered, 28 never entered, 71.3%

    after batch three 850 uncovered, 26 never entered, 72.3%

Thirty-one scripts in total have taken it from 1,036 to 850 and from 44 functions to 26 — 18% of the
points and 41% of the entries, for six percentage points.

**And the third batch is where the return fell off**: batches one and two were -78 points and -8
entries each, batch three was -30 and -2 for ten scripts aimed at the group I had picked as most
likely. That was the stated signal to stop guessing, so this is the natural boundary between widening
and the two things that come after it — targeted work for the groups below, and rules for whatever
survives that.

**The 28 that remain**, so the next person starts from a list rather than a walk — 22 in `exec.wac`,
2 each in `arith.wac`, `lex.wac` and `refusal.wac`:

    HELD_CAP INTERRUPT_POLL_MS ansiEscape before declaredLocal endJob endsWithColon
    enterSelf hexValue isBlankAt isName jobOfPid killList mtimeOf nameByte nameStart
    octalMode of onFs ownership reapJob refused spawnableName statReason stopAll
    stopStage streamPipeline tryHelp

They read as three groups. **Lexer helpers** — `isName`, `nameByte`, `nameStart`, `hexValue`,
`isBlankAt`, `endsWithColon`, `ansiEscape` — which are the ones most likely to be one odd script
away. **Job control's tail** — `reapJob`, `endJob`, `stopAll`, `stopStage`, `killList`, `jobOfPid`,
`streamPipeline` — which needs a job that outlives the script that started it. **That one is
settled, and it is the true answer.** `packages/sh/test/wac/probe.wac` fakes `spawn` statelessly on
purpose, and says why: *"a fake that returned bytes would return them for ever and the read loop
would not finish"*. A child there answers end-of-input immediately and never transitions, so nothing
this exercise can write will produce a job to reap, stop or list.

The same comment names where the coverage actually is — `packages/sh/test/spawn.test.ts`, *"against
the real host instead, which is the only place a child can actually speak"*. So this family's ledger
rule is written already, in the probe, in the same way the refusals family's was written in
`cov.ts`: two of the three groups above turn out to have their explanation sitting in prose
somewhere a test cannot read it, which is the general shape this issue keeps running into. And **stat detail** —
`mtimeOf`, `onFs`, `ownership`, `octalMode`, `statReason` — which `ls -l` was aimed at and did not
reach, so something narrower is wanted there.

What is left is unchanged in kind and smaller in size: keep widening while it is cheap, then write
rules for what genuinely cannot be reached, then switch the driver from `reports` to `floor` in the
commit that can prove it. The next obvious probe is the differential corpus itself, which this
exercise still does not run.
