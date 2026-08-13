// The bookkeeping that turns a packet into a connection.
//
// `stream.test.ts` drives this against a real server, which is the right oracle for "did the
// retransmission arrive" and nearly blind to everything else: from the far end of a socket, a client
// that resent the frames once and a client that resent them four times look the same, and so do a
// client that reused a packet number and one that did not — until the day the reuse loses the key.
//
// So the accounting is checked here, directly. The keys are irrelevant and the handshake reply is not
// a real one, so every `send` answers an empty packet — deliberately, because what is under test
// happens before the sealing.
//
// ## The two rules everything here is about
//
// **A packet number is used once.** RFC 9000 §12.3. The nonce is derived from it, so reusing one
// under the same key is the failure that loses the key rather than the packet. Every test below that
// looks like it is about counters is really about that.
//
// **Frames are retransmitted; packets are not.** §13.3. "Sending it again" means the same frames in a
// *new* packet with the next number, which is why `Connection` keeps frames rather than packets.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/conn_probe.wac") as unknown as {
  numbersAscend(n: number): number;
  outstandingAfterSends(n: number): number;
  outstandingAfterAck(n: number, largest: number): number;
  oldest(n: number, largest: number): number;
  afterResend(): number;
  resendWithNothingOutstanding(): number;
  repeatedResends(times: number): number;
  resendCarriesTheSameFrames(): boolean;
};

Deno.test("packet numbers are handed out in order and never reused", () => {
  // The counter after n sends is n, which is only interesting because of what it rules out: a
  // connection that reused a number would keep the counter still, and one that skipped would not.
  for (const n of [0, 1, 2, 9, 40]) {
    assertEquals(mod.numbersAscend(n), n, `${n} sends should leave the next number at ${n}`);
  }
});

Deno.test("everything sent is outstanding until something acknowledges it", () => {
  for (const n of [0, 1, 5, 20]) {
    assertEquals(mod.outstandingAfterSends(n), n);
  }
  // The growth path: the record array starts empty and doubles, so 8 and 9 sends take different
  // routes through `reserve` and must agree about the answer.
  assertEquals(mod.outstandingAfterSends(8), 8, "exactly the initial capacity");
  assertEquals(mod.outstandingAfterSends(9), 9, "and one past it, which grows the array");
  assertEquals(mod.outstandingAfterSends(17), 17, "and one past the doubled capacity");
});

Deno.test("an acknowledgement clears everything at or below it, and nothing above", () => {
  // Five packets, numbered 0 to 4.
  assertEquals(mod.outstandingAfterAck(5, 4), 0, "acknowledging the last clears all five");
  assertEquals(mod.outstandingAfterAck(5, 0), 4, "acknowledging the first clears one");
  assertEquals(mod.outstandingAfterAck(5, 2), 2, "and the middle clears three");
  // A peer cannot acknowledge what it has not been sent, but a reader must not fall over if it
  // claims to: the effect is that everything is cleared, which is the peer's error and not a crash.
  assertEquals(mod.outstandingAfterAck(5, 99), 0);
});

Deno.test("the oldest unacknowledged packet is the one to resend", () => {
  assertEquals(mod.oldest(5, -1), 0, "nothing acknowledged: the first");
  assertEquals(mod.oldest(5, 1), 2, "two acknowledged: the third");
  assertEquals(mod.oldest(5, 4), -1, "everything acknowledged: nothing to resend");
  assertEquals(mod.oldest(0, -1), -1, "nothing sent: nothing to resend");
});

Deno.test("resending takes a new number and does not leave the old record outstanding", () => {
  // Two sends and a resend: numbers 0, 1, then 2 — the resend does **not** reuse 0. And two
  // outstanding, not three: the record it copied from is retired, because the frames are now
  // carried by the new packet and leaving both live would resend them twice.
  assertEquals(mod.afterResend(), 302, "next number 3, two outstanding");
});

Deno.test("resending with nothing outstanding does nothing, and burns no number", () => {
  // A caller polling for something to resend must not be able to exhaust the number space by asking.
  assertEquals(mod.resendWithNothingOutstanding(), 1);
});

Deno.test("repeated resends do not grow the outstanding count without bound", () => {
  // One packet, resent many times, is still one packet in flight. A version that left each record
  // live would answer 1, 2, 3, … and a caller retrying in a loop would run out of memory before it
  // ran out of patience.
  for (const times of [1, 2, 10, 50]) {
    assertEquals(mod.repeatedResends(times), 1, `after ${times} resends`);
  }
});

Deno.test("and it carries the frames the lost packet carried, byte for byte", () => {
  // The point of keeping frames rather than packets. A resend that produced an empty or different
  // payload would satisfy every count above.
  assertEquals(mod.resendCarriesTheSameFrames(), true);
});
