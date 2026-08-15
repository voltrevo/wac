// The compile benchmark must time the build that happens.
//
// `tools/benchCompile.ts` keeps a list of the compiler calls a build makes. `harness/waccBuild.ts`
// makes them. Nothing connects the two, and twice now they have come apart: the benchmark timed
// five calls after three were folded into one and reported ~106 s for a path nothing took, and then
// — one commit after that was fixed, by the same person, within the hour — `buildFiles` folded two
// more and the list was not updated again. Neither drift failed anything. Both produced a plausible
// table for a build that did not exist.
//
// The first fix was a note in bold in the file asking the next person to keep it in step. That is
// what did not work. This is the check.
//
// It is a text scan, which is coarse: it cannot tell a call on the default path from one only a
// coverage build makes. That is what `bench-exempt` is for — a line naming the call and saying why
// it is not timed. The point is not that the benchmark times everything. It is that adding a call
// to a build forces someone to decide, instead of leaving a stale table that still looks right.

import { ROOT } from "../harness/programs.ts";

Deno.test("every compiler call a build makes is timed or exempted", async () => {
  const harness = await Deno.readTextFile(`${ROOT}/harness/waccBuild.ts`);
  const bench = await Deno.readTextFile(`${ROOT}/tools/benchCompile.ts`);

  const called = new Set([...harness.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]));
  const timed = new Set([...bench.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]));
  const exempt = new Set([...bench.matchAll(/bench-exempt:\s*(\w+)/g)].map((m) => m[1]));

  const missing = [...called].filter((n) => !timed.has(n) && !exempt.has(n)).sort();
  if (missing.length > 0) {
    throw new Error(
      `harness/waccBuild.ts calls ${missing.map((n) => `api.${n}`).join(", ")}, which ` +
        `tools/benchCompile.ts neither times nor exempts.\n` +
        `  Add it to PHASES if a build's cost depends on it, or write\n` +
        `    // bench-exempt: ${missing[0]} — <why>\n` +
        `  if it does not. A benchmark that misses a call reports a smaller build than the one\n` +
        `  anybody runs, and says nothing while doing it.`,
    );
  }

  // And the other direction, weakly: an exemption for a call the harness no longer makes is dead
  // text that will outlive whatever it was explaining.
  const stale = [...exempt].filter((n) => !called.has(n)).sort();
  if (stale.length > 0) {
    throw new Error(
      `tools/benchCompile.ts exempts ${stale.join(", ")}, which harness/waccBuild.ts ` +
        `does not call any more — drop the bench-exempt line.`,
    );
  }
});
