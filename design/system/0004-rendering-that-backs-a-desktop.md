# 0004 — rendering that backs a desktop: one surface, from a kernel or from a tab

- **Status:** proposal
- **Opened:** 2026-08-10
- **Written by:** agent-a, from a decision with the operator
- **Depends on:** [0001](0001-a-self-contained-system.md) step 8, which is the desktop this would back

## Why this document exists

[0001](0001-a-self-contained-system.md)'s step 8 built a window manager: windows over one filesystem,
a launcher, dragging, a terminal in each. It is a real manager and it is standing on the DOM. The
browser is doing text layout, selection, the caret and IME; `Page.render` hands over markup and the
browser decides what a glyph is.

That is fine, and it is also the reason this document exists. 0001's aim opens with *"the userland of a
bootable system — a minimal Linux kernel and Wasmtime, no JavaScript at all"*, and a desktop on that
stack has no DOM to borrow. So either step 8 finishes as a browser artefact, or something has to draw.

**The constraint that shapes every answer below is that it is both, not a sequence.** The
kernel-and-wasmtime stack is the ambition *and* running wac programs without it is paramount: Deno,
Node and a browser stay first-class targets. A renderer that only works on a framebuffer is not a
candidate, however good it is. Whatever we build has to run in a tab.

## What we are aiming at

A **surface** a wac program can draw a desktop into, which behaves the same whether the pixels end up
in a Linux framebuffer or a `<canvas>`, and a text stack good enough that a terminal drawn on it is
not worse than the `<pre>` and `<input>` it replaces.

Done means: `desk.wac` runs unchanged over the surface on both, with a terminal you can select text
in, paste into, and type non-Latin script into — and the browser build is not a special case in the
manager's code.

What it is **not**: a general GUI toolkit, a compositor with transparency and shadows, a font
rasteriser competitive with FreeType, or an accessibility story. Each of those is a project. This is
the smallest thing that makes a desktop stop depending on somebody else's text engine.

## The decision this turns on

**A pixel buffer is the only seam that exists on both sides.** `Page.drawPixels(id, w, h, rgba)` is
already there and already argued for: *"one coarse capability instead of a drawing API… a buffer is
one call, and wac is good at filling a buffer."* A framebuffer is the same shape. Every richer
alternative — a 2D context, a display list, DOM nodes — exists on one side and not the other.

So the seam is settled by the constraint rather than by preference. What is **not** settled is
everything above it, and that is what this document is for.

### D1 — the surface is a buffer plus a damage rectangle, not a buffer

Blitting a whole desktop per frame is 4 bytes × width × height across the bridge on every change. At
1920×1080 that is 8 MB a frame, and the capability caps a frame's payload at 8 MiB (`CAP` in
`host/child.ts`), so a full-screen redraw is *at the limit* before anything else is in flight.

A drag moves one window; a keystroke changes one glyph cell. The surface therefore takes a rectangle
with each blit, and the manager already knows which one — `desk.wac` computes exactly that today when
it decides to `setStyle` one window instead of calling `render`. **`drawPixels` has no rectangle
argument.** Adding one is the first capability change this needs, and it is small.

### D2 — text is a glyph cache over a rasteriser we own, and the first cut is bitmap-only

The honest cost of leaving the DOM is text. Three things it does for free: shaping (which glyph for
which codepoints, and where), rasterisation (glyph to coverage), and selection/IME (the parts a user
notices immediately and nobody thinks about until they are gone).

The staging that keeps this finishable:

