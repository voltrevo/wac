// The frames inside a real Initial, and the ClientHello they add up to.
//
// design/system 0007 step 4, first slice. Step 3 established that quinn's first flight *decrypts*;
// the payload it decrypts to was never read. This reads it: walk the frames, reassemble the CRYPTO
// stream, and hand what falls out to `packages/tls`'s handshake parser.
//
// **The oracle is that a TLS parser nobody wrote for this recognises the result.** A frame walk that
// got a length wrong produces bytes that are not a ClientHello, and `parseClientHello` says so — by
// a random that is not 32 bytes, a key share that is empty, a version that is not TLS 1.3. There is
// nothing to eyeball: decrypted QUIC payload and garbage look identical.
//
// The packet is minted from Deno's QUIC client each run rather than checked in, so when quinn
// changes what it sends — a different frame order, a token, ECN counts in an ACK — this notices. A
// blob would keep passing while describing a flight no peer sends any more.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/frame_probe.wac") as unknown as {
  opens(b: Uint8Array): boolean;
  frameCount(b: Uint8Array): number;
  walkWhole(b: Uint8Array): boolean;
  paddingBytes(b: Uint8Array): number;
  cryptoLen(b: Uint8Array): number;
  cryptoWhole(b: Uint8Array): boolean;
  handshakeType(b: Uint8Array): number;
  helloRandomLen(b: Uint8Array): number;
  helloOffersTls13(b: Uint8Array): boolean;
  helloKeyShareLen(b: Uint8Array): number;
  helloSuite(b: Uint8Array): number;
  kindAt(b: Uint8Array, at: number): number;
  sizeAt(b: Uint8Array, at: number): number;
  ackLargest(b: Uint8Array, at: number): number;
  closeReason(b: Uint8Array, at: number): string;
  streamLen(p: Uint8Array): number;
  streamWhole(p: Uint8Array): boolean;
  streamByte(p: Uint8Array, i: number): number;
};

/** One real Initial, from Deno's QUIC client aimed at a socket that never answers. */
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

Deno.test("a real Initial's payload walks to frames with nothing left over", async () => {
  const packet = await anInitial();
  assertEquals(mod.opens(packet), true, "step 3's claim, restated: the packet decrypts");

  // Every byte accounted for. This is the assertion that catches a length read one byte off: the
  // walk would stop early on a frame it could not read, and `walkWhole` would be false.
  assertEquals(mod.walkWhole(packet), true, "the walk consumed the payload exactly");
  assertEquals(mod.frameCount(packet) > 0, true, "at least one frame");

  // An Initial is padded to 1200 bytes because of anti-amplification, and the padding is inside the
  // encrypted payload rather than after it — so most of what decrypts is zeros.
  const pad = mod.paddingBytes(packet);
  assertEquals(pad > 500, true, `an Initial is mostly padding, got ${pad} bytes`);
});

Deno.test("the CRYPTO frames reassemble into a ClientHello that packages/tls recognises", async () => {
  const packet = await anInitial();

  assertEquals(mod.cryptoWhole(packet), true, "no hole in the CRYPTO stream");
  const n = mod.cryptoLen(packet);
  assertEquals(n > 100, true, `a ClientHello is hundreds of bytes, got ${n}`);

  // 1 is `client_hello`. A wrong reassembly lands on a byte that is some other message type, or on
  // padding, so this single number is most of the check.
  assertEquals(mod.handshakeType(packet), 1, "the first handshake message is a ClientHello");

  // …and the parse has to make sense of it. Each of these is a different way the bytes could be
  // right by accident: a 32-byte random is a fixed-width field at a fixed offset, the key share is
  // length-prefixed deep inside an extension, and the version comes from a different extension
  // again. All three landing means the whole message is where the walk said it was.
  assertEquals(mod.helloRandomLen(packet), 32, "a ClientHello random is 32 bytes");
  assertEquals(mod.helloOffersTls13(packet), true, "a QUIC client must offer TLS 1.3");
  assertEquals(mod.helloKeyShareLen(packet) > 32, true,
    `the client offered a key share we know: ${mod.helloKeyShareLen(packet)} bytes of group ++ key`);
  assertEquals(mod.helloSuite(packet), 0x1301, "quinn offers TLS_AES_128_GCM_SHA256");
});

// ── The frames a real Initial does not contain ────────────────────────────────
//
// quinn's first flight is PADDING and CRYPTO. The other three an Initial may carry are built by
// hand here, because the walk has to get their lengths right too and there is no peer that will
// send one on demand.

