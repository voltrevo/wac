// The IPFS task of docs/footprint.md for the standard JavaScript libraries, the same work as
// tools/footprint/wac/ipfsbench.wac: read the CAR (@ipld/car), hash every block (multiformats' sha256) against its CID
// into a memory blockstore (blockstore-core), check the root, then export the whole tree (ipfs-unixfs-exporter's
// `recursive` and `exporter`) through a blockstore that hashes each block again as it is read, as wac's store does.
//
// multiformats' sha256 is the platform's: node:crypto in Node, WebCrypto (crypto.subtle) in a browser. wac hashes in
// its own wasm. docs/footprint.md says so where it matters.
import { CarReader } from '@ipld/car';
import { sha256 } from 'multiformats/hashes/sha2';
import { equals } from 'multiformats/bytes';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { recursive, exporter } from 'ipfs-unixfs-exporter';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

// `hasher`: 'platform' (multiformats' sha256: node:crypto or WebCrypto, both native) or 'noble' (@noble/hashes, pure
// JavaScript): the second separates JavaScript from the platform's native SHA-256.
let hasher = 'platform';
async function check(cid, bytes) {
  const d = hasher === 'noble' ? nobleSha256(bytes) : (await sha256.digest(bytes)).digest;
  if (cid.multihash.code !== sha256.code || !equals(d, cid.multihash.digest)) throw new Error(`block ${cid} does not hash to its CID`);
}

export async function verify(car, want) {
  const reader = await CarReader.fromBytes(car);
  const roots = await reader.getRoots();
  if (roots.length !== 1 || roots[0].toString() !== want) return `refused: the CAR's root is not ${want}`;
  const store = new MemoryBlockstore();
  for await (const { cid, bytes } of reader.blocks()) { await check(cid, bytes); await store.put(cid, bytes); }
  // blockstore-core 7's get yields the block's bytes (as one or more chunks); gather, hash, hand on.
  const hashedGet = {
    async *get(cid, opts) {
      const parts = [];
      for await (const p of store.get(cid, opts)) parts.push(p);
      const bytes = parts.length === 1 ? parts[0] : Uint8Array.from(parts.flatMap((p) => Array.from(p)));
      await check(cid, bytes);
      yield bytes;
    },
  };
  let total = 0;
  // `recursive` walks the tree and yields each entry's name and CID; `exporter` opens one, and a file's content()
  // reads its blocks.
  for await (const e of recursive(roots[0], hashedGet)) {
    const entry = await exporter(e.cid, hashedGet);
    if (entry.type === 'file' || entry.type === 'raw') for await (const chunk of entry.content()) total += chunk.length;
  }
  return `${want} ${total}`;
}

export async function run(base, repeat = 5, log = console.log, hash = 'platform') {
  hasher = hash;
  const t0 = performance.now();
  const car = new Uint8Array(await (await fetch(`${base}/data/content.car`)).arrayBuffer());
  const want = (await (await fetch(`${base}/data/content.cid`)).text()).trim();
  const t1 = performance.now();
  log(`phase fetch ${(t1 - t0).toFixed(3)}`);
  let result = await verify(car, want);
  const t2 = performance.now();
  log(`phase first ${(t2 - t1).toFixed(3)}`);
  log(`result ${result}`);
  for (let i = 0; i < repeat; i++) result = await verify(car, want);
  log(`phase per ${((performance.now() - t2) / repeat).toFixed(3)}`);
}