1. **A fixed-cell monospace grid with a bitmap font.** A terminal is a grid; a window manager needs
   labels. This is a lookup table and a blit, it is a weekend, and it covers `desk.wac` entirely.

   **The font is unscii, decided 2026-08-15 with the operator.** Public domain — its README says
   *"You can consider it Public Domain (or CC-0)"* — so it carries **no obligation at all**: no
   notice to reproduce, nothing to travel with a binary, and no caveat needed on the repository's
   *"no third-party code in any package's `src/`"*. **`unscii-16` (8x16) is the first cut**, with
   `unscii-8` (8x8) the same design at half height for a dense terminal.

   **One exception, and it is the thing to get wrong.** The files derived from Roman Czyborra's
   Unifont — `unifont.hex`, `hex2bdf.pl`, and **`unscii-16-full.*`** — are GPL. The `-full` variants
   are the trap, because the name suggests *more* rather than *differently licensed*. Vendor
   `unscii-16.hex` and `unscii-8.hex` and nothing whose name contains `full`.

   Chosen by rendering the candidates rather than by reading about them: parsed and drawn at 1:1,
   which is how they will appear through `drawPixels`. Coverage decided it and the licence confirmed
   it — **unscii-16 has 3,240 glyphs, 160 box-drawing and 128 block characters**, against Spleen's
   1,001 and Tamzen's 189. Tamzen drew *none* of the box-drawing sample; its line came out empty
   where the others drew `┌──┬──┐ █▓▒░`. A window manager wants borders and a terminal wants shading,
   so that is close to disqualifying. Cozette was not compared: its repository generates its BDF at
   build time and ships none.

   **Spleen, BSD-2, was the pick for about an hour** and is worth recording as the runner-up: a
   clean licence, five sizes of one design, and the better letterforms on `ILil1|`. It lost because
   attribution-in-binaries would have been the first such obligation in this repository, and because
   unscii covers three times as much.

   **The format is a second reason.** unscii ships Unifont `.hex` — `CODEPOINT:HEXROWS`, one line a
   glyph, every glyph already filling its cell. There are no bounding boxes and no offsets, where
   BDF has both and a reader that ignores them stacks every glyph at the baseline. The wac-side
   loader is a split and an index, which is materially less of `packages/raster` than BDF would be.

   **The file has been fetched and read, 2026-08-15, and it is not uniformly 8 pixels wide.** The
   licence was checked at the source rather than taken from this note: the README says *"You can
   consider it Public Domain (or CC-0) except for the files (unifont.hex, hex2bdf.pl,
   unscii-16-full.\*) which fall under GPL"* — the split described above, now verified against the
   repository it comes from. 3,240 glyphs, matching the count above. `viznut.fi` is **not** on the
   proxy allowlist; GitHub is, and the path that works is
   `raw.githubusercontent.com/viznut/unscii/HEAD/fontfiles/unscii-16.hex`.

   Two things a `.hex` reader gets wrong by default, both found by writing one:

   - **Code points are five hex digits**, not four — `A` is the line beginning `00041:`. A
     four-digit assumption matches nothing and yields an *empty font* rather than an error, which is
     the failure shape this repository keeps finding.
   - **243 of the 3,240 glyphs are 64 hex characters rather than 32** — sixteen rows of *two* bytes,
     so 16 pixels wide in a font whose cell is 8. They are the CJK and emoji code points, the ones a
     terminal already gives two cells, so this is unscii agreeing with East Asian Width rather than
     contradicting it. Checking that correspondence exactly needs a width table the host does not
     expose, so it is stated as a shape and not as a number.

   So the loader is a split, an index, *and a width taken from the line's own length* — still much
   less than BDF, but not quite the two things the paragraph above says.

   **That bears on staging this to "a fixed-cell grid" below.** A fixed cell is still the right
   first cut, and the grid has to decide what a double-width glyph means in it — two cells, as every
   terminal does, or skipped. Deciding it now costs nothing; discovering it when the first CJK
   character draws over its neighbour is a rewrite of the glyph cache's key.

2. **A cached rasteriser for scalable fonts**, one glyph at a time into an atlas. This is where a real
   font library would be, and where reimplementing one is a mistake — but it is also the point at
   which "no dependencies" and "renders text" collide, and the collision deserves its own decision
   rather than a default.
3. **Shaping** — only if a script that needs it is in scope. It is not, for a terminal.

**Selection, the caret and IME are not free at any stage**, and D2 does not pretend otherwise. A
terminal on a raster surface has to implement its own selection model and its own composition
handling, and in a browser it has to do so *while* the browser is willing to do it for an `<input>`
sitting invisibly on top. That tension is the strongest argument for the fallback in D4.