Deno.test("ACK, PING and CONNECTION_CLOSE are read at their real lengths", () => {
  // PING is one byte and nothing else.
  assertEquals(mod.kindAt(Uint8Array.from([0x01]), 0), 0x01, "PING");
  assertEquals(mod.sizeAt(Uint8Array.from([0x01]), 0), 1, "PING is one byte");

  // ACK: type, largest=9, delay=3, range count=1, first range=0, then one (gap, length) pair. The
  // pair is the part a naive reader skips, and skipping it puts the next frame two bytes early.
  const ack = Uint8Array.from([0x02, 9, 3, 1, 0, 2, 1, /* the next frame: */ 0x01]);
  assertEquals(mod.kindAt(ack, 0), 0x02, "ACK");
  assertEquals(mod.ackLargest(ack, 0), 9, "largest acknowledged");
  assertEquals(mod.sizeAt(ack, 0), 7, "type, four varints and one range pair");
  assertEquals(mod.kindAt(ack, mod.sizeAt(ack, 0)), 0x01, "and the frame after it is the PING");

  // The ECN form adds three counts and nothing else, so it is three bytes longer here.
  const ecn = Uint8Array.from([0x03, 9, 3, 1, 0, 2, 1, 0, 0, 0, 0x01]);
  assertEquals(mod.sizeAt(ecn, 0), 10, "the ECN form carries three more counts");
  assertEquals(mod.kindAt(ecn, mod.sizeAt(ecn, 0)), 0x01, "and the PING is still found");

  // CONNECTION_CLOSE, transport form: code, the frame type that caused it, then a reason.
  const enc = new TextEncoder();
  const reason = enc.encode("no");
  const close = Uint8Array.from([0x1c, 0x0a, 0x06, reason.length, ...reason]);
  assertEquals(mod.kindAt(close, 0), 0x1c, "CONNECTION_CLOSE");
  assertEquals(mod.closeReason(close, 0), "no", "the reason comes back");
  assertEquals(mod.sizeAt(close, 0), 6, "type, code, frame type, length, two bytes");

  // The application form has no frame type, so the same bytes minus one mean the same thing.
  const appClose = Uint8Array.from([0x1d, 0x0a, reason.length, ...reason]);
  assertEquals(mod.closeReason(appClose, 0), "no", "the application form has no frame type field");
  assertEquals(mod.sizeAt(appClose, 0), 5, "one field shorter");
});

Deno.test("a frame that will not fit stops the walk, and so does one nobody knows", () => {
  // Every truncation of a CRYPTO frame: type, offset, length, then the data it promised.
  const crypto = Uint8Array.from([0x06, 0, 4, 0xDE, 0xAD, 0xBE, 0xEF]);
  assertEquals(mod.sizeAt(crypto, 0), 7, "whole, it is seven bytes");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assertEquals(mod.sizeAt(crypto.subarray(0, n), 0), 0, `a ${n}-byte prefix cannot be read whole`);
    assertEquals(mod.kindAt(crypto.subarray(0, n), 0), -1, `and says so as Incomplete, not as a frame`);
  }

  // **An unknown type is not skipped.** There is nothing to skip over — a frame's length lives in
  // its own encoding — so the walk stops. 0x08 is STREAM, which is a real frame and still not one
  // an Initial may carry, which makes it the honest example: legal elsewhere, unreadable here.
  const stream = Uint8Array.from([0x08, 1, 2, 3, 4]);
  assertEquals(mod.kindAt(stream, 0), -2, "Unknown, distinct from Incomplete");
  assertEquals(mod.sizeAt(stream, 0), 0, "and the walk stops rather than guessing a length");
});

Deno.test("the CRYPTO stream is reassembled by offset, not by arrival", () => {
  // Two frames, the second one first: offsets 2 and 0. A reader that concatenated in arrival order
  // would answer "CDAB" and be wrong in a way nothing downstream could detect.
  const outOfOrder = Uint8Array.from([
    0x06, 2, 2, 0x43, 0x44, // offset 2, two bytes "CD"
    0x06, 0, 2, 0x41, 0x42, // offset 0, two bytes "AB"
  ]);
  assertEquals(mod.streamLen(outOfOrder), 4, "four bytes in total");
  assertEquals(mod.streamWhole(outOfOrder), true, "and no hole between them");
  assertEquals(mod.streamByte(outOfOrder, 0), 0x41, "A first");
  assertEquals(mod.streamByte(outOfOrder, 2), 0x43, "then C at offset 2");

  // A hole: offset 0 never arrives, so nothing may be handed to a parser. TLS is a stream and a
  // message is not there until its bytes are — answering with the later fragment would be handing
  // a parser the middle of a message and calling it the start.
  const hole = Uint8Array.from([0x06, 4, 2, 0x45, 0x46]);
  assertEquals(mod.streamLen(hole), 0, "nothing contiguous from zero");
  assertEquals(mod.streamWhole(hole), false, "and it says something arrived early");

  // Padding around CRYPTO is ordinary and must not end the walk or enter the stream.
  const padded = Uint8Array.from([0x00, 0x00, 0x00, 0x06, 0, 1, 0x5A, 0x00, 0x00]);
  assertEquals(mod.streamLen(padded), 1, "one byte of handshake between the zeros");
  assertEquals(mod.streamByte(padded, 0), 0x5A, "and it is the one that was sent");
});
