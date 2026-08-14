// ICE, with a real aioice agent on the other end of a UDP socket.
//
// `design/system/0008` step 2. The arithmetic below could be checked against the RFC's formulae by
// hand, and the last two tests do exactly that — but the ones that matter put `aioice.Connection` on
// loopback and let it drive: it sends connectivity checks, we validate and answer them, and its
// `connect()` either completes or does not. A peer that finishes ICE with us is the only evidence
// that our checks and responses are *acceptable* rather than merely well-formed.
//
// ## What the peer has to be told, and what it must not be
//
// ICE credentials are exchanged out of band — in SDP, in a real deployment — so the test plays the
// signalling channel: it takes aioice's ufrag, password and candidate, and hands it ours. Nothing
// else crosses. In particular the test never tells aioice what to expect, so a response it accepts
// is one it validated with its own code, against its own password.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/ice_probe.wac") as unknown as {
  priorityOf(typePref: number, localPref: number, component: number): bigint;
  pairPriorityOf(controlling: bigint, controlled: bigint): bigint;
  hostPref(): number;
  srflxPref(): number;
  prflxPref(): number;
  relayPref(): number;
  lineFor(f: string, c: number, t: string, p: bigint, h: string, port: number, k: string): string;
  usernameFor(peerUfrag: string, ourUfrag: string): string;
  check(tid: Uint8Array, peerUfrag: string, ourUfrag: string, peerPassword: Uint8Array,
    priority: bigint, controlling: boolean, tiebreaker: Uint8Array, useCandidate: boolean): Uint8Array;
  rejected(msg: Uint8Array, ourUfrag: string, peerUfrag: string, ourPassword: Uint8Array): number;
  isNomination(msg: Uint8Array): boolean;
  tiebreakerOf(msg: Uint8Array, controlling: boolean): Uint8Array;
  tidOf(msg: Uint8Array): Uint8Array;
  success(tid: Uint8Array, ourPassword: Uint8Array, family: number, peerIp: Uint8Array,
    peerPort: number): Uint8Array;
  reportedAddress(msg: Uint8Array): Int32Array;
  newConsent(interval: bigint, timeout: bigint, now: bigint): unknown;
  consentDue(c: unknown, now: bigint): boolean;
  consentSent(c: unknown, tid: Uint8Array, now: bigint): void;
  consentAnswered(c: unknown, msg: Uint8Array, password: Uint8Array, now: bigint): boolean;
  consentLive(c: unknown, now: bigint): boolean;
};

const enc = new TextEncoder();
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

/**
 * Run a Python program, with a deadline, and hand back its stdout.
 *
 * A deadline rather than a wait: an ICE agent that never completes is exactly the failure this file
 * exists to catch, and without one it would hang the suite instead of failing it.
 */
