// Both lanes say who is in them and why.
//
// A file that declares `// test-lane: exclusive — why` is run alone, after the parallel pass. That is a
// real cost — the suite pays it in wall time, sequentially, every run — and it is the kind of cost that
// grows quietly: a test that is merely *flaky* is easier to move into the lane than to fix, and a lane
// with twenty files in it is a serial suite with extra steps.
//
// So the lane is countable, and each member has to give a reason. Neither of these can prove a file
// belongs there; what they do is make the answer to "why is the suite slow?" visible in one place, and
// stop the reason being the empty string.

import { declaredLaneFiles, exclusiveTests, heavyTests, laneSplit, wacLaneDirs, wacTestDirs } from "../harness/testLane.ts";
import { wacTestRegistrations } from "../harness/testRegistrars.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("every exclusive test says why it needs the machine", async () => {
  const lane = await exclusiveTests();
  const mute = lane.filter((e) => e.why.length < 12);
  assertEquals(
    mute.map((e) => e.file).join(", "),
    "",
    `these declared themselves exclusive without saying why:\n  ${
      mute.map((e) => e.file).join("\n  ")
    }\nWrite the reason after the dash — the next person deciding whether to add a fourth file to the ` +
      `lane needs to know what the first three were for.`,
  );
  // Printed on every green run, because a serial lane that nobody counts is how a parallel suite
  // becomes a sequential one by accident.
  console.log(`  ${lane.length} file(s) in the exclusive lane:`);
  for (const e of lane) console.log(`    ${e.file} — ${e.why}`);
});

Deno.test("the lane is small enough to still be a lane", async () => {
  // Not a law of nature, and deliberately loose. What it catches is the drift where "run it alone"
  // becomes the standard answer to a flaky test: at that point the right move is to fix the test or the
  // design, and the number is there to make somebody say so out loud rather than raising it again.
  const lane = await exclusiveTests();
  assertEquals(
    lane.length <= 6,
    true,
    `${lane.length} files want the machine to themselves. That is a sequential suite wearing a lane; ` +
      `fix the tests or the design rather than raising this number.`,
  );
});

Deno.test("every heavy test says what it costs, in a number", async () => {
  // Stricter than the exclusive rule above, which only asks for twelve characters. A heavy file is
  // *not run* on a whole-suite pass, so its declaration is the only thing standing between "this is
  // expensive" and "somebody found this annoying" — and prose alone cannot be re-checked. A number
  // can: the next person can sample the process tree and find out whether 1145 MB is still true.
  const lane = await heavyTests();
  const vague = lane.filter((e) => !/\d/.test(e.why));
  assertEquals(
    vague.map((e) => e.file).join(", "),
    "",
    `these declared themselves heavy without naming a cost:\n  ${
      vague.map((e) => e.file).join("\n  ")
    }\nGive megabytes resident, seconds, or cores held. "Slow" is what every test would say.`,
  );
  console.log(`  ${lane.length} file(s) in the heavy lane, skipped by a whole-suite run:`);
  for (const e of lane) console.log(`    ${e.file} — ${e.why}`);
});

Deno.test("no file is in both lanes, because they disagree about what to do with it", async () => {
  // Exclusive means "run this on every push, alone"; heavy means "do not run this on a push". A file
  // claiming both leaves `runTests.ts` to break the tie by whichever `--ignore` it assembles first,
  // which is a coin toss written as an implementation detail. If a file really is both, it is heavy:
  // say so, and let the heavy lane run it at two workers where its exclusivity costs nothing.
  const heavy = new Set((await heavyTests()).map((e) => e.file));
  const both = (await exclusiveTests()).map((e) => e.file).filter((f) => heavy.has(f));
  assertEquals(both.join(", "), "", "declared exclusive and heavy at once");
});

Deno.test("the heavy lane cannot quietly become the suite", async () => {
  // The failure mode this repository keeps finding is the quiet one, and here it would be a lane that
  // grows a file at a time until a push tests nothing. Twelve is roughly the measured set — ten files
  // at about a gigabyte each — with room for two more before somebody has to argue for it.
  const lane = await heavyTests();
  assertEquals(
    lane.length <= 12,
    true,
    `${lane.length} files are excluded from a whole-suite run. Past this, the question is not which ` +
      `test to exclude next but why the suite costs what it does.`,
  );
});

Deno.test("no targets means everything, which is where this was wrong the first time", () => {
  // `deno task test` passes no targets and lets discovery find the files; `test:changed` does the same
  // when a shared file changed. Reading that as "nothing matches" left the gate's lane working and the
  // other entry point silently running the same files four-at-a-time — the exact inconsistency the lane
  // exists to remove.
  const declared = ["packages/ssh/test/wac/cli_test.wac", "packages/ssh/test/wac/live_test.wac"];
  assertEquals(laneSplit([], declared).alone.length, 2, "empty targets should mean the whole tree");
});

