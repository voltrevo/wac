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
  newAssociation(ourTag: number, initialTsn: number, window: number): unknown;
  associationReassemble(a: unknown, stream: number, flags: number, piece: Uint8Array,
    tsn: number): Uint8Array;
  associationHeld(a: unknown): number;
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array,
    now: bigint): Uint8Array;
  associationInFlight(a: unknown): number;
  associationReceive(a: unknown, pkt: Uint8Array, cookie: Uint8Array, now: bigint): Uint8Array[];
  associationCumulative(a: unknown): number;
  associationAccept(a: unknown, tsn: number): boolean;
  associationSack(a: unknown): Uint8Array;
  sackPacketGaps(tag: number, cum: number, window: number, starts: Int32Array,
    ends: Int32Array): Uint8Array;
  associationFastRetransmits(a: unknown): number;
  sackGapCount(value: Uint8Array): number;
  sackGapStartAt(value: Uint8Array, i: number): number;
  sackGapEndAt(value: Uint8Array, i: number): number;
  tsnIsBefore(a: number, b: number): boolean;
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

Deno.test("a message reassembles when its chunks are reordered on the path", () => {
  // **Reordering is not loss.** UDP may deliver 1, 3, 2, 4 with nothing dropped at all, and a
  // reassembler that concatenates in arrival order turns that into a message the checksum passes
  // and the content is wrong — every piece intact, in the wrong order. There is no error, no alert,
  // nothing in a log; the receiving application just gets rubbish.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  const B = 0x02, E = 0x01;
  const piece = (s: string) => enc.encode(s);

  assertEquals(ours.associationReassemble(a, 0, B, piece("AAA"), 1).length, 0, "a begin, not an end");
  // Now 3 arrives before 2 — it must be held, not appended.
  assertEquals(ours.associationReassemble(a, 0, 0, piece("CCC"), 3).length, 0, "held, out of order");
  assertEquals(ours.associationReassemble(a, 0, 0, piece("BBB"), 2).length, 0, "still no end");
  const whole = new TextDecoder().decode(ours.associationReassemble(a, 0, E, piece("DDD"), 4));
  assertEquals(whole, "AAABBBCCCDDD",
    `the chunks were put together in arrival order rather than TSN order, giving ${whole}`);
});

Deno.test("and it reassembles when the TSNs are negative as an i32, which is half of them", () => {
  // **A TSN is unsigned 32-bit and chosen at random**, so held in an `i32` it is negative about
  // half the time. This test exists because a `-1` sentinel for "no message in progress" was also
  // a TSN Chromium really sent: the browser test failed on four runs in five, and it presented as
  // the browser's message never arriving rather than as anything about a number.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  const base = -102851347;                       // an actual initial TSN from a Chromium run
  const B = 0x02, E = 0x01;
  assertEquals(ours.associationReassemble(a, 0, B | E, enc.encode("hi"), base).length, 2,
    "a whole message in one chunk, at a negative TSN");

  assertEquals(ours.associationReassemble(a, 0, B, enc.encode("AA"), base + 1).length, 0);
  assertEquals(ours.associationReassemble(a, 0, 0, enc.encode("CC"), base + 3).length, 0, "early");
  assertEquals(ours.associationHeld(a), 1, "and held rather than appended");
  assertEquals(ours.associationReassemble(a, 0, 0, enc.encode("BB"), base + 2).length, 0);
  assertEquals(
    new TextDecoder().decode(ours.associationReassemble(a, 0, E, enc.encode("DD"), base + 4)),
    "AABBCCDD");
  assertEquals(ours.associationHeld(a), 0, "the hold list drained");
});

