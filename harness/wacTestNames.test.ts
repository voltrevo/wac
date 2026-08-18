// The two paths' names for the same test, and the one rule that relates them.
//
// A wac test is `export string test_basics()` in a `.wac` file. `wac test` knows it by that name;
// the Deno suite knows it as `map: basics`, because `wacTestRun("…/map_test.wac", "map")` registers
// it under a label. Anything that reads a **native** coverage profile and then runs the tests it
// selected through Deno has to translate between the two — `tools/mutate.ts` is about to.
//
// That translation is the dangerous kind of code. `deno test --filter test_basics` matches nothing,
// exits 0, and prints "0 passed, 0 failed, 16 filtered out"; the mutation runner reads that as a
// mutant nothing killed and scores it as **surviving**. So a broken translation does not fail — it
// raises the mutation score, which is the one direction nobody investigates. `issues/system/0161`.
//
// Two things are therefore checked here rather than left to reading:
//
//   - the name rule has **one** implementation, `denoTestName`, which `wacTestRun` itself calls, so a
//     translator cannot drift from the registrar;
//   - every `wacTestRun` call in the repository resolves, and the count of the ones that do not is
//     the number this file states — because "no registrations found" and "this file registers
//     nothing" are the same answer from a text scan, and only one of them is true.

import { denoTestName } from "./wacTestRun.ts";
import { wacTestRegistrations } from "./testRegistrars.ts";
import { ROOT } from "./programs.ts";

Deno.test("the registered name is the label and the test name without its prefix", () => {
  const cases: [string, string | undefined, string, string][] = [
    ["packages/std/test/wac/map_test.wac", "map", "test_basics", "map: basics"],
    // `test` with no underscore is the other spelling the stripper accepts.
    ["packages/std/test/wac/map_test.wac", "map", "testBasics", "map: Basics"],
    // No label: the wac file's stem, extension removed, directories dropped.
    ["packages/std/test/wac/map_test.wac", undefined, "test_basics", "map_test: basics"],
    ["a/b/c/option_test.wac", "opt", "test_a_long_name", "opt: a_long_name"],
  ];
  for (const [entry, prefix, native, want] of cases) {
    const got = denoTestName(entry, prefix, native);
    if (got !== want) {
      throw new Error(`denoTestName(${entry}, ${prefix}, ${native}) = ${got}, expected ${want}`);
    }
  }
});

Deno.test("a call written with a variable is counted, not dropped", () => {
  const src = [
    'await wacTestRun("packages/std/test/wac/map_test.wac", "map");',
    'await wacTestRun("packages/std/test/wac/option_test.wac");',
    'await wacTestRun("packages/crypto/test/wac/aes_test.wac", "aes", [ref]);',
    "await wacTestRun(path);",
  ].join("\n");
  const r = wacTestRegistrations(src);
  if (r.unresolved !== 1) throw new Error(`unresolved ${r.unresolved}, expected 1`);
  if (r.found.length !== 3) throw new Error(`found ${r.found.length}, expected 3`);
  if (r.found[0].prefix !== "map") throw new Error(`prefix ${r.found[0].prefix}`);
  // The middle call leaves the label out, and `undefined` has to survive as far as `denoTestName`
  // — which is what turns it into the file's stem. A `""` here would name every test `: basics`.
  if (r.found[1].prefix !== undefined) throw new Error(`prefix ${JSON.stringify(r.found[1].prefix)}`);
  if (denoTestName(r.found[1].entry, r.found[1].prefix, "test_some") !== "option_test: some") {
    throw new Error("a call with no label does not fall back to the wac file's stem");
  }
  // A third argument must not be mistaken for the label.
  if (r.found[2].prefix !== "aes") throw new Error(`prefix ${r.found[2].prefix}`);
});

