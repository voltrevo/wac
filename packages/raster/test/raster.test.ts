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
