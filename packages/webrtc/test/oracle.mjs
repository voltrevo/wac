// The TLS 1.2 key schedule and AEAD record protection, adjudicated by things that are not us.
//
// Two references, and neither shares an assumption with the code under test:
//
//   - **`openssl kdf … TLS1-PRF`** is OpenSSL's own implementation of the function the whole
//     schedule is built from. Every derivation — the master secret, the key block, a Finished's
//     verify_data — is one `PRF` call with a particular label and seed, so OpenSSL can adjudicate
//     all of them by being asked the same question in its own terms. `node:crypto` has no TLS1-PRF,
//     which is why this one op shells out.
//   - **AES-128-GCM** decrypts a record we sealed, using the nonce and additional data we claim to
//     have used. That is the half a round trip cannot check: our sealer and our opener agree about
//     a wrong nonce construction perfectly well.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   prf <secret-hex> <label-hex> <seed-hex> <n>   →  `prf <hex>`
//   gcmopen <key-hex> <nonce-hex> <aad-hex> <ct>  →  `gcmopen <hex>`, empty if the tag fails
//   sha256 <data-hex>                             →  `sha256 <hex>`
//
// **The label travels as hex**, not as text. It is part of the seed rather than a separate input in
// TLS 1.2 — which is the detail these tests exist to pin — and one of the cases is the empty label,
// which a space-separated protocol carrying it as text would lose entirely.

import { createDecipheriv, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";

const bytes = (h) =>
  h.length === 0 ? new Uint8Array(0) : Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * OpenSSL's TLS 1.2 PRF.
 *
 * `hexseed` is the label *and* the seed concatenated, because that is what TLS 1.2 means by the
 * seed. Output comes back colon-separated and uppercase depending on the build.
 */
function prf(secretHex, labelHex, seedHex, n) {
  const out = execFileSync("openssl", [
    "kdf",
    "-keylen", String(n),
    "-kdfopt", "digest:SHA2-256",
    "-kdfopt", `hexsecret:${secretHex}`,
    "-kdfopt", `hexseed:${labelHex}${seedHex}`,
    "TLS1-PRF",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.trim().replaceAll(":", "").toLowerCase();
}

/** Decrypt, or empty if the tag does not verify — a failed tag is an answer, not an error. */
function gcmOpen(key, nonce, aad, ct) {
  const body = ct.subarray(0, ct.length - 16);
  const tag = ct.subarray(ct.length - 16);
  try {
    const d = createDecipheriv("aes-128-gcm", key, nonce, { authTagLength: 16 });
    d.setAAD(aad, { plaintextLength: body.length });
    d.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([d.update(body), d.final()]));
  } catch {
    return new Uint8Array(0);
  }
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
  if (op === "prf") {
    // **Four fields, always.** The empty seed is a real case, and it travels as an empty field
    // between two spaces — which `split` preserves. A line that lost it would leave the length
    // where the seed should be and read `n` as undefined, and `-keylen NaN` is not an error
    // OpenSSL reports in terms this could recognise.
    if (rest.length !== 4) {
      out.push(`FAIL prf wants 4 fields, got ${rest.length}`);
      continue;
    }
    const [secret, label, seed, n] = rest;
    out.push(`prf ${prf(secret, label, seed, Number(n))}`);
  } else if (op === "gcmopen") {
    const [key, nonce, aad, ct] = rest;
    out.push(`gcmopen ${hex(gcmOpen(bytes(key), bytes(nonce), bytes(aad), bytes(ct)))}`);
  } else if (op === "sha256") {
    out.push(`sha256 ${hex(createHash("sha256").update(bytes(rest[0])).digest())}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
