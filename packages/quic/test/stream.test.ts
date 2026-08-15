// **A stream, opened by this client, read by a real QUIC server.**
//
// Everything before this reads what a server sent or answers a handshake. This is the first thing
// the client *says* on its own account, and it is what a connection is for. `design/system/0007`
// step 5.
//
// ## The oracle is quinn handing us the bytes back through its own API
//
// A `QuicConn`'s incoming-stream reader yields a stream when the peer opens one, and reading it
// yields the bytes the peer sent. Neither happens unless the packet authenticated, the frame parsed,
// the stream id was one a client is allowed to open, and flow control allowed the data. So "the
// server's application code saw these bytes on stream 0" is a much stronger statement than anything
// this package can check about its own output — and it is checked by an implementation nobody here
// wrote.
//
// ## What is deliberately hardcoded, and why that is the honest shape today
//
// The packet number is passed in. There is no connection state in `Client` yet: no next-number
// counter, no ACK tracking, no retransmission. That is the rest of step 5, and inventing a counter
// here would be pretending the state exists. What this establishes is the *packet* — that a wac
// program can put application data on the wire in a form quinn accepts — and the state is what turns
// one packet into a connection.
//
// The client also never acknowledges anything, so quinn will retransmit and eventually give up on
// this connection. That is fine for one exchange and is exactly what step 5's "survives deliberately
// dropped datagrams" is about.

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
  openApplication(handshakeReply: Uint8Array, packet: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  closeCodeIn(payload: Uint8Array): bigint;
  clientFinishedPacket(datagram: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
  streamPacket(
    handshakeReply: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    streamId: number,
    data: Uint8Array,
    fin: boolean,
    number: number,
  ): Uint8Array;
  streamBytes(
    handshakeReply: Uint8Array,
    packet: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    streamId: number,
  ): Uint8Array;
  streamFinished(
    handshakeReply: Uint8Array,
    packet: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    streamId: number,
  ): boolean;
  applicationPacketNumber(
    handshakeReply: Uint8Array,
    packet: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
  ): number;
  ackPacket(
    handshakeReply: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    largest: number,
    firstRange: number,
    number: number,
  ): Uint8Array;
  lostThenResent(
    handshakeReply: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    streamId: number,
    data: Uint8Array,
  ): Uint8Array[];
  resendAfterAckIsEmpty(
    handshakeReply: Uint8Array,
    dcid: Uint8Array,
    scid: Uint8Array,
    serverName: string,
    data: Uint8Array,
  ): number;
};

type Stream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type Conn = {
  incomingBidirectionalStreams: ReadableStream<Stream>;
  close?(o?: unknown): void;
};
type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<Conn> };
  close(): void;
};

const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);
const SCID = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);

/** Read what the server's application code received on the first stream the client opened. */
async function firstStreamBytes(conn: Conn, ms: number): Promise<Uint8Array | null> {
  const reader = conn.incomingBidirectionalStreams.getReader();
  const stream = await Promise.race([
    reader.read().then((r) => (r.done ? null : r.value)),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
  if (stream === null) return null;
  const body = stream.readable.getReader();
  const out: number[] = [];
  // Read until the stream ends, which our FIN is what causes.
  for (;;) {
    const chunk = await Promise.race([
      body.read(),
      new Promise<{ done: true; value: undefined }>((res) =>
        setTimeout(() => res({ done: true, value: undefined }), ms)
      ),
    ]);
    if (chunk.done) break;
    out.push(...chunk.value!);
  }
  return Uint8Array.from(out);
}

Deno.test({
  name: "a real QUIC server reads a stream this client opened",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
    const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
    const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
      .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
    try {
      let conn: Conn | null = null;
      endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
        .then((c) => { conn = c; })
        .catch(() => {});

      await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
      const reply = await Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (reply === null) throw new Error("the server did not answer our first flight");
      await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);

      // `accept()` resolves on a task of its own once the handshake completes.
      for (let i = 0; i < 40 && conn === null; i++) await new Promise((r) => setTimeout(r, 50));
      if (conn === null) throw new Error("the handshake did not complete, so there is no stream to open");

      // **Stream 0 with FIN.** RFC 9000 §2.1 numbers streams by their initiator and directionality in
      // the low two bits: 0 is the first client-initiated bidirectional stream, which is the one a
      // client opens first and the only id a server will accept from us here. Packet number 0, in the
      // application number space, which starts again at zero.
      const body = new TextEncoder().encode("hello from wac");
      const packet = Uint8Array.from(
        ours.streamPacket(reply, DCID, SCID, "localhost", 0, body, true, 0),
      );
      assertEquals(packet.length > 0, true, "the client produced a packet at all");
      assertEquals((packet[0] & 0x80) === 0, true, "and it is a short header");
      await sock.send(packet, to);

      const got = await firstStreamBytes(conn, 5000);
      if (got === null) {
        throw new Error(
          "the server never saw a stream. The packet authenticated or it did not: the 1-RTT keys " +
            "come off the master secret at the transcript through the server's Finished, the id is " +
            "the one the server chose, the packet number is its own space starting at zero, and the " +
            "first byte's low five bits are header-protected. Any of those wrong is silence.",
        );
      }
      assertEquals(new TextDecoder().decode(got), "hello from wac");
    } finally {
      sock.close();
      endpoint.close();
    }
  },
});

