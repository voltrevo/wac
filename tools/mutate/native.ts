// Running a wac test through `wac`, for the mutation runner.
//
// `issues/system/0161` step 2. Once the `.test.ts` wrappers are deleted (step 3) there is no Deno
// path to those tests at all, so `mutate` has to be able to run them itself. This is the piece that
// issue names as "the one to write": `tools/mutate.ts`'s `testCommand` returns a single
// `Deno.Command` built for `deno test`, and a native run needs its own.
//
// **Pure, and in `tools/mutate/` rather than in `mutate.ts`.** That module builds its dependency map
// with a top-level `await`, so importing it to check one function runs the whole tool — which is why
// `testDirs` moved to `types.ts` when `issues/system/0139` wanted it tested. Same reason here.
//
// ## The exit codes, which are the whole point
//
// A mutation runner reads an exit code as a verdict, so conflating two of them corrupts a score
// silently. `wac test` distinguishes them and this is where that contract is written down:
//
//   0  the selected tests ran and passed        -> the mutant SURVIVED
//   3  the selected tests ran and one failed    -> the mutant was KILLED
//   1  nothing matched the filter, or a file did not run  -> ABORT, score nothing
//   4  every test in the file needs a host oracle this cannot supply  -> nothing ran here
//
// **1 is the dangerous one and it is dangerous in the unobvious direction.** A filter that matches
// nothing is a *tooling* failure — the name was misspelled, or the profile and the runner disagree
// about which spelling a test has. It exits non-zero, so a runner that treats "non-zero means
// killed" records a kill for a mutant nothing ran, and the mutation score goes *up*. The Deno path
// has the mirror-image hazard: `deno test --filter nonsense` exits **0** with "0 filtered out", and
// the same mutant is recorded as having survived. Both are wrong and neither is visible in a score,
// which is why `classify` returns a verdict rather than a boolean.
//
// `--filter` matches by **substring**, as Deno's plain filter does. That over-selects — `test_remove`
// also matches `test_remove_keeps_probe_runs_contiguous` — and over-selection is the safe direction:
// running extra tests can only make a mutant more likely to be killed, never less. It costs time,
// not correctness.

/** Where the unified binary lives once `cargo build --release` has run. */
export const WAC_BIN = "native/v8/target/release/wac";

/**
 * The argv for running some or all of a wac test file's tests.
 *
 * @param entry    the `.wac` test file, or a directory of them
 * @param filter   a native export name, e.g. `test_basics`; omit to run everything in `entry`
 */
export function wacTestArgs(entry: string, filter?: string): string[] {
  return filter === undefined
    ? ["test", entry]
    : ["test", "--filter", filter, entry];
}

/** What an exit code from `wac test` means to a mutation run. */
export type NativeVerdict =
  | { kind: "survived" }
  | { kind: "killed" }
  | { kind: "no-tests-here" }
  /** Nothing ran, and that is a fault in the run rather than a fact about the mutant. */
  | { kind: "abort"; why: string };

export function classify(code: number): NativeVerdict {
  switch (code) {
    case 0:
      return { kind: "survived" };
    case 3:
      return { kind: "killed" };
    case 4:
      return { kind: "no-tests-here" };
    case 1:
      return {
        kind: "abort",
        why: "nothing matched the filter, or a file did not run — the selected test could not be " +
          "run at all, so this mutant has no verdict. Scoring it either way is a made-up number.",
      };
    default:
      return { kind: "abort", why: `unexpected exit ${code} from \`wac test\`` };
  }
}

/**
 * Whether these directories are run by the binary rather than by Deno.
 *
 * Two ways to qualify, and the second is the one `issues/system/0161` step 2 needed.
 *
 * **By package**, which is the original rule: every directory belongs to a package holding no
 * `.test.ts` at all. Kept exactly as it was so nothing that ran natively stops doing so.
 *
 * **By directory**, which is new: every directory is one the profile proved runnable — no
 * TypeScript test in it, and every wac entry inside profiled by `wac test --coverage` with nothing
 * skipped. The package question disqualifies `packages/wacc/test/wac`, ninety wac files and no
 * TypeScript, on the strength of three `.test.ts` a level above it that the runner is never handed.
 *
 * The directory rule needs the profile's evidence and not just the absent `.test.ts`, because a
 * directory can hold a wac test that wants a host oracle. The binary skips such a test, the others
 * pass, the run exits 0, and the mutant is recorded **survived** by a suite that never ran the test
 * that would have killed it. False survivals are the one direction that cannot be spot-checked, and
 * `wacShare` already refuses a partial profile — this reads the refusal it was making anyway.
 *
 * An empty list is not a native run: `wac test` with no directories has nothing to select from.
 */
