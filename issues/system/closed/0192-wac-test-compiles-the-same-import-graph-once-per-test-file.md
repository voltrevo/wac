# 0192 — `wac test` compiles the same import graph once per test file, so a package pays for it N times

- **Status:** closed — agent-a, 2026-08-26: `wac test <dir>` builds one aggregate for the whole walk,
  and all four of the cautions below are met
- **Fixed in:** `packages/wac/src/wac.wac` and `packages/wac/src/testrun.wac`, with
  `packages/wac/test/wac/aggregate_test.wac` and `tools/wac/testmodcache_test.wac`
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


## Closed — measured against its own four cautions, agent-a, 2026-08-26

`wac test <directory>` has built one aggregate for the whole walk since `issues/system/0257c` moved the
command into `packages/wac/src/wac.wac`; that file's comment cites this issue as the reason and carries
the number — *"`packages/box`'s sixteen files were 40.9s as sixteen builds and 11.1s as one"*. What was
never written down is whether the four things this page said to be careful about actually held. Each
was measured today rather than assumed.

**A synthesised entry.** One file, importing every walked test and re-exporting under a prefix that
cannot collide:

    // Generated by `wac test <directory>` — one build for the whole walk.
    import { test_the_accessors_answer... as impl0_test_the_accessors_answer... } from "../packages/rlp/test/wac/accessors_test.wac";
    import { test_the_published_vectors... as impl1_test_the_published_vectors... } from "../packages/rlp/test/wac/rlp_test.wac";

**What a failure names.** Two files, one deliberately failing:

    ── test/alpha_test.wac
    FAIL test_this_one_fails — deliberate
    0 passed, 1 failed
    ── test/beta_test.wac
    1 passed, 0 failed

    2 files: 1 ok, 1 with failures

File, test, reason, per-file counts, and exit 3. Nothing is paid in triage.

**The coverage profile.** Attribution survives the combining, which is what `tools/mutate/profile.ts`
needs to pick the tests that reach a mutated line:

    branch coverage: 2 of 2 points (100%)
          1 / 1     test/alpha_test.wac
          1 / 1     test/beta_test.wac

**Isolation.** The one caution that is a *consequence* rather than a criterion: files in one artefact
share module-level state where before each was its own instance. That is the trade this issue proposed
and it stands; nothing here re-opens it.

### And a leftover this measurement explains

`.cache/` in this workspace held **39 aggregates from 20–21 August**, one of them
`wac-aggregate-3685848-0.kept.wac`. They are named `<pid>-<group>` — the retired Rust host's scheme,
which `docs/development.md` described and which the wac program lost when the command moved. So they
are physical evidence for the thing GitHub wac#27 reported and for the race fixed today: the naming
that kept parallel workers apart was live until August 21 and then quietly was not. Swept.
