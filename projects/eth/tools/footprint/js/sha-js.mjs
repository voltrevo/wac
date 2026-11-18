// SHA-256 throughput for docs/footprint.md's IPFS section, ms per MiB over 10 × 1 MiB:
//   platform  node:crypto (native, as multiformats uses in Node)      noble  @noble/hashes (pure JavaScript)
//     node sha-js.mjs platform|noble
import { createHash } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha2.js';
const impl = process.argv[2];
const b = new Uint8Array(1048576).fill(7);
const h = impl === 'noble' ? (x) => sha256(x) : (x) => createHash('sha256').update(x).digest();
let d = h(b);
const t0 = performance.now();
for (let i = 0; i < 10; i++) d = h(b);
console.log(`phase per ${((performance.now() - t0) / 10).toFixed(3)}`);
console.log(`result ${d[0]}`);
