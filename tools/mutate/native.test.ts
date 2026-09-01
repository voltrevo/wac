// `wac test`'s exit codes are a contract, so they are checked against the binary.
//
// `tools/mutate/native.ts` turns them into verdicts for a mutation run, and every one of those
// mappings is a claim about a program nothing else in this repository pins. The mapping that matters
// is **1**: a filter matching nothing exits non-zero, so a runner reading "non-zero means killed"
// records a kill for a mutant that never ran, and the score rises. The Deno path fails the mirror
// way — `deno test --filter nonsense` exits 0 and the mutant reads as survived — so neither
// direction can be assumed and both have to be observed.
//
// Skipped without a binary, as `tools/wac/seedfresh_test.wac` skips without a seed.

import { classify, isWacRun, mergeRuns, splitHalves, WAC_BIN, wacTestArgs } from "./native.ts";
import { ROOT } from "../../harness/programs.ts";

/** A file with several passing tests and no host oracle, so every code below is reachable. */
const SUBJECT = "core/test/map_test.wac";
/** A file whose tests all take an oracle the native host cannot supply. */
const ORACLE_ONLY = "packages/tor/test/wac/votestatus_test.wac";

async function haveBinary(): Promise<boolean> {
  try {
    return (await Deno.stat(`${ROOT}/${WAC_BIN}`)).isFile;
  } catch {
    return false;
  }
}