Deno.test("every wacTestRun call in the repository can be read from its source", async () => {
  // Zero, and it was 1 until 2026-08-18. The call that could not be read was in
  // packages/wactest/test/assert.test.ts, which drove the runner with a computed path — a test of
  // the runner rather than a registration. `issues/system/0161` retired that file: `wac test` does
  // the running now, and what it guaranteed is asked of the new runner in
  // `packages/wactest/test/wac/runner_test.wac`.
  //
  // Still *counted* rather than dropped, because the count is what makes a spelling this cannot read
  // visible at all — the whole reason `wacTestRegistrations` returns a number and not a shorter list.
  const EXPECTED_UNRESOLVED = 0;

  let calls = 0, unresolved = 0, withPrefix = 0;
  // How many files textually contain the call, so the floor below can be derived from the tree
  // rather than chosen. Every such file has at least one call in it.
  let filesWithCall = 0;
  const seen = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue;
        await walk(p);
        continue;
      }
      if (!e.name.endsWith(".test.ts")) continue;
      const src = await Deno.readTextFile(p);
      if (!src.includes("wacTestRun(")) continue;
      filesWithCall++;
      const r = wacTestRegistrations(src);
      calls += r.found.length + r.unresolved;
      unresolved += r.unresolved;
      for (const reg of r.found) {
        seen.add(reg.entry);
        if (reg.prefix !== undefined) withPrefix++;
      }
    }
  };
  // **Two roots, and what stays out is excluded by path rather than by name.** This said
  // "`packages/` only, and that is not a shortcut — all 83 registrations are there", which stopped
  // being true: the registrations were consolidated into `harness/wac/hostless.test.ts`, the file
  // `tools/mutate/profile.ts` reads statically, and `packages/` now holds none at all. Walking only
  // `packages/` found nothing, and the floor below reported that as an extractor that had stopped
  // resolving rather than as a tree with nothing left to resolve.
  //
  // What has to stay out is the two files *directly* under `harness/`, both of them tests about the
  // runner: `wacTestProfile.test.ts` embeds a synthetic subject in a template string, and this file's
  // own `includes("wacTestRun(")` counts as a call while the comments above it name `.wac` files that
  // do not exist. A text scan that walks the tree scans itself. `harness/wac/` is a directory neither
  // of them is in, so naming it excludes both without a filename list to keep current.
  await walk(`${ROOT}/packages`);
  await walk(`${ROOT}/harness/wac`);

  if (unresolved !== EXPECTED_UNRESOLVED) {
    throw new Error(
      `${unresolved} wacTestRun call(s) could not be read from source, expected ` +
        `${EXPECTED_UNRESOLVED}. A new spelling that this cannot read is a file whose tests a ` +
        `native-profile reader will think do not exist — widen the extractor, do not widen this ` +
        `number without knowing which call it is.`,
    );
  }
  // **Derived, because every constant here has gone stale.** This was 80, then 25, and it is what
  // the number was for that matters: catching an extractor that has stopped reading *anything*,
  // which a hand-picked floor does badly. It has to sit under the true count, and the true count
  // keeps falling — forty-four wrappers became one when the Deno lane stopped needing one per
  // file, and `issues/system/0161` is moving whole packages to native wac tests, which retires
  // wrappers a package at a time. 25 outlived its second lowering by about a day and failed with
  // 19 while nothing was wrong.
  //
  // A file that contains the text has at least one call in it, so `filesWithCall` is a floor the
  // tree computes. It goes to zero exactly when the walk stops finding files, which is the failure
  // worth catching.
  //
  // "And it cannot be outrun by a migration" stood here until 2026-08-18, when it was: retiring the
  // last registrar under `packages/` took this to zero, and a floor that supposedly could not be
  // outrun read that as an extractor that had broken. A derived floor is still only as wide as the
  // roots it is derived from, so the roots are the part to keep current — see the walk above.
  if (filesWithCall === 0) {
    throw new Error("the walk found no file containing `wacTestRun(` — it did not resolve");
  }
  if (calls < filesWithCall) {
    throw new Error(
      `${calls} wacTestRun call(s) read from ${filesWithCall} file(s) that contain the text — ` +
        `a file with the call and no call read from it means the extractor cannot see a spelling`,
    );
  }
  // Most calls name a label. Also derived: a majority of what was found, rather than a count that
  // shrinks with the migration.
  if (withPrefix * 2 < calls) {
    throw new Error(`only ${withPrefix} of ${calls} calls named a label; expected most to`);
  }

  // Each entry must exist: a registration naming a file that is not there resolves textually and
  // then covers nothing, which is the same silence in a different place.
  for (const entry of seen) {
    try {
      await Deno.stat(`${ROOT}/${entry}`);
    } catch {
      throw new Error(`a wacTestRun call names ${entry}, which does not exist`);
    }
  }
});
