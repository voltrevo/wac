// SCTP framing, against aiortc's own parser and against CRC-32c's published vector.
//
// `design/system/0008` step 4, first increment: the common header, chunks, the checksum, and the
// INIT/COOKIE-ECHO shapes an association handshake is made of.
//
// ## The two oracles, and what each can see
//
//   - **`google-crc32c`** — the C library aiortc depends on — and the vector every CRC-32c
//     implementation is checked against, `crc32c("123456789") = 0xE3069283`. A checksum is a value,
//     so it has a right answer that does not depend on anyone's parser.
//   - **`aiortc.rtcsctptransport.parse_packet`**, which validates the checksum before it will look
//     at a chunk and raises if it disagrees. So a packet it parses is one whose CRC it recomputed
//     independently, over the same bytes, with the field zeroed the same way — which is more than
//     the vector proves, because the vector says nothing about *where* the checksum goes or what it
//     covers.
//
// Nothing here runs an association: DATA, SACK and retransmission are the next increment, and until
// they exist there is nothing to associate about.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/sctp_probe.wac") as unknown as {
  crcOf(data: Uint8Array): number;
  initPacket(initiateTag: number, window: number, outbound: number, inbound: number, tsn: number): Uint8Array;
  cookieEchoPacket(tag: number, cookie: Uint8Array): Uint8Array;
  crcVerifies(b: Uint8Array): boolean;
  tagOf(b: Uint8Array): number;
  firstChunkKind(b: Uint8Array): number;
  firstChunkSize(b: Uint8Array): number;
  firstChunkValue(b: Uint8Array): Uint8Array;
  initTagOf(value: Uint8Array): number;
  cookieOf(value: Uint8Array): Uint8Array;
  chunkKinds(b: Uint8Array): Int32Array;
  dataPacket(tag: number, tsn: number, streamId: number, streamSeq: number, ppid: number,
    payload: Uint8Array): Uint8Array;
  sackPacket(tag: number, cumulativeTsn: number, window: number): Uint8Array;
  openChannelPacket(tag: number, tsn: number, streamId: number, label: string, protocol: string): Uint8Array;
  ackChannelPacket(tag: number, tsn: number, streamId: number): Uint8Array;
  tsnOf(value: Uint8Array): number;
  streamOf(value: Uint8Array): number;
  streamSeqOf(value: Uint8Array): number;
  ppidOf(value: Uint8Array): number;
  payloadOf(value: Uint8Array): Uint8Array;
  sackCumOf(value: Uint8Array): number;
  labelOf(msg: Uint8Array): string;
  kPpidString(): number;
  kPpidStringEmpty(): number;
  kPpidDcep(): number;
};

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function python(code: string): Promise<string> {
  const p = new Deno.Command("python3", { args: ["-c", code], stdout: "piped", stderr: "piped" });
  const { code: rc, stdout, stderr } = await p.output();
  if (rc !== 0) {
    throw new Error(`python exited ${rc}: ${new TextDecoder().decode(stderr).trim().slice(-400)}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

Deno.test("CRC-32c is Castagnoli's, not the one packages/gzip has", async () => {
  // The check vector every CRC-32c implementation prints, and the reason it is worth stating: the
  // two polynomials agree on nothing, so an implementation that reached for the CRC already in this
  // repository would be wrong on the very first packet — which is the good kind of wrong.
  assertEquals(ours.crcOf(enc.encode("123456789")) >>> 0, 0xE3069283, `crc32c("123456789")`);
  assertEquals(ours.crcOf(new Uint8Array(0)) >>> 0, 0, "and the empty input is zero");

  // Against the library aiortc itself uses, over inputs long enough to exercise the loop.
  for (const s of ["", "a", "hello world", "x".repeat(300)]) {
    const theirs = await python(
      `import google_crc32c; print(google_crc32c.value(${JSON.stringify(s)}.encode()))`,
    );
    assertEquals(ours.crcOf(enc.encode(s)) >>> 0, Number(theirs), `crc32c(${JSON.stringify(s)})`);
  }
});

Deno.test("aiortc parses our INIT, checksum and all", async () => {
  const packet = ours.initPacket(0x12345678, 65536, 16, 16, 1);
  assertEquals(ours.crcVerifies(packet), true, "our own check agrees first");
  assertEquals(ours.tagOf(packet), 0, "an INIT carries verification tag zero — there is no peer yet");
  assertEquals(ours.firstChunkKind(packet), 1, "chunk type 1 is INIT");

  // **`parse_packet` verifies the checksum before anything else** and raises when it disagrees, so
  // getting a chunk back at all is the assertion. It is also what checks the little-endian
  // placement, which the CRC vector above cannot see.
  const out = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
src, dst, tag, chunks = parse_packet(binascii.unhexlify("${hex(packet)}"))
c = chunks[0]
print(src, dst, tag, type(c).__name__, c.initiate_tag, c.advertised_rwnd,
      c.outbound_streams, c.inbound_streams, c.initial_tsn)
`);
  const [src, dst, tag, kind, initiate, rwnd, outbound, inbound, tsn] = out.split(" ");
  assertEquals(kind, "InitChunk", "aiortc read it as an INIT");
  assertEquals(`${src},${dst}`, "5000,5000", "the ports WebRTC fixes and ignores");
  assertEquals(tag, "0");
  assertEquals(initiate, String(0x12345678), "our initiate tag survived the round trip");
  assertEquals(rwnd, "65536");
  assertEquals(`${outbound},${inbound}`, "16,16", "and the stream counts");
  assertEquals(tsn, "1");
});

