// The recorded light-client data as the beacon API's JSON, for clients that ask for JSON (Helios): the same values as
// packages/lightclient/test/mainnet's SSZ, converted by Lodestar's SSZ types (`toJson`), so every client is given
// the same objects.  `node mkjson.mjs OUTDIR`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ssz } from '@lodestar/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '../../../packages/lightclient/test/mainnet');
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const T = ssz.fulu;
const read = (f) => new Uint8Array(fs.readFileSync(path.join(data, f)));
const wrap = (type, bytes) => ({ version: 'fulu', data: type.toJson(type.deserialize(bytes)) });

fs.writeFileSync(path.join(out, 'bootstrap.json'), JSON.stringify(wrap(T.LightClientBootstrap, read('bootstrap.ssz'))));
fs.writeFileSync(path.join(out, 'finality.json'), JSON.stringify(wrap(T.LightClientFinalityUpdate, read('finality.ssz'))));
fs.writeFileSync(path.join(out, 'optimistic.json'), JSON.stringify(wrap(T.LightClientOptimisticUpdate, read('optimistic.ssz'))));
const b = read('updates.ssz');
const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
const ups = [];
for (let at = 0; at + 12 <= b.length;) {
  const n = Number(v.getBigUint64(at, true));
  ups.push(wrap(T.LightClientUpdate, b.subarray(at + 12, at + 8 + n)));
  at += 8 + n;
}
fs.writeFileSync(path.join(out, 'updates.json'), JSON.stringify(ups));
console.log(`json: ${fs.readdirSync(out).join(' ')}`);
