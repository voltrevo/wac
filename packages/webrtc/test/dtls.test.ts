// DTLS 1.2 framing, against OpenSSL.
//
// `design/system/0008` step 3, first increment: records, handshake headers, the ClientHello and the
// cookie exchange. The key schedule and the record protection are next, so nothing here completes a
// handshake — what it proves is that a real DTLS server reads what we send and answers it.
//
// ## Why OpenSSL and not aiortc, for this part
//
// aiortc's DTLS is OpenSSL underneath, so for the framing they are one oracle rather than two, and
// `s_server` can be driven directly and says more when it disagrees. aiortc earns its place at the
// next increment, where the WebRTC-specific part — binding the certificate fingerprint from the SDP
// — is not something OpenSSL does at all.
//
// ## The thing that will waste an hour if it is not written down
//
// **`openssl s_server` reads stdin and exits on EOF.** Backgrounded without something holding it
// open it prints `ACCEPT`, then `DONE`, and is gone before any client arrives — which looks exactly
// like a server that refused the connection, and sent me looking at the certificate type first.
// `sserver.ts` holds stdin from Deno, which is what keeps it up; that file also carries why it is
// no longer a `sleep 30 |` pipeline, which leaked 294 servers.

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
  epochAt(b: Uint8Array, at: number): number;
  seqAt(b: Uint8Array, at: number): bigint;
  describeAt(b: Uint8Array, at: number): string;
  handshakeKindAt(b: Uint8Array, at: number): number;
  messageSeqAt(b: Uint8Array, at: number): number;
  wholeAt(b: Uint8Array, at: number): boolean;
  cookieAt(b: Uint8Array, at: number): Uint8Array;
  suiteAt(b: Uint8Array, at: number): number;
  alertAt(b: Uint8Array, at: number): number;
  kHandshake(): number;
  kAlert(): number;
  hClientHello(): number;
  hServerHello(): number;
  hVerifyRequest(): number;
};

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A fixed ClientHello random, so a failing run prints the same bytes as the last one. */
const RANDOM = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xFF);

/** Start `openssl s_server` speaking DTLS 1.2, and hand back its port and a way to stop it. */
const server = dtlsServer;

/** Send one datagram, wait for one back. */
async function exchange(sock: Deno.DatagramConn, port: number, msg: Uint8Array, ms = 5000) {
  await sock.send(msg, { hostname: "127.0.0.1", port, transport: "udp" });
  return await Promise.race([
    sock.receive().then(([b]) => Uint8Array.from(b)),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

Deno.test({
  name: "OpenSSL answers our ClientHello with a HelloVerifyRequest, and accepts the cookie back",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = server();
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    try {
      await new Promise((r) => setTimeout(r, 800));

      // **The first hello, with no cookie.** A server that allocated state for this would be an
      // amplifier; DTLS's answer is to send back a cookie and remember nothing.
      const first = ours.hello(RANDOM, new Uint8Array(0), 0, 0n);
      assertEquals(ours.kindAt(first, 0), ours.kHandshake());
      assertEquals(ours.handshakeKindAt(first, 0), ours.hClientHello());
      assertEquals(hex(first.subarray(0, 3)), "16fefd", "a handshake record, DTLS 1.2");

      const verify = await exchange(sock, srv.port, first);
      if (verify === null) throw new Error("the DTLS server did not answer our first ClientHello");
      assertEquals(ours.kindAt(verify, 0), ours.kHandshake(),
        `expected a handshake record, got: ${ours.describeAt(verify, 0)}`);
      assertEquals(ours.handshakeKindAt(verify, 0), ours.hVerifyRequest(),
        "a server that has not issued a cookie answers with HelloVerifyRequest, not ServerHello");
      assertEquals(ours.epochAt(verify, 0), 0, "still epoch zero — nothing is encrypted yet");

      const cookie = Uint8Array.from(ours.cookieAt(verify, 0));
      assertEquals(cookie.length > 0, true, "and it carries a cookie");

      // **The second hello: the same random, the same everything, plus the cookie.** A different
      // random here would be a different client as far as the transcript is concerned.
      const second = ours.hello(RANDOM, cookie, 1, 1n);
      assertEquals(ours.messageSeqAt(second, 0), 1,
        "message_seq advances — a retransmission would reuse 0 and this is a new message");

      const answer = await exchange(sock, srv.port, second);
      if (answer === null) throw new Error("the DTLS server did not answer our cookied ClientHello");

      const alert = ours.alertAt(answer, 0);
      assertEquals(alert, -1,
        `the server sent an alert rather than a ServerHello: level/description ${alert}. ` +
          "A 2/47 is illegal_parameter, 2/40 a handshake failure — either means it read our " +
          "ClientHello and disliked something in it.");
      assertEquals(ours.handshakeKindAt(answer, 0), ours.hServerHello(),
        "the cookie was accepted and the handshake proceeded");

      const suite = ours.suiteAt(answer, 0);
      assertEquals(suite, 0xC02B,
        "and it chose ECDHE-ECDSA-AES128-GCM-SHA256, the first suite we offered, which is what " +
          "says our cipher_suites list was read rather than tolerated");

      // **A flight is several records, and they span several datagrams.** Both halves of that matter
      // and each is a way to read this wrong: a datagram holds more than one record, so a reader
      // that stops after the first sees a handshake that ends at ServerHello; and the flight is
      // larger than a datagram, so a reader that expects it all at once never sees ServerHelloDone.
      // OpenSSL sends ServerHello and Certificate in one and the rest in another here — the split
      // depends on the certificate's size, which is why this collects until the flight ends rather
      // than asserting a number of datagrams.
      const kinds: number[] = [];
      let datagrams = 1;
      let current: Uint8Array | null = answer;
      for (;;) {
        let at = 0;
        for (;;) {
          const size = ours.sizeAt(current!, at);
          if (size < 0) break;
          kinds.push(ours.handshakeKindAt(current!, at));
          at += size;
        }
        assertEquals(at, current!.length,
          `datagram ${datagrams}: the records did not exactly fill it, ${at} of ${current!.length}`);
        if (kinds.includes(14)) break;              // ServerHelloDone ends the flight
        current = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 5000)),
        ]);
        if (current === null) {
          throw new Error(`the flight stopped after ${datagrams} datagram(s) without a ` +
            `ServerHelloDone; handshake types seen: ${kinds.join(", ")}`);
        }
        datagrams++;
      }
      assertEquals(kinds.includes(11), true, `Certificate is in the flight: ${kinds.join(", ")}`);
      assertEquals(kinds.includes(12), true, "and a ServerKeyExchange, since the suite is ECDHE");
      assertEquals(kinds.includes(14), true, "and ServerHelloDone ends it");
    } finally {
      sock.close();
      srv.stop();
    }
  },
});

