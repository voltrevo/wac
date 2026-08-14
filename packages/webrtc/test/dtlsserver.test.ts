// The DTLS **server** role: OpenSSL's client completes a handshake with us.
//
// `design/system/0008` step 3's other half. The client role landed first because it is what talks to
// a server; this is what a browser needs, because an SDP answer may choose `passive` and because a
// data channel opened *to* us needs us to hold the certificate.
//
// The oracle is `openssl s_client -dtls1_2`, which is the same implementation that adjudicated the
// client role from the other side — so between the two tests both directions of the same handshake
// are checked against something that has never seen our code.
//
// ## What this exercises that the client test could not
//
// Signing. A client proves nothing about its own key in this handshake; a server signs the ephemeral
// key with the certificate's, and that signature is what binds them. So this is the first test in
// the repository where wac **produces** an ECDSA signature that something else verifies — the
// decoder in `x509.wac` has existed for a long time and nothing had ever needed the encoder.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/dtls_probe.wac") as unknown as {
  sizeAt(b: Uint8Array, at: number): number;
  kindAt(b: Uint8Array, at: number): number;
  handshakeKindAt(b: Uint8Array, at: number): number;
  epochAt(b: Uint8Array, at: number): number;
  fragInfoAt(b: Uint8Array, at: number): Int32Array;
  fragBodyAt(b: Uint8Array, at: number): Uint8Array;
  reheaded(kind: number, messageSeq: number, body: Uint8Array): Uint8Array;
  verifyRequestRecord(cookie: Uint8Array, messageSeq: number, seq: bigint): Uint8Array;
  cookieOfHello(body: Uint8Array): Uint8Array;
  randomOfHello(body: Uint8Array): Uint8Array;
  helloHasSuite(body: Uint8Array, suite: number): boolean;
  serverHelloBody(random: Uint8Array, suite: number): Uint8Array;
  certMessage(der: Uint8Array): Uint8Array;
  ecdhParams(curve: number, pub: Uint8Array): Uint8Array;
  skeBody(params: Uint8Array, scheme: number, sig: Uint8Array): Uint8Array;
  doneBody(): Uint8Array;
  ckePublic(body: Uint8Array): Uint8Array;
  signEcdsaDer(priv: Uint8Array, msg: Uint8Array, k: Uint8Array): Uint8Array;
  ourPublic(curve: number, scalar: Uint8Array): Uint8Array;
  preMaster(curve: number, scalar: Uint8Array, peer: Uint8Array): Uint8Array;
  masterFrom(pms: Uint8Array, cr: Uint8Array, sr: Uint8Array): Uint8Array;
  blockFrom(master: Uint8Array, sr: Uint8Array, cr: Uint8Array): Uint8Array;
  finishedMessage(master: Uint8Array, transcript: Uint8Array, messageSeq: number, asClient: boolean): Uint8Array;
  sealedRecord(key: Uint8Array, iv: Uint8Array, epoch: number, seq: bigint, kind: number,
    plain: Uint8Array): Uint8Array;
  openedAt(b: Uint8Array, at: number, key: Uint8Array, iv: Uint8Array): Uint8Array;
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

const SUITE = 0xC02B;        // ECDHE-ECDSA-AES128-GCM-SHA256
const X25519 = 0x001D;
const ECDSA_SHA256 = 0x0403;
const SERVER_RANDOM = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 11) & 0xFF);
const SERVER_SCALAR = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 2) & 0xFF);
/** A fixed ECDSA nonce. Fine here and catastrophic in a program — see the note where it is used. */
const SIG_K = Uint8Array.from({ length: 32 }, (_, i) => (i * 17 + 29) & 0xFF);

