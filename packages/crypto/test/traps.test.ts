// The argument guards that trap, driven one call at a time.
//
// A trap aborts the module, so a wac test cannot assert one and keep running — the same host-side shape
// `packages/ens/test/traps.test.ts` and `packages/std/test/traps.test.ts` use. The fixture is
// `test/wac/traps.wac`, which is also a coverage unit (`cov.ts`): the branch's counter is incremented
// before the trap fires, so driving these is what turns a guard from an unaccounted line into a
// measured decision. `issues/lang/0112`.
//
// **Each of these is a guard nothing else exercises.** A caller error is by definition not what the
// other tests do, so "it traps, obviously" is a claim rather than a check: delete any one of these
// guards and every other test in this package still passes. What they cost when they are wrong is not
// small — `p256Ecdh` with a zero scalar computes a shared secret with the point at infinity, and
// `fpMul` across two widths reads one operand past its end.

import { wacBind } from "../../../harness/wacBind.ts";

const m = await wacBind("packages/crypto/test/wac/traps.wac") as Record<string, () => number>;

function assertTraps(name: string): void {
  try {
    m[name]();
  } catch (e) {
    if (
      !(e instanceof WebAssembly.RuntimeError) &&
      !/unreachable|out of bounds/i.test((e as Error).message)
    ) {
      throw new Error(`${name} threw something unexpected: ${(e as Error).message}`);
    }
    return;
  }
  throw new Error(`${name} returned instead of trapping`);
}

Deno.test("a field element that is not 4n bytes, or 4n of the wrong n, is refused", () => {
  // Two different guards on one function, and the second is the one that matters: 40 bytes *is* a
  // multiple of four, so it passes the first check and is a width this field does not have.
  assertTraps("fieldFromRaggedBytes");
  assertTraps("fieldFromWrongWidth");
});

Deno.test("two field elements of different widths are not multiplicands", () => {
  // Without the guard the loop reads the shorter operand past its end, which is a wrong answer rather
  // than a crash: the limbs it finds there are whatever the allocator last left.
  assertTraps("mulAcrossWidths");
});

Deno.test("a private scalar the curve cannot hold is refused, both ways", () => {
  // Short, and zero. Zero is the one an attacker sends: a scalar of zero multiplies the peer's point
  // to infinity, and a shared secret derived from infinity is the same for every peer.
  assertTraps("ecdhShortScalar");
  assertTraps("ecdhZeroScalar");
});

Deno.test("a resumed counter stream needs a whole block and a whole counter", () => {
  // The position of a stream is a counter *and* the spent part of the current keystream block. A
  // short counter would be zero-extended into a different block, and the stream would silently
  // resume somewhere else — reusing keystream, which is the one thing CTR must never do.
  assertTraps("resumeWithShortCounter");
});
