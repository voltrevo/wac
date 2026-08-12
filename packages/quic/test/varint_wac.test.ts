// Registers the wac-side varint tests. No oracle is needed and none is passed: RFC 9000 §A.1's
// worked examples are inside the wac file, which is where a published vector belongs when it is
// four lines long and the alternative is a fixture file nobody reads.
import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/quic/test/wac/varint_test.wac", "quic");
