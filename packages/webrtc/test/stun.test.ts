// STUN, against two implementations that have never seen ours.
//
// `design/system/0008` step 1. The oracle here is not a round trip — our encoder and our decoder
// agree perfectly when both are wrong — so every case below either sends bytes to a real STUN server
// and reads what comes back, or hands bytes to `aioice`'s parser and takes bytes from its encoder.
//
// ## Why two of them
//
// **coturn** answers on the wire, which is the only way to find out whether a message is acceptable
// to something that was not built to be lenient with us. **aioice** is the STUN implementation
// inside `aiortc`, which is what the later steps of 0008 are measured against, and it exposes its
// codec directly — so it can adjudicate the two attributes coturn never sends us: MESSAGE-INTEGRITY
// under a password we choose, and FINGERPRINT.
//
// RFC 5769 prints test vectors that would be better than either, being published constants rather
// than a second implementation's opinion. `rfc-editor.org` is not on this container's proxy
// allowlist, so they are not available and nothing here pretends to quote them from memory.
//
// ## The processes
//
// Both are external and both are started per test rather than shared: coturn on a loopback port, and
// Python for aioice. A test that cannot start them fails rather than skipping — a skip that prints
// nothing reads as coverage, and the whole point of this file is that the answers come from
// somewhere else.

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/stun_probe.wac") as unknown as {
  request(tid: Uint8Array): Uint8Array;
  requestWithSoftware(tid: Uint8Array, software: Uint8Array): Uint8Array;
  looksStun(b: Uint8Array): boolean;
  parses(b: Uint8Array): boolean;
  kindOf(b: Uint8Array): number;
  isSuccess(b: Uint8Array): boolean;
  attrCount(b: Uint8Array): number;
  hasAttr(b: Uint8Array, kind: number): boolean;
  tidOf(b: Uint8Array): Uint8Array;
  attrOf(b: Uint8Array, kind: number): Uint8Array;
  mappedAddress(b: Uint8Array): Int32Array;
  roundTripAddress(family: number, port: number, ip: Uint8Array, tid: Uint8Array): Int32Array;
  addIntegrity(msg: Uint8Array, key: Uint8Array): Uint8Array;
  checkIntegrity(msg: Uint8Array, key: Uint8Array): boolean;
  addFingerprint(msg: Uint8Array): Uint8Array;
  checkFingerprint(msg: Uint8Array): boolean;
  kUsername(): number;
  kIntegrity(): number;
  kFingerprint(): number;
  kXorMapped(): number;
  kSoftware(): number;
};

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

/** A fixed transaction id, so a failure prints the same bytes twice running. */
const TID = unhex("0102030405060708090a0b0c");

/** Run a Python snippet with aioice available, and return its stdout, trimmed. */
async function python(code: string): Promise<string> {
  const p = new Deno.Command("python3", { args: ["-c", code], stdout: "piped", stderr: "piped" });
  const { code: rc, stdout, stderr } = await p.output();
  const out = new TextDecoder().decode(stdout).trim();
  if (rc !== 0) {
    throw new Error(`python exited ${rc}: ${new TextDecoder().decode(stderr).trim().slice(-400)}`);
  }
  return out;
}

/** Start coturn on a free loopback port and hand back the port and a way to stop it. */
async function coturn(): Promise<{ port: number; stop: () => void }> {
  // Port 0 is not an option — coturn wants a number — so one is picked and the bind is what proves
  // it was free. A collision shows up as a test that times out waiting for an answer, which is worth
  // knowing about rather than papering over with a retry.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = new Deno.Command("turnserver", {
    args: ["-n", "--no-auth", "--no-tls", "--no-dtls", "--no-cli", "-L", "127.0.0.1", "-p", `${port}`],
    stdout: "null",
    stderr: "null",
  }).spawn();
  // coturn takes a moment to bind. Polling for the socket would need a STUN exchange to know it is
  // up, which is what the test is for, so this waits and the test's own timeout is the backstop.
  await new Promise((r) => setTimeout(r, 700));
  return {
    port,
    stop: () => {
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
      child.status.catch(() => {});
    },
  };
}

