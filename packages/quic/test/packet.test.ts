// A QUIC long header, read against a packet a real implementation actually sent.
//
// design/system 0007 step 2. The fixture is **minted rather than transcribed**: pointing Deno's QUIC
// client at a plain UDP socket hands over its first flight, which is a genuine version-1 Initial from
// quinn — 1200 bytes, because of the anti-amplification minimum. Nothing here is copied out of the
// RFC and nothing goes stale, because the packet is made fresh each run by an implementation nobody
// here wrote.
//
// What that buys over a checked-in blob: when quinn changes what it sends — a different connection
// id length, a token, a version — this notices. A blob would keep passing while describing a packet
// no peer sends any more.
//
// The wac side is driven through `wacBind` rather than as a wac test, because the fixture has to be
// obtained from a *process* and wac has no way to reach one.

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
  scidLen(b: Uint8Array, greased: boolean): number;
  numberAt(b: Uint8Array, greased: boolean): number;
  bodyLength(b: Uint8Array, greased: boolean): number;
  shortDcidLen(b: Uint8Array, cidLen: number, greased: boolean): number;
};

/** One real Initial packet, from Deno's QUIC client aimed at a socket that never answers. */
async function anInitial(): Promise<Uint8Array> {
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const port = (sock.addr as Deno.NetAddr).port;
  try {
    // It will never complete — nothing is listening for QUIC — and that is fine: the first flight
    // is sent before any answer is expected, which is exactly the packet this test is about.
    (Deno as unknown as { connectQuic(o: unknown): Promise<unknown> })
      .connectQuic({ hostname: "127.0.0.1", port, alpnProtocols: ["h3"] })
      .catch(() => {});
    const [bytes] = await sock.receive();
    return bytes;
  } finally {
    sock.close();
  }
}

Deno.test("a real Initial from another implementation parses to the fields it has", async () => {
  const packet = await anInitial();

  assertEquals(packet.length >= 1200, true, `an Initial is padded to at least 1200, got ${packet.length}`);
  assertEquals(mod.parseOk(packet, false), true, "the header parses");
  assertEquals(mod.version(packet, false), 1, "version 1");
  assertEquals(mod.packetType(packet, false), 0, "type 0 is Initial");

  // quinn picks its own connection ids; what matters is that they are within the 20 bytes RFC 9000
  // allows and that the parse agrees with the length byte the packet itself carries.
  const dlen = mod.dcidLen(packet, false);
  assertEquals(dlen === packet[5], true, `the DCID length matches the packet's own byte: ${dlen} vs ${packet[5]}`);
  assertEquals(dlen <= 20, true, `a connection id is at most 20 bytes, got ${dlen}`);
  assertEquals(mod.scidLen(packet, false) <= 20, true, "and so is the source id");

  // Everything the header claims has to be inside the datagram. This is the assertion that would
  // catch a length read from the wrong offset, which is the failure mode that looks like corruption.
  const at = mod.numberAt(packet, false);
  assertEquals(at > 0 && at < packet.length, true, `the packet number starts inside the packet: ${at}`);
  assertEquals(at + mod.bodyLength(packet, false) <= packet.length, true,
    "the length field does not run past what arrived");
});

Deno.test("a header that cannot be read completely is refused, not half-read", async () => {
  const packet = await anInitial();

  // Every truncation of a real packet, at the places a parser has a decision to make. None may
  // answer `ok`: a partial header tells a caller nothing it may act on, and returning the fields
  // that happened to fit is how a length gets read from somebody else's payload.
  for (const n of [0, 1, 5, 6, 7, 20, 40]) {
    assertEquals(mod.parseOk(packet.subarray(0, n), false), false, `a ${n}-byte prefix must not parse`);
  }

  // The fixed bit cleared, **with greasing not allowed**, which is what every call in this file
  // passes. RFC 9287 makes the bit negotiable and a real server does send a zero — that is
  // `test/greased.test.ts` — so this asserts the refusal is available, not that no peer greases.
  const noFixed = Uint8Array.from(packet);
  noFixed[0] &= ~0x40;
  assertEquals(mod.parseOk(noFixed, false), false, "a cleared fixed bit is refused");

  // **A connection id longer than 20 bytes, in a packet that is otherwise impeccable.**
  //
  // Flipping the length byte of the real packet is not this test: every later field shifts, the
  // length check catches the mess, and the assertion passes whether or not the bound exists. I
  // wrote it that way first and the canary — deleting `dlen > MAX_CID()` — kept passing, which is
  // the only reason this synthetic packet exists. It is built so that the *only* thing wrong with
  // it is the id length.
  const withCid = (len: number): Uint8Array => {
    const out = [0xC0, 0, 0, 0, 1, len];              // long, fixed, Initial; version 1; DCID length
    for (let i = 0; i < len; i++) out.push(0xAB);     // the id itself
    out.push(0);                                      // no source id
    out.push(0);                                      // token length: a one-byte varint of 0
    out.push(1);                                      // length: one byte follows
    out.push(0x00);                                   // and here it is
    return Uint8Array.from(out);
  };
  assertEquals(mod.parseOk(withCid(20), false), true, "twenty bytes is the largest id there is, and parses");
  assertEquals(mod.parseOk(withCid(21), false), false, "twenty-one is refused — RFC 9000 §17.2");

  // A short header is not a long one, and asking for its DCID with a length nobody agreed is the
  // one thing a short header cannot answer.
  const short = Uint8Array.from(packet);
  short[0] &= ~0x80;
  assertEquals(mod.parseOk(short, false), false, "a short header is not a long header");
  assertEquals(mod.shortDcidLen(short, 8, false), 8, "a short header's DCID is as long as the receiver says");
  assertEquals(mod.shortDcidLen(short, 21, false), 0, "and never longer than 20");
});
