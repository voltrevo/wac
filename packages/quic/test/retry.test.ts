// Retry and version negotiation: the two long headers that are not packets in the ordinary sense.
//
// Neither carries a packet number, neither is protected by a key either side derived, and both are
// things a client must handle to talk to a server it has not met. They are the last of
// `design/system/0007` step 2.
//
// ## The oracle is RFC 9001's own worked example
//
// §A.4 prints a Retry packet byte for byte, together with the original destination connection id the
// tag was computed over. That is a much better oracle than anything generatable here: the tag is
// AES-128-GCM under a **fixed, published** key, so a wrong implementation and a wrong test would have
// to agree with the RFC's bytes by accident.
//
// Deno's QUIC server does not send a Retry, and provoking one would be a test about configuring
// quinn. Version-negotiation packets are likewise only sent to a client asking for a version nobody
// implements, so both are hand-built here — for Retry from the RFC, and for version negotiation from
// §17.2.1's layout.
//
// ## What a Retry's tag is actually for
//
// Not authentication of a peer: the key is public and anybody can compute the tag. What it proves is
// that whoever sent it had seen the client's **original destination connection id** — a value an
// off-path attacker guessing at a connection does not have. So it is a check against blind injection,
// and the test below that flips one byte of that id is the one that says so.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/frame_probe.wac") as unknown as {
  retryOk(packet: Uint8Array, originalDcid: Uint8Array): boolean;
  retryTokenOf(packet: Uint8Array): Uint8Array;
  isVn(b: Uint8Array): boolean;
  vnCount(b: Uint8Array): number;
  vnAt(b: Uint8Array, i: number): number;
  vnOffersV1(b: Uint8Array): boolean;
};

const hex = (s: string) =>
  Uint8Array.from(s.replace(/\s+/g, "").match(/../g)!.map((h) => parseInt(h, 16)));

/** RFC 9001 §A.4, verbatim: a Retry packet whose token is the ASCII "token". */
const RETRY = hex(
  "ff000000010008f067a5502a4262b574 6f6b656e04a265ba2eff4d829058fb3f" +
    "0f2496ba",
);
/** The client's original destination connection id, from §A.1 — what the tag is computed over. */
const ODCID = hex("8394c8f03e515708");

Deno.test("the RFC's own Retry packet verifies against the id it was made for", () => {
  assertEquals(
    mod.retryOk(RETRY, ODCID),
    true,
    "RFC 9001 §A.4's Retry does not verify — the key, the nonce, or the pseudo-packet layout " +
      "(a one-byte id length, the id, then the packet without its last sixteen bytes)",
  );
});

Deno.test("and not against any other id, which is what the tag is for", () => {
  // One byte different. An off-path attacker injecting a Retry has to guess the whole id, and this
  // is the assertion that says guessing wrong does not work.
  const wrong = Uint8Array.from(ODCID);
  wrong[0] ^= 1;
  assertEquals(mod.retryOk(RETRY, wrong), false, "a Retry must not verify under a different id");
  assertEquals(mod.retryOk(RETRY, new Uint8Array(0)), false, "nor under no id at all");
  // And a packet with a byte changed does not verify under the right id either.
  const tampered = Uint8Array.from(RETRY);
  tampered[10] ^= 0x40;
  assertEquals(mod.retryOk(tampered, ODCID), false, "nor a packet whose body was altered");
});

Deno.test("a Retry's token is the bytes between its header and its tag", () => {
  // The client echoes this in its next Initial, which is how the server learns the address answered.
  // §A.4's is the five ASCII bytes of "token", which is the RFC being playful and is also a length a
  // reader that took the tag as part of the token would get wrong by sixteen.
  assertEquals(new TextDecoder().decode(Uint8Array.from(mod.retryTokenOf(RETRY))), "token");
});

Deno.test("too short to hold a tag is refused rather than read", () => {
  assertEquals(mod.retryOk(RETRY.subarray(0, 8), ODCID), false);
  assertEquals(mod.retryOk(new Uint8Array(0), ODCID), false);
  assertEquals(mod.retryTokenOf(RETRY.subarray(0, 20)).length, 0, "and its token is nothing");
});

/**
 * A version-negotiation packet, laid out by §17.2.1: form bit set, version zero, both ids, then
 * four-byte versions to the end.
 *
 * The first byte's low seven bits are unused — a sender is told to set them at random — so this uses
 * a value that would read as a Handshake packet if anything switched on the type. That is the trap
 * the shape exists to spring.
 */
function vn(versions: number[], dcid: number[] = [1, 2, 3, 4], scid: number[] = [9, 9]): Uint8Array {
  const out = [0xea, 0, 0, 0, 0, dcid.length, ...dcid, scid.length, ...scid];
  for (const v of versions) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  return Uint8Array.from(out);
}

Deno.test("a version-negotiation packet is recognised by its version, not its type", () => {
  const p = vn([1, 0x6b3343cf]);
  assertEquals(mod.isVn(p), true, "version zero is what makes it one");
  // The RFC's own Retry is a long header with a real version, so it must not read as one.
  assertEquals(mod.isVn(RETRY), false);
  // Nor may a short header, whose first byte has the form bit clear.
  assertEquals(mod.isVn(Uint8Array.from([0x40, 0, 0, 0, 0, 0])), false);
});

Deno.test("its versions are read as a list, and a reserved one does not become the answer", () => {
  // A server may include a version it does not support, on purpose, to check that clients ignore
  // unknown ones rather than taking the first. So the reserved value goes **first** here.
  const p = vn([0x0a0a0a0a, 1]);
  assertEquals(mod.vnCount(p), 2);
  assertEquals(mod.vnAt(p, 0), 0x0a0a0a0a, "the reserved one is still reported");
  assertEquals(mod.vnAt(p, 1), 1);
  assertEquals(mod.vnOffersV1(p), true, "and version 1 is found by looking, not by position");

  const none = vn([0x0a0a0a0a, 0xff00001d]);
  assertEquals(mod.vnOffersV1(none), false, "a list without version 1 offers nothing we speak");
});

Deno.test("a trailing byte is a malformed packet, not a version to guess at", () => {
  const p = vn([1]);
  const ragged = Uint8Array.from([...p, 0x00]);
  assertEquals(mod.vnCount(ragged), 0, "33 bits of version is not a version");
  assertEquals(mod.vnCount(vn([])), 0, "and no versions at all is malformed too");
  // An id length past the maximum is refused before it is used as an offset.
  const wild = Uint8Array.from([0xea, 0, 0, 0, 0, 21, ...new Array(21).fill(7), 0]);
  assertEquals(mod.vnCount(wild), 0);
});
