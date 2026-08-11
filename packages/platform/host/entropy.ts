// `Core.randomBytes`, for every host that has Web Crypto — which is all three of them.
//
// One function rather than three, because the three had already drifted. Node filled in 64 KiB
// chunks with a comment saying why; Deno and the browser each called `getRandomValues` once with
// whatever was asked for, and Web Crypto throws above 65,536 bytes a call. So `randomBytes(65537)`
// — inside the range the capability documents and every host's own bounds check accepts — was a
// megabyte of entropy on Node and an exception on the other two (issue 0122).
//
// The bounds check lives here too, for the same reason: it was the same two lines in three files,
// and the range it enforces is the capability's rather than any one host's.

/** Web Crypto's per-call ceiling, fixed by the specification rather than by an engine. */
const PER_CALL = 65536;

/** The most `Core.randomBytes` will answer, stated in `platform.wac` beside the capability. */
export const MOST = 1 << 20;

/**
 * `n` cryptographically secure bytes, in as many calls as the platform's cap requires.
 *
 * Throws on a size outside the documented range rather than clamping: a caller that asked for two
 * megabytes of key material and silently got one would be the worse failure by far.
 */
export function randomBytes(n: number): Uint8Array {
  if (n < 0 || n > MOST) throw new Error(`randomBytes(${n}) out of range`);
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += PER_CALL) {
    crypto.getRandomValues(out.subarray(at, Math.min(at + PER_CALL, n)));
  }
  return out;
}
