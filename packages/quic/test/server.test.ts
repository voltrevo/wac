// **The mirror: Deno's QUIC client against a server written here.**
//
// `design/system/0007` step 6. Every test before this one has our client and somebody else's server;
// this is the roles swapped, and it is the arrangement that catches a mistake made consistently in
// both directions. Our client and our server could agree about a wrong transcript, a wrong label, or
// a wrong parameter, and every test up to now would pass.
//
// ## The oracle, and why it is a hard one
//
// `Deno.connectQuic` resolves when the handshake completes and never otherwise. Underneath is quinn
// and rustls, which means our ServerHello has to parse, our key share has to produce the same secret,
// our EncryptedExtensions has to carry transport parameters including the
// `original_destination_connection_id` a client checks, our Certificate has to chain to a root the
// client was given, our CertificateVerify has to be a valid RSA-PSS signature over the transcript,
// and our Finished has to be an HMAC the client recomputes. Any one of those wrong is a connection
// that does not happen.
//
// `caCerts` is what makes it runnable offline: the client is told to trust the CA that signed the
// certificate in `packages/tls/test/data`, which is ours, so nothing here needs the internet or a
// real name. The client dials **127.0.0.1** rather than `localhost` — measured, not assumed: the same
// certificate against Deno's own QUIC server fails the name check for `localhost` and passes for the
// address.
//
// ## What this does not establish
//
// One handshake, on loopback, with no Retry and no address validation. A server that answers every
// packet immediately is the shape that amplifies an attack at a spoofed address, and `server.wac`
// says so where somebody might otherwise take this test as a licence.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const srv = await wacBind("packages/quic/test/wac/srv_probe.wac") as unknown as {
  readable(
    certDer: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, scid: Uint8Array, datagram: Uint8Array,
  ): boolean;
  flight(
    certDer: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, scid: Uint8Array, datagram: Uint8Array,
  ): Uint8Array;
  streamBytes(
    certDer: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, scid: Uint8Array,
    clientInitial: Uint8Array, packet: Uint8Array, streamId: number,
  ): Uint8Array;
  answer(
    certDer: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, scid: Uint8Array,
    clientInitial: Uint8Array, streamId: number, data: Uint8Array, num: number,
  ): Uint8Array;
  done(
    certDer: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, scid: Uint8Array,
    clientInitial: Uint8Array, num: number,
  ): Uint8Array;
};

/**
 * An RSA identity for `127.0.0.1`: a CA, and a leaf it signed.
 *
 * Generated rather than taken from `packages/tls/test/data`, because the shipped leaf's key is
 * **ed25519** and this server signs RSA-PSS — which is the scheme that matters for interoperability
 * here, since a Tor relay's link certificate is RSA and `packages/tls`'s own RSA server exists for
 * that reason.
 */
