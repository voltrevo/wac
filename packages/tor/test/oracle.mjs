// The parts of the Tor tests only something outside this repository can answer.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   descdigest                     →  `descdigest <hex>`
//   edsign <seed-hex> <msg-hex>    →  `edsign <hex>`, node's Ed25519 over the message
//   edverify <pub> <cert>          →  `edverify <0|1>`: does the certificate's own signature check
//   desc <descriptor-hex>          →  `desc` and ten hex fields the host read out of it
//   rsakeypair <bits>              →  `rsakeypair <n-hex> <e-hex> <d-hex>`, a fresh throwaway key
//   crosscert <n> <e> <cert-hex>   →  `crosscert <0|1>`: does a type-7 cross-certificate check out
//   consfixtures                   →  the whole consensus-verification fixture set, below
//   conssign <digest-hex>          →  `conssign <hex>`, `privateEncrypt` with the `key` above
//   rsarecover <n> <e> <sig>       →  `rsarecover <hex>`, empty if the padding is not PKCS#1 v1.5
//   rsarecoverder <der> <sig>      →  the same, for a key that arrives already DER-encoded
//
// `rsarecover` is what says *which key signed what*. Reproducing a document byte for byte would not
// notice two signatures being exchanged, because the vector would have been generated with them
// exchanged too — so each signature's payload is recovered with the key that is supposed to have
// made it, and the caller checks the payload is the 20-byte value it should be. Those do not
// survive being produced by the wrong key.
//
// `descdigest` is the SHA-1 an `r` line carries: over the span the descriptor's RSA signature
// covers, which ends after `router-signature\n` rather than at the end of the document. The span is
// found here rather than passed in, because the span is the thing being checked — asking wac where
// its own signature ended would make the comparison agree with itself.

import {
  constants, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateEncrypt,
  publicDecrypt, sign as nodeSign, verify as nodeVerify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h) =>
  h.length === 0 ? new Uint8Array(0) : Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const here = new URL(".", import.meta.url).pathname;

const json = (name) => JSON.parse(readFileSync(`${here}data/${name}`, "utf8"));

function descriptorDigest() {
  const text = json("routerdesc_generated.json").descriptor;
  const end = "router-signature\n";
  const span = text.indexOf(end) + end.length;
  return new Uint8Array(createHash("sha1").update(Buffer.from(text.slice(0, span), "utf8")).digest());
}

/** A DER `RSAPublicKey`, which is what node wants as `pkcs1` — built here rather than trusted. */
function derPublicKey(n, e) {
  const len = (v) => {
    if (v < 128) return [v];
    const out = [];
    for (let x = v; x > 0; x = Math.floor(x / 256)) out.unshift(x & 0xff);
    return [0x80 | out.length, ...out];
  };
  const int = (m) => {
    const body = m[0] & 0x80 ? new Uint8Array([0, ...m]) : m;
    return [0x02, ...len(body.length), ...body];
  };
  const body = [...int(n), ...int(e)];
  return new Uint8Array([0x30, ...len(body.length), ...body]);
}

function rsaRecoverDer(der, sig) {
  try {
    const key = createPublicKey({ key: der, format: "der", type: "pkcs1" });
    return new Uint8Array(publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, sig));
  } catch {
    return new Uint8Array(0);
  }
}

function rsaRecover(n, e, sig) {
  try {
    const key = createPublicKey({ key: derPublicKey(n, e), format: "der", type: "pkcs1" });
    return new Uint8Array(publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, sig));
  } catch {
    return new Uint8Array(0);
  }
}

// ── The consensus-verification fixtures ───────────────────────────────────────
//
// Real RSA keys and real signatures, built here rather than captured: the chutney testnet lives in
// /tmp and does not survive a container recreation. Every signature is `privateEncrypt` with PKCS#1
// v1.5 padding over a *bare* digest and no DER DigestInfo, which is the shape tor uses — so this is
// a differential against an implementation that has never seen ours, the only kind worth having for
// a signature check.
//
// Stateful, like `packages/crypto`'s RSA ops: `consfixtures` picks the keys that every later
// `conssign` in the same batch uses. A second batch would pick different ones.

/**
 * Whether a type-7 RSA cross-certificate verifies, judged entirely here.
 *
 * The layout — 32 bytes of ed25519 key, four of expiration, one SIGLEN, then the signature — and
 * the `Tor TLS RSA/Ed25519 cross-certificate` personalisation prefix are both read here rather than
 * being handed over, because they are what the test is about. `RSA_public_decrypt` with PKCS#1
 * padding is the verify primitive: tor signs a bare digest with no DigestInfo, so there is nothing
 * for `createVerify` to match against and this is the only way to check it.
 */
