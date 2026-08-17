// Registers the wac-side `Sched` tests.
//
// The whole of the test is in `wac/sched_test.wac`, and it needs no host: a `Core` is a struct of
// `fn[…]` fields, so one whose `waitAny` answers from a script is an ordinary value.
//
// **Driven from here so the shared suite runs it.** The fixture passes under `wac test` on its own,
// which is how it was written, and that is not the same as being run: `deno task test` walks
// `*.test.ts`, so a `.wac` fixture with no driver is a file nobody executes.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/platform/test/wac/sched_test.wac", "sched");
