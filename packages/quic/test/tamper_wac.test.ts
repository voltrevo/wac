// A packet that fails authentication is discarded, not fatal — written in wac, see
// test/wac/tamper_test.wac.
//
// Host-side until 2026-08-16 though nothing in it needed a host: a probe returned four lengths and
// TypeScript compared them to zero. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/quic/test/wac/tamper_test.wac", "quic-tamper");
