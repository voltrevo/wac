// **The application epoch: quinn's own 1-RTT packet, opened here.**
//
// `complete.test.ts` ends where the handshake does. It sees the server's next packet and asserts one
// thing about it — that the top bit is clear, so it is a short header — and says in its own comment
// that nothing in this package can read one. This is that packet, read.
//
// design/system 0007 step 4's row ends "the application epoch is next: the server moves to short-header
// packets on completion and nothing here reads one". This is that sentence answered.
//
// ## Why a short header is not the same job as a long one
//
// Three differences, each of which fails silently rather than loudly:
//
//   1. **No length field.** A long header says how long its payload is, which is what lets packets be
//      coalesced. A short header runs to the end of the datagram — so the ciphertext boundary comes
//      from the datagram's size, and a reader that expected a length reads a payload of nothing.
//   2. **No connection-id length.** The id is present and its length is not, because the receiver
//      chose that id and knows how long its own are. Ours is 4 bytes because we made it 4 bytes. Pass
//      a different number and the packet number and the header-protection *sample* both shift: the
//      packet opens as noise, with nothing anywhere saying the length was the problem.
//   3. **Five protected bits, not four.** The first byte carries the spin bit, two reserved bits, the
//      key phase and the packet-number length; header protection covers the low five. Masking four —
//      which is right for a long header — leaves the key phase unrecovered.
//
// ## The oracle is the AEAD tag, and it is a very sharp one
//
// AES-128-GCM's tag is 128 bits. A payload that opens is a payload whose key, IV, nonce, packet
// number, associated data and ciphertext boundary are *all* right; the chance of that happening by
// accident is 2^-128. So the assertion "it opened" is not a weak one — it is every derivation in the
// application epoch at once, including the one thing this test exists for, which is that the master
// secret and the `s ap traffic` label were taken at the right point in the transcript.
//
// The frames inside are asserted separately, because opening proves the keys and says nothing about
// whether we can then read what is in there.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/quic/test/wac/hello_probe.wac") as unknown as {
  flight(dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  clientFinishedPacket(datagram: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  openApplication(
    handshakeReply: Uint8Array,
    packet: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
  ): Uint8Array;
  applicationKeyPhase(
    handshakeReply: Uint8Array,
    packet: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
  ): number;
  frameKinds(payload: Uint8Array): number;
  firstNewCidShape(payload: Uint8Array): number;
  frameCountIn(payload: Uint8Array): number;
  receiveInto(handshakeReply: Uint8Array, packet: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): number;
};

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);
const SCID = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);

