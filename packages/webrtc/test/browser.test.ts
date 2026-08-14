// Interop with a real browser: Chromium's WebRTC stack, which is libwebrtc.
//
// Everything else in this package is measured against aiortc, coturn and OpenSSL. They are
// independent implementations and they are not the one that matters most: **libwebrtc is what
// WebRTC is** — every other stack was written to talk to it — and it is stricter than aiortc about
// what it will accept. An SDP or a connectivity check a browser rejects is one no browser accepts.
//
// So a browser is put on the other end here, and it gets as far as our stack does:
//
//   - it accepts our SDP answer, so our description is valid to libwebrtc's parser;
//   - it sends us ICE connectivity checks, which `ice.wac` validates and answers;
//   - its ICE reaches `connected` — **a browser completes ICE against a wac peer**;
//   - it starts DTLS, we answer its ClientHello with a HelloVerifyRequest, and **it retries with our
//     cookie** — so the cookie exchange works against libwebrtc;
//   - it then rejects our ServerKeyExchange with `decrypt_error`, where OpenSSL accepts the same
//     signature over the same construction. That divergence is `issues/system/0151`.
//
// Every one of those is asserted, the failure included, so that when the boundary moves this test
// is what says so rather than a paragraph in a README that stopped being true.
//
// ## The thing that made a browser useless here for an afternoon
//
// **Chromium hides every local network interface from a page without media permission.** Its
// `FilteringNetworkManager` logs `received permission status: denied` and the peer connection then
// gathers *nothing* — gathering reaches `complete` with zero candidates, on a machine whose `eth0`
// is perfectly ordinary and which aiortc enumerates without being asked twice. No combination of
// `--allow-loopback-in-peer-connection`, `--force-webrtc-ip-handling-policy=default` or disabling
// mDNS masking changes it, and none of them is the problem.
//
// What changes it is a successful `getUserMedia`. So the page asks for a microphone it does not
// want, with `--use-fake-device-for-media-stream` to supply one, and the interfaces appear. That is
// the whole trick and it is why it is written down here at length: from the outside it looks exactly
// like a container without a network.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const sdpMod = await wacBind("packages/webrtc/test/wac/sdp_probe.wac") as unknown as {
  offer(sessionId: bigint, ufrag: string, password: string, fingerprint: string, setup: string,
    candidates: string): string;
  candidateLine(c: string): string;
  attr(sdp: string, name: string): string;
  printOf(sdp: string): string;
  hasChannel(sdp: string): boolean;
};

const iceMod = await wacBind("packages/webrtc/test/wac/ice_probe.wac") as unknown as {
  priorityOf(typePref: number, localPref: number, component: number): bigint;
  hostPref(): number;
  lineFor(f: string, c: number, t: string, p: bigint, h: string, port: number, k: string): string;
  rejected(msg: Uint8Array, ourUfrag: string, peerUfrag: string, ourPassword: Uint8Array): number;
  isNomination(msg: Uint8Array): boolean;
  tidOf(msg: Uint8Array): Uint8Array;
  success(tid: Uint8Array, ourPassword: Uint8Array, family: number, peerIp: Uint8Array,
    peerPort: number): Uint8Array;
};

