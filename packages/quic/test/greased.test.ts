// A real server's reply, which has the "fixed" bit set to zero.
//
// RFC 9000 §17.2 calls bit 0x40 the *fixed bit* and says a packet is not a valid version-1 packet
// without it. RFC 9287 then says: an endpoint may advertise the `grease_quic_bit` transport
// parameter, and a peer that has seen it **may send zero there** — the point being to stop
// middleboxes treating the bit as a reliable way to recognise QUIC.
//
// quinn advertises it, so a Deno QUIC server greases the bit in its reply, so `packet.wac` refusing
// a cleared fixed bit refuses a packet a real peer actually sends. The comment there says "a
// version-1 peer never sends a zero there". This file is that comment being wrong.
//
// **It greases at random**, which is the whole point of greasing — a bit that is always zero is as
// recognisable as one that is always one. Measured over twenty replies: 13 cleared, 7 set. So this
// samples until it has seen a cleared one rather than asserting on a single reply, which would fail
// about a third of the time.
//
// ## The oracle, and why it is different from the other two
//
// `packet.test.ts` and `initial.test.ts` read a packet quinn *sent to nobody* — Deno's client aimed
// at a dead socket, which needs no server and no certificate. This one needs an answer, so it stands
// up a real Deno QUIC server and replays a genuine Initial at it over plain UDP.
//
// Replaying somebody else's first flight is enough to make a server answer: the Initial keys come
// from the connection id in the header, which the sender chooses, and the ClientHello inside is a
// well-formed TLS message whoever produced it. The handshake cannot be *completed* this way — we do
// not have the client's private key — and it does not need to be. The reply is the whole point.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/packet_probe.wac") as unknown as {
  parseOk(b: Uint8Array, greased: boolean): boolean;
  version(b: Uint8Array, greased: boolean): number;
  packetType(b: Uint8Array, greased: boolean): number;
  dcidLen(b: Uint8Array, greased: boolean): number;
};

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

/** A genuine Initial, from Deno's client aimed at a socket that never answers. */
async function anInitial(): Promise<Uint8Array> {
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const port = (sock.addr as Deno.NetAddr).port;
  try {
    (Deno as unknown as { connectQuic(o: unknown): Promise<unknown> })
      .connectQuic({ hostname: "127.0.0.1", port, alpnProtocols: ["h3"] })
      .catch(() => {});
    const [bytes] = await sock.receive();
    return bytes;
  } finally {
    sock.close();
  }
}

/** What a real QUIC server answers when that Initial is replayed at it. */
async function aServerReply(): Promise<Uint8Array> {
  const initial = await anInitial();
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");

  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    const listener = endpoint.listen({ cert, key, alpnProtocols: ["h3"] });
    // Nothing ever completes — we cannot finish somebody else's handshake — and the rejection is
    // expected rather than a failure, so it is swallowed here instead of becoming an unhandled one.
    listener.accept().catch(() => {});

    await sock.send(initial, { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" });
    const answer = await Promise.race([
      sock.receive().then(([b]) => b),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (answer === null) throw new Error("the server did not answer the replayed Initial in 5s");
    return answer;
  } finally {
    sock.close();
    endpoint.close();
  }
}

/**
 * Replies until one has the fixed bit cleared.
 *
 * Fifteen attempts against a measured rate near two in three leaves a chance of missing below one in
 * a hundred thousand, and a run that somehow saw fifteen ungreased replies says so rather than
 * passing quietly — "we did not observe it" and "it does not happen" are different answers and only
 * one of them is a reason to skip an assertion.
 */
async function aGreasedReply(): Promise<Uint8Array> {
  for (let i = 0; i < 15; i++) {
    const reply = await aServerReply();
    if ((reply[0] & 0x40) === 0) return reply;
  }
  throw new Error("fifteen replies in a row had the fixed bit set; greasing may have been turned off");
}

Deno.test("a real server's reply has the fixed bit greased to zero, and still parses", async () => {
  const reply = await aGreasedReply();

  // The bit RFC 9000 calls fixed, in a packet from a real implementation.
  assertEquals((reply[0] & 0x80) !== 0, true, "a long header");
  assertEquals((reply[0] & 0x40) !== 0, false,
    `the server greased the fixed bit — first byte 0x${reply[0].toString(16)}`);
  assertEquals((reply[0] >> 4) & 3, 0, "and it is an Initial");

  // **The bit is the only thing wrong with it.** Everything else is an ordinary version-1 Initial,
  // which is what makes refusing it a defect rather than caution: the version says 1, the ids are
  // within their bounds, and the packet is the anti-amplification 1200 bytes.
  assertEquals(reply.length, 1200, "padded to the anti-amplification minimum");
  assertEquals(mod.parseOk(reply, true), true, "with greasing allowed, it parses");
  assertEquals(mod.version(reply, true), 1, "version 1");
  assertEquals(mod.dcidLen(reply, true) <= 20, true, "and the connection id is within bounds");
});

Deno.test("greasing is something the caller allows, not something the parser assumes", async () => {
  const reply = await aGreasedReply();

  // A parser cannot decide this alone. RFC 9287 permits a zero **only** when `grease_quic_bit` was
  // negotiated, which is connection state — so whether to accept one is the caller's answer, in the
  // same way `parseShortDcid` takes a connection id length it cannot know. Told no, this is refused.
  assertEquals(mod.parseOk(reply, false), false,
    "without the transport parameter, a cleared fixed bit is not a version-1 packet");

  // And a client's own Initial has the bit set, so allowing greasing never has to mean ignoring it.
  const initial = await anInitial();
  assertEquals((initial[0] & 0x40) !== 0, true, "quinn sets the bit on the packet it sends first");
  assertEquals(mod.parseOk(initial, false), true, "which parses either way");
  assertEquals(mod.parseOk(initial, true), true, "…either way");
});
