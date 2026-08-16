// The container bounds traps, written in wac — see test/wac/bounds_test.wac.
//
// Host-side until 2026-08-16, on the grounds that "a trap aborts the module, so a wac test cannot
// assert one and keep running". A trap unwinds that module and nothing else; what was missing was a
// way to *say* a trap is expected, which `test_traps_*` now is. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/json/test/wac/bounds_test.wac", "json-bounds");
