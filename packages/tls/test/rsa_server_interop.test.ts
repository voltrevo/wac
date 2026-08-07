// Our TLS server with an **RSA** certificate, against OpenSSL.
//
// TLS 1.3 removed PKCS#1 v1.5 from signing, so an RSA certificate means `rsa_pss_rsae_sha256` in
// CertificateVerify and nothing else. This server could only sign with ed25519 until now, and the
// reason that mattered is not TLS: **a Tor relay's link certificate is RSA**, ours was ed25519, and a
// relay is therefore distinguishable from every real one by the first thing it sends. See
// `packages/tor/README.md`, *What is not here*.
//
// The key is 1024-bit, which is what tor uses for a link key and is also what our bignum can sign
// with inside a test's patience: a 2048-bit private-key operation is 2048 squarings and
// multiplications of 2048-bit numbers in `modPowSecret`, and the first version of this test sat in
// one for four minutes before being killed. That is a performance fact about `packages/crypto`
// rather than a limit on what works, and it is written down here because a test that hangs teaches
// nothing about why.
//
// The certificate and the key are made by OpenSSL rather than by us, and the client is OpenSSL, so
// nothing in this test is ours on both ends — which for a signature scheme is the only arrangement
// worth having. Our PSS signer and our PSS verifier could be wrong together and agree; OpenSSL has no
// such courtesy.

import { withDeadline } from "../../../harness/deadline.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/tls/test/wac/probe.wac");
const initRsa = mod.srvInitRsa as (
  c: Uint8Array, n: Uint8Array, e: Uint8Array, d: Uint8Array, eph: Uint8Array, r: Uint8Array,
) => Uint8Array;
const feed = mod.srvFeed as (state: Uint8Array, input: Uint8Array) => Uint8Array;
const send = mod.srvSend as (state: Uint8Array, data: Uint8Array) => Uint8Array;
const close = mod.srvClose as (state: Uint8Array) => Uint8Array;
const recordNeeded = mod.srvRecordNeeded as (buf: Uint8Array) => number;

const enc = new TextEncoder();
const dec = new TextDecoder();

function unpack(r: Uint8Array) {
  const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
  let p = 0;
  const take = () => {
    const n = dv.getUint32(p);
    p += 4;
    const b = r.slice(p, p + n);
    p += n;
    return b;
  };
  return { state: take(), toSend: take(), appData: take() };
}

/** An RSA key and a self-signed certificate for it, both made by OpenSSL. */
async function opensslRsaIdentity(dir: string) {
  const gen = await new Deno.Command("openssl", {
    args: ["req", "-x509", "-newkey", "rsa:1024", "-keyout", `${dir}/key.pem`, "-out",
           `${dir}/cert.pem`, "-days", "1", "-nodes", "-subj", "/CN=wac.test",
           "-outform", "DER"],
    stdout: "piped", stderr: "piped",
  }).output();
  if (gen.code !== 0) throw new Error(dec.decode(gen.stderr));

  // The private exponent and modulus, as raw big-endian bytes. `-noout -text` prints them in a
  // colon-separated hex that is easier to parse than re-deriving the DER offsets here.
  const dump = await new Deno.Command("openssl", {
    args: ["rsa", "-in", `${dir}/key.pem`, "-noout", "-text"],
    stdout: "piped", stderr: "piped",
  }).output();
  const text = dec.decode(dump.stdout);
  const field = (name: string) => {
    const m = text.match(new RegExp(`${name}:\\n((?:\\s+[0-9a-f:]+\\n)+)`));
    if (!m) throw new Error(`no ${name} in:\n${text}`);
    const hex = m[1].replace(/[\s:]/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    // OpenSSL prints a leading zero byte on positive integers whose top bit is set.
    return bytes[0] === 0 ? bytes.slice(1) : bytes;
  };
  return {
    cert: await Deno.readFile(`${dir}/cert.pem`),
    n: field("modulus"),
    e: new Uint8Array([0x01, 0x00, 0x01]),
    d: field("privateExponent"),
  };
}

Deno.test("tls: OpenSSL completes a handshake with our server's RSA certificate", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-tls-rsa-" });
  try {
    const id = await opensslRsaIdentity(dir);

    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    const BODY = "hello from wac over TLS 1.3 with an RSA certificate\n";
    const REPLY = `HTTP/1.1 200 OK\r\ncontent-length: ${BODY.length}\r\n` +
      `connection: close\r\n\r\n${BODY}`;

    const done = (async (): Promise<string | null> => {
      let received: string | null = null;
      try {
        const conn = await withDeadline(listener.accept(), `a TLS client on port ${port}`);
        let state = initRsa(id.cert, id.n, id.e, id.d,
                            crypto.getRandomValues(new Uint8Array(32)),
                            crypto.getRandomValues(new Uint8Array(32)));
        let buf = new Uint8Array(0);
        try {
          while (true) {
            const chunk = new Uint8Array(16384);
            const got = await conn.read(chunk);
            if (got === null) break;
            const merged = new Uint8Array(buf.length + got);
            merged.set(buf);
            merged.set(chunk.subarray(0, got), buf.length);
            buf = merged;

            let consumed = 0;
            while (buf.length - consumed >= 5 && recordNeeded(buf.subarray(consumed)) === 0) {
              consumed += 5 + ((buf[consumed + 3] << 8) | buf[consumed + 4]);
            }
            if (consumed === 0) continue;
            const ready = buf.slice(0, consumed);
            buf = buf.slice(consumed);

            const r = unpack(feed(state, ready));
            state = r.state;
            if (r.toSend.length > 0) await conn.write(r.toSend);
            if (r.appData.length > 0) {
              received = dec.decode(r.appData);
              const s = unpack(send(state, enc.encode(REPLY)));
              state = s.state;
              await conn.write(s.toSend);
              const c = unpack(close(state));
              if (c.toSend.length > 0) await conn.write(c.toSend);
              break;
            }
          }
        } finally {
          try { conn.close(); } catch { /* already closed */ }
        }
      } catch { /* the client hung up */ }
      try { listener.close(); } catch { /* already closed */ }
      return received;
    })();

    const proc = new Deno.Command("openssl", {
      args: ["s_client", "-connect", `127.0.0.1:${port}`, "-tls1_3", "-servername", "wac.test",
             "-quiet", "-verify_quiet"],
      stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const w = proc.stdin.getWriter();
    await w.write(enc.encode("GET / HTTP/1.1\r\nHost: wac.test\r\n\r\n"));
    const { stdout, stderr } = await proc.output();
    try { w.releaseLock(); } catch { /* already released */ }
    const received = await done;

    const out = dec.decode(stdout);
    const err = dec.decode(stderr);
    if (received === null) {
      throw new Error(`our server never got a request — the handshake failed.\n${err}`);
    }
    if (!out.includes(BODY)) {
      throw new Error(`OpenSSL did not get the body.\nstdout: ${out}\nstderr: ${err}`);
    }
    // The signature scheme is the point: OpenSSL verified an RSA-PSS CertificateVerify made by us,
    // against a certificate it generated itself.
    if (err.includes("bad signature") || err.includes("decrypt error")) {
      throw new Error(`OpenSSL rejected our signature:\n${err}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