Deno.test("a directory target contains the files declared under it", () => {
  // The first version compared a directory against a file path with `Set.has`, so nothing ever matched
  // and the lane was inert. Prefixes, not equality.
  const declared = ["packages/ssh/test/wac/cli_test.wac", "packages/box/test/box.test.ts"];
  assertEquals(
    laneSplit(["packages/ssh/"], declared).alone.join(","),
    "packages/ssh/test/wac/cli_test.wac",
  );
  assertEquals(laneSplit(["packages/json/"], declared).alone.length, 0, "an unrelated package");
  assertEquals(
    laneSplit(["packages/ssh/", "packages/box/"], declared).alone.length,
    2,
    "two targets, both with a declared file",
  );
});

Deno.test("the jobs sweep ignores what the suite ignores, by asking rather than listing", async () => {
  // `tools/jobsSweep.sh` measures the suite's peak memory and wall time at several worker counts,
  // and an agent picks `DENO_JOBS` from its table. It is only a measurement of *this* suite if it
  // runs the same files — its own header says so — and it named `exclusiveTests` for a while, so the
  // day a second lane appeared it began measuring ten files the suite no longer runs. Nothing failed;
  // the table would simply have been about a suite nobody runs.
  //
  // Checked as source rather than by running it, because running it is half an hour. What it asserts
  // is the *shape* that cannot go stale: ask this module for every declared file, do not enumerate
  // lanes here.
  const sweep = await Deno.readTextFile("tools/jobsSweep.sh");
  assertEquals(
    sweep.includes("declaredLaneFiles"),
    true,
    "jobsSweep.sh does not build its --ignore from declaredLaneFiles, so a new lane will desync it",
  );
  assertEquals(
    /exclusiveTests|heavyTests/.test(sweep),
    false,
    "jobsSweep.sh names a lane rather than asking for every declared file — that is the desync",
  );

  // And the helper really does cover both lanes, so the shape above is worth having.
  const every = await declaredLaneFiles();
  for (const e of [...(await exclusiveTests()), ...(await heavyTests())]) {
    assertEquals(every.includes(e.file), true, `declaredLaneFiles missed ${e.file}`);
  }
});

Deno.test("the wac lane's directories each hold a test, and every declared one is among them", async () => {
  // The lane is a queue of these, so a discovery that quietly returned fewer would be a suite that
  // quietly ran less — and it would still print a green summary per directory it did run.
  const dirs = await wacTestDirs("packages");

  // Every directory returned really holds a test file. This reads the directory rather than the walk's
  // own bookkeeping, so it can disagree with it.
  const empty: string[] = [];
  for (const dir of dirs) {
    let found = false;
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith("_test.wac")) found = true;
    }
    if (!found) empty.push(dir);
  }
  assertEquals(empty.join(", "), "", "directories with no wac test in them");

  // And every directory the *declarations* name is one of them — an independent source for the same
  // fact, since a heavy file is a wac test file whose path nobody walked to find.
  const declared = [...new Set(
    (await heavyTests()).map((e) => e.file).filter((f) => f.endsWith("_test.wac"))
      .map((f) => f.slice(0, f.lastIndexOf("/"))),
  )];
  const missing = declared.filter((d) => !dirs.includes(d));
  assertEquals(missing.join(", "), "", "declared heavy wac tests in directories the lane never visits");

  // The canary: a walk that found nothing would satisfy both checks above.
  assertEquals(dirs.length > 20, true, `only ${dirs.length} directories of wac tests were found`);
});

Deno.test("the wac driver the suite skips registers nothing the wac lane does not run", async () => {
  // `tools/runTests.ts` leaves `harness/wac/hostless.test.ts` out of the parallel pass because every
  // test it registers runs natively in the `wac test` lane — 575 of them, twice, at 26s a time. That is
  // a claim about a list, and this is the list: an entry registered under a path the lane never walks
  // would be a test that stopped running anywhere, while both lanes still reported green.
  const driver = "harness/wac/hostless.test.ts";
  const source = await Deno.readTextFile(driver);
  const reg = wacTestRegistrations(source);
  assertEquals(reg.unresolved, 0, `${driver} has registrations this cannot read`);
  assertEquals(reg.found.length > 20, true, `only ${reg.found.length} registrations found in ${driver}`);

  const dirs = new Set(await wacLaneDirs());
  const orphans = reg.found
    .map((r) => r.entry)
    .filter((e) => !dirs.has(e.slice(0, e.lastIndexOf("/"))) || !e.endsWith("_test.wac"));
  assertEquals(
    orphans.join(", "),
    "",
    "entries registered here that the `wac test` lane does not walk — the suite skips this file, so " +
      "these run nowhere. Either move them under a package's test/wac/, or take the exclusion out of " +
      "`tools/runTests.ts`.",
  );
});