Deno.test("a duplicate of a piece already consumed is ignored, not held forever", () => {
  // The peer resends what our SACK did not cover, so a piece we already joined on comes back.
  // Holding it would leave an entry nothing ever drains — and once the list fills, a genuinely
  // early piece has nowhere to go.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  const B = 0x02, E = 0x01;
  ours.associationReassemble(a, 0, B, enc.encode("AA"), 10);
  ours.associationReassemble(a, 0, 0, enc.encode("BB"), 11);
  assertEquals(ours.associationReassemble(a, 0, 0, enc.encode("BB"), 11).length, 0, "a duplicate");
  assertEquals(ours.associationHeld(a), 0, "which was dropped rather than held");
  assertEquals(
    new TextDecoder().decode(ours.associationReassemble(a, 0, E, enc.encode("CC"), 12)), "AABBCC",
    "and the message is not doubled by it");
});

Deno.test("TSN comparison is serial, so it survives the wrap at 2^32", () => {
  // RFC 1982: subtract and read the sign, because the subtraction wraps the way the counter does.
  assertEquals(ours.tsnIsBefore(1, 2), true);
  assertEquals(ours.tsnIsBefore(2, 1), false);
  assertEquals(ours.tsnIsBefore(-2, -1), true, "negative as an i32 is still just a counter");
  // Across the wrap: 0xFFFFFFFF is -1, and the next TSN is 0. A plain `<` says 0 comes first.
  assertEquals(ours.tsnIsBefore(-1, 0), true, "0xFFFFFFFF comes before 0, which follows it");
  assertEquals(ours.tsnIsBefore(0, -1), false);
});

Deno.test("an acknowledgement clears what it covers even where the TSNs cross 2^31", () => {
  // **The same mistake as the sentinel, one comparison along.** A TSN is unsigned and an
  // association picks its first at random, so a sequence crosses the signed midpoint on about one
  // session in a hundred thousand-odd — and there `flightTsn[i] <= acked` inverts. Nothing is
  // reported: the chunks stay in flight forever, so the congestion window never reopens and the
  // transfer stops, which looks like the peer went quiet.
  const a = ours.newAssociation(0x11111111 | 0, 0x7FFFFFFE | 0, 65536);
  const first = ours.associationSend(a, 0, 51, enc.encode("one"), 0n);
  ours.associationSend(a, 0, 51, enc.encode("two"), 0n);
  const third = ours.associationSend(a, 0, 51, enc.encode("three"), 0n);
  assertEquals(ours.associationInFlight(a), 3, "three sent and unacknowledged");

  const lastTsn = ours.tsnOf(ours.firstChunkValue(third));
  assertEquals(lastTsn < 0, true, `the third TSN wrapped past 2^31 as expected: ${lastTsn}`);
  assertEquals(ours.tsnOf(ours.firstChunkValue(first)) > 0, true, "and the first did not");

  ours.associationReceive(a, ours.sackPacket(0x11111111 | 0, lastTsn, 65536), new Uint8Array(0), 1n);
  assertEquals(ours.associationInFlight(a), 0,
    "the SACK covers all three, but a signed comparison says the first two are still outstanding");
});

Deno.test("the receiver's cumulative point starts empty rather than at a TSN it might be sent", () => {
  // `cumulativeTsn` used -1 for "nothing yet" — and -1 is 0xFFFFFFFF, a TSN a peer really sends.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  assertEquals(ours.associationAccept(a, -1), true, "0xFFFFFFFF is the first chunk we ever see");
  assertEquals(ours.associationCumulative(a), -1);
  assertEquals(ours.associationAccept(a, 1), false,
    "and now a chunk two past it is out of order — with -1 as the sentinel this was taken as the " +
      "first chunk all over again, jumping the cumulative point over one that never arrived");
  assertEquals(ours.associationAccept(a, 0), true, "the immediate successor, across the wrap");
  assertEquals(ours.associationCumulative(a), 1,
    "and it carries 1 with it — that one was recorded when it arrived early, so closing the hole " +
      "in front of it moves the cumulative point over both");
});

