// The BLS micro-benchmark's input (docs/footprint.md): the recorded bootstrap's 512 sync-committee public keys
// (48 bytes each, compressed) and the recorded optimistic update's aggregate signature (96 bytes), concatenated, as
// data/gen/bls.bin. Real mainnet points, so every implementation decompresses and subgroup-checks real keys.
//     node mkbls.mjs OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ssz } from '@lodestar/types';
const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '../../../packages/lightclient/test/mainnet');
const boot = ssz.fulu.LightClientBootstrap.deserialize(fs.readFileSync(path.join(data, 'bootstrap.ssz')));
const opt = ssz.fulu.LightClientOptimisticUpdate.deserialize(fs.readFileSync(path.join(data, 'optimistic.ssz')));
const keys = boot.currentSyncCommittee.pubkeys;
const out = new Uint8Array(keys.length * 48 + 96);
keys.forEach((k, i) => out.set(k, i * 48));
out.set(opt.syncAggregate.syncCommitteeSignature, keys.length * 48);
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(path.join(process.argv[2], 'bls.bin'), out);
console.log(`bls.bin: ${keys.length} keys and a signature, ${out.length} bytes`);
