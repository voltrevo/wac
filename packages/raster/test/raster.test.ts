// The rasteriser, judged against the font it was generated from and against pixels that can be read.
//
// `design/system/0004` step 2's own criterion is "a wac program draws a window frame and a line of
// text into a buffer, tested by comparing bytes", so that is what this does — and the interesting
// part is which bytes are worth comparing.
//
// **Not a golden image.** A buffer compared against a recorded copy of itself fails on every
// deliberate change and says nothing about which pixel moved, so the checks here are properties a
// reader can evaluate: the frame is on the frame's colour, the title bar covers the row it should,
// the text left ink where the glyph has bits set and nowhere else, and clipping did not write
// outside the surface.
//
// **The font is the oracle for the glyphs.** `packages/raster/tools/genfont.ts` reads unscii's `.hex` and this reads
// the same file independently, so a bug in the generator's packing shows up as a disagreement rather
// than as both sides being wrong together — the two do not share code.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/raster/test/wac/raster_probe.wac") as unknown as {
  glyphs(): number;
  cellW(): number;
  cellH(): number;
  rowOf(cp: number, row: number): number;
  widthOf(cp: number): number;
  window(w: number, h: number): Uint8Array;
  windowDamage(w: number, h: number): Int32Array;
  damageOfFill(w: number, h: number, x: number, y: number, fw: number, fh: number): Int32Array;
  freshIsClean(w: number, h: number): boolean;
  clippedAt(w: number, h: number, x: number, y: number): number;
  textEnd(cps: Int32Array, x: number): number;
  inkOf(cp: number): number;
  strideOf(): number;
  damageOfTwo(ax: number, ay: number, bx: number, by: number): Int32Array;
  undamageClears(): boolean;
  negativeIsEmpty(): number;
  atOutside(x: number, y: number): number;
  rectDegenerate(): boolean;
  glyphOffscreen(): number;
  damagedShape(x: number, y: number, w: number, h: number): Int32Array;
  regionFirst(rx: number, ry: number): number;
  cleanHasNoPixels(): number;
  hitAt(flat: Int32Array, px: number, py: number): number;
  partOf(x: number, y: number, w: number, h: number, barH: number, closeW: number, px: number, py: number): number;
  partNone(): number;
  partBody(): number;
  partBar(): number;
  partClose(): number;
  raiseThenHit(flat: Int32Array, i: number, px: number, py: number): Int32Array;
  gridRow(cols: number, rows: number, cps: Int32Array, row: number): Int32Array;
  gridCursor(cols: number, rows: number, cps: Int32Array): Int32Array;
  gridScrolled(cols: number, rows: number, maxBack: number, cps: Int32Array, line: number): Int32Array;
  gridEmpty(): number;
  gridWideTail(): number;
  gridInk(cols: number, rows: number, cps: Int32Array): number;
  caretInk(cols: number, rows: number, cps: Int32Array): number;
  deskPress(px: number, py: number): Int32Array;
  deskDrag(downX: number, downY: number, moveX: number, moveY: number): Int32Array;
  deskCloseDuringDrag(): number;
  deskTyped(cps: Int32Array, col: number, row: number): number;
  deskDrawn(w: number, h: number): Int32Array;
};

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/**
 * unscii-16 read straight from the vendored `.hex`, independently of the generator.
 *
 * The point of parsing it twice is that the two parsers do not share code: if `genfont.ts` packs a
 * row into the wrong nibble, the wac side answers something this does not, rather than both being
 * wrong in the same way. `two-implementations-cannot-see-a-shared-mistake` is the note about it.
 */
const hex = new Map<number, { wide: boolean; rows: number[] }>();
for (const line of (await Deno.readTextFile("packages/raster/tools/unscii-16.hex")).split("\n")) {
  const colon = line.indexOf(":");
  if (colon < 0) continue;
  const bits = line.slice(colon + 1).trim();
  if (bits.length === 0) continue;
  const perRow = bits.length / 2 / 16;
  const rows: number[] = [];
  for (let r = 0; r < 16; r++) rows.push(parseInt(bits.slice(r * perRow * 2, (r + 1) * perRow * 2), 16));
  hex.set(parseInt(line.slice(0, colon), 16), { wide: perRow === 2, rows });
}