/** Send one datagram and wait for one back, or null. */
async function exchange(port: number, msg: Uint8Array, ms = 4000): Promise<Uint8Array | null> {
  const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    const from = (sock.addr as Deno.NetAddr).port;
    await sock.send(msg, { hostname: "127.0.0.1", port, transport: "udp" });
    const got = await Promise.race([
      sock.receive().then(([b]) => Uint8Array.from(b)),
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
    if (got !== null) (got as Uint8Array & { fromPort?: number }).fromPort = from;
    return got;
  } finally {
    sock.close();
  }
}

Deno.test({
  name: "coturn answers our Binding request, and we read the address it saw",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await coturn();
    try {
      const req = ours.request(TID);
      assertEquals(req.length, 20, "a Binding request with no attributes is the header alone");
      assertEquals(hex(req.subarray(0, 8)), "000100002112a442", "type, length, cookie");

      const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
      let reply: Uint8Array | null = null;
      let ourPort = 0;
      try {
        ourPort = (sock.addr as Deno.NetAddr).port;
        await sock.send(req, { hostname: "127.0.0.1", port: server.port, transport: "udp" });
        reply = await Promise.race([
          sock.receive().then(([b]) => Uint8Array.from(b)),
          new Promise<null>((r) => setTimeout(() => r(null), 5000)),
        ]);
      } finally {
        sock.close();
      }
      if (reply === null) throw new Error("coturn did not answer our Binding request");

      // **Everything below is about their bytes, not ours.**
      assertEquals(ours.looksStun(reply), true, "their answer is recognisably STUN");
      assertEquals(ours.parses(reply), true, "and it parses");
      assertEquals(ours.isSuccess(reply), true, "a Binding success response");
      assertEquals(hex(Uint8Array.from(ours.tidOf(reply))), hex(TID),
        "a response carries the request's transaction id, which is how a client pairs them");
      assertEquals(ours.hasAttr(reply, ours.kXorMapped()), true, "with an XOR-MAPPED-ADDRESS");

      const addr = ours.mappedAddress(reply);
      assertEquals(addr[0], 1, "IPv4");
      assertEquals(addr[1], ourPort,
        "the port coturn saw is the one we sent from — which is the whole purpose of STUN, and " +
          "the xor is undone correctly or this number is wrong by 0x2112");
      assertEquals([...addr.slice(2)].join("."), "127.0.0.1", "and the address");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "and a message with an attribute, so the padding is on the wire too",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await coturn();
    try {
      // Five bytes of SOFTWARE, which pads to eight — the case where an encoder that forgot the
      // padding produces a length coturn will reject or misread.
      const req = ours.requestWithSoftware(TID, new TextEncoder().encode("wac-1"));
      assertEquals(req.length, 20 + 4 + 8, "five bytes of value occupy eight, plus four of header");
      assertEquals(hex(req.subarray(2, 4)), "000c", "and the header counts twelve, padding included");

      const reply = await exchange(server.port, req);
      if (reply === null) throw new Error("coturn did not answer a request carrying SOFTWARE");
      assertEquals(ours.isSuccess(reply), true,
        "coturn accepted the padded attribute — a length that disagreed with the bytes would " +
          "have been rejected or ignored");
    } finally {
      server.stop();
    }
  },
});

Deno.test("aioice parses what we build, attribute for attribute", async () => {
  const req = ours.requestWithSoftware(TID, new TextEncoder().encode("wac-webrtc"));
  const out = await python(`
from aioice import stun
import binascii
m = stun.parse_message(binascii.unhexlify("${hex(req)}"))
print(int(m.message_method), int(m.message_class), binascii.hexlify(m.transaction_id).decode(),
      m.attributes.get("SOFTWARE"))
`);
  const [method, cls, tid, software] = out.split(" ");
  assertEquals(method, "1", "aioice reads it as a Binding");
  assertEquals(cls, "0", "of class request");
  assertEquals(tid, hex(TID), "with our transaction id");
  assertEquals(software, "wac-webrtc", "and our SOFTWARE, which is the padded attribute");
});

Deno.test("and we parse what aioice builds", async () => {
  const out = await python(`
from aioice import stun
import binascii
m = stun.Message(message_method=stun.Method.BINDING, message_class=stun.Class.RESPONSE,
                 transaction_id=binascii.unhexlify("${hex(TID)}"))
m.attributes["XOR-MAPPED-ADDRESS"] = ("192.0.2.17", 32853)
m.attributes["SOFTWARE"] = "aioice"
print(binascii.hexlify(bytes(m)).decode())
`);
  const msg = unhex(out);
  assertEquals(ours.parses(msg), true, "their message parses");
  assertEquals(ours.isSuccess(msg), true, "as a success response");
  assertEquals(ours.attrCount(msg), 2, "two attributes");
  const addr = ours.mappedAddress(msg);
  assertEquals(addr[0], 1);
  assertEquals(addr[1], 32853, "the port aioice encoded, read back through the xor");
  assertEquals([...addr.slice(2)].join("."), "192.0.2.17");
  assertEquals(new TextDecoder().decode(Uint8Array.from(ours.attrOf(msg, ours.kSoftware()))), "aioice");
});

Deno.test("an address survives our own encode and decode, at the edges of the port range", () => {
  // A round trip proves less than the two tests above and catches a different thing: the xor is its
  // own inverse, so an error in it cancels — unless the value is one where the two halves differ.
  // 0x2112 is the constant, so a port equal to it, and one that is its complement, are the two
  // places a sign or a mask error shows up.
  for (const port of [0, 1, 0x2112, 0xDEED, 3478, 65535]) {
    const got = ours.roundTripAddress(1, port, unhex("c0000211"), TID);
    assertEquals(got[1], port, `port ${port}`);
    assertEquals([...got.slice(2)].join("."), "192.0.2.17", `address for port ${port}`);
  }
  const v6 = ours.roundTripAddress(2, 5000, unhex("20010db8000000000000000000000001"), TID);
  assertEquals(v6[0], 2, "IPv6 is family 2");
  assertEquals(v6[1], 5000);
  assertEquals(v6.length, 2 + 16, "and sixteen bytes of address");
});

Deno.test("MESSAGE-INTEGRITY: aioice verifies ours, and we verify aioice's", async () => {
  const key = new TextEncoder().encode("VOkJxbRl1RmTxUk/WvJxBt");
  const signed = ours.addIntegrity(ours.requestWithSoftware(TID, new TextEncoder().encode("wac")), key);
  assertEquals(ours.hasAttr(signed, ours.kIntegrity()), true);
  assertEquals(ours.checkIntegrity(signed, key), true, "we verify our own, which proves nothing yet");

  // **The half that matters.** aioice recomputes the HMAC over the message with the header length
  // set as though MESSAGE-INTEGRITY were present — the rule this package's header comment calls the
  // part everyone gets wrong — and raises if it disagrees.
  const theirs = await python(`
from aioice import stun
import binascii
raw = binascii.unhexlify("${hex(signed)}")
m = stun.parse_message(raw, integrity_key=b"VOkJxbRl1RmTxUk/WvJxBt")
print("verified", m.attributes.get("SOFTWARE"))
`);
  assertEquals(theirs, "verified wac", "aioice rejected our MESSAGE-INTEGRITY");

  // **And the other direction**, which is the half this test is named for: aioice signs, we check.
  // `add_message_integrity` is its own counterpart to `withIntegrity` and appends a FINGERPRINT
  // after the MESSAGE-INTEGRITY — so this also proves our verifier stops where it should, since a
  // hash that swept in the trailing attribute would not match theirs.
  const built = unhex(await python(`
from aioice import stun
import binascii
m = stun.Message(message_method=stun.Method.BINDING, message_class=stun.Class.REQUEST,
                 transaction_id=binascii.unhexlify("${hex(TID)}"),
                 attributes={"USERNAME": "alice:bob"})
m.add_message_integrity(b"VOkJxbRl1RmTxUk/WvJxBt")
print(binascii.hexlify(bytes(m)).decode())
`));
  assertEquals(ours.parses(built), true, "their signed message parses");
  assertEquals(ours.hasAttr(built, ours.kFingerprint()), true,
    "and carries a FINGERPRINT after the integrity, which is the case that catches a verifier " +
      "hashing to the end of the message rather than to the attribute");
  assertEquals(ours.checkIntegrity(built, key), true,
    "aioice's MESSAGE-INTEGRITY verifies under our HMAC-SHA1 and our length adjustment");
  assertEquals(ours.checkFingerprint(built), true, "and their FINGERPRINT under our CRC-32");
  assertEquals(ours.checkIntegrity(built, new TextEncoder().encode("not the key")), false,
    "under the wrong key it does not, so the check above is a check");
});

Deno.test("a wrong key, a changed byte, and a message with no integrity at all are all refused", () => {
  // The canary. Everything above is satisfied by a checker that returns true, and this is what says
  // it can say no.
  const key = new TextEncoder().encode("correct horse battery staple");
  const signed = ours.addIntegrity(ours.request(TID), key);

  assertEquals(ours.checkIntegrity(signed, new TextEncoder().encode("wrong key")), false,
    "a different key must not verify");

  const tampered = Uint8Array.from(signed);
  tampered[19] ^= 1;                       // the last byte of the transaction id, which is covered
  assertEquals(ours.checkIntegrity(tampered, key), false, "a changed byte before the attribute");

  const cut = Uint8Array.from(signed);
  cut[cut.length - 1] ^= 1;                // one bit of the HMAC itself
  assertEquals(ours.checkIntegrity(cut, key), false, "a changed byte of the signature");

  assertEquals(ours.checkIntegrity(ours.request(TID), key), false,
    "and a message with no MESSAGE-INTEGRITY does not verify by being absent");
});

Deno.test("FINGERPRINT: aioice agrees with our CRC, and a tampered message does not", async () => {
  const msg = ours.addFingerprint(ours.requestWithSoftware(TID, new TextEncoder().encode("wac")));
  assertEquals(ours.checkFingerprint(msg), true, "ours checks");

  const theirs = await python(`
from aioice import stun
import binascii
raw = binascii.unhexlify("${hex(msg)}")
m = stun.parse_message(raw)
print("fingerprint" if "FINGERPRINT" in m.attributes else "missing", len(raw))
`);
  assertEquals(theirs.split(" ")[0], "fingerprint", "aioice sees the attribute");

  // aioice validates FINGERPRINT while parsing, so a message it accepts is one whose CRC it agrees
  // with — and one it rejects raises, which `python()` turns into a failed test.
  const tampered = Uint8Array.from(msg);
  tampered[20] ^= 0x40;
  assertEquals(ours.checkFingerprint(tampered), false, "a changed byte breaks the CRC");
  assertEquals(ours.checkFingerprint(ours.request(TID)), false,
    "and a message with no FINGERPRINT is not fingerprinted");
});

Deno.test("what is not STUN is refused rather than read", () => {
  // The port carries DTLS and RTP too, so this is a real case rather than a fuzzing courtesy.
  assertEquals(ours.looksStun(unhex("16fefd0000000000000000")), false, "a DTLS record starts at 0x16");
  assertEquals(ours.looksStun(unhex("80c8000600000000")), false, "an RTCP packet starts at 0x80");
  assertEquals(ours.looksStun(new Uint8Array(0)), false, "nothing at all");
  assertEquals(ours.looksStun(unhex("00010000deadbeef0102030405060708090a0b0c")), false,
    "the two zero bits without the cookie is not enough");
  // A header claiming more than arrived.
  const short = ours.request(TID);
  short[3] = 0x40;
  assertEquals(ours.parses(short), false, "a length past the end of the datagram");
  const odd = ours.request(TID);
  odd[3] = 0x02;
  assertEquals(ours.parses(odd), false, "and a length that is not a multiple of four");
});