/** Our certificate's DER, and the private scalar that signs with it. */
async function identity(): Promise<{ der: Uint8Array; priv: Uint8Array }> {
  const derOut = await new Deno.Command("openssl", {
    args: ["x509", "-in", "packages/tls/test/data/ec_leaf.pem", "-outform", "der"],
    stdout: "piped",
  }).output();
  const keyOut = await new Deno.Command("openssl", {
    args: ["pkey", "-in", "packages/tls/test/data/ec_leaf.key", "-text", "-noout"],
    stdout: "piped",
  }).output();
  const text = new TextDecoder().decode(keyOut.stdout);
  // The `priv:` block, which is the scalar as colon-separated hex over several lines.
  const block = text.split("priv:")[1].split("pub:")[0];
  const bytes = block.replace(/[^0-9a-f:]/g, "").split(":").filter((x) => x.length === 2);
  return { der: Uint8Array.from(derOut.stdout), priv: Uint8Array.from(bytes.map((h) => parseInt(h, 16))) };
}

/** A plaintext record header around a fragment. */
function recordOf(kind: number, epoch: number, seq: bigint, fragment: Uint8Array) {
  const out = new Uint8Array(13 + fragment.length);
  out[0] = kind;
  out[1] = 0xFE;
  out[2] = 0xFD;
  out[3] = (epoch >> 8) & 0xFF;
  out[4] = epoch & 0xFF;
  for (let i = 0; i < 6; i++) out[5 + i] = Number((seq >> BigInt((5 - i) * 8)) & 0xFFn);
  out[11] = (fragment.length >> 8) & 0xFF;
  out[12] = fragment.length & 0xFF;
  out.set(fragment, 13);
  return out;
}

