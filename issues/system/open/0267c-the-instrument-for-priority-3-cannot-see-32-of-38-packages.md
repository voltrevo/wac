# 0267c — the instrument that measures priority 3 cannot see 32 of the 38 packages

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** decision — what should the sweep measure now that the suite has moved
- **Symptom:** a green figure that is measured over a seventh of what it names

## Measured

`packages/wacc/README.md` states priority 3 as:

    34 of 34 packages pass their own suite on wacc-emitted code (1,663 tests)

printed by `packages/wacc/tools/runOnWacc.ts`. Run today, that tool reports `FAIL … 0 passed` for
package after package. Not a regression in the packages — **it finds no tests to run**:

    $ WAC_WASM_FROM=wacc deno test -A --no-check packages/abi/test
    error: No test modules found

`runOnWacc.ts` shells out to `deno test packages/<pkg>/test`, which sees `*.test.ts` and nothing else.
Counted across the 38 packages it walks — it skips `wacc` itself:

    wac-only (`*_test.wac`, no `.test.ts`)   32
    both                                      5
    ts-only                                   1
    no test directory                         0

So the tool can measure **6 of 38** packages, and the other 32 come back as failures with a tally of
zero. The figure in the README was recorded on **2026-08-12** — `git log -S` says so — and
`issues/system/0161` has been moving packages off Deno ever since. Nothing lied; the ground moved
under a number that is still printed as though it had not.

## The part that is a decision rather than a bug

The obvious fix — teach `runOnWacc.ts` to run the `wac test` lane as well — **does not mean what the
old number meant**, and that is the whole of this issue.

`WAC_WASM_FROM=wacc` swaps the wasm under a *TypeScript* harness, so the same test runs twice against
two emitters and the comparison is the point. A `*_test.wac` file has no such choice: it is compiled
by `wac`, which is wacc, and it could not have run on the reference's output in the first place. So
for those 32 packages "passes on wacc-emitted code" is not a measurement that can fail — it is a
restatement of the test having run at all.

Which means the sweep is not merely blind today; **it is becoming vacuous as `0161` proceeds**, and
finishing that migration removes the last package it could say anything about. Three ways out, and
they are not equivalent:

1. **Let it narrow honestly.** Keep the sweep on whatever `.test.ts` remains, and print the
   denominator as what it is — `6 of 38 packages have a suite this can swap the emitter under` —
   rather than a bare `34 of 34`. Cheapest, and it makes the decay visible instead of invisible.
2. **Move the comparison down a level.** What the old number really asserted is *the same source,
   compiled two ways, answers the same*. `test/wac/corpusemit_test.wac` and the rung-4 emit corpus
   already do that for programs; the packages' own suites were a broader, more realistic corpus of
   the same idea. Rebuilding that for the wac lane means compiling each `*_test.wac` with the
   reference and with wacc and comparing, which the reference cannot do for every package — it has
   no lambdas, and `packages/platform` uses them.
3. **Retire the claim and say what replaced it.** If every package's tests run on wacc by
   construction, then priority 3 is met by the suite being green, and the sweep is a second producer
   of that fact. `CLAUDE.md` is blunt about second producers. This is the honest option if 2 is not
   affordable, but it should be *taken* rather than allowed to happen by the number quietly ceasing
   to mean anything.

## Not the same as 0161

`0161` is the migration itself and its ordering. This is a consequence of it that nothing in that
page covers: `runOnWacc`, `WAC_WASM_FROM`, rung 4's other half and the README figure are not
mentioned there. Worth linking from it once this is decided.

## What is safe to say today

Nothing about the packages has been shown to be wrong. The suite is green and every package's tests
run — they simply run through `wac test`, where this tool cannot see them. **The claim that is
unsupported is the specific one the README makes**, that 34 packages pass *on wacc-emitted code as
distinct from the reference's*, because the migration has left six packages where that
distinction still exists.

## Run to completion, twice — the numbers

    34 of 34 packages ... (1,663 tests)     the README, recorded 2026-08-12
     4 of 38 packages ... (127 tests)       run today
     6 of 38 packages ... (233 tests)       run today with `--unstable-net`

**The gap between the two runs is a second bug in the same tool, and it is fixed.** `runOnWacc.ts`
called `deno test` without `--unstable-net`, so three of `packages/platform`'s datagram tests failed
with *"Deno.listenDatagram is not a function"* and the sweep reported `platform` as **a wrong answer or
a trap** on a suite that is 105 of 105. `packages/webrtc` was the other. `deno task test` passes that
flag for exactly this reason, and `issues/system/0005` is the same omission in `tools/mutate.ts`, where
it quietly stopped measuring whole packages — the second time this flag has cost a measurement, which
is an argument for a shared way of spawning `deno test` rather than a third site to forget it in.

With the flag, **no package is reported wrong**: all 32 remaining rows are `0 passed` with no cause
beyond having no `.test.ts` for this tool to find. The six that still work are `box`, `platform`,
`raster`, `sh`, `stream` and `webrtc`.

So the honest reading of priority 3 today is: *of the packages whose suites can still be run against a
choice of emitter, all of them pass* — six, and 233 tests. That is a true sentence and a much smaller
one than the README has been printing, and it will keep shrinking on its own.

## A third defect, not fixed here

`packages/webrtc/test/browser.test.ts` launches Chromium through playwright with no guard for a
machine that has no browser. On this container it cannot run, and the classifier called that *a wrong
answer or a trap* — the strongest verdict the tool has, for an absent dependency. It is `ok` now only
because the run happened to reach a skip. A tool that reports "wacc emitted something wrong" when the
real cause is "no browser installed" is one whose red means less than it says, and that matters more
as the denominator shrinks.

