# 0139 — mutation testing cannot reach a low-level package in practice: nine minutes before the first mutant runs

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** performance
- **Symptom:** no error

## Reproduction

One mutant, in one function, in `packages/std`:

```
$ deno task mutate hashI32 --operators --package std
1 mutant(s) generated; compiling for equivalence…
  1 to run, 0 provably equivalent, 0 duplicate, 0 did not compile
  deadline: 10x each scope's own baseline (slowest 553.4s -> 600s)
```

Killed at ten minutes, still **measuring the baseline**: `CUT SHORT by SIGTERM while measuring
baselines and building the coverage profile — 0 of 1 mutants`. A second run the same way, for the
eight mutants `hash` matches, reported a slowest scope of 435.8s and had run none of them when it
was stopped.

For comparison, that package's own tests:

```
$ deno test -A packages/std/test/     # 42 passed, 1s (3.4s wall including startup)
```

Expected: measuring one mutant in `std` costs something on the order of `std`'s own tests, plus
whatever confirming a *survivor* against dependents costs.
Actual: about nine minutes of baseline before the first mutant runs, and a 600s deadline on the
mutant itself.

## Where, and why it is this shape

`testDirs` in `tools/mutate.ts` gives a mutant the test directory of **every package that depends on
the file it edits**. That is the right *set* — a mutant in `std` could be caught by any of them, and
a narrower set would report survivors that something does catch. `std` is under everything, so the
set is very nearly the whole repository, and the baseline is a run of the whole repository.

Two costs, and they are not the same problem:

1. **The baseline.** Every scope is run unmutated first, so the deadline can be a multiple of what
   the tests actually take under today's load. That reasoning is right and the comment defending it
   is worth keeping. For `std` it means ~9 minutes before any mutant is measured, paid once per run.
2. **Each mutant.** `--fail-fast` means a killed mutant stops at the first failing test, so a kill
   costs *whatever runs before the killing test*. The directories are handed to `deno test` sorted
   alphabetically, so for a mutant in `std` the run walks `bignum, bls, box, bytes, codec, crypto,
   datetime…` before it reaches `packages/std` — the tests written for the mutated function are
   nearly last. `box` alone spawns about three hundred subprocesses.

## What I would do, cheapest first

- **Order the owning package first.** `testDirs` sorts; passing `packages/<owner>` ahead of the rest
  costs three lines and changes nothing about the set. With `--fail-fast`, the common case — a
  mutant its own package's tests kill — stops in seconds instead of minutes. It does not help a
  survivor, which has to run everything by definition, and it does not help the baseline.
- **Then measure whether the baseline can be reused.** It is a property of the scope and the
  machine, not of the mutant, and `mutate.ts` already keys it per scope within a run. Across runs it
  is thrown away, so a second `--package std` invocation pays the nine minutes again. A cached
  baseline keyed by (scope, staged commit) with a short life would make an iterative session
  possible; the risk to weigh is that a stale baseline sets a wrong deadline, which is the failure
  the current design exists to prevent — so it wants the same care as the cache key in
  `harness/wacBind.ts`, not a timestamp.

## Why it matters

[0005](0005-mutation-testing-found-54-untested-behaviours.md) lists surviving mutants by package —
`fmt` 4, `std` 3, `json` 3, `url` 2, `bignum` 2, `wactest` 1 — and that table is from **2026-08-01**.
Every package in it is a low-level one, which is not a coincidence: they are the ones this cost falls
hardest on. `packages/std/test/wac/hash_test.wac` was written since, and its header says it was
written *for* two of those mutants, so at least some of the table is stale — and nobody can cheaply
say which, which is the same shape as
[0101](../closed/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md): a measurement
nobody can afford to repeat stops being a measurement and becomes a memory.

Not urgent, and nothing is red because of it. It is filed because the next person to read 0005 will
otherwise spend the nine minutes finding this out, and because the first item above is small enough
that whoever owns the tool may just do it.

## 2026-08-12: the first step is taken, and it cannot be measured end to end

`testDirs` now returns the mutant's own package first and the rest after, alphabetically. The set is
unchanged — a survivor still has to run every dependent, which is what makes a survivor mean
something — so this is strictly a reordering, and `deno test --fail-fast` stops at the first failing
file.

**What it cannot show is a wall-clock win**, and that is worth stating rather than leaving somebody
to look for one. The baseline dominates: a `--package url` run measured its slowest scope at
**630 seconds** on 2026-08-12, so even a mid-level package pays ten minutes before the first mutant
runs, and a per-mutant saving of a few minutes disappears into that. The ordering helps every
individual kill; only the second item below makes a sweep affordable.

So the remaining work here is the baseline, not the order:

- reuse it across runs, keyed by (scope, staged commit) — the risk being that a stale baseline sets
  a wrong deadline, which is the failure the current design exists to prevent, so it wants the care
  `harness/wacBind.ts`'s cache key takes rather than a timestamp;
- or narrow what a low-level package's scope *is*, which changes what a survivor means and is
  therefore a decision rather than an optimisation.


## The first recommendation is done, and was unguarded — 2026-08-15

*"Order the owning package first"* landed in `8f0f5bcd`, and **nothing held it**: `testDirs` was three
lines in `tools/mutate.ts`, a module that builds its dependency map with a top-level `await`, so
importing it to check one ordering runs the whole tool. Nothing could test it, so nothing did.

That matters more here than usual because of how it would break. A `sort()` added anywhere in that
expression restores the old behaviour exactly, and the symptom is *"mutation runs got slow"* — not a
failure, not a wrong answer, and not something anyone attributes to an ordering. It is the shape this
repository keeps finding: a fix whose loss is invisible.

So the ordering is now `testDirsFor(own, all)` in `tools/mutate/types.ts`, pure and imported by both,
and `tools/mutate.test.ts` asserts it: the owning package leads, two owners both lead and stay
sorted, and **the set is unchanged** — narrowing it would report survivors that something does catch,
which is the mistake the ordering exists to avoid making. Canaried by putting the plain sort back.

### What is left

The baseline, which is the nine minutes. It is thrown away between runs, so a second `--package std`
pays it again, and the note above is right that a cache wants the care of `harness/wacBind.ts`'s key
rather than a timestamp — a stale baseline sets a wrong deadline, which is the failure the current
design exists to prevent.
