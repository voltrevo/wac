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
  return lines.find((l) => /^\s*error:/.test(l)) ?? "";
}