function crossCertOk(n, e, cert) {
  if (cert.length < 37) return false;
  const sigLen = cert[36];
  if (cert.length !== 37 + sigLen) return false;
  const prefix = utf8("Tor TLS RSA/Ed25519 cross-certificate");
  const signed = new Uint8Array([...prefix, ...cert.subarray(0, 36)]);
  const want = new Uint8Array(createHash("sha256").update(signed).digest());
  const got = rsaRecover(n, e, cert.subarray(37));
  return got.length === want.length && got.every((b, i) => b === want[i]);
}

/**
 * node's Ed25519 over a message, from a raw seed.
 *
 * `ed25519Sign` in this repo is good and it is the wrong tool for checking itself: our signer
 * feeding our verifier can agree on a wrong answer. node shares no code with us, so it can only
 * reproduce our signature if the span and the key are actually right.
 */
function edSign(seed, msg) {
  // PKCS#8 is the only shape node takes a raw Ed25519 seed in.
  const der = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ...seed,
  ]);
  return new Uint8Array(
    nodeSign(null, msg, createPrivateKey({ key: der, format: "der", type: "pkcs8" })),
  );
}

// SubjectPublicKeyInfo for Ed25519: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING }. node
// will not take a raw 32-byte key, and wrapping it is cheaper than a key-parsing library.
const SPKI_PREFIX = bytes("302a300506032b6570032100");

/**
 * Verify a certificate under `pub` with node's Ed25519 — the whole point is that it is not ours.
 *
 * `ed25519Verify` in the repo is perfectly good and it is the wrong tool here: using it would mean
 * our curve25519→ed25519 conversion feeding our own verifier, and the pair can agree on a wrong
 * answer. A formula that consistently produced the negation of the right key would pass, because
 * the verifier would be handed the same wrong key both times.
 */
function edVerify(pub, cert) {
  if (pub.length !== 32 || cert.length <= 64) return false;
  try {
    const key = createPublicKey({
      key: new Uint8Array([...SPKI_PREFIX, ...pub]),
      format: "der",
      type: "spki",
    });
    return nodeVerify(null, cert.subarray(0, cert.length - 64), key, cert.subarray(cert.length - 64));
  } catch {
    return false;
  }
}

// ── What the host reads out of a router descriptor ────────────────────────────
//
// All of it stays here rather than moving into wac, because re-deriving these is exactly what the
// wac side is being tested on: the PEM wrapping, the fingerprint spacing, the epoch behind
// `published`, and the modulus and exponent behind `signing-key`.

/** The value on the line starting with `keyword`, or "". */
const descLine = (text, keyword) =>
  text.match(new RegExp(`^${keyword} (.+)$`, "m"))?.[1] ?? "";

/** The PEM body that follows `keyword` on its own line. */
const pemAfter = (text, keyword, label) =>
  text.match(new RegExp(
    `^${keyword}[^\\n]*\\n-----BEGIN ${label}-----\\n([\\s\\S]*?)-----END ${label}-----`,
    "m",
  ))?.[1] ?? null;

const b64bytes = (t) => new Uint8Array(Buffer.from(t.replace(/\s/g, ""), "base64"));

/**
 * `SEQUENCE { INTEGER n, INTEGER e }`, with the leading zero a positive INTEGER carries when its
 * top bit is set stripped — the wac side is given magnitudes, and re-encoding is what is tested.
 */
function rsaParts(der) {
  let i = 0;
  const len = () => {
    let n = der[i++];
    if (n & 0x80) {
      const k = n & 0x7f;
      n = 0;
      for (let j = 0; j < k; j++) n = n * 256 + der[i++];
    }
    return n;
  };
  if (der[i++] !== 0x30) return [new Uint8Array(0), new Uint8Array(0)];
  len();
  const readInt = () => {
    if (der[i++] !== 0x02) return new Uint8Array(0);
    const n = len();
    let start = i, count = n;
    if (der[start] === 0 && count > 1) { start++; count--; }
    i += n;
    return der.subarray(start, start + count);
  };
  return [readInt(), readInt()];
}