### D3 — input is already portable, and this is the cheap half

`Page.on`/`nextEvent` deliver `keydown` as **the bytes a terminal sends** — `Ctrl-C` is 0x03, an arrow
is its escape sequence — which is exactly what `packages/tty`'s line discipline consumes and exactly
what a kernel would hand us. Pointer events carry coordinates relative to the element the capability
names. Neither needs a DOM to mean anything.

So input crosses unchanged. The only new thing a raster surface needs is hit-testing, which is the
manager's own arithmetic over rectangles it already keeps.

### D4 — the DOM path stays, and stays first-class

Not as a stepping stone. A wac program in a tab that wants the browser's text engine should keep
getting it: it is better at selection, paste and IME than anything here will be for a long time, and
0001's aim is that programs run *without* the full stack as much as on it.

Concretely, `desk.wac` should end up with one presentation seam and two implementations behind it —
the markup one it has, and the raster one this proposes — with the manager's own logic (stacking,
focus, drag, hit-testing) identical across both. If building the raster path makes the manager grow
branches, the seam is in the wrong place.

## What this costs, said plainly

- A rectangle on `drawPixels`, and a second host op if partial blits want their own call.
- A bitmap font in the repo — **settled: unscii, public domain**, so this line no longer carries a
  cost. The only care needed is avoiding the GPL `-full` variants; see D2 step 1.
- A selection model, a caret and a composition path, all of which the DOM currently supplies.
- A second presentation of `desk.wac`, kept honest by running the same tests over both.

Against which: the desktop stops being a browser artefact, and the same binary draws whether it boots
from a kernel or loads in a tab.

## Whether this is its own project

Probably, and that is the operator's stated view: *browserless rendering suitable for building a
desktop should maybe be its own project.* This document is written so that judgement can be made from
a plan rather than from a hunch, and so 0001's step 8 can say what it is waiting for.

**What argues for splitting it out**: nothing above needs a filesystem, a process table, users or an
image, which is what 0001 is about. It shares only `Page`.

**What argues for keeping it here**: the terminal is the only real client, and a renderer designed
without one is designed against a guess.

The proposal is to **stage it inside 0001 to the end of D2's step 1** — a fixed-cell grid, which is
enough to run the existing desktop and terminal with no DOM — and to split anything beyond that into
its own direction, because scalable text is where the work stops being about a desktop and starts
being about a font engine.

## Order of work, if this is taken up

| step | what | done means |
|---|---|---|
| 1 | a rectangle on `drawPixels`, and the conformance ledger entry that goes with it | a partial blit changes one window's pixels and nothing else, on every host that has a `Page` |
| 2 | `packages/raster`: a surface, rectangles, blits, a bitmap font, a glyph cache | a wac program draws a window frame and a line of text into a buffer, tested by comparing bytes |
| 3 | hit-testing and focus in the manager, over rectangles rather than element ids | `desk.wac`'s event handling is identical either way, which is the test |
| 4 | a raster terminal: grid, scrollback, caret, selection | the corpus that drives the DOM terminal drives this one and answers the same |
| 5 | the framebuffer host, on the stack 0001 is aiming at | the same desktop, booted, with no JavaScript in the artefact |

Steps 1–4 are browser-testable today; step 5 is the one that needs the bootable stack and would follow
0001's own step 2a rather than lead it. **2a landed on 2026-08-15**, so that ordering constraint has
been satisfied — see the step 5 row below for what it changed and what is actually left.

## State of play

