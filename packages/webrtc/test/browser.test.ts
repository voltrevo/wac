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
//   - it then starts DTLS, and that is where we stop, because our DTLS has no server role and
//     presents no certificate, which WebRTC requires of both ends. The boundary is asserted rather
//     than omitted, so when it moves this test says so.
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
};

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
  window.__pc.createDataChannel("chat");
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
  };
}, answer);
console.log(JSON.stringify({ kind: "result", ...result }));
await browser.close();
server.close();
process.exit(0);
`);

    let checksSeen = 0;
    let nominations = 0;
    let dtlsBytes = 0;
    let clientHellos = 0;
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
            // Once ICE is up, what arrives is DTLS — a record's first byte is 20 to 63 — and
            // counting it is how this test knows the browser moved on rather than gave up.
            if (msg.length > 0 && msg[0] >= 20 && msg[0] <= 63) {
              dtlsBytes += msg.length;
              // **And it parses as one.** `dtls.wac` reading libwebrtc's own ClientHello is a
              // stronger claim than "some bytes arrived", and it is the first byte of the DTLS
              // handshake this package will one day complete with a browser.
              if (dtlsMod.kindAt(msg, 0) === 22 && dtlsMod.handshakeKindAt(msg, 0) === 1) {
                clientHellos++;
              }
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
      assertEquals(result.connection === "connected", false,
        "the peer connection completed, which means DTLS and SCTP now work against a browser — " +
          "update this test and design/system/0008, because that is the goal it measures the " +
          "distance to");
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