/**
 * The digest tor's `router-signature` actually covers, recovered with a public-key operation.
 *
 * The descriptor publishes the RSA identity as `signing-key`, and `router-signature` is that key
 * signing a bare SHA-1 digest with PKCS#1 padding and no DigestInfo — so recovering the payload is
 * the only way to see what was signed, and it makes tor's own signature the oracle for our span.
 */
function recoverRouterSignature(desc) {
  const keyBody = pemAfter(desc, "signing-key", "RSA PUBLIC KEY");
  const sigBody = pemAfter(desc, "router-signature", "SIGNATURE");
  if (!keyBody || !sigBody) return new Uint8Array(0);
  const [n, e] = rsaParts(b64bytes(keyBody));
  return rsaRecover(n, e, b64bytes(sigBody));
}

function descFacts(desc) {
  const onion = pemAfter(desc, "onion-key", "RSA PUBLIC KEY");
  const signing = pemAfter(desc, "signing-key", "RSA PUBLIC KEY");
  const onionDer = onion ? b64bytes(onion) : new Uint8Array(0);
  const signingDer = signing ? b64bytes(signing) : new Uint8Array(0);
  const [n, e] = signing ? rsaParts(signingDer) : [new Uint8Array(0), new Uint8Array(0)];
  const published = descLine(desc, "published");
  // The descriptor writes UTC with no zone marker, so it has to be read as UTC explicitly.
  const secs = published === "" ? 0 : Math.floor(Date.parse(published.replace(" ", "T") + "Z") / 1000);
  const epoch = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) epoch[i] = Math.floor(secs / 2 ** (8 * (7 - i))) & 0xff;
  return [
    onionDer,
    utf8(onion ? `-----BEGIN RSA PUBLIC KEY-----\n${onion}-----END RSA PUBLIC KEY-----\n` : ""),
    utf8(descLine(desc, "fingerprint")),
    utf8(published),
    epoch,
    utf8(descLine(desc, "ntor-onion-key")),
    signingDer,
    n,
    e,
    recoverRouterSignature(desc),
  ];
}

let cons = null;

function keyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // PKCS#1 RSAPublicKey DER — the same encoding a Tor authority key is PEM-wrapped around.
  const der = new Uint8Array(publicKey.export({ type: "pkcs1", format: "der" }));
  const jwk = publicKey.export({ format: "jwk" });
  const b64u = (t) =>
    new Uint8Array(Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  return { der, n: b64u(jwk.n), e: b64u(jwk.e), privateKey };
}

const sha1 = (b) => new Uint8Array(createHash("sha1").update(b).digest());
const upper = (b) => hex(b).toUpperCase();
const utf8 = (t) => new Uint8Array(Buffer.from(t, "utf8"));
const signBare = (k, d) =>
  new Uint8Array(privateEncrypt({ key: k, padding: constants.RSA_PKCS1_PADDING }, d));

const pem = (der, label) =>
  `-----BEGIN ${label}-----\n` +
  (Buffer.from(der).toString("base64").match(/.{1,64}/g) ?? []).join("\n") +
  `\n-----END ${label}-----\n`;

/** A certificate whose signing key may be somebody else's, for the tampered case. */
function certFor(a, signingDer) {
  const body = `dir-key-certificate-version 3\n` +
    `fingerprint ${upper(sha1(a.identity.der))}\n` +
    `dir-identity-key\n${pem(a.identity.der, "RSA PUBLIC KEY")}` +
    `dir-signing-key\n${pem(signingDer, "RSA PUBLIC KEY")}` +
    `dir-key-certification\n`;
  return body + pem(signBare(a.identity.privateKey, sha1(utf8(body))), "SIGNATURE");
}

/** A consensus signed by every authority, over whatever body it is given. */
function signConsensus(authorities, body) {
  let out = body;
  for (const a of authorities) {
    out += `directory-signature sha256 ${upper(sha1(a.identity.der))} ` +
      `${upper(sha1(a.signing.der))}\n`;
    const token = "\ndirectory-signature ";
    const upTo = out.slice(0, out.indexOf(token) + token.length);
    out += pem(signBare(a.signing.privateKey, createHash("sha256").update(utf8(upTo)).digest()),
               "SIGNATURE");
  }
  return out;
}