Deno.test("and refuses one whose checksum we corrupt, so parsing is evidence", async () => {
  // The canary. `parse_packet` succeeding above proves something only if it can fail — and a parser
  // that ignored the checksum would accept both of these.
  const packet = ours.initPacket(1, 65536, 16, 16, 1);

  const badCrc = Uint8Array.from(packet);
  badCrc[8] ^= 1;
  assertEquals(ours.crcVerifies(badCrc), false, "we refuse it too");
  const refused = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
try:
    parse_packet(binascii.unhexlify("${hex(badCrc)}"))
    print("accepted")
except Exception as e:
    print("refused")
`);
  assertEquals(refused, "refused", "one bit of the checksum and aiortc refuses the packet");

  // **And a big-endian checksum**, which is the mistake worth pinning: every other field in SCTP is
  // network order and this one is not, so writing it the obvious way produces a packet that verifies
  // against your own code and against nobody else's.
  const swapped = Uint8Array.from(packet);
  swapped.set([packet[11], packet[10], packet[9], packet[8]], 8);
  if (hex(swapped) !== hex(packet)) {         // a palindromic checksum would make this vacuous
    assertEquals(ours.crcVerifies(swapped), false, "the bytes reversed is not the same checksum");
    const beRefused = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
try:
    parse_packet(binascii.unhexlify("${hex(swapped)}"))
    print("accepted")
except Exception:
    print("refused")
`);
    assertEquals(beRefused, "refused", "and aiortc refuses it as well");
  }
});

Deno.test("a COOKIE-ECHO carries the peer's tag and the cookie unchanged", async () => {
  const cookie = Uint8Array.from({ length: 37 }, (_, i) => (i * 3 + 1) & 0xFF);
  const packet = ours.cookieEchoPacket(0xDEADBEEF | 0, cookie);
  assertEquals(ours.crcVerifies(packet), true);
  assertEquals(ours.tagOf(packet) >>> 0, 0xDEADBEEF,
    "everything after the INIT carries the tag the peer chose, which is how a stale packet from a " +
      "previous association is told from a live one");
  // Thirty-seven bytes of cookie means three of padding, and the padding is in the packet but not
  // in the chunk's length — the same rule STUN has and the same place to get it wrong.
  assertEquals(ours.firstChunkSize(packet), 44, "4 + 37 rounded up to 44");
  assertEquals(hex(Uint8Array.from(ours.firstChunkValue(packet))), hex(cookie),
    "and the value read back is the cookie without the padding");

  const out = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
_, _, tag, chunks = parse_packet(binascii.unhexlify("${hex(packet)}"))
print(type(chunks[0]).__name__, binascii.hexlify(chunks[0].body).decode())
`);
  const [kind, body] = out.split(" ");
  assertEquals(kind, "CookieEchoChunk");
  assertEquals(body, hex(cookie), "aiortc reads the same cookie, padding excluded");
});

Deno.test("a chunk length under four is refused rather than walked", () => {
  // Without this a zero length is a step of zero and the walk never ends — the classic way a packet
  // parser hangs on input somebody else chose, and worth a case because the loop looks obviously
  // terminating until it is not.
  const packet = Uint8Array.from(ours.initPacket(1, 65536, 16, 16, 1));
  const zeroed = Uint8Array.from(packet);
  zeroed[14] = 0;
  zeroed[15] = 0;
  assertEquals(ours.firstChunkSize(zeroed), -1, "a length of zero is not a chunk");
  const short = Uint8Array.from(packet);
  short[14] = 0;
  short[15] = 3;
  assertEquals(ours.firstChunkSize(short), -1, "nor is three");
  const past = Uint8Array.from(packet);
  past[14] = 0xFF;
  assertEquals(ours.firstChunkSize(past), -1, "nor a length past the end of the packet");
  assertEquals([...ours.chunkKinds(zeroed)].length, 0, "so the walk finds nothing and terminates");
  assertEquals([...ours.chunkKinds(packet)].join(","), "1", "and the good packet still walks");
});

Deno.test("aiortc reads our DATA chunk, field for field", async () => {
  const payload = enc.encode("hello from wac");
  const packet = ours.dataPacket(0x11223344 | 0, 7, 3, 5, ours.kPpidString(), payload);
  assertEquals(ours.crcVerifies(packet), true);

  const value = Uint8Array.from(ours.firstChunkValue(packet));
  assertEquals(ours.tsnOf(value), 7);
  assertEquals(ours.streamOf(value), 3);
  assertEquals(ours.streamSeqOf(value), 5);
  assertEquals(ours.ppidOf(value), 51, "PPID 51 is a UTF-8 string");
  assertEquals(new TextDecoder().decode(Uint8Array.from(ours.payloadOf(value))), "hello from wac");

  const out = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
_, _, _, chunks = parse_packet(binascii.unhexlify("${hex(packet)}"))
c = chunks[0]
print(type(c).__name__, c.tsn, c.stream_id, c.stream_seq, c.protocol, c.flags, c.user_data.decode())
`);
  const [kind, tsn, sid, sseq, ppid, flags, body] = out.split(" ");
  assertEquals(kind, "DataChunk");
  assertEquals(`${tsn},${sid},${sseq},${ppid}`, "7,3,5,51", "aiortc agrees about every field");
  // **Both flags, which is the ordinary case and the one that is forgotten.** A chunk with neither
  // B nor E is a middle fragment of a message that never ends, and a receiver holds it forever.
  assertEquals(flags, "3", "begin and end together: a whole message in one chunk");
  assertEquals(body, "hello", "and the payload, up to the first space this test splits on");
});