Deno.test({
  name: "openssl s_client completes a DTLS handshake with our server role",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { der, priv } = await identity();
    assertEquals(priv.length, 32, "a P-256 private scalar is thirty-two bytes");

    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const ourPort = (sock.addr as Deno.NetAddr).port;
    let peer: Deno.NetAddr | null = null;
    const recv = async (ms = 6000): Promise<Uint8Array | null> => {
      const got = await Promise.race([
        sock.receive().then(([b, from]) => {
          peer = from as Deno.NetAddr;
          return Uint8Array.from(b);
        }),
        new Promise<null>((r) => setTimeout(() => r(null), ms)),
      ]);
      return got;
    };
    const send = (b: Uint8Array) =>
      sock.send(b, { hostname: peer!.hostname, port: peer!.port, transport: "udp" });

    const client = new Deno.Command("sh", {
      args: ["-c", `sleep 25 | openssl s_client -dtls1_2 -cert packages/tls/test/data/ec_leaf.pem -key packages/tls/test/data/ec_leaf.key -connect 127.0.0.1:${ourPort} 2>&1`],
      stdout: "piped",
      stderr: "null",
    }).spawn();

    try {
      // ── Their first hello, and our cookie ──────────────────────────────────────────────────────
      const first = await recv();
      if (first === null) throw new Error("s_client sent no ClientHello");
      assertEquals(ours.handshakeKindAt(first, 0), 1, "a ClientHello");
      const firstBody = first.subarray(13 + 12, ours.sizeAt(first, 0));
      assertEquals(Uint8Array.from(ours.cookieOfHello(firstBody)).length, 0,
        "the first hello carries no cookie — that is the point of the exchange");
      assertEquals(ours.helloHasSuite(firstBody, SUITE), true,
        "and offers ECDHE-ECDSA-AES128-GCM-SHA256, which is what we can answer");

      // Any stable value is a legal cookie. A real server derives it from the client's address so it
      // holds no state; this is a test and holds the association in a local variable instead.
      const cookie = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
      await send(Uint8Array.from(ours.verifyRequestRecord(cookie, 0, 0n)));

      // ── Their second hello: the transcript starts here ─────────────────────────────────────────
      const second = await recv();
      if (second === null) throw new Error("s_client did not retry with the cookie");
      assertEquals(ours.handshakeKindAt(second, 0), 1, "a second ClientHello");
      const clientHelloMsg = second.subarray(13, ours.sizeAt(second, 0));
      const helloBody = second.subarray(13 + 12, ours.sizeAt(second, 0));
      assertEquals(hex(Uint8Array.from(ours.cookieOfHello(helloBody))), hex(cookie),
        "which echoes the cookie we issued");
      const clientRandom = Uint8Array.from(ours.randomOfHello(helloBody));
      assertEquals(clientRandom.length, 32);

      // ── Our flight ────────────────────────────────────────────────────────────────────────────
      const ourKey = Uint8Array.from(ours.ourPublic(X25519, SERVER_SCALAR));
      const params = Uint8Array.from(ours.ecdhParams(X25519, ourKey));

      // **The signature that binds the ephemeral key to the certificate.** Over client random,
      // server random and the parameters — the same bytes the client test checks in the other
      // direction.
      //
      // `SIG_K` is a fixed nonce, which is safe *here* because the key is a test fixture and the
      // message differs every run. In a program a repeated ECDSA nonce with two different messages
      // publishes the private key, which is why this is a constant in a test and must never become
      // one anywhere else.
      const signed = cat(clientRandom, SERVER_RANDOM, params);
      const signature = Uint8Array.from(ours.signEcdsaDer(priv, signed, SIG_K));
      assertEquals(signature.length > 0, true, "the ECDSA nonce produced a usable signature");
      assertEquals(signature[0], 0x30, "and it is DER: a SEQUENCE of two INTEGERs");

      // **The server's `message_seq` is one counter across the whole handshake**, and the
      // HelloVerifyRequest already spent 0. So the ServerHello is 1, not 0 — numbering it 0 makes
      // the client read a retransmission of a message it has already had and answer
      // `unexpected message`, which says nothing about sequence numbers and cost a cycle here.
      const shMsg = Uint8Array.from(ours.reheaded(2, 1, Uint8Array.from(ours.serverHelloBody(SERVER_RANDOM, SUITE))));
      const certMsg = Uint8Array.from(ours.reheaded(11, 2, Uint8Array.from(ours.certMessage(der))));
      const skeMsg = Uint8Array.from(
        ours.reheaded(12, 3, Uint8Array.from(ours.skeBody(params, ECDSA_SHA256, signature))),
      );
      const doneMsg = Uint8Array.from(ours.reheaded(14, 4, Uint8Array.from(ours.doneBody())));

      // Four records. Sent separately rather than bundled, because the Certificate alone is close to
      // a datagram's worth and DTLS has no rule that a flight is one datagram — the client test
      // learned that from the other side.
      // **And the record sequence is a second continuous counter**, which the HelloVerifyRequest
      // also spent 0 of. Restarting it makes the ServerHello a replay of a record the peer has
      // already seen, and DTLS's replay window drops it silently — the client then waits and reports
      // `read timeout expired`, which points at the network rather than at the counter. Two
      // counters, both continuous, and both were restarted here in turn.
      await send(recordOf(22, 0, 1n, shMsg));
      await send(recordOf(22, 0, 2n, certMsg));
      await send(recordOf(22, 0, 3n, skeMsg));
      await send(recordOf(22, 0, 4n, doneMsg));

      // ── Their ClientKeyExchange, ChangeCipherSpec and Finished ─────────────────────────────────
      let clientKey: Uint8Array | null = null;
      let ckeMsg: Uint8Array | null = null;
      let sawCcs = false;
      let clientFinishedRecord: { data: Uint8Array; at: number } | null = null;
      for (let round = 0; round < 6 && clientFinishedRecord === null; round++) {
        const got = await recv(4000);
        if (got === null) {
          // **Ask the client why.** It writes its alerts and its reasons to stdout, and a test that
          // reported only "nothing arrived" would be the third time in this package a diagnostic
          // said less than the tool it was wrapping.
          try {
            client.kill("SIGKILL");
          } catch { /* gone */ }
          const said = new TextDecoder().decode((await client.output()).stdout);
          throw new Error(`no flight from s_client after our ServerHelloDone ` +
            `(cke ${clientKey !== null}, ccs ${sawCcs}). It said:\n${said.slice(0, 1200)}`);
        }
        let at = 0;
        for (;;) {
          const size = ours.sizeAt(got, at);
          if (size < 0) break;
          const kind = ours.kindAt(got, at);
          if (kind === 20) sawCcs = true;
          if (kind === 22) {
            // **Told apart by epoch, not by whether it parses.** An encrypted record is still bytes
            // and `fragInfoAt` reads a plausible-looking handshake header out of ciphertext quite
            // happily — so "it did not parse" is not the test. Epoch 1 is the first thing sent under
            // the new keys, and that is what a Finished is.
            if (ours.epochAt(got, at) === 1) {
              clientFinishedRecord = { data: got, at };
            } else if (ours.fragInfoAt(got, at)[0] === 16) {
              ckeMsg = got.subarray(at + 13, at + size);
              clientKey = Uint8Array.from(ours.ckePublic(got.subarray(at + 13 + 12, at + size)));
            }
          }
          at += size;
        }
      }
      if (clientKey === null || ckeMsg === null) throw new Error("no ClientKeyExchange arrived");
      assertEquals(sawCcs, true, "and a ChangeCipherSpec");
      assertEquals(clientKey.length, 32, "an x25519 point");

      // ── The keys, and their Finished ──────────────────────────────────────────────────────────
      const pms = Uint8Array.from(ours.preMaster(X25519, SERVER_SCALAR, clientKey));
      const master = Uint8Array.from(ours.masterFrom(pms, clientRandom, SERVER_RANDOM));
      const block = Uint8Array.from(ours.blockFrom(master, SERVER_RANDOM, clientRandom));
      const clientWriteKey = block.subarray(0, 16);
      const serverWriteKey = block.subarray(16, 32);
      const clientIv = block.subarray(32, 36);
      const serverIv = block.subarray(36, 40);

      const transcript = cat(clientHelloMsg, shMsg, certMsg, skeMsg, doneMsg, ckeMsg);
      if (clientFinishedRecord === null) throw new Error("no encrypted Finished arrived");
      const theirFinished = Uint8Array.from(
        ours.openedAt(clientFinishedRecord.data, clientFinishedRecord.at, clientWriteKey, clientIv),
      );
      assertEquals(theirFinished.length > 0, true,
        "their Finished did not authenticate under the keys we derived — the master secret, the " +
          "key block or the record protection");
      assertEquals(theirFinished[0], 20, "and it is a Finished message");

      const wantClient = Uint8Array.from(ours.finishedMessage(master, transcript, 0, true));
      assertEquals(hex(theirFinished.subarray(12)), hex(wantClient.subarray(12)),
        "their verify_data is what our transcript computes — so both ends hashed the same handshake");

      // ── Our ChangeCipherSpec and Finished ─────────────────────────────────────────────────────
      const ourFinished = Uint8Array.from(
        ours.finishedMessage(master, cat(transcript, theirFinished), 5, false),
      );
      await send(recordOf(20, 0, 5n, Uint8Array.from([1])));
      await send(Uint8Array.from(ours.sealedRecord(serverWriteKey, serverIv, 1, 0n, 22, ourFinished)));

      // ── And what s_client says about all that ─────────────────────────────────────────────────
      const out = new TextDecoder().decode((await client.output()).stdout);
      assertEquals(out.includes("Cipher is ECDHE-ECDSA-AES128-GCM-SHA256"), true,
        `s_client did not report a completed handshake. Its output:\n${out.slice(0, 1200)}`);
      assertEquals(out.includes("Verify return code: 0 (ok)") || out.includes("verify error"), true,
        "and it reached certificate verification, which means the handshake got that far");
    } finally {
      sock.close();
      try {
        client.kill("SIGKILL");
      } catch { /* gone */ }
      await client.status.catch(() => {});
    }
  },
});

