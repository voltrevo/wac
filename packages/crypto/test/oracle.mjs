// The hash and MAC oracles this package compares against, as one batched subprocess.
//
// `node:crypto` rather than WebCrypto, and not by preference: `crypto.subtle.digest` returns a
// Promise, and the tests that used to reach these through `harness/wacTestRun.ts` needed a
// *synchronous* callback because a wasm call cannot await. That constraint is gone now — the wac
// side spawns this and reads its answer — but node is still the better oracle here, because it has
// SHAKE and WebCrypto does not. `keccak_wac.test.ts` used to shell out to an OpenSSL 3.5 built from
// source for exactly that, and marked itself `ignore` when it was missing: green, and checking
// nothing.
//
// **Node, not Deno.** Deno's `node:crypto` is a shim, and this file is the only thing standing
// between a wrong digest and a passing test — `packages/zstd` found its `node:zlib` shim silently
// ignoring an option. Real Node costs nothing here.
//
// The direction is the usual one for this repository: the test computes every answer and this
// reports only what it disagrees with. One process for a whole sweep rather than one per case.
//
//   sha1  <msg-hex> <claimed-hex>
//   sha2  <bits> <msg-hex> <claimed-hex>              bits ∈ {256, 384, 512}
//   sha3  <bits> <msg-hex> <claimed-hex>              bits ∈ {256, 512}
//   shake <bits> <outlen> <msg-hex> <claimed-hex>     bits ∈ {128, 256}
//   hmac  <key-hex> <data-hex> <claimed-hex>          HMAC-SHA256
//   poly1305 <key-hex> <msg-hex> <claimed-hex>       the bare MAC, from BigInt
//   modexp <base> <exp> <mod> <claimed>              b^e mod m, from BigInt
//   f25 <op> <a-hex> <b-hex> <claimed-hex>           Curve25519's field, from BigInt
//
// `f25`'s operands are 32 little-endian bytes read as an integer mod 2^255-19, which is what the
// field's own decoder does — so a non-canonical encoding is a valid input to both sides rather than
// something the test has to avoid. `op` is one of add sub mul sqr inv round, or a decimal
// multiplier for the small multiply, in which case `b` is unused.
//   ecb   <key-hex> <block-hex> <claimed-hex>         one bare AES block, no padding
//   ctr   <key-hex> <iv-hex> <data-hex> <claimed-hex>
//   gcm   <key-hex> <iv-hex> <aad-hex> <plain-hex> <claimed-hex>   ciphertext ++ 16-byte tag
//   chacha <key-hex> <nonce-hex> <aad-hex> <plain-hex> <claimed-hex>   ChaCha20-Poly1305, sealed
//   open   <key-hex> <nonce-hex> <aad-hex> <ct-and-tag-hex>            →  `open <plain-hex>` or
//                                                                        `open -` for a refusal
//   edpub  <seed-hex> <claimed-hex>
//   edsign <seed-hex> <msg-hex> <claimed-hex>
//   edverify <pub-hex> <sig-hex> <msg-hex> <claimed:0|1>
//   xbase  <priv-hex> <claimed-hex>
//   xdh    <priv-hex> <peer-pub-hex> <claimed-hex>
//
// ECDSA is randomised, so there is no byte-identity to claim and these three **answer**:
//
//   ecgen     <curve>                    →  `ecgen <scalar-hex> <point-hex>`
//   ecgensign <curve> <msg-hex>          →  `ecgensign <scalar-hex> <point-hex> <sig-hex>`
//   ecverify  <curve> <pub-hex> <sig-hex> <msg-hex> <claimed:0|1>     (this one judges)
//
// RSA is the same shape and **stateful on purpose**: `rsakeygen` selects the key every later line
// uses, exactly as the callback it replaces did. Key generation is slow — a fresh 3072-bit key is a
// second or so — so each size is generated once and reused within the process.
//
//   rsapub    <n-hex> <e-hex>                 →  (silent) use this public key for the verdicts below
//   rsakeygen <bits>                          →  `rsakey <n-hex> <e-hex>`
//   rsaprivate                                →  `rsaprivate <d-hex>`
//   rsasign   <hashlen> <msg-hex>             →  `rsasig <hex>`      PKCS#1 v1.5
//   rsapss    <hashlen> <saltlen> <msg-hex>   →  `rsasig <hex>`
//   rsarecover <sig-hex>                      →  `rsarecover <hex>`  empty for bad padding
//   rsaverify <hashlen> <sig-hex> <msg-hex> <claimed:0|1>
//   rsapssverify <hashlen> <saltlen> <sig-hex> <msg-hex> <claimed:0|1>
//
// `ecgensign` generates and signs in one go because a signature needs the key the host just
// picked, and the wac side cannot name it until the answer comes back — one round instead of two.
// The host picking the key is the stronger direction: the scalar is not one a test author chose.
//
// The signature crosses as raw `r||s` and node speaks DER, so the conversion is here. That is where
// it belongs: X.509 and TLS both carry DER, the crypto layer wants raw, and getting it wrong on
// this side would look like a curve bug.
//
// `open` is the one op that **answers** rather than judges, and it is there for the one test that
// needs a verdict on bytes we did not seal: `aead_test.wac` frames the same 32 bytes two ways and
// asks which of them the host accepts. Everything else here is the usual direction.
//
// **`hmac`'s claim may be a prefix.** HKDF's last output block is truncated, so the wac side cannot
// always hand over a whole T(n) — it compares as many bytes as were claimed, which still pins every
// byte claimed and lets the chain be checked at lengths that are not multiples of 32. Nothing else
// here truncates.
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey,
  constants, createSign, createVerify, diffieHellman, generateKeyPairSync, publicDecrypt,
  sign as edSign, verify as edVerify,
} from "node:crypto";

