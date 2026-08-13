// How long a mutant may run before it is called hung.
//
// In a module of its own so a test can import it: `tools/mutate.ts` runs the whole tool at import,
// which is why `known.ts`, `sample.ts`, `why.ts` and this are shaped this way.

/**
 * The multiplier is generous on purpose. A mutant is either detected — usually in the first failing
 * test, with `--fail-fast` — or it runs to completion in about baseline time. Ten times baseline is
 * not "a bit slow", it is hung.
 */
export const TIMEOUT_MULTIPLIER = 10;
export const TIMEOUT_FLOOR_MS = 30_000;
export const TIMEOUT_CAP_MS = 600_000;

/**
 * The deadline for a mutant whose scope took `baseline` ms unmutated.
 *
 * **The cap must never fall below the baseline**, and it could: `min(600s, baseline × 10)` is less
 * than the baseline itself once a scope takes more than a minute, and a deadline below the baseline
 * cannot tell a hung mutant from an undetected one. An undetected mutant runs to completion in about
 * baseline time — so it would be timed out and recorded as *killed*, which is the false kill the
 * multiplier's own comment exists to prevent.
 *
 * Seen for real on 2026-08-13, and by making the tool *more* honest: adding `--unstable-net` let the
 * net tests actually run instead of failing fast, the slowest scope's baseline went to **673s**, and
 * the run printed `deadline: 10x each scope's own baseline (slowest 673.1s -> 600s)` — a deadline
 * 73 seconds shorter than doing nothing at all.
 *
 * So the cap yields to twice the baseline when the two disagree. Twice rather than ten times because
 * the cap is there for a reason — a genuinely hung mutant should not hold a slot for two hours — and
 * twice baseline is still unambiguously "hung" for work that either fails fast or finishes in
 * baseline time.
 */
export function deadlineFor(baseline: number): number {
  const want = Math.max(TIMEOUT_FLOOR_MS, baseline * TIMEOUT_MULTIPLIER);
  return Math.max(Math.min(TIMEOUT_CAP_MS, want), baseline * 2);
}
