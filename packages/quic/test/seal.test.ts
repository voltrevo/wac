// A packet we built, accepted by an implementation we did not write.
//
// design/system 0007 step 4, the writing half. Everything before this **read** — quinn's Initial
// decrypts, its frames walk, its ClientHello parses. Nothing had produced a packet.
//
// ## The oracle is that a real server answers
//
// A QUIC server that cannot open a datagram drops it in silence: there is nobody to complain to,
// because a packet that fails authentication is attacker-chosen bytes and answering it would be a
// reflection attack. So "quinn replied" is the whole assertion. A wrong AEAD tag, a wrong nonce, a
// header-protection mask applied in the wrong order, a length field off by one, a datagram under the
// anti-amplification minimum — every one of them produces silence, and nothing else produces a
// reply.
//
// **The ClientHello is quinn's own**, lifted out of a genuine first flight with `frame.wac` and put
// into a packet of our own construction. That is deliberate: it isolates what this step is about.
// Authoring a ClientHello is TLS work — transport parameters, ALPN, a key share we hold the private
// half of — and none of it is what protects a packet. Borrowing the handshake bytes tests the
// framing, the padding, the header, the AEAD and the header protection, and tests nothing else.
//
// ## Borrowing it constrains one field, and finding that out was the useful part
//
// A client's ClientHello carries `initial_source_connection_id`, a transport parameter naming the
// source id in the packet that carried it, and a server checks the two agree. So a borrowed
// handshake may only be sent from **the id its author used** — invent your own and quinn answers
// with `TRANSPORT_PARAMETER_ERROR` and the reason `CID authentication failure`, which is asserted
// below because a server that refuses for the right reason is evidence the oracle is awake.
//
// The destination id is free: a client invents it, and both sides derive the Initial keys from it.
//
// What this cannot do is *finish* a handshake: the key share belongs to a quinn client that has
// since gone away, so the ServerHello is as far as it goes. Step 4's own definition — both sides
// agreeing on traffic secrets — needs a ClientHello we can answer for, which is the next piece.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const frames = await wacBind("packages/quic/test/wac/frame_probe.wac") as unknown as {
  cryptoOf(packet: Uint8Array): Uint8Array;
  handshakeType(packet: Uint8Array): number;
  handshakeTypeIn(payload: Uint8Array): number;
  kindsIn(payload: Uint8Array): number;
  streamLen(payload: Uint8Array): number;
  closeCodeIn(payload: Uint8Array): number;
  closeReasonIn(payload: Uint8Array): string;
};
const packets = await wacBind("packages/quic/test/wac/packet_probe.wac") as unknown as {
  scidOf(b: Uint8Array, greased: boolean): Uint8Array;
};
const initial = await wacBind("packages/quic/test/wac/initial_probe.wac") as unknown as {
  seal(dcid: Uint8Array, scid: Uint8Array, crypto: Uint8Array, pn: number): Uint8Array;
  open(packet: Uint8Array, greased: boolean): Uint8Array;
  openServer(packet: Uint8Array, clientDcid: Uint8Array, greased: boolean): Uint8Array;
};

/** The frame kinds `kindsIn` reports, as the bits it sets. */
const HAS_ACK = 4, HAS_CRYPTO = 8, HAS_CLOSE = 16;

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

/** quinn's ClientHello, and the source id its transport parameters name. */
async function aClientHello(): Promise<{ hello: Uint8Array; scid: Uint8Array }> {
  const packet = await anInitial();
  assertEquals(frames.handshakeType(packet), 1, "the fixture is a ClientHello");
  return {
    hello: Uint8Array.from(frames.cryptoOf(packet)),
    scid: Uint8Array.from(packets.scidOf(packet, false)),
  };
}

/** Send one datagram at a real QUIC server and wait for anything back. */
async function ask(datagram: Uint8Array, waitMs = 5000): Promise<Uint8Array | null> {
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept().catch(() => {});
    await sock.send(datagram, { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" });
    return await Promise.race([
      sock.receive().then(([b]) => b),
      new Promise<null>((r) => setTimeout(() => r(null), waitMs)),
    ]);
  } finally {
    sock.close();
    endpoint.close();
  }
}

/** The destination id we invent. A client picks this before it knows anything about the server. */
const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);