async function python(code: string, ms = 25_000): Promise<string> {
  const child = new Deno.Command("python3", { args: ["-c", code], stdout: "piped", stderr: "piped" })
    .spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch { /* already gone */ }
  }, ms);
  try {
    const { code: rc, stdout, stderr } = await child.output();
    const out = new TextDecoder().decode(stdout).trim();
    if (rc !== 0) {
      throw new Error(`python exited ${rc} after ${ms}ms at most:\n` +
        new TextDecoder().decode(stderr).trim().slice(-700));
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

Deno.test({
  name: "aioice completes ICE against us: it checks, we answer, it connects",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // **Our end is a plain UDP socket and this file's rules.** No agent, no timers: aioice is
    // controlling, so it sends the checks and all we owe it is a valid answer to each.
    // **Bound to every interface, and advertised on the one aioice actually gathered.** aioice
    // gathers host candidates from the container's real interface — `192.168.80.2` here, not
    // loopback — and a datagram from there to a `127.0.0.1` candidate does not route. Advertising
    // loopback made the agent send checks that never arrived and time out, which reads exactly like
    // a protocol bug and is not one.
    const sock = Deno.listenDatagram({ hostname: "0.0.0.0", port: 0, transport: "udp" });
    const ourPort = (sock.addr as Deno.NetAddr).port;
    const ourUfrag = "wacUF";
    const ourPwd = "wac-password-0123456789";
    const ourPriority = ours.priorityOf(ours.hostPref(), 65535, 1);

    // aioice gathers, prints its credentials and candidate, then waits for ours on stdin — so the
    // exchange is a signalling channel the test plays, and nothing about our side is baked into it.
    const agent = new Deno.Command("python3", {
      args: ["-c", `
import asyncio, sys, json
from aioice import Candidate, Connection

async def main():
    conn = Connection(ice_controlling=True)
    await conn.gather_candidates()
    local = [c.to_sdp() for c in conn.local_candidates]
    print(json.dumps({"ufrag": conn.local_username, "pwd": conn.local_password,
                      "candidates": local}), flush=True)
    line = sys.stdin.readline()
    peer = json.loads(line)
    conn.remote_username = peer["ufrag"]
    conn.remote_password = peer["pwd"]
    for c in peer["candidates"]:
        await conn.add_remote_candidate(Candidate.from_sdp(c))
    await conn.add_remote_candidate(None)
    await conn.connect()
    sel = conn.get_default_candidate(1)
    print(json.dumps({"connected": True, "selected": sel.to_sdp() if sel else None}), flush=True)
    await conn.close()

asyncio.run(main())
`],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    const kill = setTimeout(() => {
      try {
        agent.kill("SIGKILL");
      } catch { /* already gone */ }
    }, 25_000);

    let checksSeen = 0;
    let nominations = 0;
    try {
      const reader = agent.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const readLine = async (): Promise<string> => {
        while (!buf.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error("the aioice agent exited before saying anything");
          buf += dec.decode(value, { stream: true });
        }
        const i = buf.indexOf("\n");
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        return line;
      };

      const theirs = JSON.parse(await readLine()) as {
        ufrag: string;
        pwd: string;
        candidates: string[];
      };
      if (theirs.candidates.length === 0) throw new Error("aioice gathered no candidates");
      // Their first candidate's host is the interface they will send from, so it is the one we must
      // be reachable on.
      const ourHost = theirs.candidates[0].split(" ")[4];

      const writer = agent.stdin.getWriter();
      await writer.write(enc.encode(JSON.stringify({
        ufrag: ourUfrag,
        pwd: ourPwd,
        candidates: [ours.lineFor("wac1", 1, "udp", ourPriority, ourHost, ourPort, "host")],
      }) + "\n"));
      await writer.close();

      // **Answer every check, for as long as it keeps sending them.** Each one is validated with our
      // own rules — the username has to name us, and the integrity has to check under the password
      // we published — and only then answered.
      const done = (async () => JSON.parse(await readLine()))();
      const loop = (async () => {
        for (;;) {
          const [datagram, from] = await sock.receive();
          const msg = Uint8Array.from(datagram);
          const peer = from as Deno.NetAddr;
          const why = ours.rejected(msg, ourUfrag, theirs.ufrag, enc.encode(ourPwd));
          if (why !== 0) continue;   // not a check for us; a real agent would count these
          checksSeen++;
          if (ours.isNomination(msg)) nominations++;
          const reply = ours.success(
            Uint8Array.from(ours.tidOf(msg)),
            enc.encode(ourPwd),
            1,
            Uint8Array.from(peer.hostname.split(".").map(Number)),
            peer.port,
          );
          await sock.send(reply, { hostname: peer.hostname, port: peer.port, transport: "udp" });
        }
      })();
      loop.catch(() => {});

      // **Its stderr is collected on its own reader**, not with `output()`: stdout is already locked
      // by `readLine` above, and `output()` throws for that rather than returning what it can — which
      // made the first version of this test fail inside its own error path and report nothing about
      // the agent at all.
      let stderr = "";
      (async () => {
        const dec2 = new TextDecoder();
        for await (const chunk of agent.stderr) stderr += dec2.decode(chunk, { stream: true });
      })().catch(() => {});

      const result = await Promise.race([
        done,
        agent.status.then((st) => {
          throw new Error(`the aioice agent exited (code ${st.code}) without connecting:\n` +
            stderr.trim().slice(-700));
        }),
      ]) as { connected: boolean; selected: string | null };

      assertEquals(result.connected, true, "aioice reported a completed connection");
      assertEquals(result.selected !== null, true, "and selected a candidate pair");
      // **The evidence, stated as counts.** A `connect()` that returned without ever sending us a
      // check would mean it found some other path, and this is what says otherwise.
      assertEquals(checksSeen > 0, true, `aioice sent ${checksSeen} checks we accepted`);
      assertEquals(nominations > 0, true,
        "and nominated a pair with USE-CANDIDATE, which is the controlling agent's last word");
    } finally {
      clearTimeout(kill);
      try {
        agent.kill("SIGKILL");
      } catch { /* already gone */ }
      await agent.status.catch(() => {});
      sock.close();
    }
  },
});

Deno.test("aioice validates a check we build, and refuses one signed with the wrong password", async () => {
  // The other direction. aioice's `Message` parser takes an integrity key and raises when it
  // disagrees, so this is its own validation applied to our bytes.
  const tid = unhex("1122334455667788990011aa");
  const good = ours.check(tid, "peerUF", "wacUF", enc.encode("peer-password-xyz"),
    ours.priorityOf(ours.prflxPref(), 65535, 1), true, unhex("0102030405060708"), true);
  const bad = ours.check(tid, "peerUF", "wacUF", enc.encode("the-wrong-password"),
    ours.priorityOf(ours.prflxPref(), 65535, 1), true, unhex("0102030405060708"), true);

  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const out = await python(`
from aioice import stun
import binascii
ok = stun.parse_message(binascii.unhexlify("${hex(good)}"), integrity_key=b"peer-password-xyz")
print("username", ok.attributes["USERNAME"])
print("priority", ok.attributes["PRIORITY"])
print("controlling", ok.attributes["ICE-CONTROLLING"])
print("nominated", "USE-CANDIDATE" in ok.attributes)
try:
    stun.parse_message(binascii.unhexlify("${hex(bad)}"), integrity_key=b"peer-password-xyz")
    print("refused no")
except Exception:
    print("refused yes")
`);
  const lines = Object.fromEntries(out.split("\n").map((l) => {
    const i = l.indexOf(" ");
    return [l.slice(0, i), l.slice(i + 1)];
  }));
  assertEquals(lines.username, "peerUF:wacUF",
    "the peer's fragment first — a check names the receiver, not the sender");
  assertEquals(lines.priority, String(ours.priorityOf(ours.prflxPref(), 65535, 1)),
    "and the PRIORITY aioice read back is the one we computed");
  assertEquals(lines.controlling, "72623859790382856", "the tiebreaker, as an unsigned 64-bit number");
  assertEquals(lines.nominated, "True", "with USE-CANDIDATE");
  assertEquals(lines.refused, "yes",
    "and a check signed with a different password is refused — so the acceptance above is a check");
});

Deno.test("a check for somebody else, or with a broken signature, is told apart from a good one", () => {
  // The canary for `checkRejected`, and the reason it answers a code rather than a boolean: the
  // caller does different things with these.
  const tid = unhex("aabbccddeeff001122334455");
  const pwd = enc.encode("our-password");
  const good = ours.check(tid, "wacUF", "peerUF", pwd, 100n, false, unhex("0000000000000001"), false);
  assertEquals(ours.rejected(good, "wacUF", "peerUF", pwd), 0, "a check addressed to us");

  assertEquals(ours.rejected(good, "otherUF", "peerUF", pwd), 3,
    "3: the username names a different agent — somebody else's session on a shared port");
  assertEquals(ours.rejected(good, "wacUF", "peerUF", enc.encode("not-our-password")), 5,
    "5: the right username and a signature that does not check, which is worth counting");
  assertEquals(ours.rejected(unhex("16fefd0000"), "wacUF", "peerUF", pwd), 1, "1: not STUN");
  const answer = ours.success(tid, pwd, 1, unhex("7f000001"), 4444);
  assertEquals(ours.rejected(answer, "wacUF", "peerUF", pwd), 2, "2: a response, not a check");
});

Deno.test("the response reports the peer's address, not ours", () => {
  // The mistake that verifies and teaches the peer nothing: putting our own address in the
  // XOR-MAPPED-ADDRESS because it is the one to hand.
  const tid = unhex("0f0e0d0c0b0a09080706050f");
  const reply = ours.success(tid, enc.encode("pw"), 1, unhex("c0a80105"), 51234);
  const addr = ours.reportedAddress(reply);
  assertEquals(addr[0], 1);
  assertEquals(addr[1], 51234, "the port the check came from");
  assertEquals([...addr.slice(2)].join("."), "192.168.1.5", "and its address");
});

Deno.test("the priority formulae, against RFC 8445's own arithmetic", () => {
  // `2^24 * type + 2^8 * local + (256 - component)`. A host candidate with the highest local
  // preference and component 1 is 2130706431, which is the number every ICE implementation prints
  // and the one to check a formula against.
  assertEquals(ours.priorityOf(ours.hostPref(), 65535, 1), 2130706431n, "the canonical host priority");
  assertEquals(ours.priorityOf(ours.srflxPref(), 65535, 1), 1694498815n, "server reflexive");
  assertEquals(ours.priorityOf(ours.relayPref(), 65535, 1), 16777215n, "relayed, the lowest");
  assertEquals(ours.priorityOf(ours.hostPref(), 65535, 2), 2130706430n,
    "component 2 is one less, which is what makes RTP outrank RTCP on the same address");

  // `2^32 * min(G, D) + 2 * max(G, D) + (G > D)`, and the point of the last term is that it is the
  // *only* thing distinguishing the two orderings — so a pair priority must not be symmetric.
  const a = ours.priorityOf(ours.hostPref(), 65535, 1);
  const b = ours.priorityOf(ours.srflxPref(), 65535, 1);
  assertEquals(ours.pairPriorityOf(a, b), (b << 32n) + 2n * a + 1n, "controlling higher");
  assertEquals(ours.pairPriorityOf(b, a), (b << 32n) + 2n * a + 0n, "controlled higher");
  assertEquals(ours.pairPriorityOf(a, b) - ours.pairPriorityOf(b, a), 1n,
    "the two orderings differ by exactly the tiebreak bit, which is what the formula is for");
  assertEquals(ours.pairPriorityOf(a, a), (a << 32n) + 2n * a, "equal priorities: no tiebreak");
});

Deno.test("a candidate line is the shape aioice parses", async () => {
  const line = ours.lineFor("wac1", 1, "udp", ours.priorityOf(ours.hostPref(), 65535, 1),
    "127.0.0.1", 45678, "host");
  assertEquals(line, "wac1 1 udp 2130706431 127.0.0.1 45678 typ host");
  const out = await python(`
from aioice import Candidate
c = Candidate.from_sdp("${line}")
print(c.foundation, c.component, c.transport, c.priority, c.host, c.port, c.type)
print(c.to_sdp())
`);
  const [fields, roundTrip] = out.split("\n");
  assertEquals(fields, "wac1 1 udp 2130706431 127.0.0.1 45678 host", "aioice reads every field");
  assertEquals(roundTrip, line, "and prints back exactly what we wrote");
});

Deno.test("consent has to be renewed, and one lost check does not end it", () => {
  // **RFC 7675, and it exists for somebody else's benefit.** An address that was a peer's may have
  // been reassigned; without consent checks we would keep sending to whoever holds it now, who
  // never agreed to receive it. That is the difference between a data channel and an amplifier.
  const password = enc.encode("peer-password");
  const c = ours.newConsent(5000n, 30000n, 0n);
  assertEquals(ours.consentDue(c, 0n), false, "not the moment it is created");
  assertEquals(ours.consentDue(c, 4999n), false);
  assertEquals(ours.consentDue(c, 5000n), true, "every five seconds, per §4.1");

  const tid = unhex("000102030405060708090a0b");
  ours.consentSent(c, tid, 5000n);
  assertEquals(ours.consentDue(c, 5001n), false, "and not again until the interval is up");
  assertEquals(ours.consentAnswered(c, ours.success(tid, password, 1,
    Uint8Array.from([127, 0, 0, 1]), 45678), password, 5100n), true, "answered in 100ms");
  assertEquals(ours.consentLive(c, 5100n), true);

  // **A check going unanswered is not the end of consent.** A single loss on a working path
  // happens; tearing the connection down for it would make packet loss fatal. Only thirty seconds
  // with no valid response at all expires it.
  ours.consentSent(c, unhex("0102030405060708090a0b0c"), 10000n);
  assertEquals(ours.consentLive(c, 20000n), true, "ten seconds of silence is not enough");
  assertEquals(ours.consentLive(c, 35099n), true, "nor is just under thirty from the last answer");
  assertEquals(ours.consentLive(c, 35100n), false,
    "thirty seconds after the last valid response, consent is gone and we must stop sending");
});

Deno.test("a consent response only counts if it is the one we asked for and it authenticates", () => {
  const password = enc.encode("peer-password");
  const other = enc.encode("wrong-password");
  const tid = unhex("000102030405060708090a0b");

  const fresh = () => {
    const c = ours.newConsent(5000n, 30000n, 0n);
    ours.consentSent(c, tid, 1000n);
    return c;
  };
  const addr = Uint8Array.from([127, 0, 0, 1]);

  assertEquals(ours.consentAnswered(fresh(),
    ours.success(unhex("ffffffffffffffffffffffff"), password, 1, addr, 45678), password, 1100n),
    false, "a response to a different transaction proves nothing about this path");
  assertEquals(ours.consentAnswered(fresh(), ours.success(tid, other, 1, addr, 45678),
    password, 1100n), false,
    "and one that does not authenticate is anybody's — which is the whole point of the check, " +
      "since an off-path attacker can see the transaction id in the request");
  assertEquals(ours.consentAnswered(fresh(), ours.success(tid, password, 1, addr, 45678),
    password, 1100n), true, "the right transaction, with the right key");
});

Deno.test("aioice accepts a consent check as a valid, authenticated binding request", async () => {
  // **The bytes, judged by somebody else's parser.** A consent check is an ordinary connectivity
  // check sent again later, so what has to hold is that it still authenticates: aioice's
  // `parse_message` verifies MESSAGE-INTEGRITY against the key it is given and raises otherwise.
  const tid = unhex("0102030405060708090a0b0c");
  const msg = ours.check(tid, "THEIRUF", "OURUF", enc.encode("their-password"),
    ours.priorityOf(ours.hostPref(), 65535, 1), false, unhex("0707070707070707"), false);
  const out = await python(`
import binascii
from aioice.stun import parse_message
m = parse_message(binascii.unhexlify("${[...msg].map((b) => b.toString(16).padStart(2, "0")).join("")}"),
                  integrity_key=b"their-password")
print(m.message_method.value, m.message_class.value, m.attributes["USERNAME"],
      m.attributes["PRIORITY"], "ICE-CONTROLLED" in m.attributes, "FINGERPRINT" in m.attributes)
`);
  assertEquals(out, "1 0 THEIRUF:OURUF 2130706431 True True",
    "a binding request, from the controlled agent, with the peer's fragment first in the username");
});

Deno.test("and aioice rejects one signed with the wrong password, which is the canary", async () => {
  // Without this the test above would pass on a message with no integrity attribute at all.
  const tid = unhex("0102030405060708090a0b0c");
  const msg = ours.check(tid, "THEIRUF", "OURUF", enc.encode("their-password"),
    ours.priorityOf(ours.hostPref(), 65535, 1), false, unhex("0707070707070707"), false);
  const out = await python(`
import binascii
from aioice.stun import parse_message
try:
    parse_message(binascii.unhexlify("${[...msg].map((b) => b.toString(16).padStart(2, "0")).join("")}"),
                  integrity_key=b"not-their-password")
    print("accepted")
except Exception as e:
    print("rejected")
`);
  assertEquals(out, "rejected", "aioice checks the integrity rather than merely reading past it");
});