Deno.test("the generated font is the font that was vendored", () => {
  assertEquals(mod.glyphs(), hex.size, "the table has a different number of glyphs than the .hex");
  assertEquals(mod.cellW(), 8);
  assertEquals(mod.cellH(), 16);

  // Every glyph, every row — 51,840 comparisons, which is cheap and is the only way to catch a
  // packing bug that only shows at one alignment. The bytes are packed four to an `i32`, so a
  // mistake in the last byte of a word is invisible in a sample.
  let checked = 0;
  const wrong: string[] = [];
  for (const [cp, g] of hex) {
    if (mod.widthOf(cp) !== (g.wide ? 16 : 8)) wrong.push(`U+${cp.toString(16)} width`);
    for (let r = 0; r < 16; r++) {
      checked++;
      if (mod.rowOf(cp, r) !== g.rows[r]) {
        wrong.push(`U+${cp.toString(16)} row ${r}: ${mod.rowOf(cp, r)} vs ${g.rows[r]}`);
        if (wrong.length > 5) break;
      }
    }
    if (wrong.length > 5) break;
  }
  assertEquals(checked > 50000, true, `only ${checked} rows compared`);
  assertEquals(wrong.join(", "), "", "the generated table disagrees with the .hex");
});

Deno.test("a glyph the font does not have leaves a hole, and advances one cell", () => {
  // U+E000 is a private-use point unscii does not draw.
  assertEquals(hex.has(0xE000), false, "the font unexpectedly has U+E000");
  assertEquals(mod.widthOf(0xE000), 0, "a missing glyph should have no width");
  assertEquals(mod.inkOf(0xE000), 0, "a missing glyph drew something");
  // But the line still advances, so the rest of it does not shift left.
  assertEquals(mod.textEnd(Int32Array.from([0xE000]), 0), 8, "a missing glyph did not advance a cell");
});

Deno.test("a wide glyph advances two cells, and a narrow one advances one", () => {
  // U+231A is a watch: unscii draws it 16 wide, which the manifest of shapes above confirms.
  assertEquals(mod.widthOf(0x231A), 16, "U+231A should be a double-width glyph");
  assertEquals(mod.widthOf(0x41), 8, "'A' should be a single-width glyph");
  assertEquals(mod.textEnd(Int32Array.from([0x41, 0x231A, 0x41]), 0), 8 + 16 + 8);
});

Deno.test("`A` is drawn where the font says it is, and nowhere else", () => {
  // The ink count is the whole glyph, so this is a check on the *blit* rather than on the table:
  // a shift by one column would keep the count and move the pixels, so both are asserted.
  const rows = hex.get(0x41)!.rows;
  const bits = rows.reduce((n, r) => n + r.toString(2).split("1").length - 1, 0);
  assertEquals(mod.inkOf(0x41), bits, "the glyph set a different number of pixels than it has bits");
  assertEquals(bits > 0, true, "'A' has no bits, so this proves nothing");
});

Deno.test("a fresh surface is clean, and damage is what was drawn rather than everything", () => {
  assertEquals(mod.freshIsClean(64, 32), true, "a new surface reported damage");

  // A 3x2 fill at (10, 5) damages exactly that: right and bottom are inclusive in the report.
  assertEquals([...mod.damageOfFill(64, 32, 10, 5, 3, 2)], [10, 5, 12, 6]);

  // Clipped at the edges, the damage is what was *written*, not what was asked for — a host sending
  // the damaged region must not be told about pixels outside the surface.
  assertEquals([...mod.damageOfFill(64, 32, -4, -4, 8, 8)], [0, 0, 3, 3]);
});

