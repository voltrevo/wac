// The argument guards that trap, written in wac — see test/wac/traps_test.wac.
//
// Host-side until 2026-08-16 because a trap ends the call. It still does, so each case is its own
// export; `test_traps_*` is what lets a test say it wants one. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/crypto/test/wac/traps_test.wac", "crypto-traps");
