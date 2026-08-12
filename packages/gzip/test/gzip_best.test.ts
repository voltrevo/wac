// The one guarantee `gzipBest` makes: **it never returns more bytes than a stored container.**
//
// `gzip.wac` states it in prose — *"guarantees the output is never larger than stored, which is the
// property that matters, since expansion is the one outcome a compressor should never produce"* —
// and nothing asserted it. The fuzz corpus round-trips `gzipBest`, so a wrong *answer* was caught;
// an answer that was merely larger than it should be was not, because a bigger valid gzip stream
// decompresses perfectly.
//
// The interesting inputs are the ones where compression fails but only just, because that is where
// the choice is actually made. Below `smallInput()` all three encodings are priced and the smallest
// wins; above it `gzipBest` prices dynamic first and only reaches for stored when dynamic came out
// at least as large as the input. Both sides of *that* comparison are live: on 5 000 bytes over an
// alphabet of 246, dynamic is 5 002 and stored is 5 023 — compression failed to shrink anything
// and is still the better answer by twenty-one bytes. Nothing in the suite had ever produced an
// incompressible input above the threshold, so that arm had never run.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/gzip/src/gzip.wac");
const gzipBest = mod.gzipBest as (data: Uint8Array) => Uint8Array;
const gzipStored = mod.gzipStored as (data: Uint8Array) => Uint8Array;

/**
 * Deterministic bytes that do not compress, over an alphabet of `alpha` symbols.
 *
 * A linear congruential generator rather than `Math.random`, because a property that holds on
 * Tuesday and not on Wednesday is not a property — and because when this fails, the input has to be
 * the same one that failed.
 */
function incompressible(n: number, alpha: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s >>> 16) & 255) % alpha;
  }
  return out;
}

Deno.test("gzipBest never returns more than a stored container, on either side of smallInput()", () => {
  // 4096 is `smallInput()`; these straddle it, and the alphabets span "compresses well" to "does
  // not compress at all" so both the shrinking and the failing cases are priced.
  for (const n of [0, 1, 300, 1000, 4095, 4096, 4097, 5000, 8192, 20000]) {
    for (const alpha of [2, 16, 200, 250, 256]) {
      const data = incompressible(n, alpha, 20260812 ^ n ^ alpha);
      const best = gzipBest(data).length;
      const stored = gzipStored(data).length;
      if (best > stored) {
        throw new Error(
          `gzipBest expanded past stored on ${n} bytes over ${alpha} symbols: ${best} > ${stored}`,
        );
      }
    }
  }
});

Deno.test("above smallInput(), an input that will not compress still takes the dynamic answer when stored is worse", () => {
  // The specific arm: `best.len() >= n` is true — dynamic did not shrink anything — and stored is
  // *still* larger, so `gzipBest` keeps the dynamic container. A test that only checked "the answer
  // is no worse than stored" passes whichever branch runs, so this pins which one did by checking
  // the answer is not the stored container.
  const data = incompressible(5000, 246, 3);
  const best = gzipBest(data);
  const stored = gzipStored(data);

  if (best.length < data.length) {
    throw new Error(`this input was meant not to compress, but ${data.length} became ${best.length}`);
  }
  if (best.length >= stored.length) {
    throw new Error(
      `this input was meant to leave dynamic ahead of stored, got ${best.length} vs ${stored.length}`,
    );
  }
});
