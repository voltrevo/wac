// The IPFS comparison's input (docs/footprint.md): a deterministic tree of 5.4 MB (files of 4 MiB, 1 MiB, 300 KB,
// 100 KB and 10 KB, in two directories), imported under IPIP-0499's `unixfs-v1-2025` profile by the reference
// importer (ipfs-unixfs-importer, as packages/ipfs/tools/oracle does), written as a CAR v1 with the root first.
//     node mkcar.mjs OUTDIR        writes content.car and content.cid
import fs from 'node:fs';
import path from 'node:path';
import { importer } from 'ipfs-unixfs-importer';
import { CarWriter } from '@ipld/car';

function bytes(n, seed) {          // xorshift32: the same bytes everywhere
  const b = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; b[i] = x & 255; }
  return b;
}
const files = [
  ['root/big.bin', bytes(4 * 1048576, 1)],
  ['root/mid.bin', bytes(1048576, 2)],
  ['root/small.txt', new TextEncoder().encode('verified content\n'.repeat(6400))],
  ['root/sub/b.bin', bytes(300 * 1024, 3)],
  ['root/sub/a.json', new TextEncoder().encode(JSON.stringify({ items: Array.from({ length: 300 }, (_, i) => ({ i, sq: i * i })) }))],
];
const blocks = [];
const bs = { put: async (cid, b) => { blocks.push([cid, b]); return cid; }, get: async () => { throw new Error('unused'); }, has: async () => false };
let root;
for await (const e of importer(files.map(([p, c]) => ({ path: p, content: c })), bs, { profile: 'unixfs-v1-2025' })) if (e.path === 'root') root = e.cid;
const { writer, out } = CarWriter.create([root]);
const chunks = [];
const done = (async () => { for await (const c of out) chunks.push(c); })();
const seen = new Set();
for (const [cid, b] of blocks.reverse()) { if (!seen.has(cid.toString())) { seen.add(cid.toString()); await writer.put({ cid, bytes: b }); } }
await writer.close();
await done;
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(path.join(process.argv[2], 'content.car'), Buffer.concat(chunks));
fs.writeFileSync(path.join(process.argv[2], 'content.cid'), root.toString() + '\n');
const total = files.reduce((n, [, c]) => n + c.length, 0);
console.log(`content.car: ${root} — ${files.length} files, ${total} bytes of content, ${seen.size} blocks`);
