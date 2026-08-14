// The TLS 1.2 key schedule and AEAD record protection, against OpenSSL.
//
// `design/system/0008` step 3, second increment. Two oracles, and neither is us:
//
//   - **`openssl kdf … TLS1-PRF`** is OpenSSL's own implementation of the function this whole
//     schedule is built from. Every derivation below — the master secret, the key block, a
//     Finished's verify_data — is one `PRF` call with a particular label and seed, so OpenSSL can
//     adjudicate all of them by being asked the same question in its own terms.
//   - **Python's `AESGCM`** decrypts a record we sealed, using the nonce and additional data we
//     claim to have used. That is the part a round trip cannot check: our sealer and our opener
//     agree about a wrong nonce construction perfectly well.
//
// The end-to-end evidence is still to come — a handshake OpenSSL completes — and until it does, a
// correct PRF is what makes that handshake's failure mean something other than "the keys are wrong".

import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ours = await wacBind("packages/webrtc/test/wac/keys_probe.wac") as unknown as {
  prfOf(secret: Uint8Array, label: string, seed: Uint8Array, n: number): Uint8Array;
  master(pms: Uint8Array, cr: Uint8Array, sr: Uint8Array): Uint8Array;
  block(m: Uint8Array, sr: Uint8Array, cr: Uint8Array, n: number): Uint8Array;
  finished(m: Uint8Array, label: string, transcript: Uint8Array): Uint8Array;
  aadOf(epoch: number, seq: bigint, kind: number, version: number, len: number): Uint8Array;
  sealed(key: Uint8Array, iv: Uint8Array, epoch: number, seq: bigint, kind: number,
    version: number, plain: Uint8Array): Uint8Array;
  opened(key: Uint8Array, iv: Uint8Array, epoch: number, seq: bigint, kind: number,
    version: number, frag: Uint8Array): Uint8Array;
};

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const bytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * OpenSSL's TLS 1.2 PRF, as `openssl kdf` computes it.
 *
 * `hexseed` is the label *and* the seed concatenated, because in TLS 1.2 the label is part of the
 * seed rather than a separate input — which is the detail this test exists to pin.
 */