const dtlsMod = await wacBind("packages/webrtc/test/wac/dtls_probe.wac") as unknown as {
  kindAt(b: Uint8Array, at: number): number;
  handshakeKindAt(b: Uint8Array, at: number): number;
  sizeAt(b: Uint8Array, at: number): number;
  epochAt(b: Uint8Array, at: number): number;
  fragInfoAt(b: Uint8Array, at: number): Int32Array;
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
  groupsOfHello(body: Uint8Array): Int32Array;
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

const sctpMod = await wacBind("packages/webrtc/test/wac/sctp_probe.wac") as unknown as {
  initAckPacket(theirTag: number, ourTag: number, window: number, outbound: number, inbound: number,
    tsn: number, cookie: Uint8Array): Uint8Array;
  cookieAckPacket(theirTag: number): Uint8Array;
  sackPacket(tag: number, cumulativeTsn: number, window: number): Uint8Array;
  dataPacket(tag: number, tsn: number, streamId: number, streamSeq: number, ppid: number,
    payload: Uint8Array): Uint8Array;
  ackChannelPacket(tag: number, tsn: number, streamId: number): Uint8Array;
  crcVerifies(b: Uint8Array): boolean;
  tagOf(b: Uint8Array): number;
  firstChunkKind(b: Uint8Array): number;
  firstChunkValue(b: Uint8Array): Uint8Array;
  initTagOf(value: Uint8Array): number;
  tsnOf(value: Uint8Array): number;
  streamOf(value: Uint8Array): number;
  ppidOf(value: Uint8Array): number;
  payloadOf(value: Uint8Array): Uint8Array;
  chunkKinds(b: Uint8Array): Int32Array;
  labelOf(msg: Uint8Array): string;
  newAssociation(ourTag: number, initialTsn: number, window: number): unknown;
  associationReceive(a: unknown, pkt: Uint8Array, cookie: Uint8Array): Uint8Array[];
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array, now: bigint): Uint8Array;
  associationEstablished(a: unknown): boolean;
  associationPeerTag(a: unknown): number;
  associationResend(a: unknown): Uint8Array[];
  associationInFlight(a: unknown): number;
  associationSendLarge(a: unknown, stream: number, ppid: number, payload: Uint8Array,
    maxChunk: number, now: bigint): Uint8Array[];
  associationDue(a: unknown, now: bigint, rto: bigint): Uint8Array[];
  associationAccept(a: unknown, tsn: number): boolean;
  associationReassemble(a: unknown, stream: number, flags: number, piece: Uint8Array): Uint8Array;
  firstChunkFlags(b: Uint8Array): number;
  chunkCount(b: Uint8Array): number;
  chunkKindAt(b: Uint8Array, index: number): number;
  chunkFlagsAt(b: Uint8Array, index: number): number;
  chunkValueAt(b: Uint8Array, index: number): Uint8Array;
};

const peerMod = await wacBind("packages/webrtc/test/wac/peer_probe.wac") as unknown as {
  newPeer(certDer: Uint8Array, signingKey: Uint8Array, nonce: Uint8Array, scalar: Uint8Array,
    random: Uint8Array, cookie: Uint8Array): unknown;
  peerReceive(p: unknown, datagram: Uint8Array): Uint8Array[];
  peerEstablished(p: unknown): boolean;
  peerApplication(p: unknown, datagram: Uint8Array, at: number): Uint8Array;
  peerSeal(p: unknown, payload: Uint8Array): Uint8Array;
};

const SUITE = 0xC02B;
const X25519 = 0x001D;
const ECDSA_SHA256 = 0x0403;
const SERVER_RANDOM = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 11) & 0xFF);
const SERVER_SCALAR = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 2) & 0xFF);
const SIG_K = Uint8Array.from({ length: 32 }, (_, i) => (i * 17 + 29) & 0xFF);

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

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

/** Our certificate's DER and the scalar that signs with it. */
async function identity(): Promise<{ der: Uint8Array; priv: Uint8Array }> {
  const derOut = await new Deno.Command("openssl", {
    args: ["x509", "-in", CERT, "-outform", "der"],
    stdout: "piped",
  }).output();
  const keyOut = await new Deno.Command("openssl", {
    args: ["pkey", "-in", "packages/tls/test/data/ec_leaf.key", "-text", "-noout"],
    stdout: "piped",
  }).output();
  const block = new TextDecoder().decode(keyOut.stdout).split("priv:")[1].split("pub:")[0];
  const bytes = block.replace(/[^0-9a-f:]/g, "").split(":").filter((x) => x.length === 2);
  return {
    der: Uint8Array.from(derOut.stdout),
    priv: Uint8Array.from(bytes.map((h) => parseInt(h, 16))),
  };
}

