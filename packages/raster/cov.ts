// Branch coverage for raster.
//
// The same exercises the tests run, plus the ones a test asserts about but does not vary: every
// clipping edge, both glyph widths, a glyph the font does not have, and a damage rectangle that is
// widened rather than set.
//
//   deno task coverage:raster
//   deno task coverage:raster --verbose
//
// **The clipping branches are the ones worth reaching deliberately.** Each of `fill`'s four bounds
// is its own comparison, and a suite that only ever draws inside the surface leaves all four on one
// side — which is exactly the arrangement that passes until somebody drags a window off the edge.

import { instrument, report } from "../../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");

const run = await instrument("packages/raster/test/wac/raster_probe.wac");
const m = run.mod as unknown as {
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
};

m.glyphs();
m.cellW();
m.cellH();
m.freshIsClean(16, 16);

// A window, which is fill, rect, text and damage together.
m.window(96, 48);
m.windowDamage(96, 48);

// **Each edge on its own**, so no single call can leave a bound untested: off the left, the top, the
// right, the bottom, entirely outside in both directions, and a zero-sized rectangle.
for (const [x, y, w, h] of [
  [-8, 4, 16, 8], [4, -8, 8, 16], [60, 4, 16, 8], [4, 28, 8, 16],
  [-40, -40, 8, 8], [200, 200, 8, 8], [4, 4, 0, 8], [4, 4, 8, 0],
  [-4, -4, 200, 200],
] as const) {
  m.damageOfFill(64, 32, x, y, w, h);
}
m.clippedAt(64, 32, 0, 0);
m.clippedAt(64, 32, 63, 31);

// A surface with no pixels at all, which is the degenerate case a window manager reaches when a
// window is collapsed rather than an error.
m.damageOfFill(0, 0, 0, 0, 4, 4);
m.freshIsClean(0, 0);

// Both glyph widths, a missing glyph, and a row that is entirely blank — which is the `bits == 0`
// short-circuit in the blit and is reached by the space character rather than by anything drawn.
for (const cp of [0x41, 0x231A, 0xE000, 0x20, 0x2500, 0x2588]) {
  m.widthOf(cp);
  m.inkOf(cp);
  for (const row of [0, 8, 15, -1, 16]) m.rowOf(cp, row);
}

// Text: empty, one glyph, a mixed-width line, and one starting off the left edge so the per-glyph
// clip runs as well as the per-rectangle one.
m.textEnd(Int32Array.from([]), 0);
m.textEnd(Int32Array.from([0x41]), 0);
m.textEnd(Int32Array.from([0x41, 0x231A, 0x20, 0x2500]), 4);
m.textEnd(Int32Array.from([0x41, 0x41]), -12);


// The paths a test asserts about but does not vary: the damage rectangle widening in each of its
// four directions, a surface with no area, `at` outside it, a frame with no area, and a glyph whose
// every row is clipped away.
m.strideOf();
m.undamageClears();
m.negativeIsEmpty();
m.rectDegenerate();
m.glyphOffscreen();
for (const [ax, ay, bx, by] of [[20, 20, 4, 4], [4, 4, 40, 24], [20, 4, 4, 24], [4, 20, 40, 4]] as const) {
  m.damageOfTwo(ax, ay, bx, by);
}
for (const [x, y] of [[-1, 0], [0, -1], [8, 0], [0, 8], [3, 3]] as const) m.atOutside(x, y);


// The damage payload — `drawPixelsIn`'s arguments — including the clipped case and the empty one.
m.damagedShape(10, 5, 3, 2);
m.damagedShape(-4, -4, 8, 8);
m.regionFirst(4, 4);
m.regionFirst(0, 0);
m.regionFirst(-8, -8);
m.regionFirst(100, 100);
m.cleanHasNoPixels();


// Hit-testing: overlap, both edges, an empty desktop, every part, and a raise at each end.
const stack = Int32Array.from([0, 0, 100, 100, 50, 50, 100, 100]);
for (const [x, y] of [[10, 10], [140, 140], [60, 60], [200, 200], [0, 0], [99, 99], [100, 100]] as const) {
  m.hitAt(stack, x, y);
}
m.hitAt(Int32Array.from([]), 5, 5);
m.partNone(); m.partBody(); m.partBar(); m.partClose();
for (const [px, py] of [[5, 5], [20, 15], [20, 30], [105, 15], [93, 15], [105, 30]] as const) {
  m.partOf(10, 10, 100, 80, 20, 16, px, py);
}
m.partOf(0, 0, 60, 10, 20, 16, 5, 5);     // shorter than its bar
m.partOf(0, 0, 60, 40, 20, 0, 59, 5);     // no close button
for (const i of [0, 1, 5, -1]) m.raiseThenHit(stack, i, 60, 60);


// The grid: wrapping, both control characters, a wide glyph at the edge, scrolling with the
// scrollback full, empty and none, and the caret on an empty cell and over a character.
const cp = (t: string) => Int32Array.from([...t].map((c) => c.codePointAt(0)!));
m.gridEmpty(); m.gridWideTail();
for (const [c, r, t] of [[6, 3, "abcdefgh"], [6, 3, "ab\ncd"], [6, 3, "abc\rX"], [4, 3, "abc⌚"],
                         [4, 2, "a\nb\nc"], [1, 1, "abc"], [4, 3, ""]] as const) {
  m.gridRow(c, r, cp(t), 0);
  m.gridRow(c, r, cp(t), 1);
  m.gridCursor(c, r, cp(t));
}
for (const max of [0, 1, 8]) m.gridScrolled(4, 2, max, cp("a\nb\nc\nd"), 0);
m.gridScrolled(4, 2, 8, cp("a\nb\nc"), 5);        // a line nobody kept
m.gridInk(4, 1, cp("⌚"));
m.gridInk(4, 1, cp("A"));
m.gridInk(4, 1, Int32Array.from([]));
m.caretInk(4, 1, Int32Array.from([]));
m.caretInk(4, 1, cp("AB\r"));
m.caretInk(2, 1, cp("ab"));                       // the caret past the last column

report([run], "packages/raster/", { verbose });
