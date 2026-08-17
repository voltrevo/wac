// A Merkle-Patricia trie builder as a service, so the wac verifier has proofs to consume.
//
// The wac side verifies; something has to produce. This is that something, and it shares **nothing** with
// the code it feeds: its own RLP (`rlp.ts`), its own trie (`trie.ts`), its own keccak256 (`keccak.ts`).
// That last one is new — the builder used to reach into wac for the digest, because `node:crypto` has SHA-3
// and not keccak256, so the two halves shared one symbol. They no longer share any.
//
// It is anchored before it is believed, and the anchor is `packages/mpt/test/wac/getproof_test.wac`'s first
// test: all seven roots in `vendor/trieanyorder.json`, which no builder can match with the hex-prefix
// encoding, the node shapes, the 32-byte inline rule, the RLP or the permutation wrong.
//
// ## Why it is a service and not a corpus
//
// It could emit a fixed set of tries and proofs. It does not, because then every decision about *what to
// prove* would live here in TypeScript rather than in the test that cares — and the second file's whole
// subject is composition, which is a statement about which tries exist and what they carry.
//
// So it takes instructions and answers them. One process for a whole file's worth:
//
//   trie  <id> <keyhex>:<valuehex>,…      →  root <id> <roothex>
//   proof <id> <keyhex>                   →  proof <id> <keyhex> <nodehex>,…
//   hash  <hex>                           →  hash <hex> <keccak256hex>
//
// and `DONE <n>` last, counting the lines read, so a batch that was never finished cannot pass for
// agreement. See `packages/wactest/src/oracle.wac` for the convention.
//
// `trie` with no pairs is legal and means the empty trie, whose root is `keccak256(rlp(""))`.

import { trie, type Trie } from "./trie.ts";
import { keccak256 } from "./keccak.ts";

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

const input = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());
const built = new Map<string, Trie>();
const out: string[] = [];
let n = 0;

for (const line of input.split("\n")) {
  if (line.length === 0) continue;
  n++;
  const [op, ...rest] = line.split(" ");
  if (op === "trie") {
    const [id, pairsText] = rest;
    const pairs: [Uint8Array, Uint8Array][] = [];
    for (const pair of (pairsText ?? "").split(",")) {
      if (pair.length === 0) continue;
      const [k, v] = pair.split(":");
      pairs.push([bytes(k), bytes(v ?? "")]);
    }
    const t = trie(pairs, keccak256);
    built.set(id, t);
    out.push(`root ${id} ${hex(t.root)}`);
  } else if (op === "proof") {
    const [id, key] = rest;
    const t = built.get(id);
    if (t === undefined) {
      out.push(`FAIL proof asked for trie ${id}, which was never built`);
      continue;
    }
    out.push(`proof ${id} ${key} ${t.proof(bytes(key)).map(hex).join(",")}`);
  } else if (op === "hash") {
    out.push(`hash ${rest[0]} ${hex(keccak256(bytes(rest[0])))}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}

out.push(`DONE ${n}`);
console.log(out.join("\n"));
