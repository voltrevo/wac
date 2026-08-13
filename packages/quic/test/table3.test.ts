// **RFC 9000 table 3, both columns.** Every frame type, at its real length, and only in the packet
// types that may carry it.
//
// `frame.test.ts` covers the five an Initial may hold, against a real Initial from quinn. That is the
// right oracle for those and there is no equivalent for the rest: getting a server to send a
// STREAMS_BLOCKED on demand is a test about provoking quinn, not about reading a frame. So these are
// hand-encoded from §19, which makes the RFC the oracle directly — each case is the encoding written
// out, and if it disagrees with the reader one of the two is wrong in a way that is visible here.
//
// ## The two questions, kept apart
//
// **Length** is what lets the walk continue: a frame read one byte short makes every frame after it
// garbage, and the garbage is attacker-chosen. Every case below asserts the exact size.
//
// **Fields** are what the frame means. A frame can be sized right and parsed wrong — the id and the
// token swapped inside a NEW_CONNECTION_ID occupies the same bytes — so the ones with fields anything
// will read are read here too. That is the repository's own rule about a field carried and never
// checked, applied to a file that just gained fifteen of them.
//
// **Epoch** is the third column and the reason this file exists rather than a longer `frame.test.ts`:
// table 3 says which packet types may carry each frame, and until now nothing enforced it. An
// application-level CONNECTION_CLOSE in an Initial used to be accepted.

import { wacBind } from "../../../harness/wacBind.ts";

const EPOCH_INITIAL = 0;
const EPOCH_HANDSHAKE = 1;
const EPOCH_0RTT = 2;
const EPOCH_1RTT = 3;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const mod = await wacBind("packages/quic/test/wac/frame_probe.wac") as unknown as {
  kindAtIn(b: Uint8Array, at: number, epoch: number): number;
  sizeAtIn(b: Uint8Array, at: number, epoch: number): number;
  streamId(b: Uint8Array, at: number): bigint;
  streamOffset(b: Uint8Array, at: number): bigint;
  streamData(b: Uint8Array, at: number): Uint8Array;
  streamFin(b: Uint8Array, at: number): boolean;
  newCid(b: Uint8Array, at: number): Uint8Array;
  newCidSeq(b: Uint8Array, at: number): bigint;
  newCidToken(b: Uint8Array, at: number): Uint8Array;
  maxStreamDataFor(b: Uint8Array, at: number): bigint;
  maxStreamsIsUni(b: Uint8Array, at: number): boolean;
  streamText(payload: Uint8Array, id: number): string;
  streamWholeFor(payload: Uint8Array, id: number): boolean;
  streamFinFor(payload: Uint8Array, id: number): boolean;
  streamLenFor(payload: Uint8Array, id: number): number;
};

const TOKEN = Array.from({ length: 16 }, (_, i) => 0xA0 + i);
const CID = [0xDE, 0xAD, 0xBE, 0xEF, 0x01];
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * One row of table 3: the bytes, the type it should read as, its length, and where it is legal.
 *
 * Every value below 64 encodes as one varint byte, which is why the numbers are small — these test
 * the frame layout, and `varint_wac.test.ts` tests the encoding at every boundary. The one two-byte
 * varint is deliberate: a frame whose length is computed as "one byte per field" passes every other
 * case here.
 */
