// `server.wac`'s framing guards, written in wac — see test/wac/server_traps_test.wac.
//
// Host-side until 2026-08-16 because a trap ends the call. It still does, so each refusal is its own
// export; `test_traps_*` is what lets a test say it wants one. The closed-connection case is
// deliberately *not* one of those: it must return. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/tls/test/wac/server_traps_test.wac", "tls-server-traps");