Deno.test("a sealed Initial is 1200 bytes and opens with our own reader", async () => {
  const { hello, scid } = await aClientHello();
  const packet = Uint8Array.from(initial.seal(DCID, scid, hello, 0));

  assertEquals(packet.length, 1200, "padded to the anti-amplification minimum");
  assertEquals((packet[0] & 0x80) !== 0, true, "a long header");
  assertEquals((packet[0] & 0x40) !== 0, true,
    "with the fixed bit set — a client has negotiated nothing, so there is nothing to grease");

  // Reading back what we wrote is the cheap check, not the real one: both halves share every key, so
  // agreeing proves they agree and nothing more. It is here to make a failure attributable — when
  // the server goes silent, this says whether the packet was malformed or merely unacceptable.
  const payload = Uint8Array.from(initial.open(packet, false));
  assertEquals(payload.length > 0, true, "our own reader opens it");
});

Deno.test("a real QUIC server accepts a packet we built and answers with a ServerHello", async () => {
  const { hello, scid } = await aClientHello();
  const packet = Uint8Array.from(initial.seal(DCID, scid, hello, 0));

  const reply = await ask(packet);
  if (reply === null) {
    throw new Error(
      "the server did not answer our Initial. It drops what it cannot open in silence, so this is " +
      "the AEAD, the nonce, the header protection, the length field or the padding — the packet " +
      "opens with our own reader either way, which is why that is not the check.",
    );
  }

  // The reply is addressed to the source id we sent from, which says the server read our header
  // rather than answering out of a cache: RFC 9000 §17.2 puts the destination id length at byte 5.
  assertEquals(reply[5], scid.length, "the reply's destination id is as long as the source we sent");
  for (let i = 0; i < scid.length; i++) {
    assertEquals(reply[6 + i], scid[i], `and byte ${i} of it is ours`);
  }

  // **Both directions, now.** The server's Initial is protected with keys derived from the id *we*
  // invented — a server's packet does not carry it, which is why `openServer` takes it — so opening
  // this is the mirror of everything above and needed the same salt, labels, sample offset and AAD.
  const payload = Uint8Array.from(initial.openServer(reply, DCID, true));
  assertEquals(payload.length > 0, true, "the server's Initial opens under the client's original id");

  const kinds = frames.kindsIn(payload);
  assertEquals((kinds & HAS_ACK) !== 0, true, "it acknowledges the packet we sent");
  assertEquals((kinds & HAS_CRYPTO) !== 0, true, "and carries handshake bytes");
  assertEquals((kinds & HAS_CLOSE) !== 0, false, "and is not a refusal");

  // 2 is `server_hello`. This is the answer to the ClientHello we relayed, which means quinn read
  // our framing, our padding and our length field and found a whole TLS message where we said.
  assertEquals(frames.handshakeTypeIn(payload), 2, "the handshake message is a ServerHello");
  assertEquals(frames.streamLen(payload) > 30, true,
    `a ServerHello is tens of bytes: ${frames.streamLen(payload)}`);
});

Deno.test("a source id the borrowed ClientHello does not name is refused, and the reason says why", async () => {
  const { hello } = await aClientHello();
  // Ours, not quinn's. Everything else about the packet is what the test above sends.
  const invented = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);
  const packet = Uint8Array.from(initial.seal(DCID, invented, hello, 0));

  const reply = await ask(packet);
  if (reply === null) throw new Error("the server did not answer at all, so nothing was validated");

  const payload = Uint8Array.from(initial.openServer(reply, DCID, true));
  assertEquals(payload.length > 0, true, "the refusal is itself a protected Initial, and it opens");
  assertEquals((frames.kindsIn(payload) & HAS_CLOSE) !== 0, true, "and it is a CONNECTION_CLOSE");

  // 0x08 is TRANSPORT_PARAMETER_ERROR. The reason quinn writes is "CID authentication failure" —
  // not asserted, because it is prose a peer may reword, where the code is the protocol's own word.
  assertEquals(frames.closeCodeIn(payload), 0x08,
    `TRANSPORT_PARAMETER_ERROR, reason ${JSON.stringify(frames.closeReasonIn(payload))}`);

  // **This is what makes the test above mean something.** The server validated a field of the
  // handshake we relayed, so it did not merely echo: it opened our packet, read the frames, parsed
  // the ClientHello and compared it against our header.
});

Deno.test("a packet that fails authentication gets silence, which is the rest of what makes a reply mean something", async () => {
  const { hello, scid } = await aClientHello();
  const packet = Uint8Array.from(initial.seal(DCID, scid, hello, 0));

  // One bit of the authentication tag. Everything else — header, length, padding, connection ids —
  // is exactly the packet the server answered above, so a reply here would mean the oracle reads
  // something other than the AEAD and the acceptance test proves less than it claims.
  const tampered = Uint8Array.from(packet);
  tampered[tampered.length - 1] ^= 0x01;

  assertEquals(await ask(tampered, 2000), null,
    "a packet that fails authentication is answered with nothing at all");
});
