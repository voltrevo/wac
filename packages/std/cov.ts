// Branch coverage for std.
//
// Three entry points, because the tests are split three ways and each compiles its own
// module: the containers, the sum types, and the trap fixture. The last one matters more
// here than elsewhere — every bounds check in Vec is a branch that only a trapping call
// reaches, and a trap unwinds to the host leaving the instance usable, so the counters
// survive it.
//
//   deno task coverage:std
//   deno task coverage:std --verbose

import { instrument, report, runTestExports } from "../../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");

const runs = [];
for (const entry of [
  "packages/std/test/wac/vec_test.wac",
  "packages/std/test/wac/map_test.wac",
  "packages/std/test/wac/option_test.wac",
]) {
  const run = await instrument(entry);
  runTestExports(run, entry);
  runs.push(run);
}

// `test/wac/traps_test.wac` since 2026-08-16, when the trap tests moved into wac — this line kept
// naming the fixture's old path and the task has crashed with `NotFound` ever since. It is separate
// from the loop above because a `test_traps_*` export is *expected* to trap, so its failure is not
// a failure. `issues/system/0161`.
const traps = await instrument("packages/std/test/wac/traps_test.wac");
for (const fn of Object.values(traps.mod)) {
  if (typeof fn !== "function") continue;
  try { (fn as () => number)(); } catch { /* the trap is the point */ }
}
runs.push(traps);

report(runs, "packages/std/", { verbose });
