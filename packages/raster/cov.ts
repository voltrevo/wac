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

report([run], "packages/raster/", { verbose });