Deno.test("drawing off every edge writes inside the surface and does not trap", () => {
  // The fill runs from -5 to w+15 in both directions. Every corner must be the fill colour and
  // nothing may have been written outside, which is what "did not trap" means for a `u8[]`.
  const colour = 0x11223344;
  for (const [x, y] of [[0, 0], [63, 0], [0, 31], [63, 31], [32, 16]]) {
    assertEquals(mod.clippedAt(64, 32, x, y), colour, `pixel ${x},${y} was not filled`);
  }
});

Deno.test("a window: a frame, a title bar and a line of text, compared as bytes", () => {
  const [w, h] = [96, 48];
  const px = mod.window(w, h);
  assertEquals(px.length, w * h * 4, "the buffer is not four bytes a pixel");

  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
  };

  // The desktop behind the window, the window, and the frame on its own colour.
  assertEquals(at(1, 1), 0x101416FF, "the desktop colour is not behind the window");
  assertEquals(at(4, 4), 0x46D9C0FF, "the frame's top-left corner is not the frame colour");
  assertEquals(at(w - 5, h - 5), 0x46D9C0FF, "the frame's bottom-right corner is missing");
  assertEquals(at(6, 30), 0x1E2528FF, "the window's interior is not the window colour");

  // The title bar covers its rows and stops. It is `fill(y = 5, h = cellHeight() + 2)`, so it holds
  // rows 5 through 22 and row 23 is the window again — both edges asserted, because "the bar is
  // there" and "the bar ends" are different claims and only the second one catches a fill that ran
  // one row long.
  const barTop = 5;
  const barBottom = barTop + 16 + 2;      // exclusive, as `fill` takes it
  assertEquals(at(20, barTop), 0x2A3438FF, "the title bar is not on its first row");
  assertEquals(at(20, barBottom - 1), 0x2A3438FF, "the title bar is short of its last row");
  assertEquals(at(20, barBottom), 0x1E2528FF, "the title bar did not stop where it should");

  // And the text left ink *on the bar*, in the text colour. Counting rather than naming a pixel:
  // which pixels "wac" sets is the font's business, and the assertion worth making here is that
  // some are set, they are the right colour, and they are inside the bar.
  let ink = 0;
  for (let y = 6; y < 6 + 16; y++) {
    for (let x = 8; x < 8 + 3 * 8; x++) if (at(x, y) === 0xDCE8E7FF) ink++;
  }
  const expected = [0x77, 0x61, 0x63]
    .map((cp) => hex.get(cp)!.rows.reduce((n, r) => n + r.toString(2).split("1").length - 1, 0))
    .reduce((a, b) => a + b, 0);
  assertEquals(ink, expected, "the text drew a different number of pixels than 'wac' has bits");

  // Nothing outside the three glyph cells is the text colour, which is what says the blit did not
  // run over its bounds.
  let stray = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 0xDCE8E7FF) continue;
      if (x < 8 || x >= 8 + 24 || y < 6 || y >= 6 + 16) stray++;
    }
  }
  assertEquals(stray, 0, "text was drawn outside the cells it was given");

  // The damage covers the whole window and no more than the surface.
  const [dx0, dy0, dx1, dy1] = [...mod.windowDamage(w, h)];
  assertEquals([dx0, dy0], [0, 0], "the damage does not start at the origin");
  assertEquals([dx1, dy1], [w - 1, h - 1], "the damage does not cover the surface it filled");
});

Deno.test("damage widens in each direction, and clears when it is taken", () => {
  assertEquals(mod.strideOf(), 4, "a pixel is four bytes");

  // Two 4x4 fills, the second in each direction from the first: the reported rectangle must cover
  // both. Each direction is its own comparison in `damage`, so a single pair would leave three of
  // the four untested and a wrong `<` would survive.
  assertEquals([...mod.damageOfTwo(20, 20, 4, 4)], [4, 4, 23, 23], "widening up and left");
  assertEquals([...mod.damageOfTwo(4, 4, 40, 24)], [4, 4, 43, 27], "widening down and right");
  assertEquals([...mod.damageOfTwo(20, 4, 4, 24)], [4, 4, 23, 27], "widening left and down");
  assertEquals([...mod.damageOfTwo(4, 20, 40, 4)], [4, 4, 43, 23], "widening right and up");

  assertEquals(mod.undamageClears(), true, "undamage did not clear what a fill set");
});