// Raw keys have to be wrapped in the DER these APIs expect — the prefixes are the fixed PKCS#8 and
// SPKI headers for the two algorithms, constant because the key size is.
const wrap = (prefix, raw) => Buffer.concat([Buffer.from(prefix, "hex"), Buffer.from(raw)]);
const edPriv = (seed) =>
  createPrivateKey({ key: wrap("302e020100300506032b657004220420", seed), format: "der", type: "pkcs8" });
const edPubKey = (pub) =>
  createPublicKey({ key: wrap("302a300506032b6570032100", pub), format: "der", type: "spki" });
const xPriv = (priv) =>
  createPrivateKey({ key: wrap("302e020100300506032b656e04220420", priv), format: "der", type: "pkcs8" });
const xPubKey = (pub) =>
  createPublicKey({ key: wrap("302a300506032b656e032100", pub), format: "der", type: "spki" });
/** The last 32 bytes of an SPKI export are the raw point. */
const rawPub = (k) => new Uint8Array(k.export({ type: "spki", format: "der" }).subarray(-32));

// ── RSA ───────────────────────────────────────────────────────────────────────

const rsaKeys = new Map();
let rsaCurrent = 2048;
// A public key handed in rather than generated. Needed because each batch is a fresh process, so a
// test that signs with a key from one batch and asks for a verdict in the next must name the key it
// means — `rsakeygen` in the second batch would silently make a different one.
let rsaPub = null;