async function run(entry: string, filter?: string): Promise<number> {
  const r = await new Deno.Command(`${ROOT}/${WAC_BIN}`, {
    args: wacTestArgs(entry, filter),
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return r.code;
}

Deno.test("a filter that matches runs those tests and reports success", async () => {
  if (!await haveBinary()) return;
  const code = await run(SUBJECT, "test_basics");
  if (classify(code).kind !== "survived") {
    throw new Error(`\`wac test --filter test_basics\` exited ${code}, expected 0`);
  }
});

Deno.test("a filter that matches nothing is an abort, not a verdict", async () => {
  if (!await haveBinary()) return;
  const code = await run(SUBJECT, "no_such_test_at_all");
  const v = classify(code);
  if (v.kind !== "abort") {
    throw new Error(
      `a filter matching nothing exited ${code}, which \`classify\` reads as "${v.kind}". ` +
        `That is a mutant nobody ran being given a verdict: ${code === 0 ? "survived" : "killed"}. ` +
        `The score moves and nothing goes red.`,
    );
  }
});

Deno.test("running the whole file is a pass, and the filter is what narrows it", async () => {
  if (!await haveBinary()) return;
  // Both spellings of the command, so `wacTestArgs`' two branches are each exercised — an argv
  // builder whose no-filter branch was never run would fail the first time a mutant widened.
  if (classify(await run(SUBJECT)).kind !== "survived") {
    throw new Error("running the whole file did not report success");
  }
});

Deno.test("a file whose tests all need a host oracle is distinguished from one that passed", async () => {
  if (!await haveBinary()) return;
  let there = true;
  try {
    await Deno.stat(`${ROOT}/${ORACLE_ONLY}`);
  } catch {
    there = false;
  }
  if (!there) return; // The corpus moved; this claim has no subject here.
  const v = classify(await run(ORACLE_ONLY));
  if (v.kind !== "no-tests-here") {
    throw new Error(
      `${ORACLE_ONLY} classified as "${v.kind}". 31 of this repository's wac test files run ` +
        `nothing natively, and reading that as "survived" would score every mutant they cover ` +
        `against a suite that did not execute.`,
    );
  }
});

Deno.test("[§wac-cli-status-8kz4rp6] a test that fails is killed, which is the mapping a score is built on", async () => {
  if (!await haveBinary()) return;
  // A fixture rather than a corpus file, because nothing here fails on purpose — and `killed` is the
  // one verdict a mutation score is actually made of. Without this the mapping from 3 is asserted
  // only by the comment beside it.
  const dir = await Deno.makeTempDir({ prefix: "wac-native-fail-" });
  try {
    const entry = `${dir}/failing_test.wac`;
    await Deno.writeTextFile(
      entry,
      'export string test_passes() { return ""; }\n' +
        'export string test_fails() { return "the mutant changed this"; }\n',
    );
    const v = classify(await run(entry));
    if (v.kind !== "killed") {
      throw new Error(
        `a file with a failing test classified as "${v.kind}". If a failure does not read as ` +
          `killed, every mutant its tests catch is recorded as surviving and the score is a ` +
          `count of nothing.`,
      );
    }
    // And the passing test alone is still a survival, so the verdict follows the *test* rather than
    // the file — narrowing is the whole point of selecting one.
    if (classify(await run(entry, "test_passes")).kind !== "survived") {
      throw new Error("filtering to the passing test did not report success");
    }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("wacTestArgs puts the filter before the entry, and omits it when there is none", () => {
  const withFilter = wacTestArgs("a/b_test.wac", "test_x");
  if (withFilter.join(" ") !== "test --filter test_x a/b_test.wac") {
    throw new Error(`built ${JSON.stringify(withFilter)}`);
  }
  const without = wacTestArgs("a/b_test.wac");
  if (without.join(" ") !== "test a/b_test.wac") throw new Error(`built ${JSON.stringify(without)}`);
});

// ── `isWacRun`, the rule `issues/system/0161` step 2 widened ────────────────────────────────────
//
// A pure predicate over two sets, so it is tested here rather than by a 27-minute sweep. What it
// decides is which runner scores a mutant, and the failure it must not have is a false *survival*.

Deno.test("a scope whose packages hold no TypeScript test runs natively, as it always did", () => {
  const pkgs = new Set(["gzip"]);
  if (!isWacRun(["packages/gzip/test/wac"], pkgs, new Set())) {
    throw new Error("the package rule stopped working");
  }
});

Deno.test("wacc's wac directory qualifies by directory though its package does not", () => {
  // The case this was written for. `packages/wacc/test` holds three `.test.ts`, so the package is
  // not hostless and every one of the ninety wac files below it went to Deno.
  const pkgs = new Set<string>();
  const dirs = new Set(["packages/wacc/test/wac"]);
  if (isWacRun(["packages/wacc/test/wac"], pkgs, new Set())) {
    throw new Error("a directory with no proof ran natively");
  }
  if (!isWacRun(["packages/wacc/test/wac"], pkgs, dirs)) {
    throw new Error("a directory the profile proved runnable did not run natively");
  }
});

Deno.test("one unproven directory in the set sends the whole run to Deno", () => {
  // All-or-nothing on purpose: `testCommand` returns one command. A mixed set needs two and their
  // results merged, which is the half still to do — and until it exists, the safe answer for a
  // mixed set is the slow one. Getting this wrong is how a wac test silently does not run.
  const dirs = new Set(["packages/wacc/test/wac"]);
  if (isWacRun(["packages/wacc/test/wac", "packages/platform/test"], new Set(), dirs)) {
    throw new Error("a mixed set ran natively, so the TypeScript half would not have run");
  }
});

Deno.test("an empty scope is not a native run", () => {
  if (isWacRun([], new Set(["gzip"]), new Set(["packages/gzip/test/wac"]))) {
    throw new Error("`wac test` with no directories has nothing to select from");
  }
});

// ── `splitHalves`, which decides whether `mergeRuns` is ever handed two things ────

// The split had no test until 2026-09-01 while the merge below it had a decision table, which is
// the wrong way round: `mergeRuns` cannot be wrong about a mixed scope it is never given.

Deno.test("a uniform wac scope is one run, not two", () => {
  const pkgs = new Set(["gzip"]);
  const got = splitHalves(["packages/gzip/test/wac", "packages/gzip/test/wac/inner"], pkgs, new Set());
  if (got.length !== 1) throw new Error(`split a scope that needs no splitting: ${JSON.stringify(got)}`);
});

Deno.test("a uniform Deno scope is one run, not two", () => {
  const got = splitHalves(["packages/stream/test", "packages/raster/test"], new Set(), new Set());
  if (got.length !== 1) throw new Error(`split a Deno-only scope: ${JSON.stringify(got)}`);
});

Deno.test("a mixed scope splits, wac half first", () => {
  // The order matters only for reading a log, but a test that does not pin it lets it drift.
  const got = splitHalves(
    ["packages/stream/test", "packages/gzip/test/wac", "packages/raster/test"],
    new Set(["gzip"]),
    new Set(),
  );
  if (got.length !== 2) throw new Error(`a mixed scope must be two runs: ${JSON.stringify(got)}`);
  if (JSON.stringify(got[0]) !== JSON.stringify(["packages/gzip/test/wac"])) {
    throw new Error(`wac half wrong: ${JSON.stringify(got[0])}`);
  }
  if (JSON.stringify(got[1]) !== JSON.stringify(["packages/stream/test", "packages/raster/test"])) {
    throw new Error(`Deno half wrong, or lost order: ${JSON.stringify(got[1])}`);
  }
});

Deno.test("the single-run path is handed the original list", () => {
  // Not the non-empty half, which is an equal list built by a filter. The caller passed `runDirs`
  // before there was a split and must keep passing it, or a future filter changes the argument.
  const dirs = ["packages/gzip/test/wac"];
  const got = splitHalves(dirs, new Set(["gzip"]), new Set());
  if (got[0] !== dirs) throw new Error("the uniform case must return the caller's own array");
});

Deno.test("an empty scope stays one run", () => {
  // `isWacRun([])` is false, so both halves are empty and it goes to Deno and finds nothing —
  // which is what it did before the split existed.
  const got = splitHalves([], new Set(["gzip"]), new Set());
  if (got.length !== 1 || got[0].length !== 0) {
    throw new Error(`an empty scope became ${JSON.stringify(got)}`);
  }
});

// ── `mergeRuns`, for the mixed scopes step 3 creates ────────────────────────────────────────────

Deno.test("a kill in either half is a kill", () => {
  for (const parts of [
    [{ kind: "killed" }, { kind: "survived" }],
    [{ kind: "survived" }, { kind: "killed" }],
    // Even when the other half could not run: the catch happened.
    [{ kind: "killed" }, { kind: "abort", why: "nothing matched" }],
  ] as const) {
    if (mergeRuns([...parts]).kind !== "killed") throw new Error(`lost a kill in ${JSON.stringify(parts)}`);
  }
});

Deno.test("an abort beside a survival is an abort, not a survival", () => {
  // The rule that matters. The aborted half might have been the half that killed it, and reporting
  // survival here inflates the score with a mutant nothing measured.
  const got = mergeRuns([{ kind: "survived" }, { kind: "abort", why: "nothing matched the filter" }]);
  if (got.kind !== "abort") throw new Error(`survival outvoted an abort: ${got.kind}`);
});

Deno.test("`no-tests-here` defers to the half that ran", () => {
  if (mergeRuns([{ kind: "no-tests-here" }, { kind: "survived" }]).kind !== "survived") {
    throw new Error("an absence outvoted a real run");
  }
  if (mergeRuns([{ kind: "no-tests-here" }, { kind: "killed" }]).kind !== "killed") {
    throw new Error("an absence outvoted a kill");
  }
  if (mergeRuns([{ kind: "no-tests-here" }, { kind: "no-tests-here" }]).kind !== "no-tests-here") {
    throw new Error("two absences made a verdict");
  }
});

Deno.test("both halves surviving is the only way to survive", () => {
  if (mergeRuns([{ kind: "survived" }, { kind: "survived" }]).kind !== "survived") {
    throw new Error("two clean runs did not survive");
  }
  if (mergeRuns([]).kind !== "no-tests-here") throw new Error("nothing at all is not a verdict");
});