async function opensslPrf(secret: Uint8Array, label: string, seed: Uint8Array, n: number) {
  const p = new Deno.Command("openssl", {
    args: [
      "kdf",
      "-keylen", String(n),
      "-kdfopt", "digest:SHA2-256",
      "-kdfopt", `hexsecret:${hex(secret)}`,
      "-kdfopt", `hexseed:${hex(bytes(enc.encode(label), seed))}`,
      "TLS1-PRF",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  if (code !== 0) {
    throw new Error(`openssl kdf failed: ${new TextDecoder().decode(stderr).trim().slice(-300)}`);
  }
  return new TextDecoder().decode(stdout).trim().replaceAll(":", "").toLowerCase();
}

/** Run a Python snippet and return its stdout. */
async function python(code: string): Promise<string> {
  const p = new Deno.Command("python3", { args: ["-c", code], stdout: "piped", stderr: "piped" });
  const { code: rc, stdout, stderr } = await p.output();
  if (rc !== 0) {
    throw new Error(`python exited ${rc}: ${new TextDecoder().decode(stderr).trim().slice(-400)}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

Deno.test("our PRF is OpenSSL's TLS1-PRF, over lengths that cross the block boundary", async () => {
  // SHA-256 gives thirty-two bytes a round, so 32 is the boundary and 48 and 40 are the two lengths
  // the schedule actually asks for — a master secret and a key block. A PRF that dropped or repeated
  // a byte at the seam would agree at 32 and nowhere else.
  const cases: [Uint8Array, string, Uint8Array, number][] = [
    [unhex("01020304"), "test label", unhex("05060708"), 40],
    [unhex("0102030405060708090a0b0c0d0e0f10"), "master secret", unhex("aabbccdd"), 48],
    [unhex("ff"), "key expansion", unhex(""), 32],
    [unhex("ff"), "key expansion", unhex(""), 33],
    [unhex("00112233445566778899aabbccddeeff"), "client finished", unhex("1234"), 12],
    [unhex("00112233445566778899aabbccddeeff"), "", unhex("00"), 96],
  ];
  for (const [secret, label, seed, n] of cases) {
    const mine = hex(Uint8Array.from(ours.prfOf(secret, label, seed, n)));
    const theirs = await opensslPrf(secret, label, seed, n);
    assertEquals(mine, theirs, `PRF(${hex(secret)}, ${JSON.stringify(label)}, ${hex(seed)}, ${n})`);
  }
});

Deno.test("the master secret and the key block, with their labels and their seed order", async () => {
  const pms = unhex("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
  const cr = Uint8Array.from({ length: 32 }, (_, i) => i);
  const sr = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);

  const master = Uint8Array.from(ours.master(pms, cr, sr));
  assertEquals(master.length, 48, "a master secret is forty-eight bytes");
  assertEquals(hex(master), await opensslPrf(pms, "master secret", bytes(cr, sr), 48),
    "client random then server random");

  // **And the key block reverses them.** This is the assertion that catches the swap, because the
  // two derivations are otherwise the same call: if the order did not matter, the value below would
  // equal the one computed with (cr, sr) and it does not.
  const block = Uint8Array.from(ours.block(master, sr, cr, 40));
  assertEquals(hex(block), await opensslPrf(master, "key expansion", bytes(sr, cr), 40),
    "server random then client random");
  const swapped = await opensslPrf(master, "key expansion", bytes(cr, sr), 40);
  assertEquals(hex(block) === swapped, false,
    "the two orders give different key blocks, so getting it wrong is not harmless");

  // Forty bytes for AES-128-GCM: two sixteen-byte keys and two four-byte fixed nonces, and no MAC
  // keys at all, because an AEAD suite has nothing to MAC separately.
  assertEquals(block.length, 40);

  const finished = Uint8Array.from(ours.finished(master, "client finished", enc.encode("transcript")));
  assertEquals(finished.length, 12, "verify_data is twelve bytes");
  const sha = await python(
    `import hashlib; print(hashlib.sha256(b"transcript").hexdigest())`,
  );
  assertEquals(hex(finished), await opensslPrf(master, "client finished", unhex(sha), 12),
    "over the SHA-256 of the transcript, not the transcript");
});

Deno.test("a sealed record is what Python's AES-GCM opens, with the nonce and AAD we claim", async () => {
  const key = unhex("000102030405060708090a0b0c0d0e0f");
  const iv = unhex("aabbccdd");
  const plain = enc.encode("the finished message, more or less");
  const epoch = 1;
  const seq = 0x000000000005n;
  const kind = 22;      // handshake
  const version = 0xFEFD;

  const fragment = Uint8Array.from(ours.sealed(key, iv, epoch, seq, kind, version, plain));
  assertEquals(fragment.length, 8 + plain.length + 16,
    "explicit nonce, ciphertext, tag — the eight bytes are why a sealed record is longer than " +
      "the obvious layout");

  const aad = Uint8Array.from(ours.aadOf(epoch, seq, kind, version, plain.length));
  assertEquals(hex(aad), "0001000000000005" + "16" + "fefd" + "0022",
    "epoch and sequence as the eight-byte counter, then type, version and the *plaintext* length");

  // **The half a round trip cannot check.** Python is told the key, the AAD and where the nonce
  // comes from, and decrypts. If our nonce were built the other way round — explicit part first, or
  // the fixed IV padded rather than prefixed — this fails while our own `opened` still succeeds.
  const got = await python(`
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import binascii
frag = binascii.unhexlify("${hex(fragment)}")
explicit, body = frag[:8], frag[8:]
nonce = binascii.unhexlify("${hex(iv)}") + explicit
pt = AESGCM(binascii.unhexlify("${hex(key)}")).decrypt(nonce, body, binascii.unhexlify("${hex(aad)}"))
print(pt.decode())
`);
  assertEquals(got, "the finished message, more or less",
    "an independent AES-GCM opened it with the four fixed bytes followed by the eight explicit ones");

  // And the explicit nonce is the sequence number, which is what makes a capture readable.
  assertEquals(hex(fragment.subarray(0, 8)), "0001000000000005");
});

Deno.test("and opening refuses a record whose tag, AAD or sequence does not match", () => {
  const key = unhex("0f0e0d0c0b0a09080706050403020100");
  const iv = unhex("11223344");
  const plain = enc.encode("payload");
  const sealed = Uint8Array.from(ours.sealed(key, iv, 1, 7n, 23, 0xFEFD, plain));

  assertEquals(new TextDecoder().decode(Uint8Array.from(ours.opened(key, iv, 1, 7n, 23, 0xFEFD, sealed))),
    "payload", "the good case");

  // The canary, and each of these is a real confusion rather than a fuzzing courtesy: a record
  // replayed into a different epoch, one whose sequence was rewritten, one relabelled as another
  // content type, and one with a flipped bit.
  assertEquals(ours.opened(key, iv, 2, 7n, 23, 0xFEFD, sealed).length, 0, "a different epoch");
  assertEquals(ours.opened(key, iv, 1, 8n, 23, 0xFEFD, sealed).length, 0, "a rewritten sequence");
  assertEquals(ours.opened(key, iv, 1, 7n, 22, 0xFEFD, sealed).length, 0, "a different content type");
  assertEquals(ours.opened(key, unhex("11223345"), 1, 7n, 23, 0xFEFD, sealed).length, 0,
    "a different fixed IV");
  const tampered = Uint8Array.from(sealed);
  tampered[tampered.length - 1] ^= 1;
  assertEquals(ours.opened(key, iv, 1, 7n, 23, 0xFEFD, tampered).length, 0, "a flipped tag bit");
  const shortened = sealed.subarray(0, 20);
  assertEquals(ours.opened(key, iv, 1, 7n, 23, 0xFEFD, shortened).length, 0,
    "and a fragment too short to hold a nonce and a tag is refused before it is read");
});