export function isWacRun(
  dirs: string[],
  hostlessPackages: ReadonlySet<string>,
  nativeRunnableDirs: ReadonlySet<string>,
): boolean {
  if (dirs.length === 0) return false;
  if (dirs.every((d) => hostlessPackages.has(d.split("/")[1] ?? ""))) return true;
  return dirs.every((d) => nativeRunnableDirs.has(d));
}

/**
 * The scope split into the halves `mergeRuns` merges — *"split here, merge below"*.
 *
 * A mixed scope is **two runs, not one**: `testCommand` returns a single command, so a set holding
 * both a directory the binary runs and one Deno runs would go to Deno entire. That is correct only
 * while the wrappers exist; after step 3 of `issues/system/0161` deletes them the wac half cannot
 * run under Deno at all, so it silently does not run and the mutant reads as **survived**.
 *
 * **One half, not two, when the scope is uniform**, and the whole `runDirs` is returned rather than
 * the half that happens to be non-empty. They are the same list, and returning the original keeps
 * the caller's single-run path taking exactly the argument it took before there was a split.
 *
 * Extracted from `mutate.ts` on 2026-09-01 so that it can be tested: the merge rule beside it had a
 * decision table under test and the split feeding it had none, which is the half of a mixed scope
 * that decides whether `mergeRuns` is ever handed two things. An empty scope stays one run and is
 * `isWacRun`'s "an empty list is not a native run" — it goes to Deno and finds nothing, which is
 * what it did before.
 */
export function splitHalves(
  runDirs: string[],
  hostlessPackages: ReadonlySet<string>,
  nativeRunnableDirs: ReadonlySet<string>,
): string[][] {
  const wac = runDirs.filter((d) => isWacRun([d], hostlessPackages, nativeRunnableDirs));
  const deno = runDirs.filter((d) => !isWacRun([d], hostlessPackages, nativeRunnableDirs));
  return wac.length > 0 && deno.length > 0 ? [wac, deno] : [runDirs];
}

/**
 * One verdict from the halves of a **mixed** scope — some directories run by the binary, the rest by
 * Deno.
 *
 * Needed by step 3 of `issues/system/0161` rather than by anything today: while the wrappers exist a
 * mixed set can go to Deno entire and the wac tests in it still run, through their wrappers. Delete
 * the wrappers and that stops being true — the wac half cannot run under Deno at all, so it silently
 * does not run, and a mutant nothing ran is recorded as **survived**.
 *
 * The order of the rules is the whole content:
 *
 * - **`killed` wins outright.** A half that caught the mutant caught it; that the other half could
 *   not run does not make the catch less true.
 * - **`abort` beats `survived`.** A half that could not run might have been the half that killed it,
 *   so "everything I managed to run passed" is not a statement that the mutant survived. This is the
 *   direction that matters: scoring it either way is a made-up number, and the made-up number here
 *   flatters the suite.
 * - **`no-tests-here` is an absence, not a verdict**, and defers to whatever the other half saw. Two
 *   absences are still an absence.
 */
export function mergeRuns(parts: NativeVerdict[]): NativeVerdict {
  if (parts.length === 0) return { kind: "no-tests-here" };
  const killed = parts.find((v) => v.kind === "killed");
  if (killed !== undefined) return killed;
  const aborted = parts.find((v) => v.kind === "abort");
  if (aborted !== undefined) return aborted;
  const survived = parts.find((v) => v.kind === "survived");
  if (survived !== undefined) return survived;
  return { kind: "no-tests-here" };
}
