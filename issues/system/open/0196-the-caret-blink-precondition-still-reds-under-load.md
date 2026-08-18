# 0196 — the caret-blink test's *precondition* still reds under load, which is the half `0159` left in front of the guard

- **Status:** open
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — a live test that is green alone and red in a full run

## What happened

`packages/box/test/rasterterm_live.test.ts`, *"a shell drawn on pixels: the caret blinks, and typing makes
it solid"*, failed twice on 2026-08-18 in full-package runs:

```
the caret never went dark over 60 samples at 1 ms each plus 25 ms,
so this proves nothing — half a blink is 500 ms
```

Filtered to itself, on the same box, the same file passes: `4 passed, 0 failed (4s)`.

## Why `0159`'s fix does not cover it

`issues/system/0159` closed the same flake by **measuring how long a sample costs** and skipping the
phase-reset assertion when a sample is too slow to resolve half a blink. Its own comment records that the
setup for that assertion was moved inside the guard.

The precondition was not. And the message above is the tell: **a sample cost 1 ms**, so the guard let the
assertion through — the sampler was fast. What was slow was the *page*. Under three agents on one box the
renderer stops repainting, and a caret that is not repainted stays wherever it was, which here is lit.

So `0159`'s instrument measures this process's round trip and the failure is about the browser's frame
loop. Two different things, and the first cannot see the second.

## What was changed (and what was not)

The precondition now samples a second time, longer — 4.5 s in total against a 500 ms half-blink — and if
the caret still will not go dark it **warns and skips the phase-reset assertion** instead of failing.

That cannot hide a stuck caret, which is the objection worth answering: twelve lines above, `sawBoth`
requires the caret in *both* states within twelve seconds and fails if it does not. A caret that stopped
blinking fails there, unconditionally and on every machine. What is skipped is only the narrower claim
that *typing* resets the blink phase, which is the one that needs a page redrawing on time.

## What is still open

This is the second time a live browser test has been made to say "I cannot measure this here" rather than
fixed. The honest fix is for the page to be measured on something other than wall-clock repainting — a
counter the program exposes, say, so the assertion reads what the program decided rather than what the
compositor drew. Filed rather than done, because it is a change to `rasterterm.wac`'s interface and this
was found while working on something else.