/**
 * The other direction: the server writes on the same stream and this client reads it.
 *
 * The server is an echo, written against Deno's own QUIC API, so the bytes coming back have been
 * through quinn's stream machinery rather than being a datagram we recognise. That is what makes it
 * an answer rather than a reflection of our own frame writer.
 */
Deno.test({
  name: "and answers on it, which this client reads back out of a 1-RTT packet",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
    const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
    const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
      .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
    try {
      // An echo server: read the stream the client opens, upper-case it, send it back on the same
      // stream. Upper-casing rather than echoing verbatim, so a reply that is really our own request
      // coming back off some buffer cannot be mistaken for the server's answer.
      endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
        .then(async (conn) => {
          const reader = conn.incomingBidirectionalStreams.getReader();
          const { value: stream, done } = await reader.read();
          if (done || stream === undefined) return;
          const body = stream.readable.getReader();
          const got: number[] = [];
          for (;;) {
            const chunk = await body.read();
            if (chunk.done) break;
            got.push(...chunk.value);
          }
          const said = new TextDecoder().decode(Uint8Array.from(got));
          const w = stream.writable.getWriter();
          await w.write(new TextEncoder().encode(said.toUpperCase()));
          await w.close();
        })
        .catch(() => {});

      await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
      const reply = await Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (reply === null) throw new Error("the server did not answer our first flight");
      await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);

      const body = new TextEncoder().encode("hello from wac");
      await sock.send(
        Uint8Array.from(ours.streamPacket(reply, DCID, SCID, "localhost", 0, body, true, 0)),
        to,
      );

      // Read datagrams until one of them carries stream 0's data. The server also sends
      // NEW_CONNECTION_ID, acknowledgements and its own HANDSHAKE_DONE, and nothing here tells us
      // which datagram is which until it is opened — so the loop is the honest shape.
      let answer = "";
      let fin = false;
      const deadline = Date.now() + 10_000;
      while (answer === "" && Date.now() < deadline) {
        const got = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);
        if (got === null) break;
        const data = Uint8Array.from(
          ours.streamBytes(reply, got, DCID, SCID, "localhost", 0),
        );
        if (data.length > 0) {
          answer = new TextDecoder().decode(data);
          fin = ours.streamFinished(reply, got, DCID, SCID, "localhost", 0);
        }
      }

      if (answer === "") {
        throw new Error(
          "no datagram carried stream 0's data. Either the server never answered — which would be " +
            "the request not arriving, and the test above says it does — or the reply did not open, " +
            "which is the server-direction 1-RTT keys rather than the client's.",
        );
      }
      assertEquals(answer, "HELLO FROM WAC");
      assertEquals(fin, true, "and the server said it was finished with the stream");
    } finally {
      sock.close();
      endpoint.close();
    }
  },
});

/**
 * Acknowledging what the server sent, and the connection surviving it.
 *
 * **A malformed ACK is not ignored.** RFC 9000 §19.3 makes an ACK that acknowledges a packet number
 * larger than any the peer has sent a `PROTOCOL_VIOLATION`, and a peer that receives one closes the
 * connection. So "the connection still works afterwards" is a real assertion about the frame rather
 * than a formality: an ACK with the fields in the wrong order, a length that disagrees with its
 * contents, or a range reaching past what the server sent, all end the conversation.
 *
 * The second stream is what says the connection is alive. Sending the ACK and asserting nothing would
 * pass with the ACK never having been read at all.
 */
