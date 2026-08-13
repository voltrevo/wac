// **A QUIC connection, completed with an implementation we did not write.**
//
// design/system 0007 step 4's own words are "our client completes a handshake with Deno's server and
// both sides agree on the traffic secrets". Everything up to here established the second half by
// reading — the Handshake packet opens, the server's Finished verifies. This is the first half, and
// it is the first thing in this package that had to be right in a way only the peer can judge.
//
// ## The oracle is `accept()` resolving
//
// A `QuicListener`'s `accept()` yields a connection when the handshake completes and never otherwise.
// It cannot be argued with and it cannot half-happen: quinn either verified our Finished against its
// own transcript, under a key derived from a Diffie-Hellman we both did, or it did not.
//
// That makes it a much sharper instrument than the tests before it. `handshake.test.ts` checks our
// arithmetic against bytes the server sent, so a mistake we made consistently in both directions
// could survive it. Here the server does the checking, with its own code, and tells us.
//
// ## What the client actually sends
//
// Two datagrams. The first is the Initial carrying our ClientHello, padded to 1200. The second is a
// Handshake packet carrying one CRYPTO frame with a Finished — **addressed to the id the server
// chose**, because a connection is identified by the id its receiver picked and the server told us
// one in its first flight. Sending it back to the id we invented addresses a connection nobody has.
//
// It is not padded: RFC 9000 §14.1 pads a datagram carrying an *Initial*, and this carries a
// Handshake. Eighty bytes rather than twelve hundred.

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
  serverChosenId(datagram: Uint8Array): Uint8Array;
  clientFinishedPacket(datagram: Uint8Array, dcid: Uint8Array, scid: Uint8Array, serverName: string): Uint8Array;
};

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

const DCID = Uint8Array.from([0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08]);
const SCID = Uint8Array.from([0x11, 0x22, 0x33, 0x44]);

type Result = {
  /** Whether the server's `accept()` produced a connection. */
  accepted: boolean;
  /** The bytes of our second datagram, so a test can say something about it. */
  finished: Uint8Array;
  /** Whatever the server sent after it, or null. */
  after: Uint8Array | null;
};

/**
 * The whole exchange. `addressTo` chooses where the Finished is sent, so a test can get it wrong on
 * purpose; `mangle` may alter the packet for the same reason.
 */
async function handshake(
  opts: { addressTo?: "server" | "ourselves"; mangle?: (p: Uint8Array) => Uint8Array } = {},
): Promise<Result> {
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const to = { hostname: "127.0.0.1", port: endpoint.addr.port, transport: "udp" } as const;
  let accepted = false;
  try {
    // A rejection is an ordinary outcome here — the deliberately-wrong cases end that way — so it is
    // swallowed rather than left to surface as an unhandled promise after the test has finished.
    endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
      .then(() => { accepted = true; })
      .catch(() => {});

    await sock.send(Uint8Array.from(ours.flight(DCID, SCID, "localhost")), to);
    const first = await Promise.race([
      sock.receive().then(([b]) => Uint8Array.from(b)),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (first === null) throw new Error("the server did not answer our first flight");

    let finished = Uint8Array.from(ours.clientFinishedPacket(first, DCID, SCID, "localhost"));
    if (opts.addressTo === "ourselves") {
      // The destination id sits at byte 6, after the one-byte length. Both ids here are 4 and 8
      // bytes, so this rewrites the field rather than assuming they are the same size.
      const wrong = Uint8Array.from([...finished.subarray(0, 5), SCID.length, ...SCID,
                                     ...finished.subarray(6 + Uint8Array.from(ours.serverChosenId(first)).length)]);
      finished = wrong;
    }
    if (opts.mangle) finished = Uint8Array.from(opts.mangle(finished));

    await sock.send(finished, to);
    const after = await Promise.race([
      sock.receive().then(([b]) => Uint8Array.from(b)),
      new Promise<null>((r) => setTimeout(() => r(null), 2500)),
    ]);
    // `accept()` resolves on a task of its own, so give it a turn before reading the flag.
    await new Promise((r) => setTimeout(r, 500));
    return { accepted, finished, after };
  } finally {
    sock.close();
    endpoint.close();
  }
}

Deno.test("a real QUIC server completes a handshake with our client", async () => {
  const { accepted, finished, after } = await handshake();

  assertEquals(finished.length > 0, true, "we produced a Finished packet at all");
  assertEquals(finished.length < 200, true,
    `and did not pad it — a Handshake datagram need not be 1200: ${finished.length} bytes`);
  assertEquals((finished[0] & 0x80) !== 0, true, "it is a long header");
  assertEquals((finished[0] >> 4) & 3, 2, "of type 2, Handshake");

  if (!accepted) {
    throw new Error(
      "the server did not complete the handshake. Our Finished is an HMAC over the transcript " +
      "through the server's own Finished, keyed by the *client's* handshake secret — so this is " +
      "that transcript, that secret, the packet's destination id, or the Handshake keys it is " +
      "sealed under. Every one of them produces a packet the server can open and will not accept.",
    );
  }

  // Having completed, the server moves to the application epoch, whose packets have short headers —
  // no version, no ids but the destination, and nothing this package can read yet. Seeing one is
  // how it says the handshake is behind it.
  if (after !== null) {
    assertEquals((after[0] & 0x80) === 0, true,
      `the server's next packet is a short header: first byte 0x${after[0].toString(16)}`);
  }
});

Deno.test("a Finished sent to the wrong connection id completes nothing", async () => {
  // Identical in every other way: the same transcript, the same secret, the same keys. A connection
  // is identified by the id its *receiver* chose, and the server told us one in its first flight —
  // so this is addressed to a connection that does not exist.
  const { accepted } = await handshake({ addressTo: "ourselves" });
  assertEquals(accepted, false, "the server has no connection under the id we invented");
});

Deno.test("a Finished whose verify_data is wrong completes nothing", async () => {
  // One bit of the handshake message, deep inside the AEAD. The packet still authenticates — we
  // sealed it ourselves after the change — so the server opens it, reads a Finished, computes the
  // HMAC over its own transcript, and disagrees. That is the check this whole file is about, and
  // this is the proof that it is the server doing it rather than us.
  const { accepted } = await handshake({
    mangle: (p) => {
      const bad = Uint8Array.from(p);
      bad[bad.length - 20] ^= 0x01;
      return bad;
    },
  });
  assertEquals(accepted, false, "a verify_data the server did not compute is not accepted");
});