/** A hex field as the base64url a JWK wants. */
const b64url = (h) =>
  Buffer.from(bytes(h)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const rsaPublic = () => rsaPub ?? rsaKeys.get(rsaCurrent).publicKey;

const hashFor = (len) => (len === 32 ? "sha256" : len === 48 ? "sha384" : "sha512");

/** A named JWK field of the current key, as raw big-endian bytes. */
function jwkPart(field) {
  const key = field === "d" ? rsaKeys.get(rsaCurrent).privateKey : rsaKeys.get(rsaCurrent).publicKey;
  const jwk = key.export({ format: "jwk" });
  return new Uint8Array(
    Buffer.from(jwk[field].replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
}

// ── NIST curves ───────────────────────────────────────────────────────────────

const P = {
  256: {
    hash: "sha256",
    n: 32,
    named: "prime256v1",
    pkcs8: "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420",
    tail: "a14403420004",
    spki: "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  },
  384: {
    hash: "sha384",
    n: 48,
    named: "secp384r1",
    pkcs8: "3081b6020100301006072a8648ce3d020106052b8104002204819e30819b0201010430",
    tail: "a16403620004",
    spki: "3076301006072a8648ce3d020106052b8104002203620004",
  },
};

/** DER SEQUENCE{INTEGER r, INTEGER s} from raw r||s. */
function rawToDer(raw) {
  const n = raw.length / 2;
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const body = b.subarray(i);
    const lead = body[0] & 0x80 ? Uint8Array.from([0, ...body]) : body;
    return Buffer.concat([Buffer.from([0x02, lead.length]), Buffer.from(lead)]);
  };
  const body = Buffer.concat([int(raw.subarray(0, n)), int(raw.subarray(n))]);
  const head = body.length < 0x80
    ? Buffer.from([0x30, body.length])
    : Buffer.from([0x30, 0x81, body.length]);
  return Buffer.concat([head, body]);
}

/** Raw r||s from DER, left-padded — a shorter r is the same number, not a smaller one. */
function derToRaw(d, n) {
  let i = d[1] & 0x80 ? 3 : 2;
  const out = new Uint8Array(2 * n);
  for (const half of [0, 1]) {
    i++;
    const len = d[i++];
    let v = d.subarray(i, i + len);
    i += len;
    while (v.length > n) v = v.subarray(1);
    out.set(v, half * n + n - v.length);
  }
  return out;
}

const ecPriv = (curve, scalar, pub) =>
  createPrivateKey({
    key: Buffer.concat([
      Buffer.from(P[curve].pkcs8, "hex"), Buffer.from(scalar),
      // Both tails carry the uncompressed-point marker themselves, so the raw point is appended
      // without its leading 0x04 — the lengths in the header count on that.
      Buffer.from(P[curve].tail, "hex"), Buffer.from(pub.subarray(1)),
    ]),
    format: "der", type: "pkcs8",
  });

/** A fresh keypair as `[scalar, point]`. node has no "scalar to point" call. */
function ecGenerate(curve) {
  const n = P[curve].n;
  const kp = generateKeyPairSync("ec", { namedCurve: P[curve].named });
  const spki = kp.publicKey.export({ type: "spki", format: "der" });
  const pkcs8 = kp.privateKey.export({ type: "pkcs8", format: "der" });
  const point = new Uint8Array(spki.subarray(-(2 * n + 1)));
  // The scalar sits in the SEC1 OCTET STRING; find it by its length prefix rather than at a fixed
  // offset, since the P-384 wrapper is a different size.
  let i = pkcs8.indexOf(0x04);
  while (!(pkcs8[i] === 0x04 && pkcs8[i + 1] === n)) i = pkcs8.indexOf(0x04, i + 1);
  return [new Uint8Array(pkcs8.subarray(i + 2, i + 2 + n)), point];
}
import { Buffer } from "node:buffer";

const bytes = (h) => Buffer.from(h ?? "", "hex");
const hex = (b) => Buffer.from(b).toString("hex");

/**
 * Poly1305 with no limbs: `a = ((a + block) * r) mod (2^130 - 5)`, straight from RFC 8439 §2.5.
 *
 * **A from-scratch BigInt reference because there is nowhere else to get one.** `node:crypto`
 * exposes ChaCha20-Poly1305 but not the bare MAC, and WebCrypto has neither. It lives here rather
 * than in wac for the same reason every other op does: reimplementing 130-bit arithmetic beside the
 * thing under test is how a differential stops being one.
 */
function poly1305(key, msg) {
  const leToBig = (b) => b.reduceRight((a, x) => (a << 8n) | BigInt(x), 0n);
  const P = (1n << 130n) - 5n;
  const r = leToBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leToBig(key.subarray(16, 32));
  let a = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, i + 16);
    a = ((a + leToBig(chunk) + (1n << BigInt(chunk.length * 8))) * r) % P;
  }
  a = (a + s) & ((1n << 128n) - 1n);
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Number((a >> BigInt(i * 8)) & 0xFFn);
  return hex(b);
}

// ── Curve25519's field ────────────────────────────────────────────────────────
//
// The arithmetic written down rather than in limbs, which is the whole point: `field25519.wac`'s
// difficulty is the carry chain, and none of it exists here. Its own laws — that it is a field,
// that the modulus is what it says — all hold when the carry is one pass short of complete, because
// a non-canonical representative is congruent and satisfies every relation the field can state
// about itself. An outside reference sees it immediately.

const P25519 = (1n << 255n) - 19n;

/**
 * 32 little-endian bytes as an integer, exactly as `feFromBytes` reads them.
 *
 * **Bit 255 is masked**, per RFC 7748 §5: "implementations MUST mask the most significant bit in
 * the final byte". A peer that sets it is not encoding a larger number, and reading it as one makes
 * the oracle disagree with the specification rather than with the field — which is how this first
 * ran, off by 19 on four inputs.
 */
const leBig = (h) => {
  const b = bytes(h);
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return b.length === 32 ? v & ((1n << 255n) - 1n) : v;
};

/** An integer as 32 little-endian bytes, reduced. */
function leHex(v) {
  let x = ((v % P25519) + P25519) % P25519;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 0xFFn);
    x >>= 8n;
  }
  return hex(out);
}

