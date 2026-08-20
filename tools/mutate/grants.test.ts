// The profiler's grants and the suite's wac lane's are the same list.
//
//     deno test -A --no-check tools/mutate/grants.test.ts
//
// They were two lists and they drifted. `tools/runTests.ts` added `--allow-net` to the lane on
// 2026-08-18 — because a wac test that binds a socket answers "no free port" without it — and
// `tools/mutate/profile.ts` kept passing four grants. A profiling run is not a test run: a test that
// *fails* for want of a grant is not *skipped*, so `skipped` stays empty, `wacShare` takes the file,
// and the lines those tests would have reached are attributed to nobody. Twenty-nine test files across
// seven packages have at least one such test. `issues/system/0176`.
//
// This reads the lane's list out of its source rather than importing it, because it is built inline in
// a function that spawns the suite; importing that module to ask a question about a string array would
// run the guard at its top. The regex is anchored on the array literal that follows `"test",` in the
// wac-lane command, and the test fails loudly if it stops matching — a silent zero here would be the
// same fault one level up.

// Local rather than `@std/assert`: jsr.io is not on this container's proxy allowlist, which is the
// reason `harness/deadline.test.ts` gives beside its own.
import { WAC_LANE_GRANTS } from "./profile.ts";

Deno.test("the profiler grants what the wac lane grants", async () => {
  const src = await Deno.readTextFile(new URL("../runTests.ts", import.meta.url));
  const at = src.indexOf('"test",\n    "--allow-read",');
  if (at < 0) {
    throw new Error(
      "cannot find the wac lane's grant list in tools/runTests.ts — this test is matching nothing " +
        "and would pass whatever the profiler does. Re-anchor it on the list the lane actually builds.",
    );
  }
  const end = src.indexOf("];", at);
  const block = src.slice(at, end);
  const lane = [...block.matchAll(/"(--allow-[a-z-]+)"/g)].map((m) => m[1]);
  if (lane.length < 4) {
    throw new Error(`matched only ${lane.length} grant(s) in the lane's list: ${lane.join(" ")}`);
  }
  // Compared as sorted text, not as arrays: `[] !== []` in JavaScript, so a hand-rolled equality on
  // two arrays passes or fails for the wrong reason.
  const want = [...lane].sort().join(" ");
  const got = [...WAC_LANE_GRANTS].sort().join(" ");
  if (want !== got) {
    throw new Error(
      "the suite's wac lane and tools/mutate/profile.ts disagree about what a wac test may do:\n" +
        `  lane:     ${want}\n  profiler: ${got}\n` +
        "A grant the lane passes and the profiler does not makes tests *fail* rather than skip, which " +
        "the profiler cannot see — `skipped` stays empty and the profile is taken as authoritative. " +
        "issues/system/0176.",
    );
  }
});