Deno.test("and our SACK, which is a cumulative point and not a list", async () => {
  const packet = ours.sackPacket(0x55667788 | 0, 42, 65536);
  assertEquals(ours.sackCumOf(Uint8Array.from(ours.firstChunkValue(packet))), 42);
  const out = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii
_, _, _, chunks = parse_packet(binascii.unhexlify("${hex(packet)}"))
c = chunks[0]
print(type(c).__name__, c.cumulative_tsn, c.advertised_rwnd, len(c.gaps), len(c.duplicates))
`);
  assertEquals(out, "SackChunk 42 65536 0 0",
    "cumulative through 42, no gaps and no duplicates — which is correct and slow, because a " +
      "receiver that never reports a gap makes the sender resend what it could have been told arrived");
});

Deno.test("a data channel is opened by a DCEP message inside a DATA chunk", async () => {
  // RFC 8832. A data channel has no identifier beyond the SCTP stream it runs on, which is why
  // opening one is a *message* on that stream rather than a negotiation.
  const packet = ours.openChannelPacket(1, 1, 0, "chat", "");
  const value = Uint8Array.from(ours.firstChunkValue(packet));
  assertEquals(ours.ppidOf(value), 50, "PPID 50 is DCEP, which is how a peer knows it is control");
  assertEquals(ours.labelOf(Uint8Array.from(ours.payloadOf(value))), "chat");

  const out = await python(`
from aiortc.rtcsctptransport import parse_packet
import binascii, struct
_, _, _, chunks = parse_packet(binascii.unhexlify("${hex(packet)}"))
c = chunks[0]
d = c.user_data
msg_type, channel_type, priority, reliability, label_len, proto_len = struct.unpack_from("!BBHLHH", d)
label = d[12:12+label_len].decode()
print(c.protocol, msg_type, channel_type, label_len, repr(label))
`);
  assertEquals(out, `50 3 0 4 'chat'`,
    "aiortc's own PPID constant is 50, the message type is 3 (DATA_CHANNEL_OPEN), the channel " +
      "type 0 (reliable and ordered), and the label is four bytes of 'chat'");

  // And the ACK, which is one byte.
  const ack = ours.ackChannelPacket(1, 2, 0);
  const ackValue = Uint8Array.from(ours.firstChunkValue(ack));
  assertEquals(Uint8Array.from(ours.payloadOf(ackValue)).length, 1);
  assertEquals(Uint8Array.from(ours.payloadOf(ackValue))[0], 0x02, "DATA_CHANNEL_ACK");
});

Deno.test("an empty string has its own protocol identifier, because SCTP cannot carry nothing", () => {
  // The detail that is invisible until a peer sends `""`: a DATA chunk with no user data is a
  // protocol error, so an empty string goes as one padding byte under PPID 56 and the receiver
  // discards the byte. An implementation that sent a zero-length chunk instead would be refused by
  // the peer for a reason that says nothing about empty strings.
  assertEquals(ours.kPpidStringEmpty(), 56);
  assertEquals(ours.kPpidString(), 51);
  assertEquals(ours.kPpidDcep(), 50);
});