Deno.test({
  name: "an acknowledgement the server accepts, proven by the connection outliving it",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
    const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
    const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
      .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
    try {
      // Two streams, collected in order. The second is the one that matters.
      const heard: string[] = [];
      endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
        .then(async (conn) => {
          const reader = conn.incomingBidirectionalStreams.getReader();
          for (;;) {
            const { value: stream, done } = await reader.read();
            if (done || stream === undefined) return;
            const body = stream.readable.getReader();
            const got: number[] = [];
            for (;;) {
              const chunk = await body.read();
              if (chunk.done) break;
              got.push(...chunk.value);
            }
            heard.push(new TextDecoder().decode(Uint8Array.from(got)));
          }
        })
        .catch(() => {});

      await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
      const reply = await Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (reply === null) throw new Error("the server did not answer our first flight");
      await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);

      await sock.send(
        Uint8Array.from(
          ours.streamPacket(reply, DCID, SCID, "localhost", 0, new TextEncoder().encode("first"), true, 0),
        ),
        to,
      );

      // The server's own 1-RTT packets, and the number of the last one — which is what there is to
      // acknowledge.
      //
      // **Stop at the first one, and do not drain.** Two failures taught this loop its shape and they
      // pull in opposite directions:
      //
      //   - breaking on the first read timeout fails when the machine is busy, because the server's
      //     first 1-RTT packet may not arrive inside 800ms. It did, once, on the run that also had to
      //     compile a newly added wac file;
      //   - *not* breaking fails too, and worse: an unacknowledged peer **retransmits**, so reads
      //     keep succeeding, the loop runs to its deadline, and by the time the acknowledgement goes
      //     out the connection it was about is already being torn down.
      //
      // The way out is to stop needing to drain. Under-acknowledging is always safe and
      // over-acknowledging is a PROTOCOL_VIOLATION, so one number we certainly saw is enough — it
      // need not be the largest the server sent. Waiting for a first 1-RTT packet is then the only
      // thing the deadline is for.
      let largest = -1;
      const deadline = Date.now() + 10_000;
      while (largest < 0 && Date.now() < deadline) {
        const got = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (got === null) continue;
        if ((got[0] & 0x80) !== 0) continue;  // still a long header: handshake traffic
        const n = ours.applicationPacketNumber(reply, got, DCID, SCID, "localhost");
        if (n > largest) largest = n;
      }
      assertEquals(
        largest >= 0,
        true,
        "the server sent no 1-RTT packet within ten seconds, so there was nothing to acknowledge",
      );

      // **The range must actually reach the frame**, checked on packets that are never sent.
      //
      // The keys come from `reply`, so these two can be built for any `largest` regardless of what
      // the server did — and at a `largest` above zero an implementation that ignored `firstRange`
      // produces identical bytes for "this packet alone" and "everything from zero". That is exactly
      // what 0156 was, and without this the fix for it is untested: on a quiet machine the real
      // `largest` is 0, where the two spellings genuinely are the same packet. Verified by putting
      // the bug back — every other case here still passed.
      const alone = Uint8Array.from(ours.ackPacket(reply, DCID, SCID, "localhost", 5, 0, 9));
      const fromZero = Uint8Array.from(ours.ackPacket(reply, DCID, SCID, "localhost", 5, 5, 9));
      assertEquals(alone.length > 0, true, "the probe built no acknowledgement at all");
      assertEquals(
        alone.length !== fromZero.length || alone.some((b, i) => b !== fromZero[i]),
        true,
        "acknowledging one packet and acknowledging everything below it produced the same bytes, " +
          "so `firstRange` is being ignored — issues/system/0156",
      );

      // **The ACK: the one packet we saw, and nothing below it.**
      //
      // This said "everything from zero through the largest we actually saw — and we saw them all,
      // since this reads every datagram the socket delivered", and both halves were wrong. The loop
      // above *stops at the first* 1-RTT packet, so it reads nothing after it; and a datagram the
      // server sent is not a datagram the socket delivered, because this is UDP on a machine three
      // agents share. So whenever the first 1-RTT packet to arrive was not number 0, acknowledging
      // everything below it claimed packets that had never been received — which QUIC answers with
      // PROTOCOL_VIOLATION, 0xa, and a closed connection. On a quiet machine it was always number 0.
      // `issues/system/0156`.
      await sock.send(
        // `firstRange` 0: **this packet and nothing below it.** The loop above stops at the first
        // 1-RTT packet it sees, so that number is the only one we can honestly claim — 0156.
        Uint8Array.from(ours.ackPacket(reply, DCID, SCID, "localhost", largest, 0, 1)),
        to,
      );

      // And a second stream. Stream 4 is the next client-initiated bidirectional one: the low two
      // bits carry the initiator and the directionality, so client bidi streams are 0, 4, 8.
      await sock.send(
        Uint8Array.from(
          ours.streamPacket(reply, DCID, SCID, "localhost", 4, new TextEncoder().encode("second"), true, 2),
        ),
        to,
      );

      // **Waiting, while reading — because the two ways this fails look identical if you only
      // wait.** Nothing arriving is either a server that closed the connection or a server that
      // never got scheduled, and the second happens on a machine three agents share. They differ on
      // the wire: a peer that closes sends a CONNECTION_CLOSE naming a code, and a busy one sends
      // nothing. So the datagrams are read rather than slept through, and the answer is kept.
      // Issue 0149.
      let closeCode = -1n;
      const alive = Date.now() + 5000;
      while (heard.length < 2 && Date.now() < alive) {
        const got = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 100)),
        ]);
        if (got === null || got.length === 0) continue;
        if ((got[0] & 0x80) !== 0) continue;   // a long header is handshake traffic, not this
        const payload = Uint8Array.from(ours.openApplication(reply, got, DCID, SCID, "localhost"));
        if (payload.length === 0) continue;
        const code = ours.closeCodeIn(payload);
        if (code >= 0n) { closeCode = code; break; }
      }
      if (heard.join(",") !== "first,second") {
        throw new Error(
          `the connection did not outlive the acknowledgement: heard ${JSON.stringify(heard.join(","))}, ` +
            `wanted "first,second".\n  ` +
            (closeCode >= 0n
              ? `The server closed with transport error 0x${closeCode.toString(16)}. ` +
                "0xa is PROTOCOL_VIOLATION, which an over-generous or malformed ACK provokes — so " +
                "this is the ACK rather than the streams, and the test above shows a stream " +
                "arriving on its own."
              : "The server sent no CONNECTION_CLOSE, so it did not refuse anything — it never " +
                "answered at all. That is a busy machine rather than a protocol failure (issue " +
                "0149); re-run before reading it as one."),
        );
      }
    } finally {
      sock.close();
      endpoint.close();
    }
  },
});

