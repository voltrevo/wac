// A first flight where every byte is ours, answered by an implementation we did not write.
//
// design/system 0007 step 4. `seal.test.ts` built the *packet* and borrowed quinn's ClientHello,
// which was the right way round — it isolated the packet layer — but left the handshake unowned: the
// key share belonged to a client that had gone away, so nothing could ever be derived from it.
//
// This authors the handshake message too. `packages/tls`'s `clientHello` writes the TLS 1.3 one,
// `packages/quic`'s `params.wac` writes QUIC's transport parameters into extension 57, and
// `packages/crypto`'s x25519 supplies a key share **we hold the private half of**. So the ServerHello
// that comes back is one whose shared secret is computable, which is what the rest of step 4 needs.
//
// ## What a reply proves, and what the mismatch adds
//
// A server drops what it cannot open in silence, so an answer already means the packet layer worked.
// The new claim is that the *handshake* is acceptable: a ClientHello quinn can parse, in a version
// and group and suite it will agree to, with transport parameters it will validate.
//
// The second test is the argument that the parameters are read rather than carried. It sends a
// flight identical in every way except that `initial_source_connection_id` names an id the header
// does not, and quinn refuses it with `TRANSPORT_PARAMETER_ERROR`. A passing test and a failing one
// that differ in one field are together an account of *why* the first passes.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/quic/test/wac/hello_probe.wac") as unknown as {
  publicKey(): Uint8Array;
  helloOnly(scid: Uint8Array, serverName: string): Uint8Array;
  flight(dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  flightMismatched(dcid: Uint8Array, headerScid: Uint8Array, paramScid: Uint8Array, serverName: string): Uint8Array;
};
const frames = await wacBind("packages/quic/test/wac/frame_probe.wac") as unknown as {
  kindsIn(payload: Uint8Array): number;
  handshakeTypeIn(payload: Uint8Array): number;
  streamLen(payload: Uint8Array): number;
  closeCodeIn(payload: Uint8Array): number;
  closeReasonIn(payload: Uint8Array): string;
};
const initial = await wacBind("packages/quic/test/wac/initial_probe.wac") as unknown as {
  openServer(packet: Uint8Array, clientDcid: Uint8Array, greased: boolean): Uint8Array;
};

const HAS_ACK = 4, HAS_CRYPTO = 8, HAS_CLOSE = 16;

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

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

const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);
const SCID = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);

Deno.test("the ClientHello we write is one we can read", () => {
  // The cheap check, and it is cheap for the reason `seal.test.ts` sets out: both halves are ours,
  // so agreeing proves they agree. It is here to make the network test attributable — a malformed
  // hello and an unacceptable one both look like a server that did not answer.
  const hello = Uint8Array.from(ours.helloOnly(SCID, "localhost"));
  assertEquals(hello[0], 1, "handshake type 1 is client_hello");
  assertEquals(hello.length > 150, true, `and it is a real message: ${hello.length} bytes`);

  // A key share whose private half we hold. x25519 public keys are 32 bytes, and a wrong length here
  // is the difference between a share a server can use and one it reports as a decode error.
  assertEquals(Uint8Array.from(ours.publicKey()).length, 32, "an x25519 public key is 32 bytes");
});

Deno.test("a real QUIC server accepts a first flight we authored end to end", async () => {
  const flight = Uint8Array.from(ours.flight(DCID, SCID, "localhost"));
  assertEquals(flight.length, 1200, "padded to the anti-amplification minimum");

  const reply = await ask(flight);
  if (reply === null) {
    throw new Error(
      "the server did not answer our first flight. Silence is what it gives an unopenable packet " +
      "*and* what it gives one it will not talk to, so this is either the packet layer — which " +
      "seal.test.ts covers — or the hello: the version, the group, the suite, the ALPN, or the " +
      "transport parameters.",
    );
  }

  const payload = Uint8Array.from(initial.openServer(reply, DCID, true));
  assertEquals(payload.length > 0, true, "the server's Initial opens under the id we invented");

  const kinds = frames.kindsIn(payload);
  assertEquals((kinds & HAS_CLOSE) !== 0, false,
    `not a refusal — code 0x${frames.closeCodeIn(payload).toString(16)} ${JSON.stringify(frames.closeReasonIn(payload))}`);
  assertEquals((kinds & HAS_ACK) !== 0, true, "it acknowledges the packet we sent");
  assertEquals((kinds & HAS_CRYPTO) !== 0, true, "and carries handshake bytes");

  // 2 is `server_hello`. Reaching it means quinn parsed a ClientHello we wrote, agreed to TLS 1.3,
  // x25519 and AES-128-GCM, accepted `h3`, and validated transport parameters we encoded.
  assertEquals(frames.handshakeTypeIn(payload), 2, "the handshake message is a ServerHello");
  assertEquals(frames.streamLen(payload) > 30, true,
    `a ServerHello is tens of bytes: ${frames.streamLen(payload)}`);
});

Deno.test("initial_source_connection_id is checked, so the parameters are read and not merely carried", async () => {
  // Identical to the flight above except that the parameter names an id the header does not.
  const other = Uint8Array.from([0x99, 0x88, 0x77, 0x66]);
  const flight = Uint8Array.from(ours.flightMismatched(DCID, SCID, other, "localhost"));

  const reply = await ask(flight);
  if (reply === null) throw new Error("the server did not answer, so nothing was validated");

  const payload = Uint8Array.from(initial.openServer(reply, DCID, true));
  assertEquals((frames.kindsIn(payload) & HAS_CLOSE) !== 0, true,
    "a mismatch is refused, and the refusal is itself a protected Initial we can open");

  // 0x08 is TRANSPORT_PARAMETER_ERROR. The reason quinn writes is `CID authentication failure`,
  // which is not asserted: prose a peer may reword, where the code is the protocol's own word.
  assertEquals(frames.closeCodeIn(payload), 0x08,
    `TRANSPORT_PARAMETER_ERROR, reason ${JSON.stringify(frames.closeReasonIn(payload))}`);
});