Deno.test({
  name: "and a lost flight is resent, so the handshake survives a dropped datagram",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // **The first thing a real path does is lose a packet**, and on loopback nothing ever does — so
    // the loss is made here: our whole first flight is built and thrown away. What must happen next
    // is that the client's own retransmission timer fires, its ClientHello arrives again, and the
    // stored flight goes out with *fresh record sequence numbers* and the *same* `message_seq`.
    //
    // Getting that backwards is the interesting failure: resending the stored **records** repeats a
    // sequence number the peer has already seen, its replay window drops them, and the handshake
    // stalls exactly as though the retransmission had been lost too.
    const { der, priv } = await identity();
    const peerMod = await wacBind("packages/webrtc/test/wac/peer_probe.wac") as unknown as {
      newPeer(certDer: Uint8Array, signingKey: Uint8Array, nonce: Uint8Array, scalar: Uint8Array,
        random: Uint8Array, cookie: Uint8Array): unknown;
      peerReceive(p: unknown, datagram: Uint8Array): Uint8Array[];
      peerEstablished(p: unknown): boolean;
      peerFlightSize(p: unknown): number;
    };
    const peer = peerMod.newPeer(der, priv, SIG_K, SERVER_SCALAR, SERVER_RANDOM,
      Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]));

    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    const ourPort = (sock.addr as Deno.NetAddr).port;
    const client = new Deno.Command("sh", {
      args: ["-c", `sleep 30 | openssl s_client -dtls1_2 -cert packages/tls/test/data/ec_leaf.pem -key packages/tls/test/data/ec_leaf.key -connect 127.0.0.1:${ourPort} 2>&1`],
      stdout: "piped",
      stderr: "null",
    }).spawn();

    let dropped = 0;
    const sequences: string[] = [];
    try {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline && !peerMod.peerEstablished(peer)) {
        const got = await Promise.race([
          sock.receive().then(([b, from]) => ({ b: Uint8Array.from(b), from: from as Deno.NetAddr })),
          new Promise<null>((r) => setTimeout(() => r(null), 6000)),
        ]);
        if (got === null) break;
        const out = peerMod.peerReceive(peer, got.b).map((d) => Uint8Array.from(d));
        // **Drop the first flight and nothing else.** Five messages arrive together the first time
        // — ServerHello, Certificate, ServerKeyExchange, CertificateRequest, ServerHelloDone — and
        // the resend is what the test is about, so it must get through.
        if (out.length === 5 && dropped === 0) {
          dropped = out.length;
          for (const d of out) sequences.push(hex(d.subarray(5, 11)));
          continue;
        }
        if (out.length === 5) {
          for (const d of out) sequences.push(hex(d.subarray(5, 11)));
        }
        for (const d of out) {
          await sock.send(d, { hostname: got.from.hostname, port: got.from.port, transport: "udp" });
        }
      }

      assertEquals(dropped, 5, "a flight of five messages was built and thrown away");
      assertEquals(peerMod.peerFlightSize(peer), 5, "and the peer kept it");
      assertEquals(peerMod.peerEstablished(peer), true,
        "the handshake did not recover from the dropped flight — the client retransmitted its " +
          "ClientHello and either we did not resend, or we resent records the peer discarded as " +
          "replays");

      // **The evidence that it was a resend and not a rebuild.** Ten records went out for five
      // messages, and no record sequence number appears twice.
      assertEquals(sequences.length, 10, `expected two flights of five; saw ${sequences.length}`);
      assertEquals(new Set(sequences).size, 10,
        `a record sequence number was reused: ${sequences.join(", ")} — a peer's replay window ` +
          "drops the repeat, which looks exactly like the retransmission being lost as well");

      const out = new TextDecoder().decode((await client.output()).stdout);
      assertEquals(out.includes("Cipher is ECDHE-ECDSA-AES128-GCM-SHA256"), true,
        `s_client did not report a completed handshake:\n${out.slice(0, 900)}`);
    } finally {
      sock.close();
      try {
        client.kill("SIGKILL");
      } catch { /* gone */ }
      await client.status.catch(() => {});
    }
  },
});
