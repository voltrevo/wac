// `Session` — the layer that joins ICE, DTLS and SCTP into a data channel.
//
// **What is checked here is the dispatch and the check response**, which is as far as a test can go
// without a live DTLS handshake: everything past the handshake needs record keys, and the only
// thing that establishes those is a real peer. `browser.test.ts` drives the layers directly and is
// where the protocol itself is measured; what this file covers is the composition — that a datagram
// reaches the right layer, and that the one field a session cannot derive gets plumbed through.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/session_probe.wac") as unknown as {
  sessionFor(certDer: Uint8Array, signingKey: Uint8Array, nonce: Uint8Array, scalar: Uint8Array,
    random: Uint8Array, cookie: Uint8Array, ourUfrag: string, ourPwd: string, theirUfrag: string,
    theirPwd: string, expectFingerprint: string): unknown;
  sessionReceive(s: unknown, datagram: Uint8Array, fromIp: Uint8Array, fromPort: number,
    now: bigint): Uint8Array[];
  sessionChecks(s: unknown): number;
  sessionOpen(s: unknown): boolean;
  sessionPending(s: unknown): number;
  kChunkBytes(): number;
  kPpidString(): number;
  kPpidDcep(): number;
};

const ice = await wacBind("packages/webrtc/test/wac/ice_probe.wac") as unknown as {
  check(tid: Uint8Array, peerUfrag: string, ourUfrag: string, peerPassword: Uint8Array,
    priority: bigint, controlling: boolean, tiebreaker: Uint8Array,
    useCandidate: boolean): Uint8Array;
  priorityOf(typePref: number, localPref: number, component: number): bigint;
  hostPref(): number;
  reportedAddress(msg: Uint8Array): Int32Array;
  rejected(msg: Uint8Array, ourUfrag: string, peerUfrag: string, ourPassword: Uint8Array): number;
};

const enc = new TextEncoder();
const OUR_UFRAG = "wacUF", OUR_PWD = "wac-password-0123456789";
const THEIR_UFRAG = "peerUF", THEIR_PWD = "peer-password-0123456";

const session = () =>
  ours.sessionFor(new Uint8Array(64).fill(9), new Uint8Array(32).fill(1), new Uint8Array(12),
    new Uint8Array(32).fill(2), new Uint8Array(32).fill(3), new Uint8Array(16).fill(4),
    OUR_UFRAG, OUR_PWD, THEIR_UFRAG, THEIR_PWD, "AA:BB");

// A check as the peer would send it: signed with *our* password, since we are the one who has to
// believe it, and naming us first in the username.
const peerCheck = () =>
  ice.check(crypto.getRandomValues(new Uint8Array(12)), OUR_UFRAG, THEIR_UFRAG,
    enc.encode(OUR_PWD), ice.priorityOf(ice.hostPref(), 65535, 1), true,
    crypto.getRandomValues(new Uint8Array(8)), false);

Deno.test("a connectivity check is answered, and the answer carries the sender's address", () => {
  // **The address is the one field a session cannot derive.** XOR-MAPPED-ADDRESS is how a peer
  // behind a NAT learns its own reflexive address, so it comes from the socket rather than from the
  // request — and a session that filled it with zeroes would send a response that parses cleanly
  // and tells the peer nothing. That is why `receive` takes it: only the caller holds a socket.
  const s = session();
  const out = ours.sessionReceive(s, peerCheck(), Uint8Array.from([192, 168, 3, 7]), 51234, 0n);
  assertEquals(out.length, 1, "one response");
  assertEquals(ours.sessionChecks(s), 1, "and it counted as a check answered");

  // [family, port, then the address bytes] — 1 is IPv4.
  const addr = [...ice.reportedAddress(Uint8Array.from(out[0]))];
  assertEquals(addr.join(","), "1,51234,192,168,3,7",
    `the response reported ${addr.join(",")} rather than the address it came from`);
});

Deno.test("a check that does not authenticate is not answered at all", () => {
  // Answering would make us an oracle for whether a username exists, and would let anybody who can
  // reach the port keep a pair alive that its owner never agreed to.
  const s = session();
  const forged = ice.check(crypto.getRandomValues(new Uint8Array(12)), OUR_UFRAG, THEIR_UFRAG,
    enc.encode("not-our-password"), ice.priorityOf(ice.hostPref(), 65535, 1), true,
    new Uint8Array(8), false);
  assertEquals(ours.sessionReceive(s, forged, Uint8Array.from([127, 0, 0, 1]), 1, 0n).length, 0);
  assertEquals(ours.sessionChecks(s), 0, "and it did not count");
});

Deno.test("dispatch is by the first byte, which is how STUN and DTLS share one port", () => {
  // **By shape, not by state.** Deciding which layer a datagram belongs to from the phase we think
  // we are in gets it wrong exactly when the peer disagrees about the phase — a check arriving
  // after the handshake, a retransmitted flight arriving after we thought it was done — and those
  // are the cases worth surviving. STUN is 0x00 or 0x01; a DTLS record is 20 to 63.
  const s = session();
  assertEquals(ours.sessionReceive(s, new Uint8Array(0), new Uint8Array(4), 0, 0n).length, 0,
    "an empty datagram is nothing");
  assertEquals(ours.sessionReceive(s, Uint8Array.from([200, 1, 2, 3]), new Uint8Array(4), 0, 0n)
    .length, 0, "and 200 is neither STUN nor DTLS — very likely SRTP, which we do not carry");
  // A DTLS record that is not a handshake we can act on yet: it reaches the DTLS layer and produces
  // nothing, rather than being mistaken for a malformed check.
  assertEquals(ours.sessionReceive(s, Uint8Array.from([23, 254, 253, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]),
    new Uint8Array(4), 0, 0n).length, 0, "application data before any keys exist");
  assertEquals(ours.sessionChecks(s), 0, "none of that was a connectivity check");
  assertEquals(ours.sessionOpen(s), false, "and no channel opened");
  assertEquals(ours.sessionPending(s), 0, "and nothing was delivered");
});

Deno.test("the chunk size leaves room for the headers wrapped around it", () => {
  // 1,100 bytes of payload, plus SCTP's 12-byte common header and 16-byte DATA chunk header, plus a
  // DTLS record header and GCM's explicit nonce and tag, has to stay under a 1,200-byte path MTU.
  // A value that fitted SCTP but not the record around it produces datagrams that fragment at the
  // IP layer, which is where a data channel quietly gets slow rather than breaking.
  const overhead = 12 + 16 + 13 + 8 + 16;
  assertEquals(ours.kChunkBytes() + overhead <= 1200, true,
    `${ours.kChunkBytes()} bytes of payload plus ${overhead} of headers exceeds a 1200-byte MTU`);
  assertEquals(ours.kPpidString(), 51, "WebRTC string data");
  assertEquals(ours.kPpidDcep(), 50, "and DCEP, which is what opens the channel");
});