| step | state |
|---|---|
| 1. a rectangle on `drawPixels` | **done, 2026-08-15.** `Page.drawPixelsIn(id, x, y, w, h, rgba)` blits into a canvas without resizing it; `drawPixels` still sizes. Separate calls because the resize is load-bearing for every page that draws today. In the README's table, the conformance ledger and `browser.test.ts` |
| 2. `packages/raster` | **done, 2026-08-15.** A `Surface` — pixels plus a damage rectangle — with `fill`, `rect`, `glyph` and `text`, and unscii-16 generated into `font16.wac`. The step's own criterion is its test: a window frame and a line of text drawn into a buffer and compared as bytes. 93% branch coverage, `wac task coverage:raster` |
| 3. hit-testing in the manager | **done, 2026-08-15.** `hit.wac` answers which window and which part; `desk.wac` is the state machine over it — press raises, a bar press drags by its grab point, the close button closes, and typing goes to the top. Driven by synthetic events in a test, with no page |
| 4. a raster terminal | **done, 2026-08-15.** `grid.wac` is the model and `packages/box/example/rasterterm.wac` runs the real `Session` in it — the same shell `term.wac` puts in a `<pre>`. `packages/box/test/rasterterm_live.test.ts` types `echo hi` into a canvas in chromium and finds the output in cell (0, 1) |
| 5. the framebuffer host | **not started, but no longer blocked** — 0001 step 2a is done, so the second host exists and this step is ordinary work rather than something waiting on another design note. Both halves of "the same desktop, either target" are now demonstrated: `example/rasterdesk.wac` draws on a real canvas and `test/live.test.ts` reads the pixels back out of chromium, and `example/deskshot.wac` draws the *same* desk on both hosts and `test/hosts.test.ts` compares them — 192,015 bytes, identical. What is left is a framebuffer to blit into instead of a file |

## Step 2 done, 2026-08-15 — and one thing the language decided for us

`packages/raster` exists: `Surface.create(w, h)`, `fill`, `rect`, `glyph`, `text`, and unscii-16
generated into `packages/raster/src/font16.wac` by `packages/raster/tools/genfont.ts` from the vendored `.hex`. The criterion in the
table above is what its test does — a frame, a title bar and "wac" drawn into a buffer, then read
back as pixels.

**The glyph table does not fit in one constant array.** V8 refuses `array.new_fixed` above 10,000
elements and the font is 13,932 words, so a single `const i32[]` does not compile at all —
*"Requested length 13932 for array.new_fixed too large"*. It is generated as two arrays with the
lookup dividing by a constant. That is worth knowing before anyone writes another large table in
wac: it is an engine limit rather than a wac one, and it appears at the point of *compiling* the
module rather than as a diagnostic.

Three smaller decisions, each made where the alternative was silent:

- **Damage is what was written, not what was asked for.** A fill clipped at the edge reports the
  clipped rectangle, so a host that sends the damaged region is never told about pixels outside the
  surface. D1 wanted a buffer *plus* a rectangle; this is the half that makes the rectangle usable.
- **`glyph` answers the width it drew.** 243 of unscii's 3,240 glyphs are 16 pixels wide, so a
  caller that assumed a cell would overlap every CJK and emoji point. `text` advances by what it is
  told, which is also what a fixed-cell grid needs in order to decide that such a glyph takes two
  cells — the decision D2 said this step should make on purpose.
- **No blending.** A fill writes the alpha it was given. Blending is a decision about a compositor
  that does not exist, and writing one in now would be inventing a rule the rest of the stack has
  not asked for.

### What step 3 needs from this, and what it does not

Hit-testing is over rectangles, and a `Surface` already carries the only rectangle it owns. What is
*not* here is a glyph cache: `glyph` reads the table and blits every time. That is fast enough to
draw a desktop and it is the obvious thing to measure before optimising — the table lookup is a
binary search over 3,240 entries, and whether it costs anything at a terminal's refresh rate is a
question with a number, not an opinion.

## Step 1 done, 2026-08-15 — and it is two calls, not an argument

D1 said "`drawPixels` has no rectangle argument. Adding one is the first capability change this
needs, and it is small." It is small, and it is not an argument.

`drawPixels` **sizes the canvas to the buffer**, and every page that draws relies on that: their
markup is `<canvas id="c"></canvas>` with no dimensions, so the backing store is whatever the last
blit made it. A partial blit must not resize, because resizing *clears* the canvas — it would throw
away everything outside the rectangle, which is the opposite of the point. Folding both into one
call would mean a rule about when it resizes, and a rule like that is remembered wrongly.