async function identity(dir: string) {
  const dec = new TextDecoder();
  const run = async (args: string[]) => {
    const r = await new Deno.Command("openssl", { args, stdout: "piped", stderr: "piped" }).output();
    if (r.code !== 0) throw new Error(`openssl ${args[0]}: ${dec.decode(r.stderr)}`);
    return r.stdout;
  };

  // **A CA and a leaf, not one self-signed certificate.** The first version used `req -x509` for
  // both roles at once and rustls refused it: `CaUsedAsEndEntity`. A certificate with
  // `basicConstraints CA:TRUE` may sign others and may not be the end of a chain, and a client that
  // let one be both would accept any certificate any CA had ever issued as that CA's own identity.
  await run(["req", "-x509", "-newkey", "rsa:2048", "-keyout", `${dir}/ca.key`, "-out",
             `${dir}/ca.pem`, "-days", "1", "-nodes", "-subj", "/CN=wac-quic-ca",
             "-addext", "basicConstraints=critical,CA:TRUE"]);
  await run(["req", "-newkey", "rsa:2048", "-keyout", `${dir}/leaf.key`, "-out", `${dir}/leaf.csr`,
             "-nodes", "-subj", "/CN=wac.test"]);
  // The IP SAN is what lets the client dial an address. Measured, not assumed: the same client
  // against Deno's own QUIC server fails the name check for `localhost` and passes for `127.0.0.1`.
  await Deno.writeTextFile(`${dir}/ext.cnf`, "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
  await run(["x509", "-req", "-in", `${dir}/leaf.csr`, "-CA", `${dir}/ca.pem`, "-CAkey",
             `${dir}/ca.key`, "-CAcreateserial", "-out", `${dir}/leaf.pem`, "-days", "1",
             "-extfile", `${dir}/ext.cnf`]);
  const certDer = await run(["x509", "-in", `${dir}/leaf.pem`, "-outform", "DER"]);

  // The modulus and private exponent, out of `openssl rsa -noout -text`. That is the route
  // `packages/tls/test/rsa_server_interop.test.ts` already takes: `crypto.subtle` will not import
  // this key, and parsing the DER with our own ASN.1 would put our code on both sides of a test whose
  // whole purpose is that it is not.
  const text = dec.decode(await run(["rsa", "-in", `${dir}/leaf.key`, "-noout", "-text"]));
  const field = (name: string) => {
    const m = text.match(new RegExp(`${name}:\\n((?:\\s+[0-9a-f:]+\\n)+)`));
    if (!m) throw new Error(`no ${name} in:\n${text}`);
    const hex = m[1].replace(/[\s:]/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    // OpenSSL prints a leading zero on positive integers whose top bit is set.
    return bytes[0] === 0 ? bytes.slice(1) : bytes;
  };

  return {
    certDer,
    caPem: await Deno.readTextFile(`${dir}/ca.pem`),
    n: field("modulus"),
    e: new Uint8Array([0x01, 0x00, 0x01]),
    d: field("privateExponent"),
  };
}

type Endpoint = { addr: Deno.NetAddr; close(): void };

const SCID = Uint8Array.from([0xA1, 0xB2, 0xC3, 0xD4]);

Deno.test({
  name: "a real QUIC client completes a handshake with a server written here",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-quic-server-" });
    const { certDer, caPem: ca, n, e, d } = await identity(dir);

    // Fixed randomness, so a failing run is the same failing run twice — `hello_probe.wac` makes the
    // same argument about the client, and `stream.test.ts`'s freshness test is where the other
    // property is checked.
    const scalar = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 255);
    const random = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 23) & 255);

    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const port = (sock.addr as Deno.NetAddr).port;
    let answered = false;
    let readOk = false;

    // The server loop: one datagram in, one flight out. It runs for the length of the connect
    // attempt and then stops, which is all a single handshake needs.
    // Closing the socket cancels a pending `receive`, which surfaces as an Interrupted error rather
    // than a resolved read — so the loop ends on it rather than letting it become the test's failure.
    // Without this, a handshake that *worked* fails the test with "operation canceled".
    const serving = (async () => {
      try {
      for (let i = 0; i < 8; i++) {
        const got = await Promise.race([
          sock.receive(),
          new Promise<null>((r) => setTimeout(() => r(null), 8000)),
        ]);
        if (got === null) return;
        const [datagram, from] = got;
        readOk = srv.readable(certDer, n, e, d, scalar, random, SCID, Uint8Array.from(datagram));
        const out = Uint8Array.from(
          srv.flight(certDer, n, e, d, scalar, random, SCID, Uint8Array.from(datagram)),
        );
        if (out.length === 0) continue;
        answered = true;
        await sock.send(out, from as Deno.NetAddr);
      }
      } catch (e) {
        if (!(e instanceof Deno.errors.Interrupted || e instanceof Deno.errors.BadResource)) throw e;
      }
    })();

    try {
      const conn = await (Deno as unknown as { connectQuic(o: unknown): Promise<{ close(): void }> })
        .connectQuic({
          hostname: "127.0.0.1",
          port,
          alpnProtocols: ["h3"],
          caCerts: [ca],
        });
      conn.close();
    } catch (err) {
      const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(
        `the client did not complete the handshake: ${why}\n` +
          `  the server read the client's Initial: ${readOk}\n` +
          `  the server produced a flight:         ${answered}\n` +
          "  If it read the Initial and produced nothing, the ClientHello parsed and something after " +
          "it did not — the key share, or the RSA signature. If it produced a flight and the client " +
          "refused it, the flight is wrong: the ServerHello, the transport parameters (a client " +
          "checks original_destination_connection_id), the certificate chain, the CertificateVerify " +
          "signature, or the Finished.",
      );
    } finally {
      sock.close();
      await serving;
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }

    assertEquals(readOk, true, "the server read the client's Initial");
    assertEquals(answered, true, "and answered it");
  },
});

