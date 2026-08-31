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
