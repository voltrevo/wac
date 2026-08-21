# 0229 — the heavy lane's declared costs are stale, and nothing checks the number

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-21
- **Kind:** performance
- **Symptom:** wrong answer (in a declaration, not in a program)

## The measurement

`packages/wacc/test/wac/checked_test.wac` declares:

    // test-lane: heavy — 140s, measured, the whole corpus emitted twice (and every twentieth a third time)

Run alone on this box, with nothing else of mine on it, it reached **1,166 seconds and had not
finished** — it was stopped, not completed, so 1,166s is a floor rather than the cost. That is at
least **8× the declared number**.

Found while running the heavy lane end to end for the first time in a while
(`deno task test:heavy`): the whole wac half declares 412s — 18 + 22 + 5.5 + 140 + 143 + 84 — and had
spent **9m20s of CPU on its first four files** (declared 185s) before the run hit a 28-minute bound
with `checked_test` still going. CPU rather than wall, so contention from another agent does not
explain it.

## Why the number matters rather than being decoration

Three decisions are derived from these declarations, and all three are now sized from figures that no
longer hold:

- **What the broad pass skips.** The lane exists because these files are expensive; how expensive
  decides whether a file belongs in it, and `harness/testLane.ts` says the judgement is about
  *resident memory* rather than duration — "heavy means resident, not slow".
- **Two workers rather than four**, which was chosen against a peak measured when these numbers were
  taken.
- **`deno task test:heavy` as a thing a person runs.** At the declared 412s it is a coffee; at the
  measured rate it is half an hour, and the agent who runs it before a push will conclude the lane is
  broken rather than that its label is old.

## What is not the cause

- **Not the new runner.** The wac orchestrator hands the six files to one `wac test` exactly as
  `tools/runTests.ts` did, and the file above was measured on its own, outside any runner.
- **Not contention.** The 9m20s figure is CPU time.
- **Probably not a regression in the tests themselves**, though this is the part that is *not*
  measured: the likely cause is the corpus these files walk. They are "the whole corpus emitted
  twice" and "every file in the repository through the emitter", and the repository has grown since
  the declarations were written. A cost that scales with the corpus is a cost that goes stale on its
  own, which is the interesting half of this issue.

## What would fix it, in the order that gets the value soonest

1. **Re-measure the six**, and write the date beside the number. A declaration that says
   `140s, measured 2026-08-04` ages visibly; one that says `140s, measured` does not.
2. **Make the guard check currency, not just presence.** `tools/lane.test.ts` requires the reason to
   name a number — that is what stopped "this is slow" being the whole justification — but nothing
   compares it to anything. The runner already measures every chunk and prints the three longest; the
   cheap version of this is to fail, or warn, when a declared file's own run exceeds its declaration
   by some factor.
3. **Ask whether a corpus-sized test belongs in a lane sized by a constant at all.** Two of these
   files are "every file in the repository", so their cost is a function of the repository. That is
   the thing to fix rather than the number: `issues/system/0204` and `0192` are about the same
   pressure from the other side.

## What this is not asking for

Not that the files be removed from the lane — they belong in it more than they did. The declarations
are what is wrong, and the number they carry is load-bearing precisely because somebody reads it to
decide what a push should pay for.
