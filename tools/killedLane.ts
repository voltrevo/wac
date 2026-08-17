/**
 * Whether a lane's exit code says it was **killed** rather than that it failed, and by what.
 *
 * A lane the kernel takes for memory leaves no summary, and the output then looks exactly like a lane
 * that had no tests: another lane's `ok | 61 passed`, no `FAILED` anywhere, and a non-zero exit with
 * nothing pointing at it. `issues/system/0154` records the run — exit 137, 99 MB over the gate's
 * threshold, no verdict — and the check that had to be done by hand before any result could be
 * believed was "did both summaries appear?".
 *
 * Its own module rather than a helper inside `runTests.ts`, because that file *is* the suite: importing
 * it to test a predicate would run one.
 */
export function killedLane(code: number): string | null {
  // 128 + the signal. 9 is the out-of-memory killer on this box; 15 is a timeout or a person.
  if (code === 137) return "SIGKILL, which on this box is the out-of-memory killer";
  if (code === 143) return "SIGTERM — a timeout, or somebody stopping it";
  return null;
}

/** What to print when a lane was killed. Empty when it was not. */
export function killedLaneNote(name: string, code: number): string {
  const why = killedLane(code);
  if (why === null) return "";
  return `\n== the ${name} lane was killed (exit ${code}: ${why}) ==\n` +
    "   It printed no summary, so this run has **no verdict** for it — not a pass and not a\n" +
    "   failure. Treat any other lane's `0 failed` above as covering only that lane.\n" +
    "   `issues/system/0154` has the measurements; the usual cause is memory.\n";
}
