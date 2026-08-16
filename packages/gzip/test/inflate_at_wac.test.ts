// `inflateAt`, written in wac — see test/wac/inflate_at_test.wac.
//
// Host-side until 2026-08-16 though nothing in it needed a host: both halves are wac, and the
// TypeScript was converting strings to bytes and back. `issues/system/0161`.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/gzip/test/wac/inflate_at_test.wac", "inflate-at");
