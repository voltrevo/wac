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
//   ecb   <key-hex> <block-hex> <claimed-hex>         one bare AES block, no padding
//   ctr   <key-hex> <iv-hex> <data-hex> <claimed-hex>
//   gcm   <key-hex> <iv-hex> <aad-hex> <plain-hex> <claimed-hex>   ciphertext ++ 16-byte tag
//   chacha <key-hex> <nonce-hex> <aad-hex> <plain-hex> <claimed-hex>   ChaCha20-Poly1305, sealed
//   open   <key-hex> <nonce-hex> <aad-hex> <ct-and-tag-hex>            →  `open <plain-hex>` or
//                                                                        `open -` for a refusal
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

import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
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
    } else {
      out.push(`FAIL unknown op ${op}`);
    }
  } catch (e) {
    out.push(`FAIL ${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

out.push(`DONE ${n}`);
process.stdout.write(out.join("\n") + "\n");