Deno.test("the degenerate cases answer rather than trap", () => {
  // A collapsed window asks for a surface with no area, and a frame with no area. Both are ordinary
  // states of a window manager rather than errors, so neither may trap and neither may report
  // damage it did not do.
  assertEquals(mod.negativeIsEmpty(), 0, "a negative size did not clamp to an empty surface");
  assertEquals(mod.rectDegenerate(), true, "a zero-sized frame reported damage");

  for (const [x, y] of [[-1, 0], [0, -1], [8, 0], [0, 8]]) {
    assertEquals(mod.atOutside(x, y), 0, `reading ${x},${y} outside the surface answered something`);
  }
  assertEquals(mod.atOutside(3, 3), 0, "an unwritten pixel inside the surface is transparent");

  // A glyph entirely above or below the surface writes nothing — every row clipped, which is the
  // case a window scrolled off the top reaches on every frame.
  assertEquals(mod.glyphOffscreen(), 0, "a glyph drawn off the surface wrote pixels into it");
});

Deno.test("the damaged pixels are the payload a partial blit takes", () => {
  // `Page.drawPixelsIn(id, x, y, w, h, rgba)` wants the origin, the size and exactly that many
  // pixels. A surface reports its damage *inclusive* at the right and bottom, so the width is
  // `dx1 - dx0 + 1` — the off-by-one that `damagedPixels` exists to keep out of every caller.
  const [x, y, w, h, bytes] = [...mod.damagedShape(10, 5, 3, 2)];
  assertEquals([x, y, w, h], [10, 5, 3, 2], "the damage is not the rectangle that was filled");
  assertEquals(bytes, 3 * 2 * 4, "the payload is not four bytes for each pixel in the rectangle");

  // Clipped at the edge, the payload is the *clipped* size, which pairs with the clipped origin.
  const [cx, cy, cw, ch, cbytes] = [...mod.damagedShape(-4, -4, 8, 8)];
  assertEquals([cx, cy, cw, ch], [0, 0, 4, 4], "a clipped fill reported an unclipped rectangle");
  assertEquals(cbytes, 4 * 4 * 4, "the clipped payload is the wrong size");

  // A region is copied from where it was asked for, not from the origin.
  assertEquals(mod.regionFirst(4, 4), 0x11223344, "the region did not start at the pixel asked for");
  assertEquals(mod.regionFirst(0, 0), 0, "the region at the origin should be untouched");

  assertEquals(mod.cleanHasNoPixels(), 0, "an undamaged surface offered pixels to send");
});

Deno.test("the topmost window answers, and the desktop is a real answer", () => {
  // Back to front: index 1 is drawn over index 0, so where they overlap it wins. Getting this
  // backwards gives a manager that raises the window *behind* the one you clicked, which reads as
  // the click being ignored rather than as a stacking bug.
  const two = Int32Array.from([0, 0, 100, 100, 50, 50, 100, 100]);
  assertEquals(mod.hitAt(two, 10, 10), 0, "only the back window covers this point");
  assertEquals(mod.hitAt(two, 140, 140), 1, "only the front window covers this point");
  assertEquals(mod.hitAt(two, 60, 60), 1, "where they overlap, the front one wins");
  assertEquals(mod.hitAt(two, 200, 200), -1, "the desktop is -1, not a failure");

  // Edges: right and bottom exclusive, so two windows sharing a seam do not both own it.
  const one = Int32Array.from([10, 10, 20, 20]);
  assertEquals(mod.hitAt(one, 10, 10), 0, "the top-left corner is inside");
  assertEquals(mod.hitAt(one, 29, 29), 0, "the last pixel is inside");
  assertEquals(mod.hitAt(one, 30, 20), -1, "the right edge belongs to what is next to it");
  assertEquals(mod.hitAt(one, 20, 30), -1, "the bottom edge likewise");
  assertEquals(mod.hitAt(Int32Array.from([]), 5, 5), -1, "an empty desktop");
});