Deno.test("a SACK reports the chunks that arrived out of order, so they are not sent twice", () => {
  // **A cumulative point alone understates what arrived.** If 5 is lost and 6, 7, 8 arrive, a SACK
  // saying only "4" makes the peer resend all four — three of which we are holding. Gap blocks are
  // the exceptions to the cumulative number, as offsets from it, and they are what turns one loss
  // into one retransmission.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  for (const t of [1, 2, 3, 4]) assertEquals(ours.associationAccept(a, t), true);
  assertEquals(ours.sackGapCount(ours.associationSack(a)), 0, "nothing is missing yet");

  // 5 is lost; 6, 7, 8 arrive, then 10 after a second hole at 9.
  for (const t of [6, 7, 8, 10]) assertEquals(ours.associationAccept(a, t), false, `${t} is early`);
  const sack = ours.associationSack(a);
  assertEquals(ours.sackCumOf(sack), 4, "the cumulative point is still 4 — 5 never came");
  assertEquals(ours.sackGapCount(sack), 2, "two runs arrived above it: 6-8 and 10");
  // Offsets from the cumulative TSN, per RFC 4960: 6 is +2, 8 is +4.
  assertEquals(ours.sackGapStartAt(sack, 0), 2);
  assertEquals(ours.sackGapEndAt(sack, 0), 4);
  assertEquals(ours.sackGapStartAt(sack, 1), 6, "and 10 is +6, on its own");
  assertEquals(ours.sackGapEndAt(sack, 1), 6);

  // When 5 finally arrives the cumulative point jumps over everything already held.
  assertEquals(ours.associationAccept(a, 5), true);
  const after = ours.associationSack(a);
  assertEquals(ours.sackCumOf(after), 8, "5 closed the first hole and 6, 7, 8 were already here");
  assertEquals(ours.sackGapCount(after), 1, "10 is still a gap, because 9 is still missing");
});

Deno.test("three SACKs reporting a TSN missing resend it without waiting for the timer", () => {
  // **A gap is not a timeout.** A SACK naming later TSNs proves the path is still delivering, so
  // one chunk was dropped rather than the path having failed — and waiting a whole RTO for that is
  // most of the delay a lossy path costs. RFC 4960 §7.2.4: after three further SACKs still report
  // it missing, send it again immediately. Three rather than one, because reordering also produces
  // a gap and resending on the first one would double traffic on a path that lost nothing.
  const a = ours.newAssociation(0x11111111 | 0, 1, 65536);
  for (const body of ["one", "two", "three", "four", "five"]) {
    ours.associationSend(a, 0, 51, enc.encode(body), 0n);
  }
  assertEquals(ours.associationInFlight(a), 5);

  // The peer got 1, lost 2, and has 3, 4, 5: cumulative 1, one gap block at +2..+4.
  const gapSack = () => ours.sackPacketGaps(0x11111111 | 0, 1, 65536,
    Int32Array.from([2]), Int32Array.from([4]));

  let sent = ours.associationReceive(a, gapSack(), new Uint8Array(0), 1n);
  assertEquals(ours.associationInFlight(a), 4, "1 is acknowledged; 2 through 5 are not yet");
  assertEquals(sent.length, 0, "one report is not enough — a reorder looks the same");
  ours.associationReceive(a, gapSack(), new Uint8Array(0), 2n);
  assertEquals(ours.associationFastRetransmits(a), 0, "nor two");

  sent = ours.associationReceive(a, gapSack(), new Uint8Array(0), 3n);
  assertEquals(ours.associationFastRetransmits(a), 1, "the third report resends it");
  assertEquals(sent.length, 1, "and exactly one packet goes out — 2, not 2 through 5");
  assertEquals(ours.tsnOf(ours.firstChunkValue(sent[0])), 2, "the missing one, at its own TSN");

  // And it is not resent again on the next report, or a lossy path would see a burst per SACK.
  ours.associationReceive(a, gapSack(), new Uint8Array(0), 4n);
  assertEquals(ours.associationFastRetransmits(a), 1, "once, until something changes");
});
