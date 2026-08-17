// SHA-256 for `packages/ssz`'s merkle tests, from a source that shares no code with `packages/crypto`.
//
// The branch tests need a tree, and `ssz_generic` has no branch vectors — so the tree has to be built
// rather than fetched. Building it with this package's own merkleizer would make a symmetric oracle:
// a `hashPair` that concatenated in the wrong order would build a wrong tree, verify against it, and
// agree with itself. Web Crypto's digest is the asymmetry.
//
// It is *sent* rather than fetched, which is the shape every oracle here has: wac builds the tree and
// hands over each internal node it computed, and this reports the ones Web Crypto disagrees with. One
// process for the whole tree, and a `DONE` count so a batch that was never read cannot pass.
//
// Two operations, and the second is not just the first in a loop. `hashpair` certifies one node, so a
// caller sending the nodes it computed learns whether its *digest* is right. `fold` is handed a leaf,
// a gindex and a branch, and walks them up here — so it also decides, independently, which side each
// sibling goes on. That is the check `hashpair` cannot make: a caller that folded with the side bits
// reversed sends the operands in the order it used, and `sha256(a ‖ b)` agrees with it.
//
// Reads `hashpair <a-hex> <b-hex> <claimed-hex>` or `fold <leaf-hex> <gindex> <branch-hex>
// <claimed-root-hex>` lines on stdin; writes `FAIL …` for each disagreement and `DONE <n>` last. See
// `packages/wactest/src/oracle.wac` for the caller's half.

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

// `Uint8Array<ArrayBuffer>` rather than the bare spelling, which means `ArrayBufferLike`: the digest is
// backed by an `ArrayBuffer` and the callers hold it in variables inferred from `bytes(…)`, which is the
// narrow one. `packages/server/host/serve.ts` and `packages/crypto/test/x25519.test.ts` write it the same
// way for the same reason.
const sha = async (b: Uint8Array): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource));
const cat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

const input = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());
const out: string[] = [];
let n = 0;

for (const line of input.split("\n")) {
  if (line.length === 0) continue;
  n++;
  const [op, ...rest] = line.split(" ");
  if (op === "hashpair") {
    const [a, b, claimed] = rest;
    const want = hex(await sha(cat(bytes(a), bytes(b))));
    if (want !== claimed) out.push(`FAIL sha256(${a} || ${b}) is ${want}, wac said ${claimed}`);
  } else if (op === "fold") {
    const [leaf, gindexText, branch, claimed] = rest;
    // Annotated, because `bytes` gives a `Uint8Array<ArrayBuffer>` and `sha` a
    // `Uint8Array<ArrayBufferLike>` — the loop assigns the second to the first and `npx tsc`
    // refuses, which had every TypeScript check in the repo red rather than this one file.
    let node: Uint8Array = bytes(leaf);
    let idx = Number(gindexText);
    for (let at = 0; at < branch.length; at += 64) {
      const sib = bytes(branch.slice(at, at + 64));
      node = await sha((idx & 1) ? cat(sib, node) : cat(node, sib));
      idx >>= 1;
    }
    const want = hex(node);
    if (want !== claimed) {
      out.push(`FAIL folding ${leaf} at gindex ${gindexText} gives ${want}, wac said ${claimed}`);
    }
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}

out.push(`DONE ${n}`);
console.log(out.join("\n"));