So `Page.drawPixelsIn(id, x, y, w, h, rgba)` is its own capability: `drawPixels` establishes the
canvas, `drawPixelsIn` updates part of it. On `Page` rather than `Cli`, so only programs that draw
carry it — `issues/system/0147` is about what every program pays for, and this is not that.

**`packages/raster` gained the other half in the same change.** A damage rectangle nothing can act
on is a value nothing reads, so `Surface` now answers `region(x, y, w, h)` and `damagedPixels()` —
the second being exactly `drawPixelsIn`'s payload. The reported damage is *inclusive* at the right
and bottom and a blit's width is not, so that conversion lives in one place rather than in every
caller.

A frame is now: draw, `drawPixelsIn(id, s.dx0, s.dy0, w, h, s.damagedPixels())`, `undamage()`.

### What is not done

Nothing has drawn to a real screen yet. The capability is implemented in the browser host and
checked through the bridge with a fake DOM — `browser.test.ts` asserts the payload arrives as
`drawIn:c/11,7/2x3/24b` and that a short buffer is refused where the arithmetic went wrong, rather
than several layers later inside `putImageData`. Putting a raster window on a page is step 3's
business, and it is the first thing that will find whatever this got wrong about coordinates.

## Step 3, the half that can be done without a screen — 2026-08-15

`desk.wac` dispatches on the id the browser hands it: `pointerdown` on `bar3` drags window 3, `click`
on `cls3` closes it. The DOM did the hit-testing. A raster desktop has a *point*, so the manager has
to answer "which window, and which part" itself.

`packages/raster/src/hit.wac` is that answer, and it is deliberately **pure and outside the
manager** — which is what lets it be tested by asking rather than by driving a desktop.

- `topmost(stack, x, y)` searches **back to front**, because that is the order a painter's-algorithm
  redraw walks. Backwards gives a manager that raises the window *behind* the one you clicked, which
  reads as the click being ignored rather than as a stacking bug.
- Right and bottom edges are **exclusive**. Two windows sharing a seam must not both own it, or which
  one gets the click depends on the order they happen to be tested in.
- `partAt(win, barH, closeW, …)` answers body, bar or close, and the measurements are the *caller's*
  — this module draws nothing and has no opinion about how tall a bar should be.
- `raiseTo` is here rather than in the manager because **the stack's order is the hit-testing order**.
  A raise that left the two disagreeing would be a window that draws on top and answers clicks from
  underneath.

Two edges the tests pin down because I got them wrong first: a window shorter than its own title bar
is *all bar* rather than an unreachable body, and a close button `closeW` wide starts at
`x + w - closeW`, which for a 100-wide window at x=10 with a 16-pixel button is column 94 and not 93.

### Why this is half

**`desk.wac` is not wired to it.** The manager still parses ids, and it should: it is running on a
DOM today and the DOM's hit-testing is correct there. The wiring belongs with the raster desktop that
step 4's terminal needs, and doing it now would mean two dispatch paths in a manager that has one
job.

What this does establish is that the answer does not need a screen to be checked — which is the part
that would otherwise have waited for step 5.

## Step 4's model, 2026-08-15 — and D2's deferred decision, made

`packages/raster/src/grid.wac` is the model the DOM was providing: cells, a cursor, wrapping,
scrollback and a caret, with `draw` putting it on a `Surface`.

**A double-width glyph means two cells.** D2 said a fixed-cell grid "has to decide what a
double-width glyph means in it — two cells, as every terminal does, or skipped", and this is that
decision. The first cell holds the code point and the second a `WIDE_TAIL` marker; skipping them
would make a terminal that silently cannot show CJK, and coverage is why unscii was chosen.

**A wide glyph with one column left wraps rather than splitting.** Splitting produces the half-drawn
character everyone has seen in a terminal that got this wrong, and the half on the next line is not
the other half of anything.

Two smaller decisions, both where the alternative is a visible bug:

