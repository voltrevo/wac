// wacFloatLit — one interpretation of a float literal's text.

import { wacFloatLit } from "./wacFloatLit.ts";

function eq(a: number, b: number, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${a}, expected ${b}`);
}

Deno.test("wacFloatLit: underscores are separators, not part of the number", () => {
  // The bug this atom exists for: `parseFloat` stops at the underscore and returns what it has, so
  // `1_000.5` was 1 — quietly, in three separate places [issue 0044].
  eq(wacFloatLit("1_000.5"), 1000.5, "in the integer part");
  eq(wacFloatLit("1_000.0"), 1000, "with a zero fraction");
  eq(wacFloatLit("0.000_1"), 0.0001, "in the fraction");
  eq(wacFloatLit("1_000e3"), 1_000e3, "with an exponent");
  eq(wacFloatLit("1e1_0"), 1e10, "in the exponent");
});

Deno.test("wacFloatLit: ordinary literals are unaffected", () => {
  eq(wacFloatLit("1.5"), 1.5, "a plain float");
  eq(wacFloatLit("0.0"), 0, "zero");
  eq(wacFloatLit("1e9"), 1e9, "an exponent with no point");
  eq(wacFloatLit("1E10"), 1e10, "an upper-case exponent");
  eq(wacFloatLit("2e-3"), 2e-3, "a negative exponent");
  eq(wacFloatLit("1.5e+10"), 1.5e10, "an explicit plus");
});
