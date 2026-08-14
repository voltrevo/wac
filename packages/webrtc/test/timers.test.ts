// The retransmission timers, on a clock made of numbers.
//
// Both `Association.due` and `Peer.due` take the time as an argument, because wac has no ambient
// capabilities and nothing in this package reads a clock. The usual reading of that is a constraint;
// here it is the reason this file exists at all — **a timer tested against a real clock is a slow
// test and a flaky one**, and every case below runs in microseconds because the clock is `1`, `2`,
// `1000`.
//
// The tests in `dtlsserver.test.ts` and `browser.test.ts` prove that a *lost* thing is recovered, by
// throwing it away and watching a real peer receive the retransmission. What they cannot show is
// *when*: they rely on the peer's own timer firing. This shows the rule.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const sctp = await wacBind("packages/webrtc/test/wac/sctp_probe.wac") as unknown as {
  newAssociation(ourTag: number, initialTsn: number, window: number): unknown;
  associationReceive(a: unknown, pkt: Uint8Array, cookie: Uint8Array): Uint8Array[];
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array, now: bigint): Uint8Array;
  associationDue(a: unknown, now: bigint, rto: bigint): Uint8Array[];
  associationInFlight(a: unknown): number;
  associationAccept(a: unknown, tsn: number): boolean;
  associationCumulative(a: unknown): number;
  initPacket(initiateTag: number, window: number, outbound: number, inbound: number, tsn: number): Uint8Array;
  sackPacket(tag: number, cumulativeTsn: number, window: number): Uint8Array;
  firstChunkValue(b: Uint8Array): Uint8Array;
  tsnOf(value: Uint8Array): number;
};

const enc = new TextEncoder();
const COOKIE = Uint8Array.from({ length: 8 }, (_, i) => i);

/** An association with a peer that has introduced itself, so it has a tag to answer under. */
function associated() {
  const a = sctp.newAssociation(0x77777777 | 0, 1, 65536);
  sctp.associationReceive(a, sctp.initPacket(0x1234, 65536, 16, 16, 1), COOKIE);
  return a;
}

Deno.test("a chunk is not due before its timer, and is due after", () => {
  const a = associated();
  sctp.associationSend(a, 0, 51, enc.encode("one"), 1000n);
  assertEquals(sctp.associationInFlight(a), 1, "one chunk in flight");

  assertEquals(sctp.associationDue(a, 1000n, 500n).length, 0, "not at the moment it was sent");
  assertEquals(sctp.associationDue(a, 1499n, 500n).length, 0, "nor a millisecond before the timeout");
  assertEquals(sctp.associationDue(a, 1500n, 500n).length, 1, "and due exactly at it");
});

Deno.test("and the timeout doubles per attempt, which is what stops a retry storm", () => {
  const a = associated();
  sctp.associationSend(a, 0, 51, enc.encode("one"), 0n);

  // First attempt: 500ms.
  assertEquals(sctp.associationDue(a, 499n, 500n).length, 0);
  assertEquals(sctp.associationDue(a, 500n, 500n).length, 1, "resent at 500");
  // Second: 1000ms from the resend, not another 500.
  assertEquals(sctp.associationDue(a, 999n, 500n).length, 0,
    "a fixed interval would have resent here — and a path that has lost one packet is more likely " +
      "to lose the next, so retrying at the same rate adds to the congestion that caused it");
  assertEquals(sctp.associationDue(a, 1500n, 500n).length, 1, "resent at +1000");
  // Third: 2000ms.
  assertEquals(sctp.associationDue(a, 3000n, 500n).length, 0, "not yet at +1500");
  assertEquals(sctp.associationDue(a, 3500n, 500n).length, 1, "resent at +2000");
});

Deno.test("an acknowledged chunk stops being due at all", () => {
  const a = associated();
  const pkt = sctp.associationSend(a, 0, 51, enc.encode("one"), 0n);
  const tsn = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(pkt)));

  // The peer acknowledges it, which is the only thing that takes it out of flight.
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, tsn, 65536), COOKIE);
  assertEquals(sctp.associationInFlight(a), 0, "nothing left in flight");
  assertEquals(sctp.associationDue(a, 100_000n, 500n).length, 0,
    "and nothing becomes due however long is waited — a timer that fired for acknowledged data " +
      "would resend it forever");
});

Deno.test("a cumulative acknowledgement covers everything below it", () => {
  const a = associated();
  sctp.associationSend(a, 0, 51, enc.encode("one"), 0n);
  sctp.associationSend(a, 0, 51, enc.encode("two"), 0n);
  const third = sctp.associationSend(a, 0, 51, enc.encode("three"), 0n);
  assertEquals(sctp.associationInFlight(a), 3);

  const tsn = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(third)));
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, tsn, 65536), COOKIE);
  assertEquals(sctp.associationInFlight(a), 0,
    "one SACK for the last TSN clears all three, because cumulative means everything up to it");
});

Deno.test("the cumulative point only advances in order, which is what makes a peer resend", () => {
  // The bug this pins: taking the *highest* TSN seen rather than the highest *in order* tells the
  // peer that a chunk we never received has been delivered. It then never resends it, and the
  // message it belonged to is never completed — intermittently, since it needs a reorder to show.
  const a = associated();
  assertEquals(sctp.associationCumulative(a), -1, "nothing received yet");
  assertEquals(sctp.associationAccept(a, 5), true, "the first chunk sets the point wherever it is");
  assertEquals(sctp.associationCumulative(a), 5);
  assertEquals(sctp.associationAccept(a, 6), true, "the successor advances it");
  assertEquals(sctp.associationAccept(a, 8), false, "a gap does not");
  assertEquals(sctp.associationCumulative(a), 6,
    "so the peer is told 6, resends 7, and 8 comes again after it");
  assertEquals(sctp.associationAccept(a, 7), true);
  assertEquals(sctp.associationAccept(a, 8), true, "and then 8 is next");
  assertEquals(sctp.associationCumulative(a), 8);
});

Deno.test("a DTLS flight is due on the same rule, and stops when the handshake is done", async () => {
  const peer = await wacBind("packages/webrtc/test/wac/peer_probe.wac") as unknown as {
    newPeer(certDer: Uint8Array, signingKey: Uint8Array, nonce: Uint8Array, scalar: Uint8Array,
      random: Uint8Array, cookie: Uint8Array): unknown;
    peerDue(p: unknown, now: bigint, rto: bigint): Uint8Array[];
    peerSentAt(p: unknown, now: bigint): void;
    peerFlightSize(p: unknown): number;
  };
  const p = peer.newPeer(Uint8Array.from([0x30, 0x01, 0x02]), new Uint8Array(32).fill(3),
    new Uint8Array(32).fill(7), new Uint8Array(32).fill(9), new Uint8Array(32).fill(1),
    Uint8Array.from([1, 2, 3, 4]));

  // **Nothing is due before there is a flight**, which is the state a server is in for as long as
  // nobody has talked to it — and a timer that fired then would send a handshake to nobody.
  assertEquals(peer.peerFlightSize(p), 0);
  assertEquals(peer.peerDue(p, 100_000n, 1000n).length, 0, "no flight, nothing to resend");
});
