// **Both sides agree on the Handshake secrets**, which is what design/system 0007 step 4 asks for.
//
// The chain, all of it ours except the peer: we author a ClientHello with an x25519 share whose
// private half we hold, seal it into an Initial, and send it. quinn answers with a datagram holding
// two coalesced packets — an Initial carrying the ServerHello, and a Handshake carrying everything
// after it. We open the first with Initial keys, take the server's share out of the ServerHello, run
// x25519, hash the two handshake messages into a transcript, put that through TLS's key schedule,
// turn the result into packet-protection keys with QUIC's three labels, and open the second packet.
//
// ## Why opening it is the whole assertion
//
// The Handshake keys depend on the Diffie-Hellman exchange **and** on every handshake byte both
// sides have seen. A wrong shared secret, a transcript hashed over the wrong bytes, a label spelled
// differently, the client's traffic secret where the server's belongs — each produces keys that are
// perfectly well-formed and that quinn does not share, and the packet then decrypts to nothing at
// all. There is no partial credit and nothing to inspect: AES-GCM either authenticates or does not.
//
// So `handshakePayload` returning bytes is the claim. That the bytes then begin with
// EncryptedExtensions is the confirmation that they are the right bytes rather than merely some.

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
  serverHelloMessage(datagram: Uint8Array, dcid: Uint8Array): Uint8Array;
  serverGroup(datagram: Uint8Array, dcid: Uint8Array): number;
  serverIsTls13(datagram: Uint8Array, dcid: Uint8Array): boolean;
  serverAskedRetry(datagram: Uint8Array, dcid: Uint8Array): boolean;
  shared(datagram: Uint8Array, dcid: Uint8Array): Uint8Array;
  handshakeAt(datagram: Uint8Array): number;
  handshakePayload(datagram: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  handshakeMessageType(datagram: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): number;
};

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);
const SCID = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);

/** Our first flight to a real server, and the datagram it answers with. */
async function exchange(): Promise<Uint8Array> {
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept().catch(() => {});
    const flight = Uint8Array.from(ours.flight(DCID, SCID, "localhost"));
    await sock.send(flight, { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" });
    const answer = await Promise.race([
      sock.receive().then(([b]) => b),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (answer === null) throw new Error("the server did not answer our first flight");
    return answer;
  } finally {
    sock.close();
    endpoint.close();
  }
}

Deno.test("the ServerHello answers in the group we offered, and is not a retry", async () => {
  const datagram = await exchange();

  const hello = Uint8Array.from(ours.serverHelloMessage(datagram, DCID));
  assertEquals(hello.length > 40, true, `a ServerHello is tens of bytes: ${hello.length}`);
  assertEquals(hello[0], 2, "handshake type 2 is server_hello");

  assertEquals(ours.serverIsTls13(datagram, DCID), true, "TLS 1.3, from supported_versions");
  assertEquals(ours.serverGroup(datagram, DCID), 0x001d, "x25519, the group we offered");

  // A HelloRetryRequest is a ServerHello with a sentinel random, and its key_share names a *group*
  // rather than a key. Reading one as an ordinary hello derives a shared secret from two bytes, so
  // this is checked rather than assumed even though a server with one group to choose from will not
  // send one.
  assertEquals(ours.serverAskedRetry(datagram, DCID), false, "and not a HelloRetryRequest");

  const dhe = Uint8Array.from(ours.shared(datagram, DCID));
  assertEquals(dhe.length, 32, "x25519 against the server's share gives 32 bytes");
});

Deno.test("the server coalesced a Handshake packet behind its Initial", async () => {
  const datagram = await exchange();

  // RFC 9000 §12.2. A server's first flight is normally an Initial and a Handshake in one datagram,
  // and finding the second needs the first's `length` — which is why a packet reader that stops at
  // one packet per datagram never sees the handshake at all.
  const at = ours.handshakeAt(datagram);
  assertEquals(at > 0, true, `a second packet begins inside the datagram: ${at}`);
  assertEquals(at < datagram.length, true, "and inside it, not past the end");
  assertEquals((datagram[at] & 0x80) !== 0, true, "the second packet is a long header");
  assertEquals((datagram[at] >> 4) & 3, 2, "and type 2 is Handshake");
});

Deno.test("the Handshake packet opens under keys we derived through the TLS schedule", async () => {
  const datagram = await exchange();

  const payload = Uint8Array.from(ours.handshakePayload(datagram, DCID, SCID, "localhost"));
  if (payload.length === 0) {
    throw new Error(
      "the Handshake packet did not open. The keys depend on the shared secret and on the " +
      "transcript over both handshake messages, so this is one of: x25519, the ServerHello parse, " +
      "the transcript's contents, the `s hs traffic` label, or QUIC's three. All of them produce " +
      "well-formed keys and none of them produce a readable packet.",
    );
  }
  assertEquals(payload.length > 500, true, `and it is the whole flight: ${payload.length} bytes`);

  // 8 is `encrypted_extensions`, which is what TLS 1.3 sends immediately after a ServerHello — so
  // this is the right bytes rather than merely some bytes that authenticated.
  assertEquals(ours.handshakeMessageType(datagram, DCID, SCID, "localhost"), 8,
    "and it begins with EncryptedExtensions");
});
