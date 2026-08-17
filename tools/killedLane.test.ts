// A killed lane and a failed lane are different claims, and the exit code is the only thing that says
// which. `issues/system/0154`.

import { killedLane, killedLaneNote } from "./killedLane.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("a killed lane is told apart from a failed one", () => {
  // The two that mean "did not finish".
  assertEquals(killedLane(137) !== null, true, "137 is 128 + SIGKILL");
  assertEquals(killedLane(143) !== null, true, "143 is 128 + SIGTERM");
  // **And the ones that mean the lane ran.** 1 is a test failure, 3 is the gate refusing, 0 is a pass
  // — none of them is silence, and calling any of them "killed" would tell a reader to distrust a
  // verdict they actually have.
  assertEquals(killedLane(0), null, "0 is a pass");
  assertEquals(killedLane(1), null, "1 is a failure, which is a verdict");
  assertEquals(killedLane(3), null, "3 is the suite gate refusing to start");
  assertEquals(killedLane(2), null);
});

Deno.test("the note says there is no verdict, and names the issue", () => {
  const note = killedLaneNote("parallel", 137);
  assertEquals(note.includes("parallel"), true, "it names the lane");
  assertEquals(note.includes("no verdict"), true, "which is the point: not a pass and not a failure");
  assertEquals(note.includes("0154"), true, "and where the measurements are");
  // Nothing at all for a lane that ran, so an ordinary failure is not buried under advice.
  assertEquals(killedLaneNote("parallel", 1), "");
});
