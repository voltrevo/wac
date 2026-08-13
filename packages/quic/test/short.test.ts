// Sealing a short header and opening it again — the deterministic half of `stream.test.ts`.
//
// That test puts a 1-RTT packet on the wire and a real QUIC server reads it, which is the right
// oracle and is **not reliable for one particular bug**. A short header's first byte is protected
// across its low five bits and a long header's across its low four. Seal with four and the key phase
// is left unmasked, so the reader recovers it as `mask[0] & 0x10` — zero half the time. Measured
// against the real server: the four-bit spelling passed **5 of 8 runs**.
//
// A test that catches a bug half the time is worse than one that never does, because it reads as
// flakiness in the network rather than as a mistake in the mask. So the same question is asked here
// sixteen times over payloads that differ, which makes the mask differ: one-in-two becomes
// one-in-65,536, and no network is involved.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/short_probe.wac") as unknown as {
  roundTrips(n: number): number;
  phasesZero(n: number): number;
  wrongIdLengthOpens(): number;
  paddedLength(padTo: number): number;
  paddedOpens(padTo: number): number;
  ackRoundTripLargest(largest: number, firstRange: number): number;
  ackRoundTripSize(largest: number, firstRange: number): number;
  ackRefuses(largest: number, firstRange: number): boolean;
  numberRoundTrip(n: number): number;
};

const N = 16;

Deno.test("every short-header packet we seal opens again to what went into it", () => {
  // All sixteen, not most. A partial pass is the signature of a header-protection disagreement:
  // whichever bit the two sides differ about lands in the associated data, and the tag is over the
  // associated data, so the failures are the samples where that bit happened to be set.
  assertEquals(
    mod.roundTrips(N),
    N,
    "a header-protection mask that disagrees with itself fails on the samples where the differing " +
      "bit is set — a count below 16 says which, and 5-of-8 is the four-bit spelling",
  );
});

Deno.test("and reports the key phase that was written, rather than a bit of the mask", () => {
  assertEquals(mod.phasesZero(N), N, "the phase is written as 0 and must read back as 0");
});

Deno.test("a packet read with the wrong id length does not open", () => {
  // The one field a short header does not carry. Getting it wrong shifts the packet number *and* the
  // sample, and there is nothing in the packet that could tell a reader so.
  assertEquals(mod.wrongIdLengthOpens(), 0);
});

Deno.test("padding reaches the length asked for, and does not disturb the frames", () => {
  // A short header has no length field, so padding is the only way to make a packet a given size —
  // which a client needs for path validation, where the datagram size is the thing being tested.
  assertEquals(mod.paddedLength(1200), 1200, "the packet is exactly the size asked for");
  assertEquals(mod.paddedLength(0) < 1200, true, "and unpadded it is as short as its frames");
  // The payload comes back longer than it went in, because PADDING is zero bytes and they are part
  // of the payload: the frames are there, followed by padding frames. What must not happen is the
  // frames being disturbed, which the round trip is what checks.
  assertEquals(mod.paddedOpens(1200) > 24, true, "and it still opens, with the padding inside it");
});

Deno.test("an ACK we write is one we read, and the two agree about its length", () => {
  // `next` already reads every ACK range, against real packets from quinn. What was never checked is
  // the other direction, and a writer whose length disagreed with the reader's would derail every
  // frame packed after it — silently, since a lone ACK in a packet has nothing after it to derail.
  for (const [largest, first] of [[0, 0], [1, 1], [5, 2], [63, 63], [64, 0], [16383, 100], [16384, 1]]) {
    assertEquals(mod.ackRoundTripLargest(largest, first), largest, `largest ${largest}`);
    assertEquals(
      mod.ackRoundTripSize(largest, first) > 0,
      true,
      `the writer and the reader disagree about the size of an ACK for ${largest}/${first}`,
    );
  }
  // The boundaries are where a varint changes width: 63 to 64 is one byte to two, 16383 to 16384 is
  // two to four. A length computed as "one byte per field" passes the small cases and nothing else.
  assertEquals(mod.ackRoundTripSize(0, 0), 5, "the type byte and four one-byte varints");
  assertEquals(mod.ackRoundTripSize(16384, 1), 8, "a four-byte largest makes it three longer");
});

Deno.test("and it refuses to claim a range it cannot have received", () => {
  // A first-range larger than the largest acknowledged describes packets before zero. Worse than
  // malformed: a peer that believes a lost packet arrived will never resend it, so the failure mode
  // of a too-generous ACK is silent data loss rather than a rejected frame.
  assertEquals(mod.ackRefuses(3, 4), true, "a range reaching below packet zero");
  assertEquals(mod.ackRefuses(-1, 0), true, "and a negative largest");
  assertEquals(mod.ackRefuses(3, 3), false, "acknowledging everything from zero is legal");
});

Deno.test("a packet number survives being written and read back", () => {
  // The number is under header protection and is what an acknowledgement is about, so a reader that
  // recovered it wrong would acknowledge packets the peer never sent.
  for (const n of [0, 1, 127, 128, 255, 256, 65535, 65536, 1 << 20]) {
    assertEquals(mod.numberRoundTrip(n), n, `packet number ${n}`);
  }
});
