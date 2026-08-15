// A complete DTLS 1.2 handshake with OpenSSL, from ClientHello to both Finisheds.
//
// `design/system/0008` step 3's done-when, in the form OpenSSL can adjudicate: it accepts our
// Finished — which it can only do if our master secret, our key block, our transcript and our record
// protection are all right — and sends one of its own that we verify.
//
// ## Why this is the test the others were building toward
//
// Every piece has an oracle already: the PRF against `openssl kdf`, the record layer against a real
// server's answers, AES-GCM against Python. What none of them can check is the **transcript** — which
// messages are hashed, in what order, with which headers — because a transcript is not a value
// anything else will tell you. The Finished is the only place a wrong one shows up, and it shows up
// as a `decrypt_error` alert with nothing else to go on. So this test is also the reason the earlier
// ones exist: when it fails, they are what says the cause is not the keys.
//
// ## What is deliberately still missing
//
// The server's certificate is **not verified**. That is the next increment and it is the one that
// makes the handshake mean anything — a DTLS handshake that completes with whoever answered is
// exactly the hole `packages/quic` had until this week. The test says so where it reads past the
// Certificate, and `README.md` lists it.

import { wacBind } from "../../../harness/wacBind.ts";
import { dtlsServer } from "./sserver.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/dtls_probe.wac") as unknown as {
  hello(random: Uint8Array, cookie: Uint8Array, messageSeq: number, sequence: bigint): Uint8Array;
  sizeAt(b: Uint8Array, at: number): number;
  kindAt(b: Uint8Array, at: number): number;
  handshakeKindAt(b: Uint8Array, at: number): number;
  cookieAt(b: Uint8Array, at: number): Uint8Array;
  alertAt(b: Uint8Array, at: number): number;
  curveAt(b: Uint8Array, at: number): number;
  serverPublicAt(b: Uint8Array, at: number): Uint8Array;
  fragInfoAt(b: Uint8Array, at: number): Int32Array;
  fragBodyAt(b: Uint8Array, at: number): Uint8Array;
  reheaded(kind: number, messageSeq: number, body: Uint8Array): Uint8Array;
  curveOfBody(body: Uint8Array): number;
  publicOfBody(body: Uint8Array): Uint8Array;
  ourPublic(curve: number, scalar: Uint8Array): Uint8Array;
  preMaster(curve: number, scalar: Uint8Array, peer: Uint8Array): Uint8Array;
  ckeMessage(publicKey: Uint8Array, messageSeq: number): Uint8Array;
  finishedMessage(master: Uint8Array, transcript: Uint8Array, messageSeq: number, asClient: boolean): Uint8Array;
  masterFrom(pms: Uint8Array, cr: Uint8Array, sr: Uint8Array): Uint8Array;
  blockFrom(master: Uint8Array, sr: Uint8Array, cr: Uint8Array): Uint8Array;
  sealedRecord(key: Uint8Array, iv: Uint8Array, epoch: number, seq: bigint, kind: number,
    plain: Uint8Array): Uint8Array;
  openedAt(b: Uint8Array, at: number, key: Uint8Array, iv: Uint8Array): Uint8Array;
  leafOf(body: Uint8Array): Uint8Array;
  fingerprintOf(der: Uint8Array): Uint8Array;
  keyExchangeSigned(certBody: Uint8Array, skeBody: Uint8Array, cr: Uint8Array, sr: Uint8Array): boolean;
  signatureOver(certBody: Uint8Array, skeBody: Uint8Array, signed: Uint8Array): boolean;
  schemeOf(skeBody: Uint8Array): number;
  signedBytes(cr: Uint8Array, sr: Uint8Array, skeBody: Uint8Array): Uint8Array;
};

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Fixed inputs, so a failing run and the one before it print the same bytes. */
const RANDOM = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xFF);
const SCALAR = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xFF);

/** Shared with `dtls.test.ts` — `sserver.ts` says why it holds stdin rather than piping a `sleep`. */
const server = dtlsServer;

