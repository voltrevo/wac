// Registers the wac-side RSA tests and supplies node's signer.
//
// The signer itself is `rsaOracle.ts`, shared with `cov.ts` so the coverage run can drive these
// same tests under instrumentation rather than re-deriving a weaker workload.
import { wacTestRun } from "../../../harness/wacTestRun.ts";
import { ref } from "./rsaOracle.ts";

await wacTestRun("packages/crypto/test/wac/rsa_test.wac", "rsa", [ref]);
