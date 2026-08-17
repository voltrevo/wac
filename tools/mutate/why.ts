// Why a test run failed, out of its transcript.
//
// One function, in a module of its own so a test can import it. `tools/mutate.ts` is a script: it
// runs the whole tool at import, so anything a test needs to reach has to live beside it rather than
// in it — which is why `known.ts`, `sample.ts` and the rest are shaped this way.

/**
 * The line that says why a run failed, out of a `deno test` transcript.
 *
 * **A test's *name* is not a failure.** This was `find(l => l.includes("FAILED") || l.includes("error"))`
 * and it reported `a new image is an empty world, not an error ... ok` — a *passing* test whose name
 * contains the word. The scope that was red was 23 packages; the line printed pointed at one of them
 * more or less at random, and following it cost an hour.
 *
 * So: a line Deno itself begins with `error:`, or a test line whose verdict is FAILED — and a test
 * line reporting `ok` is never either, however it is named. ANSI is stripped first because every one
 * of these arrives coloured.
 */
export function firstFailureLine(out: string): string {
  const lines = out.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  const verdict = lines.find((l) => /\bFAILED\b/.test(l) && !/\.\.\.\s+ok\b/.test(l));
  if (verdict !== undefined) return verdict;
  const denoError = lines.find((l) => /^\s*error:/.test(l));
  if (denoError !== undefined) return denoError;
  // **A `wac test` transcript says it differently**, and a scope whose tests are wac files now reaches
  // here: `FAIL <name> — <why>` per test, and a summary counting the files that did not run. Without
  // these the caller printed `BASELINE RED: … —` with nothing after the dash, which is the same silence
  // this function exists to end. `issues/system/0183`.
  const wacFail = lines.find((l) => /^FAIL\s/.test(l));
  if (wacFail !== undefined) return wacFail;
  const wacSummary = lines.find((l) => /^\d+ files?:.*(with failures|did not run)/.test(l));
  if (wacSummary !== undefined) return wacSummary;
  // Last resort: the final non-empty line. A reason nobody can read is worse than a line that might be
  // the wrong one — the caller quotes it as *why*, and an empty quote sent me looking for a fault in the
  // suite when the run had simply said something this function did not recognise.
  const tail = lines.filter((l) => l.trim() !== "");
  return tail.length > 0 ? tail[tail.length - 1] : "";
}