function consFixtures() {
  const key = keyMaterial();
  const other = keyMaterial();
  const authorities = [0, 1, 2].map(() => ({ identity: keyMaterial(), signing: keyMaterial() }));
  /** A second signing key for authority 0, as if it had rotated. */
  const rotated = keyMaterial();

  const good = "network-status-version 3 microdesc\n" +
    "valid-after 2026-08-02 00:00:00\n" +
    "fresh-until 2026-08-03 12:00:00\n" +
    "valid-until 2026-08-04 00:00:00\n" +
    "r alpha AAAAAAAAAAAAAAAAAAAAAAAAAAA 2026-08-02 09:00:00 10.0.0.1 9001 0\n" +
    "m abcdefghijklmnopqrstuvwxyz012345678901234567\n" +
    "s Exit Fast Guard Running Stable Valid\n" +
    "w Bandwidth=100\n";
  const certs = () => authorities.map((a) => certFor(a, a.signing.der)).join("");

  const docs = [
    signConsensus(authorities, good),
    certs(),
    // Signed correctly, then a flag changed underneath: the signature covers the old bytes.
    signConsensus(authorities, good).replace("Exit Fast", "Exit Guard"),
    signConsensus(authorities, good).replace("abcdefghij", "ABCDEFGHIJ"),
    // The first authority's certificate with the second's signing key substituted *after* signing,
    // so the certification no longer covers it. Re-signing instead would have meant the authority
    // genuinely certified that key, which is not an attack — it is a decision it is entitled to
    // make, and the first attempt at this fixture made exactly that mistake.
    certs().replace(pem(authorities[0].signing.der, "RSA PUBLIC KEY"),
                    pem(authorities[1].signing.der, "RSA PUBLIC KEY")),
    // Authority 0 with two certificates, its rotated key *last*. The consensus names the first
    // one's key digest, so a chain that matched on identity alone would land on the rotated
    // certificate and fail to attribute a perfectly good signature. Authorities do rotate signing
    // keys and cached-certs carries several per authority, so this is the ordinary case rather
    // than an attack.
    certs() + certFor(authorities[0], rotated.der),
  ];
  const names = [
    authorities.map((a) => upper(sha1(a.identity.der))).join("\n") + "\n",
    "0".repeat(40) + "\n",
  ];
  return { key, other, docs, names };
}

const input = Buffer.concat(await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(chunks));
})).toString();

const lines = input.split("\n").filter((l) => l.length > 0);
const out = [];
for (const line of lines) {
  const [op] = line.split(" ");
  const rest = line.split(" ").slice(1);
  if (op === "rsarecover") {
    const [n, e, sig] = rest;
    out.push(`rsarecover ${hex(rsaRecover(bytes(n), bytes(e), bytes(sig)))}`);
  } else if (op === "rsarecoverder") {
    const [der, sig] = rest;
    out.push(`rsarecoverder ${hex(rsaRecoverDer(bytes(der), bytes(sig)))}`);
  } else if (op === "edsign") {
    const [seed, msg] = rest;
    out.push(`edsign ${hex(edSign(bytes(seed), bytes(msg)))}`);
  } else if (op === "edverify") {
    const [pub, cert] = rest;
    out.push(`edverify ${edVerify(bytes(pub), bytes(cert)) ? 1 : 0}`);
  } else if (op === "desc") {
    out.push(`desc ${descFacts(Buffer.from(bytes(rest[0])).toString("utf8")).map(hex).join(" ")}`);
  } else if (op === "rsakeypair") {
    const jwk = generateKeyPairSync("rsa", { modulusLength: Number(rest[0]) })
      .privateKey.export({ format: "jwk" });
    const part = (v) =>
      new Uint8Array(Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    out.push(`rsakeypair ${hex(part(jwk.n))} ${hex(part(jwk.e))} ${hex(part(jwk.d))}`);
  } else if (op === "crosscert") {
    const [n, e, cert] = rest;
    out.push(`crosscert ${crossCertOk(bytes(n), bytes(e), bytes(cert)) ? 1 : 0}`);
  } else if (op === "consfixtures") {
    cons = consFixtures();
    for (const which of ["key", "other"]) {
      const k = cons[which];
      out.push(`${which} ${hex(k.der)} ${hex(k.n)} ${hex(k.e)}`);
    }
    cons.docs.forEach((d, i) => out.push(`doc ${i} ${hex(utf8(d))}`));
    cons.names.forEach((n, i) => out.push(`names ${i} ${hex(utf8(n))}`));
  } else if (op === "conssign") {
    out.push(`conssign ${hex(signBare(cons.key.privateKey, bytes(rest[0])))}`);
  } else if (op === "descdigest") {
    out.push(`descdigest ${hex(descriptorDigest())}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