- **The cursor stops at the edge rather than wrapping eagerly.** A terminal that wraps on write shows
  the caret at the start of a line nothing has been written to, and the next character is what
  decides whether that line exists at all.
- **The caret is a block, drawn after the text, with the character under it redrawn in the
  background.** A block is what the `<input>` gave for free, and losing it would be a regression a
  user notices. Redrawing the character is what keeps it readable rather than a solid square.

No escape sequences, no per-cell colour, no alternate screen. A cell is a code point and the grid
draws in one foreground on one background — colour belongs with the parser that would set it, and
`packages/sh` writes plain text, which is what the DOM terminal shows today.

### Why this is the model and not the terminal

**Nothing has fed it a shell.** The step's criterion is "the corpus that drives the DOM terminal
drives this one and answers the same", and that corpus is the shell's — so the remaining work is
wiring a session's bytes into `put` and comparing what the grid holds against what the `<pre>` shows.
That needs the raster desktop step 3's other half is waiting for, and it is the first thing that will
find whatever this got wrong about the cursor.

What is checked now is the model on its own: wrapping at the last column, `\r` overwriting rather
than clearing, a wide glyph taking two cells and never straddling the edge, the oldest scrollback
line being the one dropped, and a caret that covers exactly one cell.

## The four pieces meet, 2026-08-15 — `packages/raster/src/desk.wac`

`hit.wac` says which window a point is in, `grid.wac` is what a terminal holds, `surface.wac` draws,
and `desk.wac` is the state machine between them. It takes **no capability at all**: events arrive as
numbers and drawing goes into a `Surface` the caller owns, so a desktop can be driven by a test —
press here, move there, release — and the pixels read back. That is the only way any of this was
checkable before step 5's framebuffer host exists.

`packages/box/example/desk.wac` stays as it is. It runs on a browser that does its own hit-testing,
and this document is explicit that both targets stay first-class.

Three things the tests pin, each of which is a bug with a name:

- **Raise on press, not on release.** A window that comes forward only after you let go cannot be
  dragged out from under another one.
- **A drag carries its grab point.** Grabbing a bar five pixels in and moving to (200, 150) puts the
  corner at (195, 145); snapping the corner to the cursor jumps the window on the first pixel of
  movement.
- **Closing a window cancels the drag.** `wins` shifts, so an index held across a close points at a
  different window — which then starts following the pointer. A haunted desktop.

**The frame count in the draw test is a test of the draw order.** Two 64x68 outlines would be 520
pixels if they did not overlap; these do, and the front one covers 81 of the back one's — 34 of its
bottom edge and 47 of its right. Painted the other way round it would be 440. So one number says the
stack was drawn back to front, which is the order `hit.wac` searches in reverse and the one thing the
two of them must agree about.

### What is still missing, and it is the same thing as before

**Nothing has put this on a screen.** A `Page`-driven program is a thin wrapper — build a `Surface`
the size of the canvas, `draw`, `drawPixelsIn(id, dx0, dy0, w, h, damagedPixels())`, `undamage()`,
and feed `nextEvent`'s x and y to `pointerDown`/`Move`/`Up` — but a thin wrapper is exactly where the
coordinate conventions get tested, and writing one that nobody can run in a browser here proves
nothing. That is step 5's business, and it is now the only thing between this and a desktop.

## On a screen, 2026-08-15 — and what that caught

`packages/raster/example/rasterdesk.wac` draws the desktop into a `Surface`, sizes the canvas with
`drawPixels`, patches part of it with `drawPixelsIn`, and `packages/raster/test/live.test.ts` loads it
in chromium and reads `getImageData` back.

**This is the check nothing under it could make.** Every other assertion in the package has my code
on both sides — a surface read back as numbers, a hit answered as an index — so all of them can be
self-consistently wrong about where the origin is, which way `y` runs, or whether a rectangle's `w`
is a size or a right edge. A canvas is not my code. The frames land at (20, 20) and (120, 70) where
the model put them, and the magenta patch occupies exactly (200, 24) to (215, 39) — both edges
asserted, because a square one pixel off still has a middle.

