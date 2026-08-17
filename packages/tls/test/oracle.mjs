// The primitives TLS is built out of, from `node:crypto`, which has never heard of TLS 1.3.
//
// That distinction is the whole design. The record layer's nonce construction, the key schedule's
// info encoding and the inner content type are what these tests are about, and an oracle that also
// knew TLS would share every assumption we might have got wrong. So this answers HMAC and AEAD and
// nothing above them.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   hmac256 <key-hex> <data-hex>                        →  `hmac256 <hex>`
//   aeadopen <suite> <key> <nonce> <aad> <ct>           →  `aeadopen <hex>`, empty if the tag fails
//   rsakey                                              →  `rsakey <n-hex> <e-hex> <d-hex>`
//   cert <der-hex>                                      →  `cert <0|1> <subject-hex> <keytype-hex>`
//
// `cert` is the one op that is not `node:crypto` at all: it shells out to `openssl x509` and
// `openssl verify`, which have never seen this code. It is here rather than driven from wac
// directly — as `packages/crypto`'s does — only because `openssl verify` insists on a *file* and
// wants the same one twice, so something has to own a temporary path.
//
// `suite` is the TLS code point **in decimal**, as `itoa64` writes it: 4865 (0x1301) is
// AES-128-GCM and anything else is ChaCha20-Poly1305. Spelled "1301" here at first, which sent
// every AES record down the ChaCha path — and the tag then failed, so it read as our sealing being
// wrong rather than as the oracle mistaking the suite.

import { createDecipheriv, createHmac, generateKeyPairSync } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bytes = (h) =>
  h.length === 0 ? new Uint8Array(0) : Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Decrypt, or empty if the tag does not verify — a failed tag is an answer, not an error. */
function aeadOpen(suite, key, nonce, aad, ct) {
  const body = ct.subarray(0, ct.length - 16);
  const tag = ct.subarray(ct.length - 16);
  try {
    // Spelled out per suite rather than through a variable: `authTagLength` only exists on the
    // overloads keyed by a literal algorithm name.
    const d = Number(suite) === 0x1301
      ? createDecipheriv("aes-128-gcm", key, nonce, { authTagLength: 16 })
      : createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    d.setAAD(aad, { plaintextLength: body.length });
    d.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([d.update(body), d.final()]));
  } catch {
    return new Uint8Array(0);
  }
}

let rsa = null;
/** A 1024-bit RSA key, made once and reused, since the certificate tests want several signatures. */
function rsaKey() {
  if (rsa === null) {
    const jwk = generateKeyPairSync("rsa", { modulusLength: 1024 })
      .privateKey.export({ format: "jwk" });
    const part = (s) =>
      new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    rsa = { n: part(jwk.n), e: part(jwk.e), d: part(jwk.d) };
  }
  return rsa;
}

/** Run openssl over a temporary PEM of the certificate. */
function openssl(args, der) {
  const dir = mkdtempSync(join(tmpdir(), "wac-x509gen-"));
  const file = join(dir, "cert.pem");
  try {
    const b64 = Buffer.from(der).toString("base64");
    writeFileSync(
      file,
      `-----BEGIN CERTIFICATE-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n` +
        `-----END CERTIFICATE-----\n`,
    );
    try {
      return {
        code: 0,
        out: execFileSync("openssl", args.map((a) => (a === "@FILE" ? file : a)), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What openssl makes of a certificate: whether it verifies, its subject CN, and its key type.
 *
 * **`-check_ss_sig`, and without it this checks nothing.** `openssl verify -trusted <self> <self>`
 * accepts a self-signed certificate found in the trust store *without* looking at its
 * self-signature — so it returned 1 for every certificate these tests have ever built, including
 * ones signed over the wrong bytes. It was caught by a canary that would not fire: signing
 * `sha256(tbs)` with a function that hashes its argument, so the certificate was signed over
 * `sha256(sha256(tbs))`, and this still said it verified.
 */
function certFacts(der) {
  const parsed = openssl(["x509", "-in", "@FILE", "-noout", "-text"], der);
  if (parsed.code !== 0) return { ok: 0, subject: "", keyType: "" };
  const verified = openssl(
    ["verify", "-no-CApath", "-no-CAfile", "-check_ss_sig", "-trusted", "@FILE", "@FILE"],
    der,
  );
  // `subject=CN=wac relay` or `subject= CN = wac relay`, depending on the build.
  const sub = openssl(["x509", "-in", "@FILE", "-noout", "-subject"], der);
  const m = sub.out.match(/CN\s*=\s*(.+?)\s*$/m);

  let keyType = "";
  if (/ED25519/i.test(parsed.out)) keyType = "ED25519";
  else if (/rsaEncryption/.test(parsed.out)) keyType = "rsaEncryption";
  else if (/id-ecPublicKey/.test(parsed.out)) {
    // **The curve as well as the algorithm.** A certificate naming a curve other than the one the
    // key is on parses perfectly and fails only when something tries to use it.
    const curve = /NIST CURVE: (\S+)/.exec(parsed.out) ?? /ASN1 OID: (\S+)/.exec(parsed.out);
    keyType = `id-ecPublicKey ${curve === null ? "?" : curve[1]}`;
  }
  return { ok: verified.code === 0 ? 1 : 0, subject: m ? m[1] : "", keyType };
}

const input = Buffer.concat(await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(chunks));
})).toString();

const lines = input.split("\n").filter((l) => l.length > 0);
const out = [];
for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  if (op === "hmac256") {
    const [key, data] = rest;
    out.push(`hmac256 ${hex(createHmac("sha256", bytes(key)).update(bytes(data)).digest())}`);
  } else if (op === "aeadopen") {
    const [suite, key, nonce, aad, ct] = rest;
    out.push(`aeadopen ${hex(aeadOpen(suite, bytes(key), bytes(nonce), bytes(aad), bytes(ct)))}`);
  } else if (op === "cert") {
    const f = certFacts(bytes(rest[0]));
    const text = (v) => hex(new TextEncoder().encode(v));
    out.push(`cert ${f.ok} ${text(f.subject)} ${text(f.keyType)}`);
  } else if (op === "rsakey") {
    const k = rsaKey();
    out.push(`rsakey ${hex(k.n)} ${hex(k.e)} ${hex(k.d)}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
