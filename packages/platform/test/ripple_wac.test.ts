// The ripple tank's solver, written in wac — see test/wac/ripple_test.wac.
//
// Host-side until 2026-08-16 though nothing in it needed a host: a probe ran the simulation and
// TypeScript compared the numbers. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/platform/test/wac/ripple_test.wac", "ripple");