The partial blit is also checked not to have cleared the canvas, which is the whole reason step 1
made it a second capability.

### Two mistakes it caught immediately, neither of which the model could have

- **A page program's entry is `page`, not `main`.** `harness/programs.ts` decides what a program is
  by looking for one or the other and the launchers dispatch the same way — `entry.ts` runs `main`,
  `entryBrowser.ts` runs `page`. Declared as `main` with three parameters, the browser called it with
  two, and that arrives as *"Cannot read properties of undefined (reading '$ref')"* from inside the
  generated glue, naming neither the function nor the argument.
- **The markup is rendered at run time**, not exported. A page program owns its document; there is no
  hook the host calls for it. A `<canvas>` nobody rendered is a canvas that does not exist, and the
  test waited thirty seconds for an element that was never going to appear.

Both were found in minutes because the failure was *visible*. Neither would have been found by
anything in the package, and both are the sort of thing that would have been discovered by whoever
first tried to use this — which is the argument for the example existing at all.

### What step 5 still means

A framebuffer host, on the stack `0001` step 2a is aiming at: the same `Desk`, the same `Surface`,
booted, with no JavaScript in the artefact. Nothing above it changes — that is the point of the seam
being a pixel buffer — and the browser target now demonstrably works, which is the constraint this
document opened with.

## The event path, checked in a browser — 2026-08-15

`rasterdesk.wac` now listens and loops: `pointerdown`/`move`/`up` into `Desk`, redraw, and send only
the damaged rectangle through `drawPixelsIn`. The live test drags a window's title bar with a real
mouse and waits for the pixel.

**The interesting claim is about coordinates, not about dragging.** `desk.wac`'s own tests press and
drag with synthetic numbers, and they cannot check that a browser's pointer coordinates mean the same
thing the model's do. They arrive relative to the element the listener is on — the canvas — which is
what a `Surface` is indexed by, so no conversion should be needed. That is only testable here, and it
holds: grab at (60, 24), move by (+40, +90), and the window's corner goes from (20, 20) to (60, 110).

**The first version of that assertion was inert and worth recording.** It dragged to (120, 120) and
waited for the frame colour there — and window "two" is opened at (120, 70) and is 96 by 84, so its
left edge already sat on that pixel. It would have passed with no drag at all. The destination is now
asserted *empty* before the drag, which is the canary that makes the after-state mean anything, and
disabling the event loop makes the test fail with the pixel it found instead.

A frame is: draw into the surface, `drawPixelsIn(id, dx0, dy0, w, h, damagedPixels())`, `undamage()`.
A drag sends a few thousand pixels rather than the 256 KB a whole-screen redraw would be, which is
what D1 asked for.

## The shell, on pixels — 2026-08-15

`packages/box/example/rasterterm.wac` runs the same `Session` that `term.wac` puts in a `<pre>`,
laid out by `grid.wac` and blitted to a canvas. `packages/box/test/rasterterm_live.test.ts` types
`echo hi` into it with a real keyboard and finds `h` in cell (0, 1).

**The integration lives in a program, not in `packages/raster`.** A renderer that imported a shell
would be a renderer nobody could use for anything else, and `raster` has no dependencies on purpose.

**The whole screen is laid out again on every change**, rather than appended to. A shell's output is
not a stream of cells — a command can rewrite its line with `\r`, and `Session` hands back text
rather than a diff — so re-laying the tail is the only thing that cannot drift from what the session
holds. Appending would be faster and would be a *second* model of the screen, which is the thing that
gets out of step. At eighty by twenty-four it costs nothing worth measuring.

The test asserts a before-state as well as an after: the prompt is on screen before any key is
pressed, and row 1 is **empty** until a command runs. Without the second, the assertion after Enter
would pass on a terminal that only ever draws what the test typed. Canaried by never running the
command: it fails and names the ink on each of the first three rows.

### What step 4 still does not have

**All three are done, 2026-08-15.**

