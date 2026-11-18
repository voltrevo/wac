// Correctness check for both revm builds: state tests, keccak/ecrecover against @noble, verifiedCall.
//   node test/check.mjs [revm-s|revm-3] [filesPerFork]
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const here = dirname(fileURLToPath(import.meta.url));
const footprint = join(here, "../..");
const variant = process.argv[2] ?? "revm-s";
const perFork = Number(process.argv[3] ?? 50);
const mod = await import(join(footprint, "dist", variant, "revm_wasm.js"));
mod.initSync({ module: readFileSync(join(footprint, "dist", variant, "revm_wasm_bg.wasm")) });

const fixtures = join(footprint, "../../fixtures/state_tests");
const walk = (d) => readdirSync(d).sort().flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : n.endsWith(".json") ? [p] : [];
});
// An even spread over each fork's directories, not just the first ones alphabetically.
const pick = (files, n) => files.length <= n ? files : Array.from({ length: n }, (_, i) => files[Math.floor(i * files.length / n)]);

let bad = 0;
for (const [dir, fork] of [["cancun", "Cancun"], ["prague", "Prague"], ["osaka", "Osaka"]]) {
  let p = 0, f = 0, g = 0n, t0 = performance.now();
  for (const file of pick(walk(join(fixtures, dir)), perFork)) {
    const [pp, ff, gg] = mod.runStateTests(readFileSync(file), fork).split(" ");
    p += +pp; f += +ff; g += BigInt(gg);
    if (+ff) { bad++; console.log(`  FAIL ${ff}/${+pp + +ff} ${file.slice(fixtures.length + 1)}`); }
  }
  console.log(`${fork}: ${p} passed, ${f} failed, gas ${g}, ${(performance.now() - t0).toFixed(0)} ms`);
}

// keccak against @noble/hashes, over lengths around the 136-byte rate.
const hex = (b) => Buffer.from(b).toString("hex");
for (const n of [0, 1, 31, 32, 135, 136, 137, 272, 1000]) {
  const d = Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 255);
  if (hex(mod.keccak(d)) !== hex(keccak_256(d))) { bad++; console.log("keccak mismatch", n); }
}
console.log("keccak: checked");

// ecrecover against @noble/curves: valid signatures, plus a bad v and an r of zero (must be empty).
for (let i = 1; i <= 20; i++) {
  const sk = keccak_256(Uint8Array.of(i)), msg = keccak_256(Uint8Array.of(i, i));
  const sig = secp256k1.sign(msg, sk, { prehash: false, format: "recovered" }); // [recovery, r, s]
  const input = new Uint8Array(128);
  input.set(msg, 0); input[63] = 27 + sig[0]; input.set(sig.subarray(1), 64);
  const pub = secp256k1.getPublicKey(sk, false);
  const want = "0".repeat(24) + hex(keccak_256(pub.subarray(1)).subarray(12));
  if (hex(mod.ecrecoverBytes(input)) !== want) { bad++; console.log("ecrecover mismatch", i); }
  input[63] = 29;
  if (mod.ecrecoverBytes(input).length !== 0) { bad++; console.log("ecrecover accepted v=29"); }
  input[63] = 27; input.fill(0, 64, 96);
  if (mod.ecrecoverBytes(input).length !== 0) { bad++; console.log("ecrecover accepted r=0"); }
}
console.log("ecrecover: checked");

// verifiedCall: the shared fixture if it exists, else a self-made proof (test/call-mini.json).
for (const f of [join(footprint, "fixtures/call.json"), join(here, "call-mini.json")]) {
  if (!existsSync(f)) { console.log(`verifiedCall: ${f} absent, skipped`); continue; }
  const doc = JSON.parse(readFileSync(f, "utf8"));
  const got = mod.verifiedCall(readFileSync(f));
  const ok = doc.expect ? got === doc.expect : got.startsWith("ok ");
  if (!ok) bad++;
  console.log(`verifiedCall ${f.slice(footprint.length + 1)}: ${got}${doc.expect ? (ok ? " (as expected)" : ` (expected ${doc.expect})`) : ""}`);
  if (doc.expect) {
    // Tampering must be caught: flip one byte of a proved slot value / account proof.
    const t = structuredClone(doc); t.accounts[0].balance = "0x1"; // JSON beside the proof is ignored
    const g2 = mod.verifiedCall(Buffer.from(JSON.stringify(t)));
    if (g2 !== got) { bad++; console.log("  JSON-beside-proof balance changed the answer:", g2); }
    const t2 = structuredClone(doc); const n = t2.accounts[0].accountProof; n[n.length - 1] = n[n.length - 1].slice(0, -2) + "00";
    const g3 = mod.verifiedCall(Buffer.from(JSON.stringify(t2)));
    if (!g3.startsWith("error")) { bad++; console.log("  tampered proof accepted:", g3); } else console.log("  tampered proof:", g3);
    const t3 = structuredClone(doc); t3.accounts[0].code = t3.accounts[0].code + "00";
    const g4 = mod.verifiedCall(Buffer.from(JSON.stringify(t3)));
    if (!g4.startsWith("error code")) { bad++; console.log("  wrong code accepted:", g4); } else console.log("  wrong code:", g4);
  }
}
console.log(bad ? `${bad} problem(s)` : "all good");
process.exit(bad ? 1 : 0);