const ROWS: Array<{ what: string; bytes: number[]; kind: number; size: number; where: number[] }> = [
  { what: "PADDING", bytes: [0x00, 0x00, 0x00], kind: 0x00, size: 3,
    where: [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_0RTT, EPOCH_1RTT] },
  { what: "PING", bytes: [0x01], kind: 0x01, size: 1,
    where: [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_0RTT, EPOCH_1RTT] },
  // largest 5, delay 0, one range block, first-range 5.
  { what: "ACK", bytes: [0x02, 5, 0, 0, 5], kind: 0x02, size: 5,
    where: [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_1RTT] },
  { what: "RESET_STREAM", bytes: [0x04, 4, 7, 60], kind: 0x04, size: 4, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "STOP_SENDING", bytes: [0x05, 4, 7], kind: 0x05, size: 3, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "CRYPTO", bytes: [0x06, 0, 2, 0xAA, 0xBB], kind: 0x06, size: 5,
    where: [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_1RTT] },
  { what: "NEW_TOKEN", bytes: [0x07, 3, 9, 9, 9], kind: 0x07, size: 5, where: [EPOCH_1RTT] },
  // STREAM with LEN and FIN: type 0x0b = 0x08 | LEN | FIN. id 4, length 2, two bytes.
  { what: "STREAM len+fin", bytes: [0x0b, 4, 2, 0x11, 0x22], kind: 0x09, size: 5,
    where: [EPOCH_0RTT, EPOCH_1RTT] },
  // STREAM with OFF and LEN, no FIN: 0x0e. **A two-byte varint offset**, 0x4123 = 289.
  { what: "STREAM off+len", bytes: [0x0e, 4, 0x41, 0x23, 2, 0x33, 0x44], kind: 0x08, size: 7,
    where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "MAX_DATA", bytes: [0x10, 63], kind: 0x10, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "MAX_STREAM_DATA", bytes: [0x11, 4, 60], kind: 0x11, size: 3, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "MAX_STREAMS bidi", bytes: [0x12, 8], kind: 0x12, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "MAX_STREAMS uni", bytes: [0x13, 8], kind: 0x13, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "DATA_BLOCKED", bytes: [0x14, 20], kind: 0x14, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "STREAM_DATA_BLOCKED", bytes: [0x15, 4, 20], kind: 0x15, size: 3, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "STREAMS_BLOCKED bidi", bytes: [0x16, 3], kind: 0x16, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "STREAMS_BLOCKED uni", bytes: [0x17, 3], kind: 0x17, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  // seq 1, retire 0, a 5-byte id, a 16-byte token: 1 + 1 + 1 + 1 + 5 + 16.
  { what: "NEW_CONNECTION_ID", bytes: [0x18, 1, 0, CID.length, ...CID, ...TOKEN], kind: 0x18, size: 25,
    where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "RETIRE_CONNECTION_ID", bytes: [0x19, 2], kind: 0x19, size: 2, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "PATH_CHALLENGE", bytes: [0x1a, ...EIGHT], kind: 0x1a, size: 9, where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "PATH_RESPONSE", bytes: [0x1b, ...EIGHT], kind: 0x1b, size: 9, where: [EPOCH_1RTT] },
  { what: "CONNECTION_CLOSE transport", bytes: [0x1c, 10, 0, 1, 0x21], kind: 0x1c, size: 5,
    where: [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_1RTT] },
  { what: "CONNECTION_CLOSE application", bytes: [0x1d, 10, 1, 0x21], kind: 0x1c, size: 4,
    where: [EPOCH_0RTT, EPOCH_1RTT] },
  { what: "HANDSHAKE_DONE", bytes: [0x1e], kind: 0x1e, size: 1, where: [EPOCH_1RTT] },
];

const ALL = [EPOCH_INITIAL, EPOCH_HANDSHAKE, EPOCH_0RTT, EPOCH_1RTT];

Deno.test("every frame in table 3 reads as itself, at its documented length", () => {
  for (const row of ROWS) {
    const b = Uint8Array.from(row.bytes);
    // Read in an epoch that permits it, so this is about the encoding and not about the column.
    const epoch = row.where[row.where.length - 1];
    assertEquals(mod.kindAtIn(b, 0, epoch), row.kind, `${row.what}: read as the wrong type`);
    assertEquals(mod.sizeAtIn(b, 0, epoch), row.size, `${row.what}: read at the wrong length`);
  }
});

Deno.test("and only in the packet types table 3 permits", () => {
  for (const row of ROWS) {
    const b = Uint8Array.from(row.bytes);
    for (const epoch of ALL) {
      if (row.where.includes(epoch)) continue;
      // -4 is NotPermitted: a frame this reader knows, in a packet that may not carry it. Not -2,
      // which would mean the reader had never heard of it — the two are different accusations.
      assertEquals(mod.kindAtIn(b, 0, epoch), -4, `${row.what} should not be legal in epoch ${epoch}`);
      assertEquals(mod.sizeAtIn(b, 0, epoch), 0, `${row.what}: and the walk must stop`);
    }
  }
});

Deno.test("a walk over all of them ends exactly at the end", () => {
  // Every frame end to end, in an epoch that permits the lot. This is the assertion the individual
  // lengths above cannot make: one frame short by a byte and the next type read is whatever byte
  // happened to be there, so reaching the last frame means every length before it was right.
  const legal = ROWS.filter((r) => r.where.includes(EPOCH_1RTT));
  const all: number[] = [];
  for (const r of legal) all.push(...r.bytes);
  const b = Uint8Array.from(all);

  let at = 0;
  let seen = 0;
  while (at < b.length) {
    const size = mod.sizeAtIn(b, at, EPOCH_1RTT);
    if (size === 0) {
      throw new Error(
        `the walk stopped ${seen} frames in, at byte ${at} of ${b.length} — the frame before it was ` +
          `sized wrong, so this is reading a type out of the middle of ${legal[seen]?.what}`,
      );
    }
    assertEquals(mod.kindAtIn(b, at, EPOCH_1RTT), legal[seen].kind, `frame ${seen} (${legal[seen].what})`);
    at += size;
    seen++;
  }
  assertEquals(seen, legal.length, "every frame was walked");
  assertEquals(at, b.length, "and the walk ended exactly at the end");
});

Deno.test("a STREAM frame's fields, which are what step 5 will read", () => {
  // 0x0b: LEN and FIN. Stream 4, no offset field, two bytes, and the stream ends here.
  const withLen = Uint8Array.from([0x0b, 4, 2, 0x11, 0x22]);
  assertEquals(mod.streamId(withLen, 0), 4n);
  assertEquals(mod.streamOffset(withLen, 0), 0n, "no OFF bit means offset zero, not offset absent");
  assertEquals([...mod.streamData(withLen, 0)].join(","), "17,34");
  assertEquals(mod.streamFin(withLen, 0), true);

  // 0x0e: OFF and LEN, no FIN. The offset is the two-byte varint 0x4123, which is 0x123 = 291.
  const withOff = Uint8Array.from([0x0e, 4, 0x41, 0x23, 2, 0x33, 0x44]);
  assertEquals(mod.streamOffset(withOff, 0), 291n, "a two-byte varint offset");
  assertEquals(mod.streamFin(withOff, 0), false);
  assertEquals([...mod.streamData(withOff, 0)].join(","), "51,68");

  // **No LEN bit: the frame runs to the end of the packet.** This is the case a reader that always
  // expected a length gets wrong, and it gets it wrong by reading the next frame's bytes as this
  // frame's length — so it is worth its own line.
  const toEnd = Uint8Array.from([0x08, 4, 0x77, 0x88, 0x99]);
  assertEquals([...mod.streamData(toEnd, 0)].join(","), "119,136,153");
  assertEquals(mod.sizeAtIn(toEnd, 0, EPOCH_1RTT), 5, "and it takes the whole buffer");
});

Deno.test("a NEW_CONNECTION_ID's parts land where they belong", () => {
  const b = Uint8Array.from([0x18, 1, 0, CID.length, ...CID, ...TOKEN]);
  assertEquals(mod.newCidSeq(b, 0), 1n);
  assertEquals([...mod.newCid(b, 0)].join(","), CID.join(","));
  assertEquals([...mod.newCidToken(b, 0)].join(","), TOKEN.join(","));

  // A zero-length id is a protocol violation rather than an empty id: a peer using zero-length ids
  // cannot be handed a new one, so RFC 9000 §19.15 fixes the range at 1 to 20.
  const zero = Uint8Array.from([0x18, 1, 0, 0, ...TOKEN]);
  assertEquals(mod.kindAtIn(zero, 0, EPOCH_1RTT), -4, "a zero-length id is refused");
  const tooLong = Uint8Array.from([0x18, 1, 0, 21, ...Array(21).fill(1), ...TOKEN]);
  assertEquals(mod.kindAtIn(tooLong, 0, EPOCH_1RTT), -4, "and so is one past 20");

  // Truncated before the token: the frame is not there, and that is Incomplete rather than a
  // violation — the datagram may simply have ended.
  assertEquals(mod.kindAtIn(b.subarray(0, b.length - 1), 0, EPOCH_1RTT), -1, "a byte short is Incomplete");
});

Deno.test("MAX_STREAM_DATA and MAX_STREAMS read their numbers and their kind", () => {
  assertEquals(mod.maxStreamDataFor(Uint8Array.from([0x11, 4, 60]), 0), 60n);
  assertEquals(mod.maxStreamsIsUni(Uint8Array.from([0x12, 8]), 0), false, "0x12 is bidirectional");
  assertEquals(mod.maxStreamsIsUni(Uint8Array.from([0x13, 8]), 0), true, "0x13 is unidirectional");
});

Deno.test("a stream is reassembled by offset, not by arrival", () => {
  // The same argument `frame.test.ts` makes about CRYPTO, for the same reason and on the path that
  // carries application data. A fourteen-byte echo arrives in one frame and never exercises this;
  // packet reordering is what does, which is to say only in production.
  //
  // Two frames, the second one first: offsets 3 and 0. `0x0e` is STREAM with OFF and LEN.
  const later = [0x0e, 0, 3, 3, 0x64, 0x65, 0x66];   // "def" at offset 3
  const first = [0x0e, 0, 0, 3, 0x61, 0x62, 0x63];   // "abc" at offset 0
  const payload = Uint8Array.from([...later, ...first]);
  assertEquals(mod.streamText(payload, 0), "abcdef", "arrival order is not offset order");
  assertEquals(mod.streamWholeFor(payload, 0), true);

  // A gap is not a short read. Offsets 0 and 4 with nothing between is a stream this reader cannot
  // represent — one packet has nowhere to keep the pieces — so it says so rather than handing back
  // "abc\0\0" and letting a caller believe it.
  const gapped = Uint8Array.from([...first, 0x0e, 0, 6, 2, 0x67, 0x68]);
  assertEquals(mod.streamWholeFor(gapped, 0), false, "a hole is reported, not zero-filled");
  assertEquals(mod.streamLenFor(gapped, 0), 0, "and nothing is handed back");

  // Frames for another stream in the same payload are not this stream's data. A reader that walked
  // frames and ignored the id would pass every case above.
  const mixed = Uint8Array.from([...first, 0x0e, 4, 0, 3, 0x78, 0x79, 0x7a]);
  assertEquals(mod.streamText(mixed, 0), "abc", "stream 4's bytes are not stream 0's");
  assertEquals(mod.streamText(mixed, 4), "xyz");

  // FIN is a fact about the stream, so it is reported even when the data has a hole — a caller that
  // has to buffer still needs to know the peer has stopped sending.
  const finished = Uint8Array.from([...first, 0x0f, 0, 6, 2, 0x67, 0x68]);
  assertEquals(mod.streamFinFor(finished, 0), true, "the fin bit is read");
  assertEquals(mod.streamWholeFor(finished, 0), false, "and it does not paper over the gap");
});
