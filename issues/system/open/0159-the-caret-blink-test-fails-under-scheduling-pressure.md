# 0159 — the caret-blink test fails under scheduling pressure, and passes alone

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
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