Deno.test("a window's parts are where a desktop puts them", () => {
  const [NONE, BODY, BAR, CLOSE] = [mod.partNone(), mod.partBody(), mod.partBar(), mod.partClose()];
  // A 100x80 window at (10, 10) with a 20px bar and a 16px close button.
  const p = (px: number, py: number) => mod.partOf(10, 10, 100, 80, 20, 16, px, py);

  assertEquals(p(5, 5), NONE, "outside the window is nothing, without needing `contains` first");
  assertEquals(p(20, 15), BAR, "the bar is the top of the window");
  assertEquals(p(20, 30), BODY, "below the bar is the body");
  assertEquals(p(20, 29), BAR, "the bar's last row is still the bar");
  assertEquals(p(105, 15), CLOSE, "the close button is the bar's right end");
  // The window spans x = 10..109, so a 16-pixel button starts at 110 - 16 = 94. Both sides of that
  // boundary are asserted: "the button is there" and "the bar is not" are different claims, and only
  // the second catches a button one column too wide.
  assertEquals(p(94, 15), CLOSE, "the button starts `closeW` from the right edge");
  assertEquals(p(93, 15), BAR, "one pixel left of it is the bar");
  assertEquals(p(105, 30), BODY, "below the bar, the close button's column is body");

  // A collapsed window is chrome only: a point in its title must be the bar rather than a body
  // nobody can reach.
  assertEquals(mod.partOf(0, 0, 60, 10, 20, 16, 5, 5), BAR, "a window shorter than its bar");
  // And a window with no close button has none, rather than one of width zero at the right edge.
  assertEquals(mod.partOf(0, 0, 60, 40, 20, 0, 59, 5), BAR, "closeW 0 means no close button");
});

Deno.test("raising changes which window answers for a point they share", () => {
  // The stack's order *is* the hit-testing order, so a raise that left the two disagreeing would be
  // a window that draws on top and answers clicks from underneath.
  const two = Int32Array.from([0, 0, 100, 100, 50, 50, 100, 100]);
  assertEquals(mod.hitAt(two, 60, 60), 1, "before raising, the front window answers");

  const [at, who] = [...mod.raiseThenHit(two, 0, 60, 60)];
  assertEquals(at, 1, "the raised window is now last, which is the front");
  assertEquals(who, 1, "and it is what the shared point hits");

  // Raising what is already on top is a no-op rather than a rotation.
  const [at2, who2] = [...mod.raiseThenHit(two, 1, 60, 60)];
  assertEquals([at2, who2], [1, 1], "raising the front window moved something");

  assertEquals([...mod.raiseThenHit(two, 5, 60, 60)][0], -1, "an index nobody has");
});

/** Code points from a string, which is how a terminal is actually fed. */
const cps = (t: string) => Int32Array.from([...t].map((c) => c.codePointAt(0)!));

Deno.test("text wraps at the last column, and newlines do what newlines do", () => {
  const E = mod.gridEmpty();
  // Six columns: "abcdefgh" fills the first row and puts "gh" on the second.
  assertEquals([...mod.gridRow(6, 3, cps("abcdefgh"), 0)], [...cps("abcdef")]);
  assertEquals([...mod.gridRow(6, 3, cps("abcdefgh"), 1)], [...cps("gh"), E, E, E, E]);

  // A newline ends the line wherever the cursor is, and a carriage return goes back to its start
  // without clearing — "abc\rX" is "Xbc", which is how a progress line overwrites itself.
  assertEquals([...mod.gridRow(6, 3, cps("ab\ncd"), 0)], [...cps("ab"), E, E, E, E]);
  assertEquals([...mod.gridRow(6, 3, cps("ab\ncd"), 1)], [...cps("cd"), E, E, E, E]);
  assertEquals([...mod.gridRow(6, 3, cps("abc\rX"), 0)], [...cps("Xbc"), E, E, E]);

  // The cursor stops at the edge rather than wrapping eagerly: a terminal that wraps on write shows
  // the caret at the start of a line nothing has been written to.
  assertEquals([...mod.gridCursor(6, 3, cps("abcdef"))], [6, 0]);
  assertEquals([...mod.gridCursor(6, 3, cps("abcdefg"))], [1, 1]);
});

