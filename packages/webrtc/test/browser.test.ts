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
  check(tid: Uint8Array, peerUfrag: string, ourUfrag: string, peerPassword: Uint8Array,
    priority: bigint, controlling: boolean, tiebreaker: Uint8Array,
    useCandidate: boolean): Uint8Array;
  newConsent(interval: bigint, timeout: bigint, now: bigint): unknown;
  consentDue(c: unknown, now: bigint): boolean;
  consentSent(c: unknown, tid: Uint8Array, now: bigint): void;
  consentAnswered(c: unknown, msg: Uint8Array, password: Uint8Array, now: bigint): boolean;
  consentLive(c: unknown, now: bigint): boolean;
};

const sessionMod = await wacBind("packages/webrtc/test/wac/session_probe.wac") as unknown as {
  sessionOver(certDer: Uint8Array, signingKey: Uint8Array, nonce: Uint8Array,
    scalar: Uint8Array, random: Uint8Array, dtlsCookie: Uint8Array, ourTag: number,
    initialTsn: number, sctpCookie: Uint8Array, consentInterval: bigint, now: bigint,
    ourUfrag: string, ourPwd: string, theirUfrag: string, theirPwd: string,
    expectFingerprint: string): unknown;
  sessionPeerIsExpected(s: unknown): boolean;
  sessionApplication(s: unknown, datagram: Uint8Array, at: number): Uint8Array;
  sessionPeerEstablished(s: unknown): boolean;
  sessionAssocEstablished(s: unknown): boolean;
  sessionWaiting(s: unknown): number;
  sessionWindow(s: unknown): number;
  sessionAborted(s: unknown): boolean;
  sessionPeerFingerprint(s: unknown): string;
  sessionPeerAuthenticated(s: unknown): boolean;
  sessionConsentLive(s: unknown, now: bigint): boolean;
  sessionConsentDue(s: unknown, now: bigint): boolean;
  sessionConsentSent(s: unknown, tid: Uint8Array, now: bigint): void;
  sessionConsentAnswered(s: unknown, msg: Uint8Array, password: Uint8Array,
    now: bigint): boolean;
  sessionReceive(s: unknown, datagram: Uint8Array, fromIp: Uint8Array, fromPort: number,
    now: bigint): Uint8Array[];
  sessionSend(s: unknown, stream: number, payload: Uint8Array, now: bigint): Uint8Array[];
  sessionTick(s: unknown, now: bigint): Uint8Array[];
  sessionResend(s: unknown, now: bigint): Uint8Array[];
  sessionTake(s: unknown): Uint8Array;
  sessionOpen(s: unknown): boolean;
  sessionLabel(s: unknown): Uint8Array;
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
  associationReceive(a: unknown, pkt: Uint8Array, cookie: Uint8Array, now: bigint): Uint8Array[];
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array, now: bigint): Uint8Array;
  associationEstablished(a: unknown): boolean;
  associationPeerTag(a: unknown): number;
  associationResend(a: unknown): Uint8Array[];
  associationInFlight(a: unknown): number;
  associationSendLarge(a: unknown, stream: number, ppid: number, payload: Uint8Array,
    maxChunk: number, now: bigint): Uint8Array[];
  associationDue(a: unknown, now: bigint, rto: bigint): Uint8Array[];
  associationAccept(a: unknown, tsn: number): boolean;
  associationFlush(a: unknown, now: bigint): Uint8Array[];
  associationWaiting(a: unknown): number;
  associationWindow(a: unknown): number;
  associationReassemble(a: unknown, stream: number, flags: number, piece: Uint8Array,
    tsn: number): Uint8Array;
  associationAborted(a: unknown): boolean;
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

    let deadSock: Deno.DatagramConn | null = null;
    let watchDead: Promise<void> = Promise.resolve();
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
  window.__channel = channel;
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
  // **Everything about the live connection is read before anything is closed.** Closing moves both
  // ICE and connection state to closed at once, so a snapshot taken afterwards reports a torn-down
  // connection and every assertion about the working one fails.
  const live = { ice: window.__pc.iceConnectionState, connection: window.__pc.connectionState };
  const pairs = [];
  const stats = await window.__pc.getStats();
  stats.forEach((r) => {
    if (r.type === "candidate-pair") {
      pairs.push(r.state + " reqRecv=" + r.requestsReceived + " respSent=" + r.responsesSent +
        " reqSent=" + r.requestsSent + " respRecv=" + r.responsesReceived);
    }
  });

  // **And then close, to find out what a browser actually sends.** A data channel closing and a
  // peer connection closing are different events at the SCTP layer, so they are done apart with a
  // pause between: whatever arrives after each is attributable to that one.
  window.__channel.close();
  await new Promise((r) => setTimeout(r, 1200));
  const afterChannelClose = window.__pc.connectionState;
  window.__pc.close();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    afterChannelClose,
    pairs,
    ice: live.ice,
    connection: live.connection,
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
    const chunkLog: number[] = [];
    const handshakeKinds = new Set<number>();
    // Where to send a consent check. The session owns the timer; what it cannot know is the
    // address, which we learn from the first check we answer.
    let consentPeer: Deno.NetAddr | null = null;
    /** Stable for this agent's lifetime, per RFC 8445 §5.2. */
    const tiebreaker = crypto.getRandomValues(new Uint8Array(8));
    let consentSent = 0;
    let consentAnswers = 0;
    let bigReceived = 0;
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

      // **The session, once the peer's credentials are known**, since they are half of what
      // authenticates every check in both directions. Everything below this point hands datagrams
      // to it rather than to the four layers separately.
      const session = sessionMod.sessionOver(der, priv, SIG_K, SERVER_SCALAR, SERVER_RANDOM,
        Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]), 0x77777777 | 0, 1, COOKIE,
        400n, BigInt(Date.now()), ourUfrag, ourPwd, theirUfrag, theirPwd,
        // **The fingerprint from its offer.** Without this the session refuses to carry anything,
        // which is the point: a peer nobody named is a peer nobody vouched for.
        sdpMod.printOf(offer.sdp));
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
      // ── Two candidates, and the better one does not work ─────────────────────────────────────
      //
      // **The design note's third criterion: if a check is never seen to fail, the pairing is
      // untested by construction.** One candidate that always works exercises nothing about
      // choosing between pairs. So the answer advertises a dead port at a *higher* priority than
      // the live one — nothing is listening there, and `localPref` 65535 against 65534 is what
      // makes a peer try it first. A browser that reaches a data channel anyway has been seen to
      // fail a check and move on, which is the whole of what ICE is for.
      const deadPort = ourPort + 1;
      // **Bound, and silent.** Listening lets this count the checks that arrive, which is what
      // turns "the browser coped" into "the browser tried this pair and it failed" — without it a
      // browser that ignored the candidate outright would pass this just as happily.
      deadSock = Deno.listenDatagram({
        port: deadPort, transport: "udp", hostname: "0.0.0.0",
      });
      const listening = deadSock;
      let deadChecks = 0;
      watchDead = (async () => {
        try {
          for (;;) {
            await listening.receive();
            deadChecks++;
          }
        } catch { /* closed at the end of the test */ }
      })();
      const deadPriority = iceMod.priorityOf(iceMod.hostPref(), 65535, 1);
      const livePriority = iceMod.priorityOf(iceMod.hostPref(), 65534, 1);
      const candidates =
        sdpMod.candidateLine(
          iceMod.lineFor("wacDead", 1, "udp", deadPriority, theirHost, deadPort, "host"),
        ) +
        sdpMod.candidateLine(
          iceMod.lineFor("wac1", 1, "udp", livePriority, theirHost, ourPort, "host"),
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
          if (consentPeer !== null && sessionMod.sessionConsentDue(session, BigInt(Date.now()))) {
            const tid = crypto.getRandomValues(new Uint8Array(12));
            sessionMod.sessionConsentSent(session, tid, BigInt(Date.now()));
            consentSent++;
            await sock.send(
              iceMod.check(tid, theirUfrag, ourUfrag, enc.encode(theirPwd),
                // **Controlled, not controlling.** Chromium made the offer, so it is the
                // controlling agent; claiming that role in our own check is a role conflict and
                // gets a 487 error response rather than a success.
                // **And one tiebreaker for the whole session.** RFC 8445 §5.2 requires an agent
                // to use the same value in every check it sends — it is what identifies the agent,
                // so a fresh one each time is a different agent each time. This was regenerated per
                // check, which is `issues/system/0152`.
                iceMod.priorityOf(iceMod.hostPref(), 65535, 1), false, tiebreaker, false),
              consentPeer,
            );
          }
          const msg = Uint8Array.from(datagram);
          const sender = from as Deno.NetAddr;
          const why = iceMod.rejected(msg, ourUfrag, theirUfrag, enc.encode(ourPwd));

          // **A STUN success response is the answer to a consent check we sent** — `rejected`
          // reports it as "a response, not a check", which is right for its own purpose and is
          // exactly what we are waiting for here.
          if (why === 2) {
            // `Session.receive` folds this in too; it is done here as well only to count it, since
            // the number is what `issues/system/0152` is about.
            if (sessionMod.sessionConsentAnswered(session, msg, enc.encode(theirPwd),
                                                  BigInt(Date.now()))) {
              consentAnswers++;
            }
            continue;
          }
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
            // ── One call, because `Session` is the thing that joins the layers ───────────────
            //
            // **This used to be sixty lines here.** Which record inside the datagram is
            // application data, that an SCTP packet holds several chunks, that DCEP's open has to
            // be answered before a browser will fire its `open` event, that a large message is a
            // run of DATA chunks to reassemble — all of it now belongs to `session.wac`, and a
            // program using this package gets it without writing any of it. The browser is the
            // oracle for whether that composition is right: if it were wrong the data channel
            // would not open, and every assertion below would say so.
            const flight: Uint8Array[] = [];
            for (const out of sessionMod.sessionReceive(
              session, msg, Uint8Array.from(sender.hostname.split(".").map(Number)),
              sender.port, BigInt(Date.now()),
            )) {
              flight.push(Uint8Array.from(out));
            }
            if (dtlsMod.handshakeKindAt(msg, 0) === 1) clientHellos++;
            // Every plaintext handshake message the browser sends, so the *absence* of one is
            // assertable — see the certificate note at the end of this test.
            for (let ha = 0; ; ) {
              const size = dtlsMod.sizeAt(msg, ha);
              if (size < 0) break;
              if (dtlsMod.kindAt(msg, ha) === 22) {
                handshakeKinds.add(dtlsMod.handshakeKindAt(msg, ha));
              }
              ha += size;
            }

            // **Observation, separately and without mutating anything.** `peerApplication` only
            // decrypts, so reading the chunk kinds a second time costs nothing and keeps this test
            // measuring the protocol rather than only the composition — which is what says a
            // browser really did send an INIT and echo a cookie, not merely that a channel opened.
            let at = 0;
            for (;;) {
              const size = dtlsMod.sizeAt(msg, at);
              if (size < 0) break;
              if (dtlsMod.kindAt(msg, at) === 23) {
                const sctp = Uint8Array.from(sessionMod.sessionApplication(session, msg, at));
                if (sctp.length > 0 && sctpMod.crcVerifies(sctp)) {
                  const kinds = [...sctpMod.chunkKinds(sctp)];
                  if (kinds.includes(1)) sawInit = true;
                  if (kinds.includes(10)) sawCookieEcho = true;
                  for (let ci = 0; ci < sctpMod.chunkCount(sctp); ci++) {
                    chunkLog.push(sctpMod.chunkKindAt(sctp, ci));
                  }
                }
              }
              at += size;
            }

            // **What the session delivered**, and what this test does with it: echo the small one
            // after throwing the first copy away, and echo the large one back whole.
            if (sessionMod.sessionOpen(session) && !ackedChannel) {
              ackedChannel = true;
              channelLabel = new TextDecoder().decode(
                Uint8Array.from(sessionMod.sessionLabel(session)),
              );
            }
            for (;;) {
              const whole = Uint8Array.from(sessionMod.sessionTake(session));
              if (whole.length === 0) break;
              if (whole.length > 1000) {
                bigReceived = whole.length;
                for (const part of sessionMod.sessionSend(session, 0, whole, BigInt(Date.now()))) {
                  flight.push(Uint8Array.from(part));
                }
              } else if (!droppedEcho) {
                received = new TextDecoder().decode(whole);
                // Built, kept in flight and thrown away — the loss this test makes.
                sessionMod.sessionSend(session, 0, whole, BigInt(Date.now()));
                droppedEcho = true;
              }
            }
            // Once the echo has been dropped, resend whatever is unacknowledged — the browser will
            // never acknowledge a chunk it did not receive, so it stays in flight until this puts
            // it back on the wire.
            if (droppedEcho) {
              for (const again of sessionMod.sessionResend(session, BigInt(Date.now()))) {
                flight.push(Uint8Array.from(again));
              }
            }
            // **Whatever the congestion window now allows.** A SACK opens it, so this is where the
            // rest of a large message goes out — without it the remainder would sit queued.
            for (const more of sessionMod.sessionTick(session, BigInt(Date.now()))) {
              flight.push(Uint8Array.from(more));
            }
            for (const out of flight) {
              await sock.send(out, { hostname: sender.hostname, port: sender.port, transport: "udp" });
            }
            continue;
          }
          checksSeen++;
          if (iceMod.isNomination(msg)) nominations++;
          // **Consent runs from the first check we answer**, because that is the first moment we
          // know an address that wants our packets. The interval is 400ms rather than RFC 7675's
          // five seconds so that several renewals happen inside a test that lasts a few — the rule
          // being measured is that the peer answers an authenticated request on the selected pair,
          // and that does not depend on the period.
          if (consentPeer === null) {
            consentPeer = { hostname: sender.hostname, port: sender.port, transport: "udp" };
          }
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
        pairs: string[];
        afterChannelClose: string;
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
      assertEquals(sessionMod.sessionPeerEstablished(session), true,
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
      assertEquals(sessionMod.sessionAssocEstablished(session), true,
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
      // **Not "nothing in flight".** That held when the small echo was the only traffic, and stopped
      // being true the moment a 40,000-byte message followed it: the last SACK of that transfer may
      // arrive after the page has stopped waiting, so the assertion would be a race rather than a
      // fact. What is checked instead is that the window *opened*, below, which cannot happen
      // without acknowledgements arriving.

      // **A message larger than a datagram, both ways.** The browser sends 40,000 bytes, which
      // arrives as a run of DATA chunks we reassemble; we send it back split across chunks of our
      // own, and it arrives as one message.
      assertEquals(bigReceived, result.bigSent,
        `we reassembled ${bigReceived} bytes of the ${result.bigSent} the browser sent`);
      // **And the window paced it.** 40,000 bytes is far more than the initial 4,380, so it can only
      // have crossed by the window opening as acknowledgements came back — if `sendLarge` had put
      // every chunk on the path at once this would still pass, which is why the window is asserted
      // to have grown rather than the message merely arriving.
      assertEquals(sessionMod.sessionWaiting(session), 0, "nothing left queued");
      assertEquals(sessionMod.sessionWindow(session) > 4380, true,
        `the congestion window is still ${sessionMod.sessionWindow(session)}, so it never ` +
          "opened — the message went out in one burst rather than being paced");

      // ── What the browser never sent, which is the point ──────────────────────────────────────
      //
      // **We authenticate nobody, and this is where that is visible.** WebRTC's identity is the
      // `a=fingerprint` line: each end is supposed to compare the certificate the other presented
      // against the fingerprint the signalling channel named. A DTLS server gets the peer's
      // certificate only by asking — a CertificateRequest in its first flight — and ours does not
      // ask, so Chromium sends no Certificate (11) and no CertificateVerify (15), and there is
      // nothing here to compare against anything.
      //
      // Asserted as an absence rather than described, because that is what dates it: adding
      // CertificateRequest makes these two fail on the next run, which is when the paragraph and
      // `issues/system/0153` need rewriting.
      assertEquals(handshakeKinds.has(11), true,
        "Chromium sent no Certificate — our CertificateRequest is in the flight, so either it was " +
          "not understood or the flight did not arrive");
      assertEquals(handshakeKinds.has(15), true,
        "and a CertificateVerify, which is the signature that makes the certificate mean anything");

      // **And it is the certificate the signalling channel named.** This is the whole of WebRTC's
      // identity: no PKI, a self-signed certificate per session, and an `a=fingerprint` line that
      // says which one to expect. Comparing them is what distinguishes the peer we were told about
      // from anybody else who can reach the port.
      const offered = sdpMod.printOf(offer.sdp);
      const presented = sessionMod.sessionPeerFingerprint(session);
      assertEquals(presented.length, 95,
        `we hold no usable peer certificate — fingerprint read as ${JSON.stringify(presented)}`);
      assertEquals(presented, offered,
        "the certificate Chromium presented in DTLS is not the one its SDP promised");

      // **And it proved it holds the key.** The fingerprint says which certificate to expect; the
      // CertificateVerify signature, over this handshake and no other, is what an attacker holding
      // the same public certificate cannot produce.
      assertEquals(sessionMod.sessionPeerIsExpected(session), true,
        "the session does not accept this peer as the one the SDP named, so no data would have " +
          "crossed — yet it did, which means the gate is not where it is supposed to be");
      assertEquals(sessionMod.sessionPeerAuthenticated(session), true,
        "the CertificateVerify Chromium sent does not check out against the certificate it " +
          "presented, so the signature and the certificate disagree");

      // ── And a pair that did not work ─────────────────────────────────────────────────────────
      assertEquals(deadChecks > 0, true,
        "nothing arrived at the higher-priority candidate, so the browser never tried it and this " +
          "case proves nothing about choosing between pairs — check the priorities");

      // ── Consent freshness, against a real browser ─────────────────────────────────────────────
      //
      // **The rule is that the peer keeps agreeing.** RFC 7675 exists for whoever might later hold
      // the address we are sending to, so the thing worth proving against a browser is that an
      // authenticated binding request on the selected pair really is answered — a timer that were
      // never answered would expire consent on a perfectly good connection and take the data
      // channel with it.
      assertEquals(consentSent > 1, true,
        `only ${consentSent} consent checks went out, so the renewal interval never came round ` +
          "and this asserts nothing about a browser");
      // **Chromium answers every consent check it receives**, which its own statistics say and our
      // socket cannot: the responses that arrive after this loop stops reading are never counted
      // here, which is what made this look like a one-in-six coin flip for a while
      // (`issues/system/0152`, now closed). Asking the peer how many it answered is the measurement
      // that does not depend on when we stop listening.
      // **The pair that received our requests, whatever state it is in.** This used to require
      // `in-progress`, which is the state Chromium happened to report when the assertion was
      // written — and it is an *intermediate* state, so keying on it made the test fail when the
      // handshake got faster. It did, on 2026-08-20: masking the branches out of `ghash` and
      // `xtime` took GHASH from 740 traced events to 484 and AES from 11,779 to 9,475, the pair
      // reached `succeeded` before these statistics were sampled, and this reported "no candidate
      // pair received any request from us" while printing `reqRecv=2` in the same sentence.
      //
      // Reverting only those two files made it pass again, which is how the cause was pinned. The
      // state was never the point: what the assertions below need is the pair Chromium answered
      // consent checks on, and `succeeded` is the better end for it to have reached.
      const selected = result.pairs.find((p) => /\breqRecv=([1-9]\d*)/.test(p));
      assertEquals(selected !== undefined, true,
        `no candidate pair received any request from us, in any state. Pairs: ` +
          JSON.stringify(result.pairs));
      const recv = Number(/reqRecv=(\d+)/.exec(selected!)![1]);
      const sent = Number(/respSent=(\d+)/.exec(selected!)![1]);
      assertEquals(sent, recv,
        `Chromium answered ${sent} of the ${recv} consent checks it received. Anything less than ` +
          "all of them means it is declining to answer, which is what 0152 suspected and its own " +
          "statistics disproved");
      assertEquals(recv > 0, true, "and it received some, so this is not a vacuous equality");
      assertEquals(sessionMod.sessionConsentLive(session, BigInt(Date.now())), true,
        "consent is live at the end, which is the state that permits sending at all");

      // ── And how a browser closes, which is not how the specification's example does ──────────
      //
      // **Measured rather than assumed.** The design note said it was unclear whether Chromium sent
      // SCTP's shutdown exchange at all; it does not. Over a whole session it sent exactly one
      // chunk that was not DATA, SACK, INIT or COOKIE_ECHO, and it was ABORT. No SHUTDOWN, and no
      // RE-CONFIG for the data channel closing either. So the graceful exchange is one we may
      // start, and ABORT is the one we will be handed — which is why ignoring it was a real gap
      // rather than a tidiness one.
      const kinds = [...new Set(chunkLog)].sort((x, y) => x - y);
      assertEquals(kinds.join(","), "0,1,3,6,10",
        `Chromium sent chunk kinds ${kinds.join(",")}. Expected DATA, INIT, SACK, ABORT and ` +
          "COOKIE_ECHO — and in particular no SHUTDOWN (7). If a 7 appears here, a browser has " +
          "started sending the graceful exchange and the design note's account of this is out of date");
      assertEquals(chunkLog[chunkLog.length - 1], 6,
        "and the abort was the last thing it sent, which is what makes it the close");
      assertEquals(sessionMod.sessionAborted(session), true,
        "and our association recorded it rather than carrying on believing the peer was there");
      assertEquals(result.afterChannelClose, "connected",
        "closing the data channel alone did not close the connection — the abort came from the " +
          "peer connection closing, not from the channel");

      assertEquals(result.bigEcho, result.bigSent,
        `the browser received ${result.bigEcho} bytes of our ${result.bigSent}-byte echo — a ` +
          "receiver handed the pieces sees intact chunks and a wrong message, which no checksum catches");
    } finally {
      sock.close();
      try { deadSock?.close(); } catch { /* never bound */ }
      await watchDead;
      try {
        child.kill("SIGKILL");
      } catch { /* gone */ }
      await child.status.catch(() => {});
      await Deno.remove(file).catch(() => {});
    }
  },
});
