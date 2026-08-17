# 0178 — the caret stays lit for over a second after a click, and the test waiting for it to go dark gives up

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a live test red on a quiet box, one run in three

## Reproduction

```
deno test -A --unstable-net packages/box/test/rasterterm_live.test.ts --filter "caret blinks"
```

Once in three runs, on an otherwise quiet box, filtered to itself:

```
error: Error: the caret never went dark, so this proves nothing
      if (await caretLit()) throw new Error("the caret never went dark, so this proves nothing");
    at fn (packages/box/test/rasterterm_live.test.ts:574:35)
```

The other two runs pass. The whole `packages/box` run before it failed the same way — 129 passed, 1
failed — so this is the failure that was already there, now caught filtered to one test.

**This is not `issues/system/0159`**, whose title is "fails under scheduling pressure, and passes
alone". It fails alone, and it fails on the canary rather than on an assertion: nothing in that
message is about the program being wrong. What it says is that the test never established its own
precondition.

## What is known

The step is lines 570–574 as they were: click the screen, then sample until the caret is dark, then
type and require it lit inside half a blink.

```ts
await page.click("#screen");
for (let i = 0; i < 60 && await caretLit(); i++) {
  await new Promise((r) => setTimeout(r, 25));
}
if (await caretLit()) throw new Error("the caret never went dark, so this proves nothing");
```

Sixty samples at 25 ms plus a ~1 ms round trip is about 1.6 s of watching, and a blink cycle is
1000 ms — half lit, half dark. So on the failing run **the caret was lit in every one of sixty
samples spanning at least one full cycle.** Two mechanisms fit and they want different fixes:

- **The click leaves the caret solid.** `page.click` is a mousedown and a mouseup, and a drag
  selection begins on mousedown — if a selection in progress, or a stuck button state, draws the
  caret solid, the loop is waiting for something that will not happen. This is the one that would be
  a real defect in `rasterterm.wac`, and it is testable without a browser by driving the terminal's
  mouse handling directly.
- **The samples aliased with the phase.** Less likely at this cadence, but the loop's period is set
  by a constant sleep rather than by anything measured, so nothing rules it out.

The blink assertion ahead of it had already passed on the failing run — both states seen — so the
program was blinking a moment earlier. That points at the click.

## What was done in passing, and what was not

The guard `issues/system/0159` added covered the deadline and not the setup: the click, the wait and
the canary ran on every machine, while only the assertion they set up was skipped when a sample cost
too much to resolve half a blink. So a box that fix had already judged unable to measure this could
still go red here. The setup is inside the guard now, and the message says how long it watched.

That narrows who can see it; it does not explain a caret lit for 1.6 s on a box that can sample in
1 ms. The mechanism above is untouched, which is why this is filed rather than closed.
