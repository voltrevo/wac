// The proof task of docs/footprint.md for @ethereumjs/mpt (EthereumJS's Merkle Patricia trie, v10; it was
// @ethereumjs/trie): the same recorded eth_getProof answer as tools/footprint/wac/mptbench.wac, verified the same way
// from its JSON text: the account proof against the state root (`verifyMerkleProof` with the root given and key
// hashing on), the account's RLP, then each storage proof against its storage root.
import { verifyMerkleProof } from '@ethereumjs/mpt';
import { RLP } from '@ethereumjs/rlp';
import { hexToBytes, bytesToHex } from '@ethereumjs/util';

const minimal = (h) => { let s = h.replace(/^0x/, '').replace(/^0+/, ''); if (s.length % 2) s = '0' + s; return '0x' + s; };

export async function verify(proofText, stateRoot) {
  const r = JSON.parse(proofText).result;
  const acct = await verifyMerkleProof(hexToBytes(r.address), r.accountProof.map(hexToBytes), { root: stateRoot, useKeyHashing: true });
  if (!acct) return 'account absent';
  const [, , storageRoot] = RLP.decode(acct);
  if (bytesToHex(storageRoot) !== r.storageHash) return 'storage root differs';
  for (const [i, s] of r.storageProof.entries()) {
    const v = await verifyMerkleProof(hexToBytes(s.key), s.proof.map(hexToBytes), { root: storageRoot, useKeyHashing: true });
    const value = v ? bytesToHex(RLP.decode(v)) : '0x';
    if (minimal(value) !== minimal(s.value)) return `slot ${i}: value differs`;
  }
  return 'ok ' + bytesToHex(storageRoot);
}

export async function run(base, repeat = 200, log = console.log) {
  const t0 = performance.now();
  const proof = await (await fetch(`${base}/data/proof.json`)).text();
  const block = await (await fetch(`${base}/data/block.json`)).text();
  const t1 = performance.now();
  log(`phase fetch ${(t1 - t0).toFixed(3)}`);
  const stateRoot = hexToBytes(JSON.parse(block).result.stateRoot);
  let result = await verify(proof, stateRoot);
  const t2 = performance.now();
  log(`phase first ${(t2 - t1).toFixed(3)}`);
  log(`result ${result}`);
  for (let i = 0; i < repeat; i++) result = await verify(proof, stateRoot);
  log(`phase per ${((performance.now() - t2) / repeat).toFixed(4)}`);
}
