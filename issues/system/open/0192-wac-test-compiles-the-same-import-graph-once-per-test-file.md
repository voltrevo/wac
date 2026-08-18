# 0192 — `wac test` compiles the same import graph once per test file, so a package pays for it N times

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — a suite whose cost is dominated by rebuilding the same program

## The measurement

A wac test file is compiled as its own entry, so its whole import graph is compiled again for every
file that imports it. Measured on `packages/box`, whose tests reach the shell and its sixty applets —
about 180 files:

    wac test packages/box/test/wac/inprocess_test.wac
      3 tests, whole run: 6 053 ms
      the tests themselves: 2 ms, 1 ms, 0 ms

So **six seconds of compile for three milliseconds of testing**, and the compile is of a graph that
does not change between test files. `packages/box` has 26 test files today; converted as they stand,
that is 26 compiles of the same 180 files.

The same shape across the repository: the suite's `wac test` lane is 193 files in about seven minutes,
roughly 2.2 s a file, and almost all of it is compiling.

## What is wanted

One build per *run* rather than per file: `wac test packages/box` compiles the union of the files'
graphs once and runs every test against that single artefact.

**Not the workaround.** The obvious response to the measurement above is to aggregate assertions into
fewer, larger test files, and that is the wrong direction — it would make the file layout a function of
the compiler's batching rather than of what the tests are about. The operator's words, filing this:

> we shouldn't be aggregating into large test files for performance. instead the compiler should be
> able to aggregate many test files into one build, so all the tests can run against a single wasm
> artifact.

## What it would take, and what to be careful about

- **A synthesised entry.** Something has to import every selected `*_test.wac` and re-export its
  `test*` functions under names that cannot collide — `file: test_name` is the spelling
  `harness/wacTestRun.ts` already uses for the Deno lane, and `wac test`'s `--filter` matches
  substrings, so a prefix is compatible with both.
- **Isolation changes.** Today each file is its own module instance, so a test cannot leave state
  behind for another file. In one artefact they share module-level state. Most of these files declare
  none, but the ones that do — and any that trap — need thinking about: a trap unwinds the call and
  leaves the instance, which is fine for the runner and not obviously fine for a `Buf` half-written by
  a neighbour.
- **What a failure names.** A combined artefact must still report `file:test` and a source position,
  or the saving is paid for in triage.
- **The coverage profile.** `wac test --coverage` writes points per entry; `tools/mutate/profile.ts`
  reads them per entry to decide which tests reach a mutated line. Combining entries must keep that
  attribution or mutation selection gets coarser.

## Why it is worth doing rather than living with

`issues/system/0161` is moving the whole suite into wac, and the lane is already the largest single
block of suite time. Every file converted from Deno adds one more compile of a graph the run has
already compiled — so the cost of the migration grows with its success unless this is fixed.

Found while converting `packages/box`'s tests to run in-process (`issues/system/0193` is that work):
the conversion makes each assertion about a hundred times cheaper — 132 ms of spawn becomes 1 ms of
call — and leaves the per-file compile as the whole of what remains.

## Measured in `packages/box` — 2026-08-18

Four `*_test.wac` files, each importing box's world, run one at a time:

    wac/backings_test.wac   7 201 ms   946 scripts × 3 backings
    wac/fuzz_test.wac       6 878 ms   120 replays
    wac/corpus_test.wac     6 702 ms   301 replays
    wac/inprocess_test.wac  6 101 ms   3 assertions

The work each does differs by three orders of magnitude and the times differ by 18%: **about 6 s of every
one of them is the compile.** `inprocess_test.wac` asks three questions and pays six seconds to ask them.

This is what stops `issues/system/0193` step 2. Moving a test out of Deno and into wac is a *loss* while
this holds — the Deno files it would replace cost 0.5–5 s each — so the cheapest tests in the package are
the ones that cannot move. Whatever the fix is, it is worth more than every remaining conversion in 0193
put together: 205 wac test files pay this.

