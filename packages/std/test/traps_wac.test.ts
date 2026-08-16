// The traps in Vec, Option and Result, written in wac — see test/wac/traps_test.wac.
//
// Host-side until 2026-08-16 on the grounds that "a trap aborts the whole module, so each case needs
// its own call from the host", and that the capacity-not-length case was one "no test written in wac
// can tell the difference" about. Both are answered by `test_traps_*`: making `Vec.get` check
// `data.len()` instead of `n` fails that exact case. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/std/test/wac/traps_test.wac", "std-traps");
