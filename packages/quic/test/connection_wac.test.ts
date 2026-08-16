// The bookkeeping that turns a packet into a connection, written in wac — see
// test/wac/connection_test.wac.
//
// Host-side until 2026-08-16 though nothing in it needed a host: a probe did the bookkeeping and
// TypeScript compared counts. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/quic/test/wac/connection_test.wac", "quic-connection");
