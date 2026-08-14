// `example/answer.wac` — the package as a program rather than as a library.
//
// **Everything else here drives wac from TypeScript.** The browser test owns the socket, the clock
// and the identity and asks the wac side what bytes to send, which is the right way to measure a
// packet layer and leaves one question unasked: whether the thing is a program. This runs the
// program — its own socket, its own clock, its own certificate — and talks to it from outside.
//
// Two things are checked and they fail differently. That the description it prints is one a peer
// can act on, judged by aiortc rather than by us. And that its *loop* runs: a connectivity check
// sent to the port it bound comes back answered, under the password it advertised, which cannot
// happen unless the SDP it printed and the socket it is listening on agree.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ice = await wacBind("packages/webrtc/test/wac/ice_probe.wac") as unknown as {
  check(tid: Uint8Array, peerUfrag: string, ourUfrag: string, peerPassword: Uint8Array,
    priority: bigint, controlling: boolean, tiebreaker: Uint8Array,
    useCandidate: boolean): Uint8Array;
  priorityOf(typePref: number, localPref: number, component: number): bigint;
  hostPref(): number;
  reportedAddress(msg: Uint8Array): Int32Array;
  tidOf(msg: Uint8Array): Uint8Array;
};
const stun = await wacBind("packages/webrtc/test/wac/stun_probe.wac") as unknown as {
  checkIntegrity(msg: Uint8Array, key: Uint8Array): boolean;
  kindOf(msg: Uint8Array): number;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The offer we play, which is only as much of one as the program reads. */
const OFFER_UFRAG = "peerUF";
const OFFER_PWD = "peer-password-0123456";
const OFFER = `v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n` +
  `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n` +
  `a=ice-ufrag:${OFFER_UFRAG}\r\na=ice-pwd:${OFFER_PWD}\r\na=setup:actpass\r\na=mid:0\r\n`;

async function python(code: string): Promise<string> {
  const p = new Deno.Command("python3", { args: ["-c", code], stdout: "piped", stderr: "piped" });
  const { code: rc, stdout, stderr } = await p.output();
  if (rc !== 0) throw new Error(`python exited ${rc}: ${dec.decode(stderr).trim().slice(-400)}`);
  return dec.decode(stdout).trim();
}

const attr = (sdp: string, name: string) =>
  (new RegExp(`^a=${name}:(.*)$`, "m").exec(sdp)?.[1] ?? "").trim();

Deno.test("the example runs as a program: it answers an offer and answers checks", async () => {
  // **A path that does not exist yet.** `makeTempFile` creates it, and the builder handed an
  // existing output file does not return — which presents as the test hanging with no diagnostic.
  const dir = await Deno.makeTempDir();
  const built = `${dir}/answer.js`;
  const build = new Deno.Command("deno", {
    args: ["task", "app:build", "packages/webrtc/example/answer.wac", "--allow-net", "-o", built],
    stdout: "piped", stderr: "piped",
  });
  const b = await build.output();
  if (b.code !== 0) {
    throw new Error(`the example did not build:\n${dec.decode(b.stderr).slice(-800)}`);
  }

  // A port nobody else has. Bound and released, which races in principle and has not in practice;
  // the program's own bind failing is reported rather than hanging, which is what makes it visible.
  const probe = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" });
  const port = (probe.addr as Deno.NetAddr).port + 1;
  probe.close();
  const child = new Deno.Command("deno", {
    args: ["run", "-A", "--unstable-net", built, "127.0.0.1", String(port)],
    stdin: "piped", stdout: "piped", stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(enc.encode(OFFER));
  await w.close();

  // **Both streams, and every read bounded.** A bare `reader.read()` waits forever, so a deadline
  // checked between reads is not a deadline at all — the first version of this hung with no
  // diagnostic when the child wrote nothing. And stderr is drained alongside rather than after: a
  // child that fills its stderr pipe blocks writing to it, so a reader waiting on stdout first
  // waits for a write that cannot happen.
  const reader = child.stdout.getReader();
  const errReader = child.stderr.getReader();
  let sdp = "";
  let errText = "";
  const drainErr = (async () => {
    try {
      for (;;) {
        const { value, done } = await errReader.read();
        if (done) break;
        errText += dec.decode(value);
      }
    } catch { /* closed when the child is killed */ }
  })();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !sdp.includes("sctp-port")) {
    const r = await Promise.race([
      reader.read(),
      new Promise<null>((res) => setTimeout(() => res(null), 1000)),
    ]);
    if (r === null) continue;                 // nothing yet; the deadline decides when to give up
    if (r.done) break;
    sdp += dec.decode(r.value);
  }
  reader.releaseLock();

  try {
    assertEquals(sdp.includes("sctp-port"), true,
      `the program printed no complete description.\n  stdout: ${JSON.stringify(sdp)}\n` +
        `  stderr: ${JSON.stringify(errText)}`);

    // ── Judged by aiortc, which has never seen this code ──────────────────────────────────────
    const parsed = await python(`
from aiortc.sdp import SessionDescription
d = SessionDescription.parse(${JSON.stringify(sdp)})
m = d.media[0]
print(m.kind, m.profile, m.dtls.role, m.dtls.fingerprints[0].algorithm,
      len(m.dtls.fingerprints[0].value), len(m.ice_candidates), m.sctp_port)
`);
    assertEquals(parsed, "application UDP/DTLS/SCTP server sha-256 95 1 5000",
      "a data channel section, DTLS server — it answered `passive` — with a sha-256 fingerprint " +
        "of a certificate it generated itself, and one host candidate");

    // **The identity is its own and is fresh.** Nothing here supplied a key: the program made a
    // P-256 certificate at startup, and this is its digest.
    const fingerprint = attr(sdp, "fingerprint");
    assertEquals(fingerprint.startsWith("sha-256 "), true, `fingerprint line: ${fingerprint}`);

    // ── And the loop runs ─────────────────────────────────────────────────────────────────────
    //
    // A check signed with the password the program just advertised, sent to the port it says it is
    // on. An answer proves both halves agree — a program that printed one set of credentials and
    // listened with another would pass everything above and fail here.
    const ourUfrag = attr(sdp, "ice-ufrag");
    const ourPwd = attr(sdp, "ice-pwd");
    assertEquals(ourUfrag.length > 0 && ourPwd.length > 0, true, "it advertised ICE credentials");

    const sock = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" });
    try {
      const tid = crypto.getRandomValues(new Uint8Array(12));
      const request = ice.check(tid, ourUfrag, OFFER_UFRAG, enc.encode(ourPwd),
        ice.priorityOf(ice.hostPref(), 65535, 1), true,
        crypto.getRandomValues(new Uint8Array(8)), false);

      let answer: Uint8Array | null = null;
      const until = Date.now() + 15000;
      while (Date.now() < until && answer === null) {
        await sock.send(request, { hostname: "127.0.0.1", port, transport: "udp" });
        const got = await Promise.race([
          sock.receive(),
          new Promise<null>((r) => setTimeout(() => r(null), 700)),
        ]);
        if (got !== null) answer = Uint8Array.from(got[0]);
      }

      assertEquals(answer !== null, true,
        `no answer from the program on 127.0.0.1:${port}. Either it never bound, or it rejected a ` +
          "check built with the password it printed — and the second would mean the description " +
          "and the socket disagree, which is the failure this case exists for");
      const reply = answer as Uint8Array;
      assertEquals(stun.kindOf(reply), 0x0101, "a binding success response");
      assertEquals([...ice.tidOf(reply)].join(","), [...tid].join(","),
        "for the transaction we asked about");
      assertEquals(stun.checkIntegrity(reply, enc.encode(ourPwd)), true,
        "authenticated under the password from its own SDP, which is what ties the two together");
      // And it reports where the check came from, which is the field it cannot derive.
      const addr = [...ice.reportedAddress(reply)];
      assertEquals(addr.slice(2).join("."), "127.0.0.1",
        `it reported ${addr.slice(2).join(".")} as our address`);
    } finally {
      sock.close();
    }
  } finally {
    try { child.kill(); } catch { /* already gone */ }
    await child.status;
    await drainErr;
    try { child.stdout.cancel(); } catch { /* drained */ }
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
