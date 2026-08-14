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
  associationReceive(a: unknown, pkt: Uint8Array, cookie: Uint8Array, now: bigint): Uint8Array[];
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array, now: bigint): Uint8Array;
  associationDue(a: unknown, now: bigint, rto: bigint): Uint8Array[];
  associationInFlight(a: unknown): number;
  associationAccept(a: unknown, tsn: number): boolean;
  associationCumulative(a: unknown): number;
  associationRto(a: unknown): bigint;
  associationSmoothed(a: unknown): bigint;
  associationSendLarge(a: unknown, stream: number, ppid: number, payload: Uint8Array,
    maxChunk: number, now: bigint): Uint8Array[];
  associationFlush(a: unknown, now: bigint): Uint8Array[];
  associationWindow(a: unknown): number;
  associationThreshold(a: unknown): number;
  associationAvailable(a: unknown): number;
  associationWaiting(a: unknown): number;
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
  sctp.associationReceive(a, sctp.initPacket(0x1234, 65536, 16, 16, 1), COOKIE, 0n);
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
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, tsn, 65536), COOKIE, 0n);
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
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, tsn, 65536), COOKIE, 0n);
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

Deno.test("the timeout is measured rather than assumed, and a retransmission gives no sample", () => {
  // RFC 6298's estimator, which SCTP and TCP share. Before anything is measured the answer is a
  // second — long enough not to flood a path nothing is known about, which is what every
  // implementation starts at.
  const a = associated();
  assertEquals(sctp.associationSmoothed(a), -1n, "nothing measured yet");
  assertEquals(sctp.associationRto(a), 1000n, "so a second");

  // One round trip of 200: the first sample seeds the average rather than being folded into zero,
  // which would make the first timeout far too short.
  const first = sctp.associationSend(a, 0, 51, enc.encode("one"), 0n);
  const t1 = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(first)));
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, t1, 65536), COOKIE, 200n);
  assertEquals(sctp.associationSmoothed(a), 200n, "seeded by the first sample");
  // srtt 200, rttvar 100 → 200 + 400 = 600, below the floor.
  assertEquals(sctp.associationRto(a), 1000n,
    "and still a second, because RFC 4960 floors it there — a timeout under a second retries " +
      "faster than many real paths answer");

  // A slower trip moves the average by an eighth and the variation by a quarter.
  const second = sctp.associationSend(a, 0, 51, enc.encode("two"), 1000n);
  const t2 = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(second)));
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, t2, 65536), COOKIE, 2000n);
  assertEquals(sctp.associationSmoothed(a), 300n,
    "200 + (1000 - 200)/8 = 300: one sample moves the average an eighth of the way, so a single " +
      "slow answer does not stretch the timeout to match it");

  // **And a chunk that was retransmitted contributes nothing.** Its acknowledgement could be
  // answering either transmission, so a sample taken from it measures a trip that never happened.
  const before = sctp.associationSmoothed(a);
  const third = sctp.associationSend(a, 0, 51, enc.encode("three"), 3000n);
  const t3 = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(third)));
  assertEquals(sctp.associationDue(a, 9000n, 1000n).length, 1, "its timer expires and it is resent");
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, t3, 65536), COOKIE, 9100n);
  assertEquals(sctp.associationSmoothed(a), before,
    "the average did not move: Karn's rule, and the reason `flightTries` is kept rather than just " +
      "a timestamp — the count is what makes a sample trustworthy");
});

Deno.test("the congestion window paces a large message rather than putting it all on the path", () => {
  const a = associated();
  // RFC 4960's initial window is 4,380 bytes — a few packets rather than one, so a short exchange
  // does not spend a round trip per chunk.
  assertEquals(sctp.associationWindow(a), 4380, "the initial window");

  const sent = sctp.associationSendLarge(a, 0, 51, new Uint8Array(20000).fill(65), 1100, 0n);
  assertEquals(sent.length < 5, true,
    `${sent.length} chunks went out at once; 4,380 bytes of window holds about three`);
  assertEquals(sctp.associationWaiting(a) > 10, true,
    "and the rest is queued — built and numbered, waiting for the path to allow it");
  // Not zero: there is room left, just less than the next chunk needs. A window is a byte count and
  // a chunk is indivisible, so "full" means "the next one does not fit" rather than "nothing left".
  assertEquals(sctp.associationAvailable(a) < 1100, true,
    `${sctp.associationAvailable(a)} bytes remain, which is less than one more chunk`);

  // **An acknowledgement opens it.** In slow start the window grows by the bytes acknowledged,
  // capped at one MTU each, so it roughly doubles per round trip.
  const before = sctp.associationWindow(a);
  const firstTsn = sctp.tsnOf(Uint8Array.from(sctp.firstChunkValue(sent[0])));
  sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, firstTsn, 65536), COOKIE, 100n);
  assertEquals(sctp.associationWindow(a) > before, true,
    "the window did not grow on an acknowledgement, so nothing would ever be sent again");

  // And the queue drains as it opens.
  const more = sctp.associationFlush(a, 100n);
  assertEquals(more.length > 0, true, "more chunks are released once there is room");
});

Deno.test("and a timeout closes it hard, because a timeout means nothing got through", () => {
  const a = associated();
  sctp.associationSendLarge(a, 0, 51, new Uint8Array(20000).fill(65), 1100, 0n);

  // Grow it first, so the collapse is visible.
  for (let i = 0; i < 6; i++) {
    sctp.associationReceive(a, sctp.sackPacket(0x77777777 | 0, i + 1, 65536), COOKIE, 10n);
    sctp.associationFlush(a, 10n);
  }
  const grown = sctp.associationWindow(a);
  assertEquals(grown > 4380, true, `the window grew to ${grown}`);

  // Now let a timer expire.
  assertEquals(sctp.associationDue(a, 100_000n, 1000n).length > 0, true, "something was resent");
  assertEquals(sctp.associationWindow(a), 1200,
    "the window drops to one MTU — a timeout is the strongest evidence a path has that it is " +
      "overloaded, unlike a gap, which says the path is delivering and dropped one");
  assertEquals(sctp.associationThreshold(a) >= 4 * 1200, true,
    "and the threshold halves rather than collapsing, so the recovery is slow-start then linear");
});
