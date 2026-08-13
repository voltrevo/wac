// **A packet that fails authentication must be discarded, not kill the connection.**
//
// `initial.wac` says so about its own readers, in the paragraph above `openClientInitial`: "Empty on
// any failure — a header that will not parse, a sample that runs off the end, a tag that does not
// verify." Two of those three are true. The third traps.
//
// The path is `openClientInitial` → `unprotect` → `gcmDecrypt`, and `gcmDecrypt` traps on a bad tag
// **by design**: its own comment says trapping rather than returning a status is deliberate, because
// wac cannot express a result the caller is forced to inspect and an AEAD whose failure can be ignored
// is the classic misuse. That is a good rule for a primitive. It is the wrong answer for QUIC, and RFC
// 9001 §9 says which: an endpoint that receives a packet it cannot authenticate discards it and
// carries on. It has to — the packet is not evidence of anything, since anyone who can reach the
// four-tuple can send one, and a connection that dies on an unauthenticated datagram can be killed by
// any passer-by.
//
// So the primitive keeps its trap and `unprotect` stops relying on it: check the tag, then decrypt.
//
// Why this was never noticed: every other test in this package feeds the reader packets that are
// *right* — from quinn, or from our own sealer — so the failure path had never been driven once. The
// case that found it was written to check something else entirely, and reached this by passing a
// connection id of the wrong length.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const probe = await wacBind("packages/quic/test/wac/tamper_probe.wac") as unknown as {
  intactOpens(): number;
  damagedOpens(): number;
  tagDamagedOpens(): number;
  wrongConnectionOpens(): number;
};

Deno.test("the control: an undamaged packet still opens", () => {
  // Without this, a reader that refused *everything* would pass every case below.
  assertEquals(probe.intactOpens() > 0, true, "a packet we sealed ourselves must open");
});

Deno.test("a flipped ciphertext byte is refused, not trapped", () => {
  assertEquals(probe.damagedOpens(), 0);
});

Deno.test("a flipped tag byte is refused, not trapped", () => {
  assertEquals(probe.tagDamagedOpens(), 0);
});

Deno.test("a packet for another connection is refused, not trapped", () => {
  // The connection id is associated data, so this is a bad tag reached through a header that parses
  // perfectly — which is what an injected packet from a stranger looks like.
  assertEquals(probe.wrongConnectionOpens(), 0);
});