- **Scrollback you can scroll.** `Grid.drawFrom(s, x, y, fg, bg, up)` joins the scrollback and the
  live screen; `PageUp` and `PageDown` move the viewport and typing returns it to the bottom. Three
  things had to change under it: `relay` lays out the whole session rather than the tail that fits
  (a layout starting at the last screen boundary never scrolls anything, which is why the scrollback
  was always empty), the browser host learned to encode the paging keys at all, and `keydown.test.ts`
  stopped asserting they send nothing.
- **Selection.** A drag over the canvas selects a *range* in reading order rather than a rectangle,
  drawn inverted, cleared by typing. Checked twice: against the drawn surface with synthetic
  coordinates, and in chromium with a real pointer — the second is the only place that says a
  browser's pointer coordinates mean what the model's do.

- **A blinking caret**, which I first recorded here as needing a capability the platform does not
  have — a timer a program can wait on alongside its events — on the reasoning that `nextEvent`
  blocks and nothing could wake it.

  **That was wrong, and it was wrong in the same hour I wrote it.** `core.waitAny` takes a ticket
  list *and* a deadline, and answers `-1` when the deadline wins; its own doc comment gives the shape
  (`waitAny(i32[](click.id), 5000)`) and says the deadline "costs nothing — no opcode, no slot, no
  ticket to dispose of". The loop had to be restructured from `nextEvent().wait()` to a ticket held
  across iterations. Nothing had to be added.

  I then built it with `core.sleepMillis` as a *ticket in the list*, which is the shape `platform.wac`
  argues against two doc comments further up: a timer ticket costs a ring slot and must be disposed
  of on every path or the ring fills and the next call stops the program. Reading the paragraph after
  the one that answered the question would have saved both mistakes.

**All three of step 4's gaps are closed.** What selection does not do yet is leave the page: the text
is available — `Grid.selectedText(up)` answers it as code points, in reading order, with trailing
blanks dropped — and there is no clipboard capability to put it on. Deciding what one looks like is
its own decision, and inventing a gesture to work around not having it would be worse than the gap.



## Both targets, byte for byte — 2026-08-15

This note opens by refusing the sequence: *"it is both, not a sequence"*. Everything above tests one
half of that. `packages/raster/example/deskshot.wac` and `packages/raster/test/wac/hosts_test.wac` test the
claim itself — the same desk, drawn by the same source, on the canvas host and on the host with no
JavaScript in the artefact, compared as bytes:

    192015 bytes of desktop, identical on both hosts

It is testable at all because **`Desk` takes no capability**. That was a step 3 decision made for
other reasons — a manager that asked for a `Page` could only ever be driven by a page, and its tests
would need a browser. The consequence only became visible here: a drawing that needs nothing can run
anywhere, so the two hosts are comparable without a shim on either side.

**PPM, not PNG.** `P6`, a header, the RGB triples: twelve lines of wac against CRC tables and
deflate, and every image tool reads it. A screenshot is opaque by construction, so dropping alpha
costs nothing.

### What this test can and cannot catch

It compares **hosts**, not correctness. Both sides run the same wac, so a bug in the drawing appears
identically on both and the comparison stays green — which is exactly what happened when I canaried
it by putting an off-by-one in the glyph advance. What it catches is the two hosts *disagreeing*:
different arithmetic, a different string encoding, a `u8[]` marshalled differently across the two
`$bind$` implementations. That class has bitten this repository before and nothing else here would
see it.

So the assertions before the comparison are load-bearing, and they are the ones with a canary: a
320x200 `P6` header, the exact pixel-data length, and **more than three distinct colours** in the
image. Two hosts that both wrote nothing agree perfectly. Drawing only the background fails with
`the desktop has 1 colours in it`.

### What step 5 needs now

0001 step 2a is done, so the second host exists and the ordering constraint in "Order of work" is
satisfied. What is left for step 5 is a framebuffer to blit into instead of a file — and this test is
what it will be checked against, because a framebuffer that disagrees with the canvas is not the same
desktop and nothing else would say so.
