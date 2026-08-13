// The Initial keys, judged by whether quinn's own first flight decrypts.
//
// design/system 0007 step 3, and the first step where being wrong is invisible without an oracle: a
// key that is wrong in one bit produces bytes exactly as random-looking as a right one. There is
// nothing to inspect and nothing to reason about — either the peer's packet opens or it does not.
//
// **What one passing assertion establishes.** RFC 9001's initial salt, transcribed here from memory;
// the four HKDF labels; the sample offset for header protection; the nonce construction; and that
// the AAD is the *unmasked* header. Every one of those is load-bearing, so the ClientHello coming
// out the other end is the whole chain at once. That is the argument for testing this against a peer
// rather than against a fixture of our own making.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/initial_probe.wac") as unknown as {
  open(packet: Uint8Array, greased: boolean): Uint8Array;
  secret(dcid: Uint8Array, isServer: boolean): Uint8Array;
  key(dcid: Uint8Array): Uint8Array;
  iv(dcid: Uint8Array): Uint8Array;
  hp(dcid: Uint8Array): Uint8Array;
  firstCryptoHandshakeType(frames: Uint8Array): number;
};

/** One real Initial from Deno's QUIC client, aimed at a socket that never answers. */
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

Deno.test("quinn's Initial decrypts to a CRYPTO frame carrying a ClientHello", async () => {
  const packet = await anInitial();
  const plain = mod.open(packet, false);

  // An empty answer is every failure at once — bad salt, bad label, wrong sample offset, masked AAD.
  // There is no diagnosis to print here, which is exactly why the assertion is worth having.
  assertEquals(plain.length > 0, true,
    "the packet did not open: the derivation is wrong somewhere and only the peer can say so");

  // RFC 9000 §19: frame type 0x06 is CRYPTO, and inside it an offset, a length, then the TLS
  // handshake — handshake type 1 being ClientHello.
  //
  // Read with the package's **own varint decoder**, through the probe. The first version of this
  // assumed the offset and length were a byte each and read the type one byte early: quinn's
  // ClientHello is 280 bytes, so its length is `41 18`, the two-byte form. Guessing a varint's width
  // is the exact mistake `src/varint.wac` exists to prevent, and a test does not get an exemption.
  assertEquals(mod.firstCryptoHandshakeType(plain), 0x01,
    "the first CRYPTO frame should carry a ClientHello");
});

Deno.test("the keys are the right shapes, and the two directions differ", async () => {
  const dcid = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);

  assertEquals(mod.key(dcid).length, 16, "AES-128-GCM key");
  assertEquals(mod.iv(dcid).length, 12, "a GCM nonce base");
  assertEquals(mod.hp(dcid).length, 16, "the header-protection key");

  // Client and server derive from the same connection id and must not land on the same secret —
  // the labels are the only thing separating them, and swapping them is a silent disaster.
  const client = Array.from(mod.secret(dcid, false)).join(",");
  const server = Array.from(mod.secret(dcid, true)).join(",");
  assertEquals(client === server, false, "client and server initial secrets must differ");
  assertEquals(mod.secret(dcid, false).length, 32, "a SHA-256 secret");
});