/**
 * **A deliberately dropped datagram, and the stream arriving anyway.**
 *
 * `design/system/0007` step 5's second done-when clause, and the one that needs a connection rather
 * than a packet: resending means putting the same *frames* in a **new** packet with a new number,
 * because a QUIC packet number is used once — the nonce comes from it, and reusing one under the same
 * key is the failure that loses the key rather than the packet.
 *
 * The loss is real in the only sense a test can make it: the client produced two packets and this
 * sends the second. Nothing on the wire distinguishes that from a path that dropped the first, which
 * is the point — the server has no idea a retransmission is what it is.
 */
Deno.test({
  name: "a dropped datagram is survived: the frames arrive in a later packet",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
    const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
    const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
      .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
    try {
      let conn: Conn | null = null;
      endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
        .then((c) => { conn = c; })
        .catch(() => {});

      await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
      const reply = await Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (reply === null) throw new Error("the server did not answer our first flight");
      await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);
      for (let i = 0; i < 40 && conn === null; i++) await new Promise((r) => setTimeout(r, 50));
      if (conn === null) throw new Error("the handshake did not complete");

      const body = new TextEncoder().encode("survived the drop");
      const [lost, resent] = ours.lostThenResent(reply, DCID, SCID, "localhost", 0, body)
        .map((p) => Uint8Array.from(p));

      assertEquals(lost.length > 0, true, "the connection produced a first packet");
      assertEquals(resent.length > 0, true, "and a retransmission of it");
      // **Different bytes, because a different number.** Sending the same packet twice would be
      // reusing a nonce; this is the check that the retransmission is a new packet rather than a
      // copy, and it is the difference the far end can never see.
      assertEquals(
        [...lost].join(",") === [...resent].join(","),
        false,
        "the retransmission is byte-identical to the packet it replaces, which means the packet " +
          "number — and so the AEAD nonce — was reused",
      );

      // The first is thrown on the floor. Only the second goes out.
      await sock.send(resent, to);

      const got = await firstStreamBytes(conn, 5000);
      if (got === null) {
        throw new Error(
          "the retransmitted frames never reached the server's application. The frames are the same " +
            "bytes the first packet carried, so this is the new packet: its number, its nonce, or " +
            "its header protection.",
        );
      }
      assertEquals(new TextDecoder().decode(got), "survived the drop");
    } finally {
      sock.close();
      endpoint.close();
    }
  },
});

