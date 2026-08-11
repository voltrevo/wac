// The DATA/QUANTITY split, in wac. No oracle: the two encodings are defined by the Ethereum
// JSON-RPC spec's own words, and what these pin is that the *caller* chooses which one it is
// asking for — see issue 0119, where one decoder served both and padded a hash.
import { wacTestRun } from "../../../harness/wacTestRun.ts";
await wacTestRun("packages/ethrpc/test/wac/jsonhex_test.wac", "jsonhex");