Deno.test("a double-width glyph takes two cells and never straddles the edge", () => {
  const E = mod.gridEmpty(), T = mod.gridWideTail();
  // U+231A is 16 pixels wide, so it occupies a cell and a continuation.
  assertEquals([...mod.gridRow(6, 3, cps("a\u231Ab"), 0)], [0x61, 0x231A, T, 0x62, E, E]);

  // **With one column left it wraps rather than splitting.** A glyph cut in half at the edge leaves
  // half a character on each line, and the half on the second is not the other half of anything.
  assertEquals([...mod.gridRow(4, 3, cps("abc\u231A"), 0)], [...cps("abc"), E]);
  assertEquals([...mod.gridRow(4, 3, cps("abc\u231A"), 1)], [0x231A, T, E, E]);
  assertEquals([...mod.gridCursor(4, 3, cps("abc\u231A"))], [2, 1]);

  // And it draws once, not twice: the continuation cell contributes no ink of its own.
  const wide = mod.gridInk(4, 1, cps("\u231A"));
  const narrow = mod.gridInk(4, 1, cps("A"));
  assertEquals(wide > narrow, true, `a wide glyph should be more ink than a narrow one: ${wide} vs ${narrow}`);
  assertEquals(mod.gridInk(4, 1, Int32Array.from([])), 0, "an empty grid has no ink");
});

Deno.test("scrolling keeps what went off the top, and drops the oldest when full", () => {
  const E = mod.gridEmpty();
  // Two rows, three lines written: the first scrolls off.
  const three = cps("a\nb\nc");
  assertEquals([...mod.gridRow(4, 2, three, 0)], [...cps("b"), E, E, E]);
  assertEquals([...mod.gridRow(4, 2, three, 1)], [...cps("c"), E, E, E]);

  const [kept, ...line0] = [...mod.gridScrolled(4, 2, 8, three, 0)];
  assertEquals(kept, 1, "one line should have scrolled off");
  assertEquals(line0, [...cps("a"), E, E, E], "and it is the first one");

  // A scrollback of one keeps only the newest of the two that scrolled off.
  const five = cps("a\nb\nc\nd");
  const [kept1, ...only] = [...mod.gridScrolled(4, 2, 1, five, 0)];
  assertEquals(kept1, 1, "the bound is one line");
  assertEquals(only, [...cps("b"), E, E, E], "and the oldest was dropped, not the newest");

  // None kept at all is a legitimate configuration, not a bug.
  assertEquals([...mod.gridScrolled(4, 2, 0, three, 0)][0], 0, "scrollback of zero keeps nothing");
});

Deno.test("the caret is a block, and it covers exactly one cell", () => {
  // A cell is 8x16, so a block caret on an empty cell is 128 pixels of foreground. On a cell with a
  // character in it the glyph is redrawn in the background colour, so it is 128 minus that glyph's
  // bits — which is what keeps a block caret readable rather than a solid square.
  assertEquals(mod.caretInk(4, 1, Int32Array.from([])), 8 * 16, "a caret on an empty cell");

  // **After writing "A" the caret is on the cell *after* it**, which is where a terminal puts it —
  // so that case is still an empty cell and measures 128. To get the caret onto a character the
  // cursor has to go back, which is what a carriage return is for.
  assertEquals(mod.caretInk(4, 1, cps("A")), 8 * 16, "the caret follows the character, not sits on it");

  const over = mod.caretInk(4, 1, cps("AB\r"));
  assertEquals(over > 0 && over < 8 * 16, true, `a caret over a character: ${over}`);
});

