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

  // Bit 31 means the walk stopped at a frame type this package cannot size, and bit 30 that the
  // payload ended mid-frame. Either is a real gap, and naming which one is the point of separating
  // them: an unknown frame is work to do, a truncated one is a reader that is wrong.
  //
  // **This is expected to fire today.** quinn's first application flight carries HANDSHAKE_DONE
  // (0x1e) and NEW_CONNECTION_ID (0x18), and `frame.wac` knows neither — its own comment says an
  // unknown frame has no known length, so the walk must stop. Asserting the stop rather than
  // pretending otherwise is what makes this test tell the truth about where the package is: step 5
  // is what adds them, and this line changes when it does.
  const stoppedAtUnknown = (kinds & (1 << 31)) !== 0;
  const truncated = (kinds & (1 << 30)) !== 0;
  assertEquals(truncated, false, `the payload ended mid-frame, which is a reader bug: 0x${kinds.toString(16)}`);
  assertEquals(
    stoppedAtUnknown,
    true,
    "expected the walk to stop at a frame this package cannot size yet — if it no longer does, " +
      "someone taught `frame.wac` the rest of RFC 9000's table 3 and this expectation is stale",
  );

  // And something was read before it stopped. A walk that halted on the very first byte would set
  // the same bit and prove nothing about the payload being frames at all.
  const known = kinds & 0x3fffffff;
  assertEquals(known !== 0, true, `no frame was recognised before the walk stopped: 0x${kinds.toString(16)}`);
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