Deno.test("and a packet that was acknowledged is not resent", () => {
  // The other half of surviving loss: resending what already arrived is how a client turns one lost
  // datagram into a connection that never stops repeating itself. No network needed — the question is
  // whether the record was retired, and `connection.test.ts` covers the counting around it.
  const body = new TextEncoder().encode("acknowledged");
  assertEquals(
    ours.resendAfterAckIsEmpty(new Uint8Array(0), DCID, SCID, "localhost", body),
    0,
    "an acknowledged packet has nothing to resend",
  );
});

/**
 * **An ACK the server must refuse, and the close it answers with.**
 *
 * The canary for the diagnosis above (issue 0149). That test distinguishes "the server closed" from
 * "the server never answered" by looking for a CONNECTION_CLOSE — and a signal that has never been
 * seen firing is a signal that might not fire at all. So this provokes one on purpose.
 *
 * RFC 9000 §19.3: acknowledging a packet number larger than any the peer has sent is a
 * PROTOCOL_VIOLATION. The number here is 1000, which no handshake reaches, so the server has no
 * choice about it — and the value is not the point, only that it is past what was sent.
 *
 * This also pins the premise the other test's *message* rests on. It claims an over-generous ACK
 * ends the connection; nothing checked that, so if quinn had merely ignored one, the message would
 * have been sending readers after a cause that was not there.
 */
Deno.test({
  name: "an ACK past what the server sent is refused, and the close says why",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
    const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
    const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
      .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
    try {
      // **The rejection has to be caught on the connection, not on `accept`.** The server closes
      // *after* accepting, so the failure — "unsent packet acked", quinn's own words — surfaces on
      // whatever is reading the connection rather than on the promise that produced it. Uncaught, it
      // fails the module rather than this test, which is a confusing way to learn the canary worked.
      endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
        .then((conn) => {
          // `closed` is a promise the connection carries and nothing else awaits; when the peer is
          // shut down for a protocol violation it is the one that rejects.
          (conn as unknown as { closed?: Promise<unknown> }).closed?.catch(() => {});
          return conn.incomingBidirectionalStreams.getReader().read().catch(() => {});
        })
        .catch(() => {});

      await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
      const reply = await Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (reply === null) throw new Error("the server did not answer our first flight");
      await sock.send(Uint8Array.from(ours.clientFinishedPacket(reply, DCID, SCID, "localhost")), to);

      // Packet number 1000, which the server has certainly not reached.
      // Everything from 0 through 1000, all of which is a lie: `firstRange` matches `largest` on
      // purpose here, because claiming the whole range is what this case is provoking.
      await sock.send(
        Uint8Array.from(ours.ackPacket(reply, DCID, SCID, "localhost", 1000, 1000, 0)),
        to,
      );

      let closeCode = -1n;
      const deadline = Date.now() + 10_000;
      while (closeCode < 0n && Date.now() < deadline) {
        const got = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (got === null || got.length === 0) continue;
        if ((got[0] & 0x80) !== 0) continue;
        const payload = Uint8Array.from(ours.openApplication(reply, got, DCID, SCID, "localhost"));
        if (payload.length === 0) continue;
        const code = ours.closeCodeIn(payload);
        if (code >= 0n) closeCode = code;
      }

      assertEquals(
        closeCode >= 0n,
        true,
        "the server accepted an ACK for a packet it never sent, or closed without saying so — " +
          "either way the CONNECTION_CLOSE the test above relies on did not arrive, and that test " +
          "cannot tell a refusal from a silence any more",
      );
      assertEquals(
        closeCode,
        0x0an,
        `the close carried transport error 0x${closeCode.toString(16)} rather than PROTOCOL_VIOLATION`,
      );
    } finally {
      sock.close();
      endpoint.close();
    }
  },
});
