// The statement task of docs/footprint.md for the standard JavaScript libraries, the same work as
// tools/footprint/wac/stmtbench.wac per statement: decode the signed block (@ipld/dag-cbor), recompute the statement's
// CID (multiformats, sha256) and compare, then recover the EIP-712 signer and compare. The recovery is a library's:
// stmt-viem.mjs (viem's hashTypedData and recoverAddress) or stmt-ethers.mjs (ethers 6's TypedDataEncoder.hash and
// recoverAddress), each in its own bundle; both rest on @noble/curves' secp256k1.
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

export const domain = { name: 'reckon', version: '2' };
export const types = { Derivation: [{ name: 'recipe', type: 'bytes' }, { name: 'output', type: 'bytes' }, { name: 'runner', type: 'string' }] };
export const hex = (b) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.slice(2).match(/../g), (h) => parseInt(h, 16));

export async function verifyAll(items, recover) {
  let ok = 0;
  for (const it of items) {
    const v = dagCbor.decode(it.bytes);
    const id = CID.create(1, dagCbor.code, await sha256.digest(dagCbor.encode(v.statement)));
    if (id.toString() !== it.id) continue;
    if (hex(v.signer).toLowerCase() !== it.signer) continue;
    if ((await recover(v.statement, v.signature)) === it.signer) ok++;
  }
  return ok;
}

export async function run(base, recover, repeat = 10, log = console.log) {
  const t0 = performance.now();
  const raw = await (await fetch(`${base}/data/stmts.json`)).json();
  const t1 = performance.now();
  log(`phase fetch ${(t1 - t0).toFixed(3)}`);
  const items = raw.map((x) => ({ bytes: unhex(x.block), id: x.id, signer: x.signer }));
  let ok = await verifyAll(items, recover);
  const t2 = performance.now();
  log(`phase first ${(t2 - t1).toFixed(3)}`);
  log(`result ${ok}/${items.length}`);
  for (let r = 0; r < repeat; r++) ok = await verifyAll(items, recover);
  log(`phase per ${((performance.now() - t2) / (repeat * items.length)).toFixed(4)}`);
}
