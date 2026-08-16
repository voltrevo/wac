// Sealing a short header and opening it again, written in wac — see test/wac/short_test.wac.
//
// Host-side until 2026-08-16 though nothing in it needed a host: a probe sealed and opened, and
// TypeScript compared counts. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/quic/test/wac/short_test.wac", "quic-short");