Deno.test({
  name: "a ClientHello with a wrong cookie is refused, so the check above is a check",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // The canary. The test above is satisfied by a server that ignores cookies entirely — which is
    // a real configuration — and this is what says it does not.
    const srv = server();
    const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
    try {
      await new Promise((r) => setTimeout(r, 800));
      const verify = await exchange(sock, srv.port, ours.hello(RANDOM, new Uint8Array(0), 0, 0n));
      if (verify === null) throw new Error("no HelloVerifyRequest");
      const cookie = Uint8Array.from(ours.cookieAt(verify, 0));
      const wrong = Uint8Array.from(cookie);
      wrong[0] ^= 0xFF;

      const answer = await exchange(sock, srv.port, ours.hello(RANDOM, wrong, 1, 1n), 3000);
      // OpenSSL answers a bad cookie with another HelloVerifyRequest rather than an alert — it has
      // no state to be offended with, which is the point of the mechanism. Either way, what it must
      // not do is proceed.
      const proceeded = answer !== null && ours.handshakeKindAt(answer, 0) === ours.hServerHello();
      assertEquals(proceeded, false,
        "a cookie with one byte changed took the handshake forward, so the server is not " +
          "checking cookies and the test above proves less than it says");
    } finally {
      sock.close();
      srv.stop();
    }
  },
});

Deno.test("the framing round-trips, and says when a record is not whole", () => {
  const h = ours.hello(RANDOM, Uint8Array.from([1, 2, 3]), 5, 0x0102030405n);
  assertEquals(ours.kindAt(h, 0), 22);
  assertEquals(ours.epochAt(h, 0), 0);
  assertEquals(ours.seqAt(h, 0), 0x0102030405n,
    "forty-eight bits of sequence number, which is why it is an i64 and not an i32");
  assertEquals(ours.messageSeqAt(h, 0), 5);
  assertEquals(ours.wholeAt(h, 0), true);
  assertEquals(ours.sizeAt(h, 0), h.length, "one record fills the datagram");

  // A record whose length claims more than arrived is not a record.
  const short = h.slice(0, h.length - 1);
  assertEquals(ours.sizeAt(short, 0), -1, "a truncated record is refused rather than read");
  assertEquals(ours.sizeAt(h, h.length), -1, "and there is nothing after the last one");
  assertEquals(ours.sizeAt(h, -1), -1, "nor before the first");
});
