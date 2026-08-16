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
  // The one that cannot: `packages/wactest/test/assert.test.ts` drives the runner with a computed
  // path, testing the runner rather than registering a suite. It is *counted*, which is the whole
  // reason `wacTestRegistrations` returns a number instead of a shorter list.
  const EXPECTED_UNRESOLVED = 1;

  let calls = 0, unresolved = 0, withPrefix = 0;
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
      const r = wacTestRegistrations(src);
      calls += r.found.length + r.unresolved;
      unresolved += r.unresolved;
      for (const reg of r.found) {
        seen.add(reg.entry);
        if (reg.prefix !== undefined) withPrefix++;
      }
    }
  };
  // **`packages/` only, and that is not a shortcut.** All 83 registrations are there; the two files
  // under `harness/` that contain the call are tests *about* the runner — one embeds a synthetic
  // subject in a template string, and the other is this file, whose own `includes("wacTestRun(")`
  // counts as a call and whose comment above names a `.wac` file that does not exist. A text scan
  // that walks the tree scans itself, and both of those would have arrived as findings about the
  // repository.
  await walk(`${ROOT}/packages`);

  if (unresolved !== EXPECTED_UNRESOLVED) {
    throw new Error(
      `${unresolved} wacTestRun call(s) could not be read from source, expected ` +
        `${EXPECTED_UNRESOLVED}. A new spelling that this cannot read is a file whose tests a ` +
        `native-profile reader will think do not exist — widen the extractor, do not widen this ` +
        `number without knowing which call it is.`,
    );
  }
  // A floor rather than an exact count, so adding a wac test file is not a failure here. The number
  // that matters is the one above.
  if (calls < 80) throw new Error(`only ${calls} wacTestRun call(s) found — did the walk resolve?`);
  if (withPrefix < 70) throw new Error(`only ${withPrefix} calls named a label; expected most to`);

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
