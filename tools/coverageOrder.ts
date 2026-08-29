// What order `tools/coverageAll.ts` dispatches its drivers in, on its own so it can be tested.
//
// **The tail is the whole wall time, and alphabetical order put the tail last.** A run's best
// possible wall is `max(longest driver, work / workers)`; measured on 2026-08-29, back to back:
//
//     alphabetical    696s of work, longest 94s  ->  ideal 174s, actual 204s   (17% over)
//     longest-first   471s of work, longest 89s  ->  ideal 118s, actual 119s   ( 1% over)
//
// Compare the two ratios and not the two walls. The second run had a third less work in it — these
// share a machine with two other agents and with each other's warm caches — so 204s against 119s
// flatters this considerably. What the change bought is the distance from each run's own bound, and
// that went from 30s to 1s.
//
// **Split out of `coverageAll.ts` because that file cannot be imported without running.** It spawns
// thirty-seven drivers at the top level, so a test of the ordering would have to be a two-minute
// sweep — which is why the ordering shipped with only a hand check behind it. Nine lines in their own
// module are testable in milliseconds, and `tools/coverageOrder.test.ts` is that test.

/**
 * The packages to run, longest-first, from the previous run's measurements.
 *
 * `packages` arrives alphabetical and is left that way by the caller: it is what the report is sorted
 * back into, and a reader scanning for a red should not have the rows move because a machine was busy.
 *
 * **A package with no recorded time goes first**, which is the safe end. An unknown is usually a new
 * package and short, so putting it first costs nothing; putting it last risks re-creating the exact
 * problem this fixes, for a package nobody has timed yet. With no file at all every package is
 * unknown, they all compare equal, and the result is the alphabetical order that arrived — which is
 * what a fresh checkout did before any of this existed.
 *
 * `Number.MAX_SAFE_INTEGER` rather than `Infinity` for the unknowns, because `Infinity - Infinity` is
 * `NaN` and a comparator that returns `NaN` has no defined answer.
 */
const UNTIMED = Number.MAX_SAFE_INTEGER;

export function dispatchOrder(
  packages: readonly string[],
  lastTimes: Record<string, number>,
): string[] {
  return [...packages].sort((a, b) => (lastTimes[b] ?? UNTIMED) - (lastTimes[a] ?? UNTIMED));
}
