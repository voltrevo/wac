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
};

type Conn = {
  incomingBidirectionalStreams: ReadableStream<{ readable: ReadableStream<Uint8Array> }>;
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
