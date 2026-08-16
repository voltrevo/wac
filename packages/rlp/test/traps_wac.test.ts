// `fromI64`'s refusal to encode a negative, written in wac — see test/wac/traps_test.wac.
//
// Host-side until 2026-08-16 because a trap ends the call. It still does, so each case is its own
// export, but `test_traps_*` lets a test say it wants one. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/rlp/test/wac/traps_test.wac", "rlp-traps");
