// `dispatchOrder` — the ratchets' longest-first ordering, which shipped with only a hand check.
//
//     deno test -A tools/coverageOrder.test.ts
//
// The suite's equivalent ordering has `tools/wac/suiteorder_test.wac` behind it, driving `--dry` and
// asserting the queue swaps when the recorded times say so. This one had nothing, because
// `tools/coverageAll.ts` spawns thirty-seven drivers at import time and cannot be loaded by a test.
// Splitting the nine lines out is what makes the difference between a two-minute sweep and this.

import { dispatchOrder } from "./coverageOrder.ts";

const eq = (got: string[], want: string[], what: string) => {
  if (got.join(",") !== want.join(",")) {
    throw new Error(`${what}: got [${got.join(", ")}], wanted [${want.join(", ")}]`);
  }
};

Deno.test("coverageOrder: with no recorded times the alphabetical order is kept", () => {
  // A fresh checkout has no file, so every package is unknown, they all compare equal, and what
  // comes out is what went in. This is the case that must not regress: it is what the sweep did for
  // a year before any of this.
  const pkgs = ["abi", "bytes", "crypto", "zstd"];
  eq(dispatchOrder(pkgs, {}), pkgs, "no times");
});

Deno.test("coverageOrder: the slowest recorded package goes first", () => {
  const pkgs = ["abi", "bytes", "crypto", "zstd"];
  const times = { abi: 5_000, bytes: 1_000, crypto: 90_000, zstd: 10_000 };
  eq(dispatchOrder(pkgs, times), ["crypto", "zstd", "abi", "bytes"], "all timed");
});

Deno.test("coverageOrder: a package with no recorded time is dispatched before every timed one", () => {
  // The safe end, and the argument is asymmetric: an unknown is usually a new package and short, so
  // putting it first costs almost nothing, while putting it last re-creates the exact problem this
  // fixes for a package nobody has timed yet.
  const pkgs = ["abi", "bytes", "crypto", "zstd"];
  const times = { abi: 5_000, crypto: 90_000, zstd: 10_000 };
  eq(dispatchOrder(pkgs, times), ["bytes", "crypto", "zstd", "abi"], "one untimed");
});

Deno.test("coverageOrder: two untimed packages keep the order they arrived in", () => {
  // They compare equal, and `Array.prototype.sort` has been stable since ES2019. The alternative —
  // `Infinity` for the unknowns — makes the comparator return `NaN` for this pair, which has no
  // defined answer at all; that is why the sentinel is `Number.MAX_SAFE_INTEGER`.
  const pkgs = ["abi", "bytes", "crypto", "zstd"];
  const times = { crypto: 90_000, zstd: 10_000 };
  eq(dispatchOrder(pkgs, times), ["abi", "bytes", "crypto", "zstd"], "two untimed");
});

Deno.test("coverageOrder: the input is not mutated", () => {
  // `coverageAll.ts` keeps its alphabetical `PACKAGES` to sort the report back into, so an in-place
  // sort here would silently reorder every row a reader scans for a red.
  const pkgs = ["abi", "bytes", "crypto"];
  const before = pkgs.join(",");
  dispatchOrder(pkgs, { abi: 9_000 });
  if (pkgs.join(",") !== before) throw new Error(`dispatchOrder reordered its argument: ${pkgs}`);
});

Deno.test("coverageOrder: a recorded time for a package that is gone is ignored", () => {
  // The times file is written from whatever ran; a package can leave `tasks.json5` between runs and
  // its entry outlives it. Sorting must not invent a row for it.
  const pkgs = ["abi", "bytes"];
  eq(dispatchOrder(pkgs, { retired: 99_000, abi: 1_000 }), ["bytes", "abi"], "stale key");
});
