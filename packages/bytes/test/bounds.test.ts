// Buf's bounds checks. Host-side because a trap aborts the module, so a wac test
// cannot assert one and keep running.

import { wacBind } from "../../../harness/wacBind.ts";

const m = await wacBind("packages/bytes/test/bounds.wac") as Record<string, () => number>;

function assertTraps(name: string): void {
  try {
    m[name]();
  } catch (e) {
    const msg = (e as Error).message;
    // Any wasm trap is acceptable; what matters is that it did not return a value.
    if (!/unreachable|out of bounds|RuntimeError/i.test(msg) && !(e instanceof WebAssembly.RuntimeError)) {
      throw new Error(`${name} threw something unexpected: ${msg}`);
    }
    return;
  }
  throw new Error(`${name} returned instead of trapping`);
}

Deno.test("Buf.get traps outside the written range", () => {
  assertTraps("getPastEnd");
  assertTraps("getNegative");
  // The one that matters: inside the allocation, past the length. A check against
  // data.len() instead of len would return uninitialised zero here.
  assertTraps("getAtCapacityNotLength");
});

Deno.test("Buf.get returns the byte when in range", () => {
  if (m.getOk() !== 42) throw new Error(`expected 42, got ${m.getOk()}`);
});

Deno.test("Buf.pushRepeat traps outside the written range", () => {
  // The source has to be bytes that exist. Reading before the start or past the length would
  // copy uninitialised zeros into the output, which for a decompressor means a match that
  // silently produces the wrong bytes rather than a stream that is refused.
  assertTraps("pushRepeatBeforeStart");
  assertTraps("pushRepeatPastEnd");
  assertTraps("pushRepeatNegativeCount");
});

/**
 * `slice` and `clamped` — the two meanings that were one name in nine packages (wac-mono 0093).
 *
 * The whole value of the split is that the call site says which it wanted, so the test is that they
 * genuinely differ: every range `slice` refuses is one `clamped` answers, and neither is a rounding of
 * the other. The old private copies trapped *by accident*, reading past the end rather than saying the
 * range was wrong, and one of them could not tell an inverted range from an empty one.
 */
Deno.test("slice refuses a range that is not inside the array", () => {
  assertTraps("slicePastEnd");
  assertTraps("sliceNegativeFrom");
  // Backwards, which four of the nine copies silently answered with an empty array — a caller doing
  // arithmetic that came out reversed got "nothing there" and no reason to look.
  assertTraps("sliceBackwards");
});

Deno.test("slice returns the bytes when the range is inside", () => {
  // An empty slice at the very end is valid and must not be caught by an off-by-one in the check.
  if (m.sliceEmptyAtEnd() !== 0) throw new Error("slice(s, 5, 5) should be empty, not a trap or a byte");
  if (m.sliceWhole() !== 5) throw new Error(`whole array: got ${m.sliceWhole()}`);
  if (m.sliceMiddle() !== 0x62) throw new Error(`slice(s, 1, 3)[0] should be 'b', got ${m.sliceMiddle()}`);
});

Deno.test("clamped answers every range slice refuses, and answers with what exists", () => {
  const cases: [string, number][] = [
    ["clampedPastEnd", 2],        // 3..9 over five bytes is 3..5
    ["clampedNegativeFrom", 2],   // -1..2 is 0..2
    ["clampedBackwards", 0],      // backwards contains nothing
    ["clampedBothOutside", 0],
    ["clampedNegativeBoth", 0],
  ];
  for (const [name, want] of cases) {
    const got = m[name]();
    if (got !== want) throw new Error(`${name}: got ${got}, want ${want}`);
  }
  if (m.clampedFirstByte() !== 0x61) throw new Error("clamped(s, -3, 1) should start at the array's first byte");
});
