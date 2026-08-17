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
//
// **`hmac`'s claim may be a prefix.** HKDF's last output block is truncated, so the wac side cannot
// always hand over a whole T(n) — it compares as many bytes as were claimed, which still pins every
// byte claimed and lets the chain be checked at lengths that are not multiples of 32. Nothing else
// here truncates.
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import { createHash, createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

const bytes = (h) => Buffer.from(h ?? "", "hex");
const hex = (b) => Buffer.from(b).toString("hex");

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
    if (op === "sha1") {
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
    } else {
      out.push(`FAIL unknown op ${op}`);
    }
  } catch (e) {
    out.push(`FAIL ${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

out.push(`DONE ${n}`);
process.stdout.write(out.join("\n") + "\n");
