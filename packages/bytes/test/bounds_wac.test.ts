// `Buf`'s bounds checks and the slice/clamped split, written in wac — see test/wac/bounds_test.wac.
//
// Host-side until 2026-08-16 because a trap ends the call. It still does, so each refusal is its own
// export; `test_traps_*` is what lets a test say it wants one. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/bytes/test/wac/bounds_test.wac", "bytes-bounds");