// The desk under test has two windows: "a" at (10, 10) and "b" at (40, 30), each 8x3 cells — so
// 64 by 3*16 + 20 = 68 pixels. "b" is on top.
Deno.test("a press raises what it hit, and the desktop is not a window", () => {
  // Inside "a" only: it comes to the front, and both windows remain.
  assertEquals([...mod.deskPress(15, 40)], [1, 2, -1], "clicking the back window's body raises it");
  // Inside "b" only.
  assertEquals([...mod.deskPress(45, 60)], [1, 2, -1], "clicking the front window keeps it there");
  // The desktop.
  assertEquals([...mod.deskPress(300, 300)], [-1, 2, -1], "the desktop raises nothing");

  // On "b"'s title bar: raised *and* held, which is what makes a drag possible.
  const [top, count, dragging] = [...mod.deskPress(45, 35)];
  assertEquals([top, count], [1, 2], "a bar press raises");
  assertEquals(dragging, 1, "and takes hold of what it raised");

  // The close button is the bar's right end: "b" spans x 40..103, so the button starts at 92.
  assertEquals([...mod.deskPress(100, 35)][1], 1, "the close button closes it");
  assertEquals([...mod.deskPress(91, 35)][2], 1, "one pixel left of the button is still the bar");
});

Deno.test("a drag carries the window by where it was grabbed, and stops on release", () => {
  // Grab "b" at (45, 35) — five pixels in from its left edge, five down from its top — and move to
  // (200, 150). The window's corner must land at (195, 145), not at the cursor: a drag that snaps
  // the corner to the pointer jumps the window on the first pixel of movement.
  const [x, y, afterX, afterY] = [...mod.deskDrag(45, 35, 200, 150)];
  assertEquals([x, y], [195, 145], "the grab offset was not preserved");
  // And after release, further movement does nothing.
  assertEquals([afterX, afterY], [195, 145], "the window kept following the pointer after release");
});

Deno.test("closing a window does not hand the drag to another one", () => {
  // Hold "b", then close "a". `wins` shifts, so an index kept across the close would now point at a
  // different window — which would start following the pointer. A haunted desktop.
  assertEquals(mod.deskCloseDuringDrag(), 40, "the surviving window moved when it was not held");
});

Deno.test("typing goes to the focused window, which is the one on top", () => {
  const cps = (t: string) => Int32Array.from([...t].map((c) => c.codePointAt(0)!));
  assertEquals(mod.deskTyped(cps("hi"), 0, 0), 0x68, "the first cell of the focused terminal");
  assertEquals(mod.deskTyped(cps("hi"), 1, 0), 0x69);
  // Wrapping still applies inside a window: eight columns, so the ninth character is on row 1.
  assertEquals(mod.deskTyped(cps("123456789"), 0, 1), 0x39, "the ninth character wrapped");
});

Deno.test("a drawn desk damages what it drew, and its frames are on the frame colour", () => {
  const [dx0, dy0, dx1, dy1, frames, bytes] = [...mod.deskDrawn(200, 150)];
  // The background fill covers the surface, so the damage is the whole thing — and the payload is
  // four bytes for each pixel of it, which is what `drawPixelsIn` takes.
  assertEquals([dx0, dy0, dx1, dy1], [0, 0, 199, 149], "the damage is not the whole surface");
  assertEquals(bytes, 200 * 150 * 4, "the damaged payload is not four bytes a pixel");

  // **The frame count is a test of the draw order**, which is why it is a number and not "more than
  // zero". Each window is a one-pixel outline of 64 by 68 — `2*(64 + 68) - 4` corners = 260 — so two
  // of them would be 520 if they did not overlap. They do: "a" is at (10, 10) and "b" at (40, 30),
  // and "b" is drawn *second*, covering 81 pixels of "a"'s outline: 34 of its bottom edge and 47 of
  // its right.
  //
  // Drawn front to back instead, "a" would cover 80 of "b"'s — its top edge and its left — and the
  // answer would be 440. So this single number says the stack was painted back to front, which is
  // the order `hit.wac` searches in reverse and the one thing the two must agree about.
  assertEquals(frames, 520 - 81, "the frames are not two outlines with the front one on top");
});