const enc = new TextEncoder();

/** The certificate our SDP names. Not yet used in a handshake — see the note at the top. */
const CERT = "packages/tls/test/data/ec_leaf.pem";

/**
 * The flags and the permission that make a browser's WebRTC usable here. See the header.
 *
 * `--use-fake-device-for-media-stream` supplies a microphone so `getUserMedia` succeeds without one,
 * and `--use-fake-ui-for-media-stream` answers the permission prompt there is nobody to click.
 */
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

/**
 * Write a script into `~/pw` and run it under node.
 *
 * **Beside playwright's `node_modules`**, because `NODE_PATH` does not apply to ESM `import` — a
 * script anywhere else fails with "Cannot find package 'playwright'" however the environment is set,
 * which reads as a missing install rather than as a resolution rule.
 */
async function browserScript(script: string) {
  const file = `${Deno.env.get("HOME")}/pw/.wac-browser-${crypto.randomUUID()}.mjs`;
  await Deno.writeTextFile(file, script);
  return {
    file,
    child: new Deno.Command("node", {
      args: [file],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn(),
  };
}

Deno.test({
  name: "Chromium completes ICE against us, and reads our SDP as we read its",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const printed = await new Deno.Command("openssl", {
      args: ["x509", "-in", CERT, "-noout", "-fingerprint", "-sha256"],
      stdout: "piped",
    }).output();
    const fingerprint = new TextDecoder().decode(printed.stdout).trim().split("=")[1];

    const sock = Deno.listenDatagram({ hostname: "0.0.0.0", port: 0, transport: "udp" });
    const ourPort = (sock.addr as Deno.NetAddr).port;
    const ourUfrag = "wacUF";
    const ourPwd = "wac-password-0123456789";

    // The browser prints its offer, waits for our answer on stdin, then reports what happened. The
    // test is the signalling channel, exactly as it is for the aiortc tests.
    const { file, child } = await browserScript(`
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

// A page over http://localhost, which is a secure context — WebRTC needs one.
const server = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>wac</body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch({ args: ${JSON.stringify(CHROMIUM_ARGS)} });
const context = await browser.newContext({ permissions: ["microphone", "camera"] });
const page = await context.newPage();
await page.goto("http://localhost:" + server.address().port + "/");

const offer = await page.evaluate(async () => {
  // **The getUserMedia is what unlocks the interface list.** Without it every candidate is filtered
  // away and ICE gathers nothing at all.
  await navigator.mediaDevices.getUserMedia({ audio: true });
  window.__pc = new RTCPeerConnection({ iceServers: [] });
  const channel = window.__pc.createDataChannel("chat");
  window.__channelOpen = false;
  window.__echo = "";
  channel.addEventListener("open", () => {
    window.__channelOpen = true;
    channel.send("hello from a browser");
  });
  window.__bigEcho = -1;
  window.__bigSent = 0;
  channel.addEventListener("message", (e) => {
    if (typeof e.data === "string" && e.data.length < 1000) {
      window.__echo = String(e.data);
      // **A message larger than a datagram**, which has to be split across DATA chunks and put back
      // together. 40,000 bytes is well past a path MTU and well inside the 256 KiB a browser offers.
      const big = "x".repeat(40000);
      window.__bigSent = big.length;
      channel.send(big);
    } else {
      window.__bigEcho = String(e.data).length;
    }
  });
  window.__cands = [];
  window.__pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) window.__cands.push(e.candidate.candidate);
  });
  window.__states = [];
  window.__pc.addEventListener("iceconnectionstatechange", () =>
    window.__states.push("ice:" + window.__pc.iceConnectionState));
  window.__pc.addEventListener("connectionstatechange", () =>
    window.__states.push("pc:" + window.__pc.connectionState));
  await window.__pc.setLocalDescription(await window.__pc.createOffer());
  await new Promise((r) => {
    if (window.__pc.iceGatheringState === "complete") return r();
    window.__pc.addEventListener("icegatheringstatechange", () => {
      if (window.__pc.iceGatheringState === "complete") r();
    });
    setTimeout(r, 5000);
  });
  return { sdp: window.__pc.localDescription.sdp, candidates: window.__cands };
});
console.log(JSON.stringify({ kind: "offer", ...offer }));

const rl = createInterface({ input: process.stdin });
const answer = (await new Promise((r) => rl.once("line", r))).replaceAll("\\\\r\\\\n", "\\r\\n");

const result = await page.evaluate(async (answerSdp) => {
  await window.__pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  // **Wait for the result, not for a duration.** A fixed sleep is a race with a 40,000-byte
  // transfer: it passed and failed alternately at twelve seconds. Polling ends as soon as the echo
  // is back and still gives up rather than hanging.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && window.__bigEcho < 0) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    ice: window.__pc.iceConnectionState,
    connection: window.__pc.connectionState,
    states: window.__states,
    channelOpen: window.__channelOpen === true,
    echo: window.__echo,
    bigSent: window.__bigSent,
    bigEcho: window.__bigEcho,
  };
}, answer);
console.log(JSON.stringify({ kind: "result", ...result }));
await browser.close();
server.close();
process.exit(0);
`);

    const { der, priv } = await identity();
    let checksSeen = 0;
    let nominations = 0;
    let dtlsBytes = 0;
    let clientHellos = 0;
    // The DTLS server handshake, run inside the same receive loop as ICE because both arrive on the
    // one socket — which is what a WebRTC peer is: everything demultiplexed by the first byte.


    // The SCTP association, which runs inside the DTLS connection once it is up.
    let sctpSeq = 1n;                  // our epoch-1 record sequence; the Finished spent 0
    let theirTag = 0;
    let sawInit = false;
    let sawCookieEcho = false;
    let channelLabel = "";
    let ackedChannel = false;
    let received = "";
    let droppedEcho = false;
    let bigReceived = 0;
    const association = sctpMod.newAssociation(0x77777777 | 0, 1, 65536);
    const peer = peerMod.newPeer(der, priv, SIG_K, SERVER_SCALAR, SERVER_RANDOM,
                                 Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]));
    /** What our INIT-ACK carries and the peer echoes. A real server authenticates it with a key. */
    const COOKIE = Uint8Array.from({ length: 24 }, (_, i) => (i * 7 + 1) & 0xFF);
    const alerts: string[] = [];


    try {
      let stderr = "";
      (async () => {
        const d = new TextDecoder();
        for await (const chunk of child.stderr) stderr += d.decode(chunk, { stream: true });
      })().catch(() => {});

      const reader = child.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const readLine = async (): Promise<string> => {
        while (!buf.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) {
            throw new Error(`the browser exited without a full line. stdout: ` +
              `${JSON.stringify(buf.slice(0, 200))}\nstderr:\n${stderr.trim().slice(-900)}`);
          }
          buf += dec.decode(value, { stream: true });
        }
        const i = buf.indexOf("\n");
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        return line;
      };

      const offer = JSON.parse(await readLine()) as { sdp: string; candidates: string[] };

      // ── A browser's own description, read by src/sdp.wac ───────────────────────────────────────
      assertEquals(sdpMod.hasChannel(offer.sdp), true, "Chromium's offer has a data channel");
      const theirUfrag = sdpMod.attr(offer.sdp, "ice-ufrag");
      const theirPwd = sdpMod.attr(offer.sdp, "ice-pwd");
      assertEquals(theirUfrag.length > 0, true, `no ice-ufrag in:\n${offer.sdp}`);
      assertEquals(theirPwd.length > 0, true, "and an ice-pwd");
      assertEquals(sdpMod.printOf(offer.sdp).length, 95, "and a sha-256 fingerprint");
      assertEquals(sdpMod.attr(offer.sdp, "setup"), "actpass");
      // libwebrtc's own number, four times aiortc's, and the one a real peer expects.
      assertEquals(sdpMod.attr(offer.sdp, "max-message-size"), "262144");
      assertEquals(offer.candidates.length > 0, true,
        "Chromium gathered no candidates — the media permission that unlocks its interface list " +
          "is the usual cause; see the note at the top of this file");
      const theirHost = offer.candidates[0].split(" ")[4];

      // ── Our answer, built by src/sdp.wac ───────────────────────────────────────────────────────
      //
      // `active`: an answer must choose a DTLS role, and being the client is what our stack can do.
      const priority = iceMod.priorityOf(iceMod.hostPref(), 65535, 1);
      const candidates = sdpMod.candidateLine(
        iceMod.lineFor("wac1", 1, "udp", priority, theirHost, ourPort, "host"),
      );
      // **`passive`, so the browser is the DTLS client.** An answer must choose a role, and choosing
      // to be the *server* is what lets this test see libwebrtc's ClientHello — the alternative,
      // `active`, is correct too and means Chromium waits for us to start, which looks from here
      // exactly like a browser that gave up. The first version of this test chose `active` and
      // failed asserting that DTLS records arrived, which they never would have.
      const answer = sdpMod.offer(1n, ourUfrag, ourPwd, fingerprint, "passive", candidates);
      const writer = child.stdin.getWriter();
      await writer.write(enc.encode(answer.replaceAll("\r\n", "\\r\\n") + "\n"));
      await writer.close();

      // ── Answer its checks, and watch what follows ──────────────────────────────────────────────
      const loop = (async () => {
        for (;;) {
          const [datagram, from] = await sock.receive();
          const msg = Uint8Array.from(datagram);
          const sender = from as Deno.NetAddr;
          const why = iceMod.rejected(msg, ourUfrag, theirUfrag, enc.encode(ourPwd));
          if (why !== 0) {
            // Once ICE is up, what arrives is DTLS — a record's first byte is 20 to 63.
            if (msg.length === 0 || msg[0] < 20 || msg[0] > 63) continue;
            dtlsBytes += msg.length;

            // ── The DTLS server handshake and the SCTP association, both in wac ───────────────
            //
            // **`Peer` answers the handshake and `Association` answers the SCTP**, so what is left
            // here is the two lines that join them: application data out of one goes into the
            // other, and its replies go back through the first. Every counter, every transcript and
            // every reassembly that this test used to keep now belongs to a struct — which is the
            // point, because each of them was forgotten at least once while it lived here.
            const flight: Uint8Array[] = [];
            for (const out of peerMod.peerReceive(peer, msg)) {
              flight.push(Uint8Array.from(out));
            }
            if (dtlsMod.handshakeKindAt(msg, 0) === 1) clientHellos++;

            let at = 0;
            for (;;) {
              const size = dtlsMod.sizeAt(msg, at);
              if (size < 0) break;
              if (dtlsMod.kindAt(msg, at) === 23) {
                const sctp = Uint8Array.from(peerMod.peerApplication(peer, msg, at));
                if (sctp.length > 0 && sctpMod.crcVerifies(sctp)) {
                  const kinds = [...sctpMod.chunkKinds(sctp)];
                  const value = Uint8Array.from(sctpMod.firstChunkValue(sctp));
                  const reply = [...sctpMod.associationReceive(association, sctp, COOKIE)]
                    .map((r) => Uint8Array.from(r));
                  if (kinds.includes(1)) sawInit = true;
                  if (kinds.includes(10)) sawCookieEcho = true;
                  // **Every chunk, not the first.** A peer bundles as many as fit into one
                  // packet, and a large message is a run of them — a reader that takes the first
                  // sees a fraction of what arrived. Third time this shape has been got wrong here:
                  // a datagram holds several DTLS records, a DTLS record's flight spans datagrams,
                  // and an SCTP packet holds several chunks.
                  for (let ci = 0; ci < sctpMod.chunkCount(sctp); ci++) {
                    if (sctpMod.chunkKindAt(sctp, ci) !== 0) continue;
                    const value = Uint8Array.from(sctpMod.chunkValueAt(sctp, ci));
                    const flags = sctpMod.chunkFlagsAt(sctp, ci);
                    // **Only a chunk that is next in order.** `receive` above has already moved
                    // the cumulative point for it; one that arrives out of order is dropped
                    // unacknowledged and the peer resends it, which is correct and slow. Reassembling
                    // an out-of-order chunk would splice it into the wrong place in the message.
                    const ppid = sctpMod.ppidOf(value);
                    const stream = sctpMod.streamOf(value);
                    const payload = Uint8Array.from(sctpMod.payloadOf(value));
                    if (ppid === 50 && payload.length > 0 && payload[0] === 0x03) {
                      channelLabel = sctpMod.labelOf(payload);
                      reply.push(Uint8Array.from(sctpMod.associationSend(
                        association, stream, 50, Uint8Array.from([0x02]), BigInt(Date.now()),
                      )));
                      ackedChannel = true;
                    } else if (ppid === 51) {
                      const whole = Uint8Array.from(
                        sctpMod.associationReassemble(association, stream, flags, payload),
                      );
                      if (whole.length === 0) continue;          // a middle piece
                      if (whole.length > 1000) {
                        bigReceived = whole.length;
                        for (const part of sctpMod.associationSendLarge(
                          association, stream, 51, whole, 1100, BigInt(Date.now()),
                        )) {
                          reply.push(Uint8Array.from(part));
                        }
                      } else if (!droppedEcho) {
                        received = new TextDecoder().decode(whole);
                        // Built, kept in flight and thrown away — the loss this test makes.
                        sctpMod.associationSend(association, stream, 51, whole, BigInt(Date.now()));
                        droppedEcho = true;
                      }
                    }
                  }

                  // Once the echo has been dropped, resend whatever is unacknowledged — the
                  // browser will never SACK a chunk it did not receive, so it stays in flight until
                  // this puts it back on the wire.
                  if (droppedEcho) {
                    for (const again of sctpMod.associationResend(association)) {
                      reply.push(Uint8Array.from(again));
                    }
                  }
                  for (const r of reply) {
                    flight.push(Uint8Array.from(peerMod.peerSeal(peer, r)));
                  }
                }
              }
              at += size;
            }
            for (const out of flight) {
              await sock.send(out, { hostname: sender.hostname, port: sender.port, transport: "udp" });
            }
            continue;
          }
          checksSeen++;
          if (iceMod.isNomination(msg)) nominations++;
          await sock.send(
            iceMod.success(
              Uint8Array.from(iceMod.tidOf(msg)),
              enc.encode(ourPwd),
              1,
              Uint8Array.from(sender.hostname.split(".").map(Number)),
              sender.port,
            ),
            { hostname: sender.hostname, port: sender.port, transport: "udp" },
          );
        }
      })();
      loop.catch(() => {});

      const result = JSON.parse(await readLine()) as {
        ice: string;
        connection: string;
        states: string[];
        channelOpen: boolean;
        echo: string;
        bigSent: number;
        bigEcho: number;
      };

      // ── What a browser did with us ─────────────────────────────────────────────────────────────
      assertEquals(checksSeen > 0, true,
        `Chromium sent no connectivity check we accepted — it rejected our answer or our candidate. ` +
          `Its states: ${result.states.join(", ")}`);
      assertEquals(nominations > 0, true, "and nominated a pair with USE-CANDIDATE");
      assertEquals(["connected", "completed"].includes(result.ice), true,
        `Chromium's ICE reached ${result.ice} rather than connected — states: ${result.states.join(", ")}`);

      // **The boundary, asserted so it cannot drift silently.** With ICE up libwebrtc starts DTLS;
      // we have a client, no server role and no certificate to present, so the peer connection does
      // not complete. When that changes this fails and is the reminder to update it and 0008.
      assertEquals(dtlsBytes > 0, true,
        "after ICE, Chromium should have begun sending DTLS records to us — none arrived");
      assertEquals(clientHellos > 0, true, "the browser sent us a ClientHello");
      assertEquals(peerMod.peerEstablished(peer), true,
        `the DTLS handshake did not complete: the Peer never verified the browser's Finished. ` +
          `Alerts it sent: ${alerts.join(", ") || "none"}`);

      // **And the peer connection reaches `connected`**, which in libwebrtc means ICE *and* DTLS are
      // both up. A browser has completed a DTLS 1.2 handshake with a wac peer: our HelloVerifyRequest,
      // our ServerHello, our certificate, our ECDSA signature over a transcript it agrees with, and a
      // Finished each way.
      assertEquals(["connected", "completed"].includes(result.connection), true,
        `the peer connection reached ${result.connection} rather than connected. ` +
          `Alerts: ${alerts.join(", ") || "none"}. States: ${result.states.join(", ")}`);

      // ── And SCTP on top of it ─────────────────────────────────────────────────────────────────
      assertEquals(sawInit, true,
        "the browser sent an SCTP INIT inside the DTLS connection, which is what a data channel " +
          "is carried by");
      assertEquals(sawCookieEcho, true,
        "and echoed the state cookie from our INIT-ACK, which is the four-way handshake that " +
          "makes a forged INIT cost the server nothing");
      assertEquals(channelLabel, "chat",
        `and opened a data channel by name. Label read: ${JSON.stringify(channelLabel)}`);
      assertEquals(ackedChannel, true, "which we acknowledged with a DATA_CHANNEL_ACK");
      assertEquals(sctpMod.associationEstablished(association), true,
        "and the association records itself as established, which is the cookie having been echoed");
      assertEquals(result.channelOpen, true,
        `the browser's data channel did not reach open. States: ${result.states.join(", ")}`);

      // **And a message crosses, both ways.** The browser sends on open, we read it out of a DATA
      // chunk and send it back in one of ours, and its `message` handler fires. That is a WebRTC
      // data channel between a browser and a wac peer, end to end.
      assertEquals(received, "hello from a browser",
        `we did not read the browser's message. Got: ${JSON.stringify(received)}`);
      // **And it arrives after being dropped.** The echo was built, kept in flight and not sent;
      // what the browser received is the retransmission, byte for byte and under the same TSN.
      assertEquals(droppedEcho, true, "the first echo was built and thrown away");
      assertEquals(result.echo, "hello from a browser",
        `the browser did not receive our echo, so the retransmission did not arrive or was ` +
          `discarded as a duplicate. Got: ${JSON.stringify(result.echo)}`);
      assertEquals(sctpMod.associationInFlight(association), 0,
        "and the browser acknowledged it, so nothing is left in flight");

      // **A message larger than a datagram, both ways.** The browser sends 40,000 bytes, which
      // arrives as a run of DATA chunks we reassemble; we send it back split across chunks of our
      // own, and it arrives as one message.
      assertEquals(bigReceived, result.bigSent,
        `we reassembled ${bigReceived} bytes of the ${result.bigSent} the browser sent`);
      assertEquals(result.bigEcho, result.bigSent,
        `the browser received ${result.bigEcho} bytes of our ${result.bigSent}-byte echo — a ` +
          "receiver handed the pieces sees intact chunks and a wrong message, which no checksum catches");
    } finally {
      sock.close();
      try {
        child.kill("SIGKILL");
      } catch { /* gone */ }
      await child.status.catch(() => {});
      await Deno.remove(file).catch(() => {});
    }
  },
});
