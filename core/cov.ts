// Branch coverage for the built-in tree.
//
//   deno task coverage:core
//   deno task coverage:core --verbose
//
// **It exists because the move would otherwise have turned coverage off.** `option.wac` and
// `result.wac` came from `packages/std`, where `coverage:std` measured them; they are `core/`'s now,
// and `report()` filters by prefix, so without this the two files are measured by nothing and
// `coverage:std` reads a *higher* number for having lost them. That is the shape of change this
// repository keeps catching after the fact — `issues/system/0200` most recently — so the task lands
// with the move.
//
// The workload is the tree's own tests. There is no second workload here as there is in the larger
// packages, because `core` is small enough that a hand-written exercise beside the tests would be
// the tests again, spelled differently.

import { instrument, report, runTestExports } from "../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");

const runs = [];
for (const entry of ["option", "hash", "map", "vec"]) {
  const run = await instrument(`core/test/${entry}_test.wac`);
  runTestExports(run, `core/test/${entry}_test.wac`);
  runs.push(run);
}

// **`traps_test.wac` is separate, because a `test_traps_*` export is *expected* to trap.** Its
// failure is not a failure, so it cannot go through `runTestExports`, which reports one. This came
// across with the collections when `packages/std` retired — and the same block in that package's
// driver had once named a path that no longer existed, crashing the task with `NotFound` until
// somebody looked. `issues/system/0161`.
const traps = await instrument("core/test/traps_test.wac");
for (const fn of Object.values(traps.mod)) {
  if (typeof fn !== "function") continue;
  try {
    (fn as () => number)();
  } catch { /* the trap is the point */ }
}
runs.push(traps);

const { total, covered } = report(runs, "core/", { verbose });
if (covered < total) Deno.exit(0); // reporting tool, not a gate
