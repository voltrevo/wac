// The incremental CRC against the whole-array one, written in wac — see
// test/wac/crc32_incremental_test.wac.
//
// This was a host-side test until 2026-08-16 and never needed to be: it builds an array, calls two
// functions and compares two integers. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/gzip/test/wac/crc32_incremental_test.wac", "crc32-incremental");
