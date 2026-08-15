# raster

A pixel buffer and the three things a desktop draws into one: rectangles, a one-pixel frame, and
text in a fixed cell.

```wac
import { Surface } from "../raster/src/surface.wac";

Surface s = Surface.create(96, 48);
s.fill(0, 0, 96, 48, 0x101416FF);        // the desktop
s.rect(4, 4, 88, 40, 0x46D9C0FF);        // a window frame
s.text(i32[](0x77, 0x61, 0x63), 8, 6, 0xDCE8E7FF);   // "wac"
// s.pixels is R G B A, row-major — the layout `Page.drawPixels` takes
```

`design/system/0004` is why this exists: the window manager and the terminal are built on a DOM, and
the stack `design/system/0001` is aiming at has no DOM in it. This is step 2 of that document — *a
surface, rectangles, blits, a bitmap font, a glyph cache*.

## What it is not

**Not a compositor and not a font engine.** There is no alpha blending: a fill writes the alpha it
was given, because blending is a decision about a compositor that does not exist yet. There is no
shaping, no kerning and no hinting: the font is a fixed cell and a bit pattern, which is what a
terminal and a window label need and where 0004 says the first cut stops. Scalable text is where
this would stop being about a desktop and start being about a font engine.

## The font

**unscii-16, public domain**, vendored as `packages/raster/tools/unscii-16.hex` — see `packages/raster/tools/UNSCII.md` for the
licence and where it came from, and `design/system/0004` for why it was chosen over Spleen and
Tamzen. `packages/raster/tools/genfont.ts` turns it into `packages/raster/src/font16.wac`; regenerate with

    deno run --allow-read --allow-write packages/raster/tools/genfont.ts

3,240 glyphs, of which **243 are 16 pixels wide rather than 8** — the CJK and emoji points, the ones
a terminal already gives two cells. `glyph` answers the width it drew and `text` advances by it, so a
caller lays out a line by adding what it is told rather than by assuming a cell.

**The glyph table is split across two constant arrays**, and that is not tidiness: V8 refuses
`array.new_fixed` above 10,000 elements, and the font is 13,932 words. A single `const i32[]` does
not compile — *"Requested length 13932 for array.new_fixed too large"* — which is worth knowing
before writing any other large table in wac.

## Damage

A `Surface` is a buffer **and** a damage rectangle, which is 0004's D1: a host that can send one
window's pixels rather than the screen's needs to be told which pixels. Every routine here widens it,
because every routine already knows what it touched and a caller that recomputes it will get it
wrong. `undamage()` after the pixels have been taken.

Damage is what was *written*, not what was asked for — a fill clipped at the edge reports the clipped
rectangle, so a host is never told about pixels outside the surface.

## Where it is going

Steps 3 to 5 of `design/system/0004`: hit-testing over rectangles rather than element ids, a raster
terminal driven by the same corpus as the DOM one, and the framebuffer host. Step 1 — a rectangle on
`drawPixels`, so a partial blit changes one window and nothing else — is the capability change this
is waiting on to reach a screen.