function f25(what, a, b) {
  const A = a % P25519, B = b % P25519;
  if (what === "add") return leHex(A + B);
  if (what === "sub") return leHex(A - B);
  if (what === "mul") return leHex(A * B);
  if (what === "sqr") return leHex(A * A);
  if (what === "round") return leHex(A);
  if (what === "inv") {
    // Fermat: a^(p-2) inverts a non-zero a, and gives 0 for 0 — which is what the exponentiation
    // naturally yields and what the ladder relies on for the identity.
    if (A === 0n) return leHex(0n);
    let r = 1n, base = A, e = P25519 - 2n;
    while (e > 0n) {
      if (e & 1n) r = r * base % P25519;
      base = base * base % P25519;
      e >>= 1n;
    }
    return leHex(r);
  }
  return leHex(A * BigInt(what));            // a decimal multiplier: the small multiply
}

const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks)));
});

const out = [];
let n = 0;

for (const line of raw.toString("utf8").split("\n")) {
  if (line.length === 0) continue;
  n++;
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "f25") {
      const [what, a, b, claimed] = rest;
      const want = f25(what, leBig(a), leBig(b));
      if (want !== claimed) {
        out.push(`FAIL f25 ${what}(${leBig(a)}, ${leBig(b)}) is ${want}, wac said ${claimed}`);
      }
    } else if (op === "modexp") {
      const [b, e, m, claimed] = rest;
      const big = (h) => BigInt("0x" + h);
      const width = claimed.length / 2;
      let r = 1n, base = big(b) % big(m), exp = big(e);
      while (exp > 0n) {
        if (exp & 1n) r = r * base % big(m);
        base = base * base % big(m);
        exp >>= 1n;
      }
      const want = r.toString(16).padStart(width * 2, "0");
      if (want !== claimed) out.push(`FAIL ${big(b)}^${big(e)} mod ${big(m)} is ${want}, wac said ${claimed}`);
    } else if (op === "poly1305") {
      const [key, msg, claimed] = rest;
      const want = poly1305(bytes(key), bytes(msg));
      if (want !== claimed) {
        out.push(`FAIL poly1305(key ${key.slice(0, 16)}…, ${msg.length / 2} bytes) is ${want}, ` +
          `wac said ${claimed}`);
      }
    } else if (op === "sha1") {
      const [msg, claimed] = rest;
      const want = hex(createHash("sha1").update(bytes(msg)).digest());
      if (want !== claimed) out.push(`FAIL sha1(${msg.slice(0, 24)}…) is ${want}, wac said ${claimed}`);
    } else if (op === "sha2") {
      const [bits, msg, claimed] = rest;
      const want = hex(createHash(`sha${bits}`).update(bytes(msg)).digest());
      if (want !== claimed) {
        out.push(`FAIL sha${bits}(${msg.slice(0, 24)}…) is ${want}, wac said ${claimed}`);
      }
    } else if (op === "sha3") {
      const [bits, msg, claimed] = rest;
      const want = hex(createHash(`sha3-${bits}`).update(bytes(msg)).digest());
      if (want !== claimed) {
        out.push(`FAIL sha3-${bits}(${msg.slice(0, 24)}…) is ${want}, wac said ${claimed}`);
      }
    } else if (op === "shake") {
      const [bits, outLen, msg, claimed] = rest;
      const h = createHash(`shake${bits}`, { outputLength: Number(outLen) });
      const want = hex(h.update(bytes(msg)).digest());
      if (want !== claimed) {
        out.push(
          `FAIL shake${bits}(${msg.slice(0, 24)}…, ${outLen}) is ${want}, wac said ${claimed}`,
        );
      }
    } else if (op === "hmac") {
      const [key, data, claimed] = rest;
      const full = hex(createHmac("sha256", bytes(key)).update(bytes(data)).digest());
      const want = full.slice(0, (claimed ?? "").length);
      if (want !== claimed) {
        out.push(`FAIL hmac(key ${key.slice(0, 16)}…) is ${want}, wac said ${claimed}`);
      }
    } else if (op === "ecb") {
      // Not a mode anyone should use, and the only way to ask a library for one bare block
      // transform — which is the thing the modes are built on and worth checking on its own.
      const [key, block, claimed] = rest;
      const c = createCipheriv(`aes-${bytes(key).length * 8}-ecb`, bytes(key), null);
      c.setAutoPadding(false);
      const want = hex(Buffer.concat([c.update(bytes(block)), c.final()]));
      if (want !== claimed) out.push(`FAIL ecb is ${want}, wac said ${claimed}`);
    } else if (op === "ctr") {
      const [key, iv, data, claimed] = rest;
      const c = createCipheriv(`aes-${bytes(key).length * 8}-ctr`, bytes(key), bytes(iv));
      const want = hex(Buffer.concat([c.update(bytes(data)), c.final()]));
      if (want !== claimed) out.push(`FAIL ctr is ${want}, wac said ${claimed}`);
    } else if (op === "gcm") {
      // Spelled out per key size rather than through a template: `authTagLength` only exists on
      // the overloads keyed by a literal algorithm name.
      const [key, iv, aad, plain, claimed] = rest;
      const k = bytes(key);
      const n = k.length * 8;
      const c = n === 128
        ? createCipheriv("aes-128-gcm", k, bytes(iv), { authTagLength: 16 })
        : n === 192
        ? createCipheriv("aes-192-gcm", k, bytes(iv), { authTagLength: 16 })
        : createCipheriv("aes-256-gcm", k, bytes(iv), { authTagLength: 16 });
      const body = bytes(plain);
      c.setAAD(bytes(aad), { plaintextLength: body.length });
      const out1 = Buffer.concat([c.update(body), c.final()]);
      const want = hex(Buffer.concat([out1, c.getAuthTag()]));
      if (want !== claimed) out.push(`FAIL gcm is ${want}, wac said ${claimed}`);
    } else if (op === "chacha") {
      const [key, nonce, aad, plain, claimed] = rest;
      const c = createCipheriv("chacha20-poly1305", bytes(key), bytes(nonce),
                               { authTagLength: 16 });
      const body = bytes(plain);
      c.setAAD(bytes(aad), { plaintextLength: body.length });
      const out1 = Buffer.concat([c.update(body), c.final()]);
      const want = hex(Buffer.concat([out1, c.getAuthTag()]));
      if (want !== claimed) out.push(`FAIL chacha is ${want}, wac said ${claimed}`);
    } else if (op === "open") {
      const [key, nonce, aad, ctTag] = rest;
      const all = bytes(ctTag);
      const body = all.subarray(0, all.length - 16);
      const tag = all.subarray(all.length - 16);
      try {
        const d = createDecipheriv("chacha20-poly1305", bytes(key), bytes(nonce),
                                   { authTagLength: 16 });
        d.setAAD(bytes(aad), { plaintextLength: body.length });
        d.setAuthTag(tag);
        out.push(`open ${hex(Buffer.concat([d.update(body), d.final()]))}`);
      } catch {
        out.push("open -");
      }
    } else if (op === "edpub") {
      const [seed, claimed] = rest;
      const want = hex(rawPub(createPublicKey(edPriv(bytes(seed)))));
      if (want !== claimed) out.push(`FAIL edpub is ${want}, wac said ${claimed}`);
    } else if (op === "edsign") {
      const [seed, msg, claimed] = rest;
      const want = hex(edSign(null, bytes(msg), edPriv(bytes(seed))));
      if (want !== claimed) out.push(`FAIL edsign is ${want}, wac said ${claimed}`);
    } else if (op === "edverify") {
      const [pub, sig, msg, claimed] = rest;
      const ok = edVerify(null, bytes(msg), edPubKey(bytes(pub)), bytes(sig)) ? "1" : "0";
      if (ok !== claimed) out.push(`FAIL edverify is ${ok}, wac said ${claimed}`);
    } else if (op === "xbase") {
      const [priv, claimed] = rest;
      const want = hex(rawPub(createPublicKey(xPriv(bytes(priv)))));
      if (want !== claimed) out.push(`FAIL xbase is ${want}, wac said ${claimed}`);
    } else if (op === "xdh") {
      const [priv, peer, claimed] = rest;
      const want = hex(diffieHellman({
        privateKey: xPriv(bytes(priv)),
        publicKey: xPubKey(bytes(peer)),
      }));
      if (want !== claimed) out.push(`FAIL xdh is ${want}, wac said ${claimed}`);
    } else if (op === "rsapub") {
      const [n, e] = rest;
      rsaPub = createPublicKey({
        key: { kty: "RSA", n: b64url(n), e: b64url(e) },
        format: "jwk",
      });
    } else if (op === "rsakeygen") {
      rsaPub = null;
      const bits = Number(rest[0]);
      rsaCurrent = bits;
      if (!rsaKeys.has(bits)) {
        rsaKeys.set(bits, generateKeyPairSync("rsa", { modulusLength: bits }));
      }
      out.push(`rsakey ${hex(jwkPart("n"))} ${hex(jwkPart("e"))}`);
    } else if (op === "rsaprivate") {
      // Only ever a throwaway key made in this process — see the timing note at the bottom of
      // `src/rsa.wac`.
      out.push(`rsaprivate ${hex(jwkPart("d"))}`);
    } else if (op === "rsasign") {
      const [hLen, msg] = rest;
      const s2 = createSign(hashFor(Number(hLen)));
      s2.update(bytes(msg));
      out.push(`rsasig ${hex(s2.sign(rsaKeys.get(rsaCurrent).privateKey))}`);
    } else if (op === "rsapss") {
      const [hLen, saltLen, msg] = rest;
      const s2 = createSign(hashFor(Number(hLen)));
      s2.update(bytes(msg));
      out.push(`rsasig ${hex(s2.sign({
        key: rsaKeys.get(rsaCurrent).privateKey,
        padding: 6,                       // RSA_PKCS1_PSS_PADDING
        saltLength: Number(saltLen),
      }))}`);
    } else if (op === "rsarecover") {
      // `RSA_public_decrypt` with PKCS#1 padding is the *verify* primitive: it requires block type
      // 1 and returns the payload. That is the shape `rsaSignRawPkcs1` produces, and node offers no
      // other way to check a signature with no DigestInfo in it.
      try {
        out.push(`rsarecover ${hex(publicDecrypt(
          { key: rsaPublic(), padding: constants.RSA_PKCS1_PADDING },
          bytes(rest[0]),
        ))}`);
      } catch {
        out.push("rsarecover ");           // malformed padding; the caller asserts on the length
      }
    } else if (op === "rsaverify") {
      const [hLen, sig, msg, claimed] = rest;
      const v = createVerify(hashFor(Number(hLen)));
      v.update(bytes(msg));
      const ok = v.verify(rsaPublic(), bytes(sig)) ? "1" : "0";
      if (ok !== claimed) out.push(`FAIL rsaverify is ${ok}, wac said ${claimed}`);
    } else if (op === "rsapssverify") {
      const [hLen, saltLen, sig, msg, claimed] = rest;
      const v = createVerify(hashFor(Number(hLen)));
      v.update(bytes(msg));
      const ok = v.verify(
        { key: rsaPublic(), padding: 6, saltLength: Number(saltLen) },
        bytes(sig),
      ) ? "1" : "0";
      if (ok !== claimed) out.push(`FAIL rsapssverify is ${ok}, wac said ${claimed}`);
    } else if (op === "ecgen") {
      const curve = Number(rest[0]);
      const [scalar, point] = ecGenerate(curve);
      out.push(`ecgen ${hex(scalar)} ${hex(point)}`);
    } else if (op === "ecgensign") {
      const curve = Number(rest[0]);
      const [scalar, point] = ecGenerate(curve);
      const s2 = createSign(P[curve].hash);
      s2.update(bytes(rest[1]));
      const sig = derToRaw(s2.sign(ecPriv(curve, scalar, point)), P[curve].n);
      out.push(`ecgensign ${hex(scalar)} ${hex(point)} ${hex(sig)}`);
    } else if (op === "ecverify") {
      const [curveText, pub, sig, msg, claimed] = rest;
      const curve = Number(curveText);
      const v = createVerify(P[curve].hash);
      v.update(bytes(msg));
      const raw = bytes(pub);
      const spki = Buffer.concat([
        Buffer.from(P[curve].spki, "hex"),
        Buffer.from(curve === 256 ? raw : raw.subarray(1)),
      ]);
      const key = createPublicKey({ key: spki, format: "der", type: "spki" });
      const ok = v.verify(key, rawToDer(bytes(sig))) ? "1" : "0";
      if (ok !== claimed) out.push(`FAIL ecverify is ${ok}, wac said ${claimed}`);
    } else {
      out.push(`FAIL unknown op ${op}`);
    }
  } catch (e) {
    out.push(`FAIL ${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

out.push(`DONE ${n}`);
process.stdout.write(out.join("\n") + "\n");
