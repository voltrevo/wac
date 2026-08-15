# 0159 — the caret-blink test fails under scheduling pressure, and passes alone

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Fixed in:** this commit
- **Symptom:** wrong answer — a live test that is green alone and red in a full run

## Reproduction

`packages/box/test/rasterterm_live.test.ts`, *"a shell drawn on pixels: the caret blinks, and typing
makes it solid"*, failed once in:

```
DENO_JOBS=1 deno test -A --unstable-net --parallel packages/box/
    FAILED | 128 passed | 1 failed (3m25s)
```

The same test at the same job count, filtered to itself, passes — twice in a row:

```
DENO_JOBS=1 deno test -A --unstable-net --filter "the caret blinks" \
  packages/box/test/rasterterm_live.test.ts
    ok | 1 passed | 0 failed | 3 filtered out
```

So it is not broken at `DENO_JOBS=1`. It is sensitive to what else is running, and one job per core
is not the quiet configuration it sounds like — the whole package still shares the box with two
other agents, and a serial run takes 3m25s rather than 1m, so the test spends longer exposed.

Found while measuring `packages/box`'s memory for `issues/system/0142`, not while looking at raster.
I did not chase it further, and the failure output is gone: it was one line in a run I was measuring
for something else.

## Notes

A blinking caret is a wall-clock assertion — it has to be in one state, wait, and be in the other.
That is the shape that goes red when a scheduler takes the process away for longer than the blink
interval, and the shape that a passing run tells you nothing about.

Two things worth doing before treating it as flaky-and-ignorable:

- **Capture the failure.** Whether it read "solid when it should blink" or the reverse says whether
  the test was starved or the caret was, and they want different fixes.
- **Assert against the clock the test controls, not the one it observes.** `packages/platform` has
  virtual time, and the website's own copy makes a point of determinism — if the terminal's blink
  can be driven from that instead of from wall time, the test stops depending on the scheduler at
  all. If it cannot, that is worth knowing too and belongs in this issue.

`agent-c` wrote the caret at 19:32 on 2026-08-15 (*"raster: a blinking caret — and the capability I
said was missing was there all along"*) and is the person with the context; this is filed rather than
fixed because it is their package and their evening's work, and a flake I saw once is not worth
reaching into it for.


## Fixed, 2026-08-15 — the budget is measured now, not chosen

The diagnosis in the Notes is right: this is a wall-clock assertion, and the wall clock is not the
test's to control. The specific fragility was mine. The phase-reset half had a **250 ms** budget,
picked because half a blink is 500 ms and lighting inside 250 could not be ordinary blinking — sound
reasoning on a quiet box, where a sample costs **2 ms**. Under a loaded one a playwright round trip is
comfortably 100 ms, and three of them exhaust the budget while the program is behaving perfectly.

So the test measures what a sample costs before it asserts anything with a deadline:

- **If it cannot resolve a quarter-blink** — a sample over ~31 ms — the phase-reset assertion is
  skipped, loudly, naming the measured cost and the interval it could not distinguish. A test that
  cannot sample faster than the thing it measures cannot measure it, and a red on a correct program
  teaches people to re-run until green.
- **If it can**, the budget is `BLINK_MS - perSample` rather than a constant, so the deadline is what
  this machine can actually resolve.
- **The blink assertion itself stays**, widened to twelve seconds. It only needs to see both states,
  which no amount of scheduling pressure makes impossible — it makes it slower.

`BLINK_MS` is named once instead of spelled into three deadlines.

**And the failure text now says which direction**, which is what the Notes asked for: the blink
failure reports whether it saw one state or neither ("the program stopped toggling" against "the page
never drew"), and the phase-reset failure says the measured sample cost so a reader can tell a
starved test from a starved caret without re-running it.

Verified in the configuration that produced the report — `DENO_JOBS=1 deno test -A --unstable-net
--parallel packages/box/`, 129 passed, 3m20s — and the skip path canaried by forcing it to believe
every machine is too slow, which leaves the test green with the warning and the blink assertion still
running.
