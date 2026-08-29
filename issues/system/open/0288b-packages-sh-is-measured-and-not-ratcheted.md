# 0288b — `packages/sh` is the one package whose coverage is measured and not ratcheted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — a gap in a guard, and a sentence on the website that counts it as closed
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
