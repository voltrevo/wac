// Writes test/call-mini.json: a small verifiedCall fixture with real EIP-1186-shaped proofs, made with
// @ethereumjs/mpt (an independent MPT), for when tools/footprint/fixtures/call.json is not there.
// The contract C returns storage[1] + balance(X); X, C and the caller are proved, Z is proved ABSENT,
// slot 2 of C is proved absent. 60 filler accounts and 20 filler slots make the proofs multi-node.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMPT, createMerkleProof } from "@ethereumjs/mpt";
import { RLP } from "@ethereumjs/rlp";
import { keccak_256 } from "@noble/hashes/sha3.js";

const hex = (b) => "0x" + Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, "").padStart(2, "0"), "hex"));
const be = (n) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; return n === 0n ? new Uint8Array() : bytes(h); };
const addr = (i) => bytes(i.toString(16).padStart(40, "0"));
const word = (n) => bytes(n.toString(16).padStart(64, "0"));

const C = addr(0xc0de), X = addr(0xaaaa), FROM = addr(0xf00), Z = addr(0xdead);
const slot1 = 0x1234n, balX = 1000000000000000000n;
// PUSH1 1 SLOAD PUSH20 X BALANCE ADD PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN
const code = bytes("600154" + "73" + Buffer.from(X).toString("hex") + "3101" + "600052" + "60206000f3");
// 3 + 2100 (cold SLOAD) + 3 + 2600 (cold BALANCE) + 3 + 3 + 6 (MSTORE, one word) + 3 + 3 = 4724
const expectGas = 4724;

const storage = await createMPT({ useKeyHashing: true });
await storage.put(word(1n), RLP.encode(be(slot1)));
for (let i = 3n; i < 23n; i++) await storage.put(word(i), RLP.encode(be(i * 77n)));

const state = await createMPT({ useKeyHashing: true });
const EMPTY_CODE = keccak_256(new Uint8Array());
const EMPTY_ROOT = bytes("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");
const account = (nonce, bal, root, ch) => RLP.encode([be(nonce), be(bal), root, ch]);
await state.put(C, account(1n, 0n, storage.root(), keccak_256(code)));
await state.put(X, account(0n, balX, EMPTY_ROOT, EMPTY_CODE));
await state.put(FROM, account(5n, 3n, EMPTY_ROOT, EMPTY_CODE));
for (let i = 1; i <= 60; i++) await state.put(addr(0x100000 + i), account(BigInt(i), BigInt(i), EMPTY_ROOT, EMPTY_CODE));

const proof = async (t, k) => (await createMerkleProof(t, k)).map(hex);
const entry = async (a, nonce, bal, sroot, ch, c, slots) => ({
  address: hex(a), balance: "0x" + bal.toString(16), nonce: "0x" + nonce.toString(16), codeHash: hex(ch),
  storageHash: hex(sroot), accountProof: await proof(state, a), code: hex(c),
  storageProof: await Promise.all(slots.map(async (s) => ({ key: "0x" + s.toString(16), value: s === 1n ? "0x" + slot1.toString(16) : "0x0", proof: await proof(storage, word(s)) }))),
});

const doc = {
  stateRoot: hex(state.root()),
  block: { fork: "Prague", coinbase: hex(addr(0xc0ffee)), number: "0x10", timestamp: "0x1000", gasLimit: "0x1c9c380", prevRandao: "0x" + "11".repeat(32), baseFee: "0x7", chainId: "0x1" },
  call: { from: hex(FROM), to: hex(C), data: "0x", gas: "0x989680" },
  accounts: [
    await entry(C, 1n, 0n, storage.root(), keccak_256(code), code, [1n, 2n]),
    await entry(X, 0n, balX, EMPTY_ROOT, EMPTY_CODE, new Uint8Array(), []),
    await entry(FROM, 5n, 3n, EMPTY_ROOT, EMPTY_CODE, new Uint8Array(), []),
    { ...(await entry(Z, 0n, 0n, EMPTY_ROOT, EMPTY_CODE, new Uint8Array(), [])) },
  ],
  expect: `ok ${hex(word(slot1 + balX))} ${expectGas}`,
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "call-mini.json"), JSON.stringify(doc, null, 1) + "\n");
console.log("wrote call-mini.json, root", doc.stateRoot, "proof lengths", doc.accounts.map((a) => a.accountProof.length));
