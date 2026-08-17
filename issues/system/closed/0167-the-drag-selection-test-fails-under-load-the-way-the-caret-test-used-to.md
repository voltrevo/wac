# 0167 — the drag-selection test fails under load, the way the caret test used to

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a red suite that goes green when the file is run alone

## Reproduction

Run three packages together on a loaded box — here `packages/box packages/sh packages/platform`,
8m54s wall clock with two other agents working:

```
a shell drawn on pixels: dragging over text selects it, and typing clears it
  => ./packages/box/test/rasterterm_live.test.ts:320:6
error: Error: assertEquals failed — the selection did not reach the cell the drag ended on
FAILED | 346 passed | 1 failed (8m54s)
```

The same file alone: `ok | 4 passed | 0 failed (4s)`.

## Why this is filed rather than fixed

**Because it is the second instance of a fixed bug, and the fix is a decision about this test's
budget rather than a repeat of the last one.** `issues/system/0159` is the caret-blink test in this
same file, closed 2026-08-15: it asserted against a constant deadline, and under scheduling pressure
a sample cost more than the whole budget. The answer there was to *measure* what a sample costs
first and derive the deadline from it, so the assertion degrades to slower rather than to false.

This test has the same shape — a drag is a sequence of events and the assertion is about the state
after the last one — and it did not get the same treatment, presumably because it was not the test
that was failing at the time. Whether it wants 0159's measured budget, a settle-until-stable wait, or
a different assertion entirely is a judgement about what the test is *for*, and the person who wrote
it will make it better than I will.

Noticed while running `packages/box` for `issues/lang/0137`. Unrelated to that work — the file names
neither the frame nor anything it touches — and reported because a flake in a shared file is red for
whoever runs the suite next, not only for me.

## Fixed — 2026-08-17, agent-c

**It was a race between the wait and the assertion, not a budget.** I filed this expecting
`issues/system/0159`\'s answer — measure a sample, derive the deadline — and that is not what it needed.

The test waits for cell **(1,1)** to turn selected, which is the cell the drag *started* on, and then
asserts synchronously about cell **(3,1)**, which is where it *ended*:

```ts
await page.waitForFunction(/* (1,1) is FG */);
assertEquals(await corner(3, 1), FG, "the selection did not reach the cell the drag ended on");
```

Under load the repaint reaches one cell and not yet the other, so the assertion arrives mid-render and
reports a selection that was on its way as a selection that did not happen. Nothing about the deadline
was wrong: the condition being waited for was not the condition being asserted.

The wait now covers both ends in one predicate, and the diagnostic prints both cells rather than one.
The cell *outside* the selection is still asserted without a wait, deliberately — waiting for a pixel
to stay unchanged says nothing, and by the time both ends are painted the selection has settled.

Four passes in the file, sampled three times over on a box with two other agents working. The race is
gone by construction rather than by timing, which is the part worth having: the test now waits for
what it reads.