/** Complete the handshake and keep both the server's flight and whatever it sent afterwards. */
async function completed(): Promise<{ reply: Uint8Array; after: Uint8Array | null }> {
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
  try {
    endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept().catch(() => {});

    await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
    const reply = await Promise.race([
      sock.receive().then(([b]) => Uint8Array.from(b)),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (reply === null) throw new Error("the server did not answer our first flight");

    await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);
    const after = await Promise.race([
      sock.receive().then(([b]) => Uint8Array.from(b)),
      new Promise<null>((r) => setTimeout(() => r(null), 2500)),
    ]);
    return { reply, after };
  } finally {
    sock.close();
    endpoint.close();
  }
}

const handshake = await completed();

Deno.test("the server's first application packet opens under keys we derived", () => {
  const { reply, after } = handshake;
  if (after === null) throw new Error("the server sent nothing after the handshake");
  assertEquals((after[0] & 0x80) === 0, true, `not a short header: 0x${after[0].toString(16)}`);

  const payload = Uint8Array.from(ours.openApplication(reply, after, DCID, SCID, "localhost"));
  if (payload.length === 0) {
    throw new Error(
      "the 1-RTT packet did not open. AES-128-GCM's tag is 128 bits, so this is not a near miss: " +
        "it is the master secret, the `s ap traffic` label, the transcript point those are taken at " +
        "(through the server's Finished, not the ServerHello), the id length the header does not " +
        "carry, the five protected bits, or the ciphertext running to the end of the datagram.",
    );
  }
  // Having opened at all is the strong statement; the length is here so a payload of nothing cannot
  // be mistaken for one.
  assertEquals(payload.length > 0, true, "the opened payload has bytes in it");
});

Deno.test("the key phase is zero, which is the server saying it has not updated its keys", () => {
  const { reply, after } = handshake;
  if (after === null) throw new Error("the server sent nothing after the handshake");
  // Not decoration: this bit is *inside* header protection, so reading it as 0 rather than as garbage
  // is the evidence that five bits were unmasked rather than four. A long header's four-bit mask
  // leaves this bit exactly where it was, and it would then be whatever the mask happened to make it.
  assertEquals(
    ours.applicationKeyPhase(reply, after, DCID, SCID, "localhost"),
    0,
    "a fresh connection's first application packet is phase 0",
  );
});

Deno.test("the frames inside are ones we can walk, and the walk reaches the end", () => {
  const { reply, after } = handshake;
  if (after === null) throw new Error("the server sent nothing after the handshake");
  const payload = Uint8Array.from(ours.openApplication(reply, after, DCID, SCID, "localhost"));
  const kinds = ours.frameKinds(payload);

  // Bit 31 means the walk stopped at a frame type this package cannot size, bit 30 that the payload
  // ended mid-frame, and bit 27 that a frame arrived in a packet type table 3 does not permit it in.
  // All three are failures and they are different ones: work to do, a reader that is wrong, and a
  // peer that is wrong.
  //
  // **This expectation used to be the opposite**, and it said so: it asserted the walk *stopped*,
  // because `frame.wac` covered only the five frames an Initial may carry and quinn's first
  // application flight carries HANDSHAKE_DONE and NEW_CONNECTION_ID. The rest of table 3 is now
  // implemented, so the walk reaches the end of the payload — which is a much stronger statement,
  // since every frame's length had to be right for the one after it to be found at all.
  assertEquals((kinds & (1 << 31)) === 0, true, `stopped at an unknown frame type: 0x${kinds.toString(16)}`);
  assertEquals((kinds & (1 << 30)) === 0, true, `the payload ended mid-frame: 0x${kinds.toString(16)}`);
  assertEquals((kinds & (1 << 27)) === 0, true, `a frame arrived where table 3 forbids it: 0x${kinds.toString(16)}`);

  // What is actually in quinn's first application flight is **NEW_CONNECTION_ID**, several of them:
  // a server hands a peer spare ids as soon as it can, so the peer can migrate without being
  // linkable. Not HANDSHAKE_DONE, which was the guess when this test was written — it arrives in a
  // later packet, and asserting it here would have been asserting quinn's packing rather than our
  // reading.
  assertEquals((kinds & (1 << 24)) !== 0, true, `no NEW_CONNECTION_ID: 0x${kinds.toString(16)}`);

  // The walk reached the end: `frameCountIn` answers -1 if any frame could not be read whole, so a
  // count at all is the payload accounted for byte for byte with nothing left over.
  //
  // It is one frame, and the first draft of this line asserted "several" — that was guessing at
  // quinn's packing again, one paragraph after saying not to. What carries the weight here is the
  // shape check below rather than the count.
  const count = ours.frameCountIn(payload);
  assertEquals(count >= 1, true, `the walk did not reach the end of the payload (${count})`);

  // And the fields inside one, not merely its size: RFC 9000 §19.15 fixes the token at 16 bytes and
  // the id at 1 to 20. A frame whose *size* is right with the id and token misplaced within it would
  // satisfy every check above and fail this one.
  const shape = ours.firstNewCidShape(payload);
  const cidLen = Math.floor(shape / 100), tokenLen = shape % 100;
  assertEquals(tokenLen, 16, `a stateless-reset token is 16 bytes, got ${tokenLen} (shape ${shape})`);
  assertEquals(cidLen >= 1 && cidLen <= 20, true, `a connection id is 1..20 bytes, got ${cidLen}`);

  // And something was read before it stopped. A walk that halted on the very first byte would set
  // the same bit and prove nothing about the payload being frames at all.
  const known = kinds & 0x07ffffff;
  assertEquals(known !== 0, true, `no frame was recognised at all: 0x${kinds.toString(16)}`);
});

Deno.test("a wrong connection-id length does not open the packet", () => {
  const { reply, after } = handshake;
  if (after === null) throw new Error("the server sent nothing after the handshake");
  // The canary for difference (2) above, and the reason it is worth a test of its own: this is the
  // one field a short header does not carry, so getting it wrong is not detectable from the packet.
  // A client that guessed would see exactly this — nothing — and have no way to know why.
  //
  // Driven by lying about our own id: a `Client` whose scid is 8 bytes reads the id as 8 bytes, and
  // the packet number and sample both move by four.
  const wrong = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
  const payload = Uint8Array.from(ours.openApplication(reply, after, DCID, wrong, "localhost"));
  assertEquals(payload.length, 0, "an 8-byte id length must not open a packet addressed to a 4-byte id");
});

Deno.test("a packet that does not open leaves the window where it was", () => {
  // RFC 9000 §A.3 decodes a truncated packet number against the largest **processed**, and the
  // distinction is the point: anybody who can reach the four-tuple can send a packet, so a window
  // that moved on *receipt* would be a window a stranger moves with noise — and a window moved far
  // enough makes the peer's real packets decode to the wrong numbers.
  const { reply, after } = handshake;
  if (after === null) throw new Error("the server sent nothing after the handshake");

  // The real packet: it opens, and the window moves to the number it carried.
  const good = ours.receiveInto(reply, after, DCID, SCID, "localhost");
  assertEquals(good % 10, 1, "the server's own packet should have opened");
  assertEquals(good >= 10, true, `and moved the window off -1: ${good}`);

  // The same packet with one ciphertext byte flipped. It cannot open, so nothing is read — and the
  // window must still be -1, which is `(−1 + 1) * 10 + 0`.
  const tampered = Uint8Array.from(after);
  tampered[tampered.length - 20] ^= 1;
  assertEquals(
    ours.receiveInto(reply, tampered, DCID, SCID, "localhost"),
    0,
    "a packet that failed authentication moved the window, which lets a stranger move it with noise",
  );

  // And something that is not a packet at all.
  assertEquals(ours.receiveInto(reply, new Uint8Array(8), DCID, SCID, "localhost"), 0);
});
