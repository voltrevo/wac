// What ETXTBSY looks like, and how long to wait for it — in one place, because it is now recognised
// two ways.
//
// `harness/spawnRetry.ts` catches it as a thrown error: Deno's own `execve` of a binary this process
// just built. `harness/bounded.ts` reads it off a child's stderr: the target is run under `timeout`, so
// the failing `execve` is *`timeout`'s* and nothing throws. Same window, same wait, two detectors — and
// two copies of "Text file busy" plus two copies of the budget is how they drift apart.
//
// wac-mono 0074 is the measurement behind the numbers: the window is real, is not a leaked handle
// anybody can name, and is already shut by the time user space can ask who held the file. Waiting and
// trying again is the correct response to a condition that has already cleared.

/** The message both the kernel and `timeout` use for it. */
export const BUSY_TEXT = "Text file busy";

/** How many times to try, and how long between: the window measured closed in under a millisecond. */
export const ATTEMPTS = 6;
export const WAIT_MS = 10;

/** Whether a thrown error, or a child's stderr, is this condition. */
export function isBusy(what: unknown): boolean {
  return String(what).includes(BUSY_TEXT);
}

/**
 * Whether a *finished* run failed this way rather than answering.
 *
 * The exit status is checked as well as the text, because a program is perfectly entitled to print the
 * words "Text file busy" on its own stderr — `box cat` over a file called that would. 126 is the
 * shell-and-`timeout` convention for "found it and could not run it", and 127 for "did not find it";
 * both are statuses no program chose, which is the same argument `hung` makes about 124.
 */
export function ranBusy(code: number, err: string): boolean {
  return (code === 126 || code === 127) && isBusy(err);
}
