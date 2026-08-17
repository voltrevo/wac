// Registers the wac-side `Loop` tests.
//
// The whole of the test is in `wac/loop_test.wac`, and it needs no host: a `Core` is a struct of
// `fn[…]` fields, so one whose `waitAny` answers from a script is an ordinary value. What is under
// test is the dispatch — which handler runs for which ticket, what a handler may do while it runs,
// and what is left registered afterwards.
//
// **Driven from here so the shared suite runs it.** The fixture passes under `wac test` on its own,
// which is how it was written, and that is not the same as being run: `deno task test` walks
// `*.test.ts`, so a `.wac` fixture with no driver is a file nobody executes.

import { wacTestRun } from "../../../harness/wacTestRun.ts";

await wacTestRun("packages/platform/test/wac/loop_test.wac", "loop");