/**
 * **Step 5's test with the roles swapped**: a real client opens a stream to our server, and reads
 * what our server says back.
 *
 * The handshake test above proves the flight. This proves the epoch after it, which is a different
 * set of keys taken at a different point in the transcript — through *our* Finished — and a different
 * packet shape, since 1-RTT packets have short headers with no length and an id length only the
 * receiver knows.
 *
 * The server loop is deliberately dumb: it answers the first datagram with a flight and every later
 * one it can open as a stream. There is no connection state on this side — `connection.wac` is what
 * counts packets, and a server wants one of those per client, which is the next thing rather than
 * this one.
 */
Deno.test({
  name: "...and a real client opens a stream on it, and reads the answer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-quic-server-stream-" });
    const { certDer, caPem: ca, n, e, d } = await identity(dir);
    const scalar = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 255);
    const random = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 23) & 255);

    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const port = (sock.addr as Deno.NetAddr).port;
    let first: Uint8Array | null = null;
    let heard = "";

    const serving = (async () => {
      try {
        let number = 0;
        for (let i = 0; i < 40; i++) {
          const got = await sock.receive();
          const [datagram, from] = got;
          const dg = Uint8Array.from(datagram);
          if (first === null) {
            // The client's Initial. Answer it, and remember it: every key on this side derives from
            // the handshake it started, and `Server.of` is a pure function of that one datagram.
            first = dg;
            const flight = Uint8Array.from(srv.flight(certDer, n, e, d, scalar, random, SCID, dg));
            if (flight.length === 0) return;
            await sock.send(flight, from as Deno.NetAddr);
            // HANDSHAKE_DONE, which is what lets a client consider the handshake confirmed.
            const done = Uint8Array.from(srv.done(certDer, n, e, d, scalar, random, SCID, dg, number++));
            if (done.length > 0) await sock.send(done, from as Deno.NetAddr);
            continue;
          }
          if ((dg[0] & 0x80) !== 0) continue;  // a long header: still handshake traffic
          const bytes = Uint8Array.from(
            srv.streamBytes(certDer, n, e, d, scalar, random, SCID, first, dg, 0),
          );
          if (bytes.length === 0) continue;
          heard = new TextDecoder().decode(bytes);
          const reply = Uint8Array.from(
            srv.answer(certDer, n, e, d, scalar, random, SCID, first, 0,
                       new TextEncoder().encode(heard.toUpperCase()), number++),
          );
          if (reply.length > 0) await sock.send(reply, from as Deno.NetAddr);
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.Interrupted || err instanceof Deno.errors.BadResource)) {
          throw err;
        }
      }
    })();

    try {
      const conn = await (Deno as unknown as {
        connectQuic(o: unknown): Promise<{
          createBidirectionalStream(): Promise<{
            readable: ReadableStream<Uint8Array>;
            writable: WritableStream<Uint8Array>;
          }>;
          close(): void;
        }>;
      }).connectQuic({ hostname: "127.0.0.1", port, alpnProtocols: ["h3"], caCerts: [ca] });

      const stream = await conn.createBidirectionalStream();
      const w = stream.writable.getWriter();
      await w.write(new TextEncoder().encode("hello server"));
      await w.close();

      // The server sets FIN, so this ends on the stream ending rather than on the timeout — which is
      // why the timeout can be generous without costing anything. It is generous because the run that
      // also has to compile a wac file is slower than the twelve after it, and this package already
      // carries issues about tests going red under load.
      const r = stream.readable.getReader();
      const out: number[] = [];
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          r.read(),
          new Promise<{ done: true; value: undefined }>((res) =>
            setTimeout(() => res({ done: true, value: undefined }), 8000)
          ),
        ]);
        if (chunk.done) break;
        out.push(...chunk.value!);
      }
      conn.close();

      assertEquals(heard, "hello server", "the server read what the client sent");
      assertEquals(
        new TextDecoder().decode(Uint8Array.from(out)),
        "HELLO SERVER",
        "and the client read what the server said back",
      );
    } finally {
      sock.close();
      await serving;
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
