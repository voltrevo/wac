# 0178 — the caret stays lit for over a second after a click, and the test waiting for it to go dark gives up

- **Status:** closed
- **Fixed in:** `packages/box/example/rasterterm.wac` — a bare `pointermove` no longer restarts the
  blink phase. `packages/raster/src/grid.wac`'s click-selects-nothing fix went with it and is not
  this. Nine consecutive passes where one in three failed.
- **Claimed by:** agent-b
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

## Two real defects on this path, and neither is this — agent-b, 2026-08-29

Took the issue's own advice and drove the terminal's model directly instead of the browser. Two
things are wrong, both now fixed, and I cannot show that either is the flake — so this stays open.

**A click leaves a cell selected, for good.** `Grid.selectFrom` sets `selAnchor` and `selHead` to the
same cell and `selected()` answered true for it, so a press with no drag left one cell drawn
inverted — `grid.wac` fills a selected cell entirely with the *foreground* colour. A terminal selects
on a drag, not on a click. Fixed with a `selDragged` flag set by `selectTo`, rather than by comparing
the two indices, because a drag that returns to the cell it began on has selected that cell.
`raster_test.wac` covers it and the assertion fails without the fix.

**But it cannot be what this issue sees.** `caretLit()` samples `getImageData(0, 0, 640, 16)` — row
0 and nothing else — and reports true when any cell there is over 96 of its 128 pixels in the
foreground colour, which is what a filled cell is. The terminal is 80×24 with no CSS sizing, so the
canvas is its intrinsic 640×384 and `page.click("#screen")` lands at (320, 192), which is cell
(40, 12). The stray selection is twelve rows below anything the test looks at.

**A bare pointer move counted as activity.** The loop set `caretOn = true` for *every* event before
deciding what the event was, and `pointermove` is subscribed — so the caret stopped blinking while
the pointer merely rested over the terminal, and started again only once the moves stopped. Now only
typing, pressing, releasing and a move *while dragging* restart the phase.

This one fits the shape of the failure — sixty consecutive lit samples is what a continuously reset
phase looks like — and I could not confirm it, because it needs the browser to deliver moves during
the sampling loop and nothing in the test moves the mouse after the click. Worth re-running the live
test a few times now; if it stops failing, this was it.

**What is still not ruled out** is the issue's own second mechanism, the sampling aliasing with the
phase, and any host-side source of moves after a click. What *is* ruled out is the selection.


## Nine of nine — agent-b, 2026-08-29

    deno test -A --unstable-net packages/box/test/rasterterm_live.test.ts --filter "caret blinks"

Run nine times in a row after the two fixes above: **9 passed, 0 failed.** At the one-in-three rate
this issue reports, nine consecutive passes is about a 2.6% outcome, so this is evidence rather than
proof — and the mechanism was never demonstrated, only argued.

**What the argument is.** The event loop set `caretOn = true` for every event *before* looking at
what the event was, and `pointermove` is subscribed. So the caret stopped blinking for as long as
moves kept arriving, and sixty consecutive lit samples is exactly what a continuously restarted
phase looks like. Nothing in the test moves the mouse after the click, which is why this could not
be confirmed from the test alone — but the browser is free to deliver moves the test did not ask
for, and that is the only path found that holds the caret lit across a full cycle.

**If it comes back**, the two things this did not rule out are the issue's own second mechanism —
the 25 ms sampling loop aliasing with the 500 ms phase, its period set by a constant rather than by
anything measured — and a host-side source of pointer events after a click. What *is* ruled out is
the stray selection: it lands on the clicked cell, `page.click` clicks the centre, the terminal is
80×24 with no CSS sizing, and `caretLit()` samples row 0 alone.

Also worth saying: the nine runs were on this box right after a gate finished, with another agent
possibly active. Quieter than the gate, not certified quiet.
