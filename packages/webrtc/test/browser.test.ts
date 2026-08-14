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
  associationSend(a: unknown, stream: number, ppid: number, payload: Uint8Array): Uint8Array;
  associationEstablished(a: unknown): boolean;
  associationPeerTag(a: unknown): number;
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
  channel.addEventListener("message", (e) => { window.__echo = String(e.data); });
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
  await new Promise((r) => setTimeout(r, 12000));
  return {
    ice: window.__pc.iceConnectionState,
    connection: window.__pc.connectionState,
    states: window.__states,
    channelOpen: window.__channelOpen === true,
    echo: window.__echo,
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
    let cookieIssued = false;
    let handshakeState = "waiting for the browser's ClientHello";
    let clientRandom: Uint8Array | null = null;
    let clientHelloMsg: Uint8Array | null = null;
    let ourFlight: Uint8Array[] = [];
    let transcript: Uint8Array | null = null;
    let ckeMsg: Uint8Array | null = null;
    let keys: { cw: Uint8Array; sw: Uint8Array; ci: Uint8Array; si: Uint8Array; master: Uint8Array } | null = null;
    let theirFinishedVerified = false;
    // The SCTP association, which runs inside the DTLS connection once it is up.
    let sctpSeq = 1n;                  // our epoch-1 record sequence; the Finished spent 0
    let theirTag = 0;
    let sawInit = false;
    let sawCookieEcho = false;
    let channelLabel = "";
    let ackedChannel = false;
    let received = "";
    const association = sctpMod.newAssociation(0x77777777 | 0, 1, 65536);
    /** What our INIT-ACK carries and the peer echoes. A real server authenticates it with a key. */
    const COOKIE = Uint8Array.from({ length: 24 }, (_, i) => (i * 7 + 1) & 0xFF);
    const alerts: string[] = [];
    let offeredGroups: number[] = [];
    let helloFrag: number[] = [];
    const fragments = new Map<number, { kind: number; body: Uint8Array; have: number }>();
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
          const peer = from as Deno.NetAddr;
          const why = iceMod.rejected(msg, ourUfrag, theirUfrag, enc.encode(ourPwd));
          if (why !== 0) {
            // Once ICE is up, what arrives is DTLS — a record's first byte is 20 to 63.
            if (msg.length === 0 || msg[0] < 20 || msg[0] > 63) continue;
            dtlsBytes += msg.length;

            // ── The DTLS server handshake, against libwebrtc ───────────────────────────────────
            let at = 0;
            const flight: Uint8Array[] = [];
            for (;;) {
              const size = dtlsMod.sizeAt(msg, at);
              if (size < 0) break;
              const kind = dtlsMod.kindAt(msg, at);
              const epoch = dtlsMod.epochAt(msg, at);
              // **An alert names the cause.** Without reading them a rejected flight is only
              // "nothing came back", which is the least informative thing a peer can tell you and
              // is what the first version of this reported.
              if (kind === 21) {
                const body = msg.subarray(at + 13, at + size);
                alerts.push(body.length >= 2 ? `${body[0]}/${body[1]}` : `short(${body.length})`);
              }
              if (kind === 22 && epoch === 0) {
                const info = dtlsMod.fragInfoAt(msg, at);
                // **Reassembled, because a browser's ClientHello does not fit in a datagram.**
                // Chromium's is 1,413 bytes and arrives in pieces; the fragment we happened to see
                // first was at offset 1,175, so reading a "client random" out of it gave 32 bytes
                // from the middle of the message — and the ServerKeyExchange signature then covered
                // the wrong bytes, which is exactly what `decrypt_error` was telling us.
                //
                // OpenSSL's `s_client` sends a hello small enough for one datagram, which is why
                // the server role passed against it and failed against a browser. The client half
                // of this package learned the same lesson from the other side and this is the same
                // reassembly, applied where it was missing.
                const [fk, fseq, foff, flen, ftotal] = [...info];
                let body: Uint8Array | null = null;
                if (fk >= 0) {
                  let slot = fragments.get(fseq);
                  if (slot === undefined) {
                    slot = { kind: fk, body: new Uint8Array(ftotal), have: 0 };
                    fragments.set(fseq, slot);
                  }
                  slot.body.set(msg.subarray(at + 13 + 12, at + 13 + 12 + flen), foff);
                  slot.have += flen;
                  if (slot.have >= ftotal) body = slot.body;
                }
                if (body === null) {
                  at += size;
                  continue;
                }
                if (info[0] === 1) {
                  clientHellos++;
                  const cookie = Uint8Array.from(dtlsMod.cookieOfHello(body));
                  if (cookie.length === 0) {
                    // No cookie yet: answer with one and remember nothing, which is the point.
                    flight.push(Uint8Array.from(
                      dtlsMod.verifyRequestRecord(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]), 0, 0n),
                    ));
                    cookieIssued = true;
                    handshakeState = "cookie issued";
                  } else if (clientHelloMsg === null) {
                    offeredGroups = [...dtlsMod.groupsOfHello(body)];
                    helloFrag = [...info];
                    // The transcript hashes the message as if it had never been fragmented.
                    clientHelloMsg = Uint8Array.from(dtlsMod.reheaded(1, fseq, body));
                    clientRandom = Uint8Array.from(dtlsMod.randomOfHello(body));
                    const ourKey = Uint8Array.from(dtlsMod.ourPublic(X25519, SERVER_SCALAR));
                    const params = Uint8Array.from(dtlsMod.ecdhParams(X25519, ourKey));
                    const signature = Uint8Array.from(dtlsMod.signEcdsaDer(
                      priv, cat(clientRandom, SERVER_RANDOM, params), SIG_K,
                    ));
                    const sh = Uint8Array.from(dtlsMod.reheaded(2, 1,
                      Uint8Array.from(dtlsMod.serverHelloBody(SERVER_RANDOM, SUITE))));
                    const cert = Uint8Array.from(dtlsMod.reheaded(11, 2,
                      Uint8Array.from(dtlsMod.certMessage(der))));
                    const ske = Uint8Array.from(dtlsMod.reheaded(12, 3,
                      Uint8Array.from(dtlsMod.skeBody(params, ECDSA_SHA256, signature))));
                    const done = Uint8Array.from(dtlsMod.reheaded(14, 4,
                      Uint8Array.from(dtlsMod.doneBody())));
                    ourFlight = [sh, cert, ske, done];
                    transcript = cat(clientHelloMsg, sh, cert, ske, done);
                    for (let i = 0; i < ourFlight.length; i++) {
                      flight.push(recordOf(22, 0, BigInt(i + 1), ourFlight[i]));
                    }
                    handshakeState = "our flight sent";
                  }
                } else if (info[0] === 16 && clientRandom !== null) {
                  ckeMsg = Uint8Array.from(dtlsMod.reheaded(16, fseq, body));
                  const clientKey = Uint8Array.from(dtlsMod.ckePublic(body));
                  const pms = Uint8Array.from(dtlsMod.preMaster(X25519, SERVER_SCALAR, clientKey));
                  const master = Uint8Array.from(dtlsMod.masterFrom(pms, clientRandom, SERVER_RANDOM));
                  const block = Uint8Array.from(dtlsMod.blockFrom(master, SERVER_RANDOM, clientRandom));
                  keys = {
                    cw: block.subarray(0, 16),
                    sw: block.subarray(16, 32),
                    ci: block.subarray(32, 36),
                    si: block.subarray(36, 40),
                    master,
                  };
                  transcript = cat(transcript!, ckeMsg);
                  handshakeState = "keys derived";
                }
              } else if (kind === 23 && epoch === 1 && keys !== null) {
                // **Application data, which for a data channel is SCTP.** The DTLS connection is up
                // and everything above it arrives here, one SCTP packet per record.
                const sctp = Uint8Array.from(dtlsMod.openedAt(msg, at, keys.cw, keys.ci));
                if (sctp.length > 0 && sctpMod.crcVerifies(sctp)) {
                  const kinds = [...sctpMod.chunkKinds(sctp)];
                  const value = Uint8Array.from(sctpMod.firstChunkValue(sctp));
                  // **The association answers.** INIT-ACK, COOKIE-ACK and the SACKs come from
                  // `Association.receive`, which owns the TSN and the per-stream sequence — the two
                  // counters that were local variables here and were each forgotten once, losing a
                  // message silently. What is left in this test is the *data channel*: DCEP is a
                  // message inside a DATA chunk and is not SCTP's business.
                  const reply = [...sctpMod.associationReceive(association, sctp, COOKIE)]
                    .map((p) => Uint8Array.from(p));
                  if (kinds.includes(1)) sawInit = true;
                  if (kinds.includes(10)) sawCookieEcho = true;
                  if (kinds.includes(0)) {
                    const ppid = sctpMod.ppidOf(value);
                    const stream = sctpMod.streamOf(value);
                    const payload = Uint8Array.from(sctpMod.payloadOf(value));
                    if (ppid === 50 && payload.length > 0 && payload[0] === 0x03) {
                      channelLabel = sctpMod.labelOf(payload);
                      reply.push(Uint8Array.from(sctpMod.associationSend(
                        association, stream, 50, Uint8Array.from([0x02]),
                      )));
                      ackedChannel = true;
                    } else if (ppid === 51) {
                      received = new TextDecoder().decode(payload);
                      reply.push(Uint8Array.from(
                        sctpMod.associationSend(association, stream, 51, payload),
                      ));
                    }
                  }
                  for (const r of reply) {
                    flight.push(Uint8Array.from(
                      dtlsMod.sealedRecord(keys.sw, keys.si, 1, sctpSeq++, 23, r),
                    ));
                  }
                }
              } else if (kind === 22 && epoch === 1 && keys !== null && !theirFinishedVerified) {
                const plain = Uint8Array.from(dtlsMod.openedAt(msg, at, keys.cw, keys.ci));
                if (plain.length > 0 && plain[0] === 20) {
                  const want = Uint8Array.from(
                    dtlsMod.finishedMessage(keys.master, transcript!, 0, true),
                  );
                  if (hex(plain.subarray(12)) === hex(want.subarray(12))) {
                    theirFinishedVerified = true;
                    handshakeState = "their Finished verified";
                    const ourFin = Uint8Array.from(
                      dtlsMod.finishedMessage(keys.master, cat(transcript!, plain), 5, false),
                    );
                    flight.push(recordOf(20, 0, 5n, Uint8Array.from([1])));
                    flight.push(Uint8Array.from(
                      dtlsMod.sealedRecord(keys.sw, keys.si, 1, 0n, 22, ourFin),
                    ));
                    handshakeState = "our Finished sent";
                  } else {
                    handshakeState = "their Finished did not match our transcript";
                  }
                }
              }
              at += size;
            }
            for (const out of flight) {
              await sock.send(out, { hostname: peer.hostname, port: peer.port, transport: "udp" });
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
              Uint8Array.from(peer.hostname.split(".").map(Number)),
              peer.port,
            ),
            { hostname: peer.hostname, port: peer.port, transport: "udp" },
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
      assertEquals(clientHellos > 0, true,
        `${dtlsBytes} bytes of DTLS arrived but none parsed as a ClientHello, so src/dtls.wac ` +
          "disagrees with libwebrtc about the record or handshake header");
      // ── How far the DTLS handshake gets with a browser ────────────────────────────────────────
      //
      // **The cookie exchange works against libwebrtc**, which is a real step past reading its
      // ClientHello: it accepted a HelloVerifyRequest we built and retried with the cookie we
      // issued.
      assertEquals(clientHellos > 0, true, "the browser sent us a ClientHello");
      assertEquals(cookieIssued, true, "we answered with a HelloVerifyRequest");
      assertEquals(clientHelloMsg !== null, true,
        `the browser did not retry with our cookie. State: ${handshakeState}`);
      // **The count, not the label.** `handshakeState` is last-write-wins and the browser
      // retransmits its first ClientHello, which sets it back to "cookie issued" — a mutable string
      // is a poor thing to assert about a conversation that repeats itself.
      assertEquals(ourFlight.length, 4,
        `we answered with ServerHello, Certificate, ServerKeyExchange and ServerHelloDone. ` +
          `State: ${handshakeState}`);

      // **And then it rejects our ServerKeyExchange, where OpenSSL accepts it.** `2/51` is
      // `decrypt_error`, which at this point in a handshake means the signature did not verify.
      // The same signature, over the same construction, satisfies `openssl s_client` in
      // `dtlsserver.test.ts` — so this is a divergence between two verifiers rather than a
      // signature that is simply wrong, and `issues/system/0151` holds the evidence.
      //
      // Asserted, rather than left as a silence, so that the day it changes this test says so.
      // **And it accepts the flight**, which means it verified our ECDSA signature over a transcript
      // it agrees with — what `issues/system/0151` was about, once the hello was reassembled.
      assertEquals(ckeMsg !== null, true,
        `the browser sent no ClientKeyExchange. Alerts: ${alerts.join(", ") || "none"}`);
      assertEquals(theirFinishedVerified, true,
        `the browser's Finished did not verify against our transcript. ` +
          `Alerts: ${alerts.join(", ") || "none"}. State: ${handshakeState}`);
      // **What the browser actually offered.** A server must choose from this list, and answering
      // with a group that is not in it sends a ServerKeyExchange the peer cannot parse.
      assertEquals(offeredGroups.length > 0, true,
        `we read the browser's supported_groups. Hello fragment: ${helloFrag.join("/")} ` +
          `(kind, seq, offset, fragLen, totalLen) — if fragLen is short of totalLen the hello is ` +
          `fragmented and only its first piece was parsed, which would make every extension ` +
          `invisible and the transcript wrong`);
      assertEquals(offeredGroups.includes(0x001D), true,
        `the browser does not offer x25519 (0x001d); it offers ` +
          `${offeredGroups.map((g) => "0x" + g.toString(16)).join(", ")} — so answering with x25519 ` +
          `is a group it never asked for, which is issues/system/0151`);



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
      assertEquals(result.echo, "hello from a browser",
        `the browser did not receive our echo. Got: ${JSON.stringify(result.echo)}`);
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
