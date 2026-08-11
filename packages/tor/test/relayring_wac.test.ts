// Registers the ring-budget tests. No oracle and none possible: this is a policy about our own
// platform's call ring, and what it is measured against is the ring's own size — see wac-mono 0091,
// which asked for exactly this cap and left the decision of *what to refuse* open.
import { wacTestRun } from "../../../harness/wacTestRun.ts";
await wacTestRun("packages/tor/test/wac/relayring_test.wac", "relayring");
