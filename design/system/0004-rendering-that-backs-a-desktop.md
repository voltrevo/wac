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
   glyph, every glyph already filling the cell. There are no bounding boxes and no offsets, where
   BDF has both and a reader that ignores them stacks every glyph at the baseline. The wac-side
   loader is a split and an index, which is materially less of `packages/raster` than BDF would be.

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
0001's own step 2a rather than lead it.

## State of play

| step | state |
|---|---|
| 1. a rectangle on `drawPixels` | **not started.** The capability blits a whole buffer; `desk.wac` already computes the rectangle it would pass |
| 2. `packages/raster` | **not started.** Its font is decided — unscii-16, public domain, Unifont `.hex` — so the open part is the surface and the glyph cache, not the glyphs or a licence |
| 3. hit-testing in the manager | **not started.** The manager keeps positions per window since dragging landed, which is the input this needs |
| 4. a raster terminal | **not started** |
| 5. the framebuffer host | **not started**, and behind 0001 step 2a's bootable stack |