Deno.test({
  name: "OpenSSL completes a DTLS handshake with us: it accepts our Finished and we verify its",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = server();
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const to = { hostname: "127.0.0.1", port: srv.port, transport: "udp" } as const;
    const recv = (ms = 5000) =>
      Promise.race([
        sock.receive().then(([b]) => Uint8Array.from(b)),
        new Promise<null>((r) => setTimeout(() => r(null), ms)),
      ]);

    try {
      await new Promise((r) => setTimeout(r, 800));

      // ── Flight 1: the cookie exchange ──────────────────────────────────────────────────────────
      await sock.send(ours.hello(RANDOM, new Uint8Array(0), 0, 0n), to);
      const verify = await recv();
      if (verify === null) throw new Error("no HelloVerifyRequest");
      const cookie = Uint8Array.from(ours.cookieAt(verify, 0));

      // **The transcript starts here.** RFC 6347 §4.2.6 excludes the first ClientHello and the
      // HelloVerifyRequest, because at the time it sent them the client could not know whether they
      // would be part of a session at all. The cookied hello is message zero of the hash.
      const second = ours.hello(RANDOM, cookie, 1, 1n);
      const clientHelloMsg = second.subarray(13);      // the handshake message, header included
      await sock.send(second, to);

      // ── Flight 2: the server's, across as many datagrams as it takes ───────────────────────────
      // **Reassembled by message_seq**, because a handshake message is fragmented whenever it does
      // not fit in a datagram, and OpenSSL fragments the ServerKeyExchange of an ECDHE handshake as
      // a matter of course — seventeen bytes in one datagram and ninety-four in the next. A reader
      // that took each fragment for a message saw a ServerKeyExchange whose curve parsed and whose
      // public key was empty, which is what the `whole` flag exists to prevent and what the first
      // version of this test walked straight past.
      //
      // The transcript hashes the message **as if it had never been fragmented** — one header with
      // offset zero and the full length — so the pieces are gathered and re-headed rather than
      // concatenated as they arrived.
      const pending = new Map<number, { kind: number; body: Uint8Array; have: number }>();
      const order: number[] = [];
      let sawDone = false;
      for (let datagram = 0; datagram < 8 && !sawDone; datagram++) {
        const got = await recv();
        if (got === null) {
          throw new Error(`the flight stopped after ${datagram} datagram(s); ` +
            `message seqs so far: ${order.join(", ")}`);
        }
        const alert = ours.alertAt(got, 0);
        if (alert >= 0) throw new Error(`the server sent alert ${alert} during its flight`);
        let at = 0;
        for (;;) {
          const size = ours.sizeAt(got, at);
          if (size < 0) break;
          const info = ours.fragInfoAt(got, at);
          const [kind, seq, offset, fragLen, total] = [...info];
          if (kind >= 0) {
            if (!pending.has(seq)) {
              pending.set(seq, { kind, body: new Uint8Array(total), have: 0 });
              order.push(seq);
            }
            const slot = pending.get(seq)!;
            slot.body.set(Uint8Array.from(ours.fragBodyAt(got, at)), offset);
            slot.have += fragLen;
            if (slot.have >= total && kind === 14) sawDone = true;
          }
          at += size;
        }
      }
      assertEquals(sawDone, true, "the flight ended with a complete ServerHelloDone");
      for (const seq of order) {
        const slot = pending.get(seq)!;
        assertEquals(slot.have, slot.body.length,
          `message_seq ${seq} (type ${slot.kind}) was ${slot.have} of ${slot.body.length} bytes`);
      }

      const serverMessages = order.map((seq) => {
        const slot = pending.get(seq)!;
        return Uint8Array.from(ours.reheaded(slot.kind, seq, slot.body));
      });
      let serverRandom: Uint8Array | null = null;
      let curve = -1;
      let serverKey: Uint8Array | null = null;
      let certBody: Uint8Array | null = null;
      let skeBody: Uint8Array | null = null;
      for (const seq of order) {
        const slot = pending.get(seq)!;
        if (slot.kind === 2) serverRandom = slot.body.subarray(2, 34);
        if (slot.kind === 11) certBody = slot.body;
        if (slot.kind === 12) {
          curve = ours.curveOfBody(slot.body);
          serverKey = Uint8Array.from(ours.publicOfBody(slot.body));
          skeBody = slot.body;
        }
      }
      if (serverRandom === null || serverKey === null) {
        throw new Error("no ServerHello random or ServerKeyExchange key in the flight");
      }
      assertEquals(curve, 0x001D,
        `the server chose curve 0x${curve.toString(16)}; x25519 is what our list puts first`);
      assertEquals(serverKey.length, 32, "an x25519 point is thirty-two bytes");

      // ── The certificate, before anything is derived from the key it vouches for ────────────────
      //
      // **Two checks, and neither is optional.** The fingerprint says *this is the certificate the
      // signalling channel named*; the ServerKeyExchange signature says *the ephemeral key came from
      // whoever holds it*. Skipping the second is the subtler hole: the certificate can be genuine
      // while the point beside it is an attacker's, and a handshake built on that completes
      // perfectly and is read by them. It is the same shape as `packages/quic`'s missing
      // CertificateVerify, one protocol along.
      if (certBody === null || skeBody === null) {
        throw new Error("the flight had no Certificate or no ServerKeyExchange");
      }
      const leaf = Uint8Array.from(ours.leafOf(certBody));
      assertEquals(leaf.length > 0, true, "a leaf certificate came out of the Certificate message");
      assertEquals(leaf[0], 0x30, "and it starts with a DER SEQUENCE");

      // The oracle: OpenSSL's own fingerprint of the file it is serving.
      const printed = await new Deno.Command("openssl", {
        args: ["x509", "-in", "packages/tls/test/data/ec_leaf.pem", "-noout", "-fingerprint", "-sha256"],
        stdout: "piped",
      }).output();
      const expected = new TextDecoder().decode(printed.stdout).trim()
        .split("=")[1].replaceAll(":", "").toLowerCase();
      assertEquals(hex(Uint8Array.from(ours.fingerprintOf(leaf))), expected,
        "the SHA-256 of the certificate on the wire is the one openssl prints for the file — " +
          "which is what an SDP's a=fingerprint line carries and all WebRTC has instead of a PKI");

      assertEquals(ours.keyExchangeSigned(certBody, skeBody, RANDOM, serverRandom), true,
        `the ServerKeyExchange signature did not verify (scheme 0x${ours.schemeOf(skeBody).toString(16)})`);

      // **The canary**, and it is the one that matters: substitute the ephemeral point and the
      // signature must fail. A verifier that checked the certificate and not this would pass the
      // line above and be defeated by exactly this.
      const tampered = Uint8Array.from(ours.signedBytes(RANDOM, serverRandom, skeBody));
      tampered[tampered.length - 1] ^= 1;
      assertEquals(ours.signatureOver(certBody, skeBody, tampered), false,
        "one bit of the server's ephemeral point changed and the signature still verified");
      assertEquals(ours.keyExchangeSigned(certBody, skeBody, RANDOM, RANDOM), false,
        "and it is bound to both randoms, so a replay into another session does not verify");

      // ── Flight 3: ClientKeyExchange, ChangeCipherSpec, Finished ────────────────────────────────
      const ourKey = Uint8Array.from(ours.ourPublic(curve, SCALAR));
      const pms = Uint8Array.from(ours.preMaster(curve, SCALAR, serverKey));
      assertEquals(pms.length, 32);
      assertEquals(hex(pms) === hex(new Uint8Array(32)), false,
        "an all-zero shared secret means the peer's point was rejected, not that it agreed");

      const master = Uint8Array.from(ours.masterFrom(pms, RANDOM, serverRandom));
      const block = Uint8Array.from(ours.blockFrom(master, serverRandom, RANDOM));
      // Forty bytes: client key, server key, client IV, server IV — no MAC keys, because AEAD.
      const clientKey = block.subarray(0, 16);
      const serverWriteKey = block.subarray(16, 32);
      const clientIv = block.subarray(32, 36);
      const serverIv = block.subarray(36, 40);

      const cke = Uint8Array.from(ours.ckeMessage(ourKey, 2));
      const transcript = cat(clientHelloMsg, ...serverMessages, cke);
      const finished = Uint8Array.from(ours.finishedMessage(master, transcript, 3, true));
      assertEquals(finished.length, 12 + 12, "a Finished is a header and twelve bytes of verify_data");

      // Three records, and they may go in one datagram — which is what OpenSSL does and what a peer
      // expects. Epoch 0 for the first two; the Finished is the first thing under the new keys.
      const dtls12 = 0xFEFD;
      const ckeRecord = recordOf(22, 0, 2n, cke);
      const ccsRecord = recordOf(20, 0, 3n, Uint8Array.from([1]));
      const finRecord = Uint8Array.from(ours.sealedRecord(clientKey, clientIv, 1, 0n, 22, finished));
      await sock.send(cat(ckeRecord, ccsRecord, finRecord), to);

      // ── Flight 4: the server's ChangeCipherSpec and Finished ───────────────────────────────────
      const answer = await recv(6000);
      if (answer === null) {
        throw new Error("the server said nothing after our Finished — it neither accepted nor " +
          "rejected it, which usually means the record never parsed");
      }
      const alert = ours.alertAt(answer, 0);
      assertEquals(alert, -1,
        `the server rejected our Finished with alert ${alert}. 2/20 is bad_record_mac — the keys ` +
          "or the nonce; 2/51 is decrypt_error — the verify_data, which means the transcript.");

      // Walk its flight: a ChangeCipherSpec in the clear, then a Finished under its own keys.
      let at = 0;
      let serverFinished: Uint8Array | null = null;
      let sawCcs = false;
      for (;;) {
        const size = ours.sizeAt(answer, at);
        if (size < 0) break;
        const kind = ours.kindAt(answer, at);
        if (kind === 20) sawCcs = true;
        if (kind === 22) {
          const plain = Uint8Array.from(ours.openedAt(answer, at, serverWriteKey, serverIv));
          if (plain.length > 0) serverFinished = plain;
        }
        at += size;
      }
      assertEquals(sawCcs, true, "the server changed cipher spec, which it only does on acceptance");
      if (serverFinished === null) {
        throw new Error("the server's Finished did not authenticate under the keys we derived");
      }

      // **And its verify_data over our transcript plus our Finished**, which is the other direction:
      // the first half proves it believed us, this proves we believe it.
      assertEquals(serverFinished[0], 20, "a Finished message");
      const want = Uint8Array.from(
        ours.finishedMessage(master, cat(transcript, finished), 0, false),
      );
      assertEquals(hex(serverFinished.subarray(12)), hex(want.subarray(12)),
        "the server's verify_data is what our own schedule computes for it");
    } finally {
      sock.close();
      srv.stop();
    }

    /** A plaintext record header around a fragment — the epoch-0 case, with nothing to seal. */
    function recordOf(kind: number, epoch: number, seq: bigint, fragment: Uint8Array) {
      const out = new Uint8Array(13 + fragment.length);
      out[0] = kind;
      out[1] = 0xFE;
      out[2] = 0xFD;
      out[3] = (epoch >> 8) & 0xFF;
      out[4] = epoch & 0xFF;
      for (let i = 0; i < 6; i++) {
        out[5 + i] = Number((seq >> BigInt((5 - i) * 8)) & 0xFFn);
      }
      out[11] = (fragment.length >> 8) & 0xFF;
      out[12] = fragment.length & 0xFF;
      out.set(fragment, 13);
      return out;
    }
  },
});
