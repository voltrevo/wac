// The parts of the Tor tests only something outside this repository can answer.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   descdigest                     →  `descdigest <hex>`
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

import { constants, createHash, createPublicKey, publicDecrypt } from "node:crypto";
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
  } else if (op === "descdigest") {
    out.push(`descdigest ${hex(descriptorDigest())}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
