// The statement comparison's input (docs/footprint.md): 100 reckon derivation statements, signed by four keys with
// ethers (not by reckon), as reckon's signed blocks: DAG-CBOR { statement, signer, signature } (packages/reckon/src/
// claims.wac), the statement { kind: "derivation", recipe: link, output: link, runner }, signed as EIP-712 typed data
// (domain { name: "reckon", version: "2" }, Derivation(bytes recipe,bytes output,string runner), links as CID bytes).
// data/gen/stmts.json: [{ block: hex, id: the statement's CID, signer }].
//     node mkstmt.mjs OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import { Wallet, TypedDataEncoder, Signature, getBytes, keccak256, toUtf8Bytes } from 'ethers';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

const domain = { name: 'reckon', version: '2' };
const types = { Derivation: [{ name: 'recipe', type: 'bytes' }, { name: 'output', type: 'bytes' }, { name: 'runner', type: 'string' }] };
const keys = [1, 2, 3, 4].map((i) => new Wallet(keccak256(toUtf8Bytes(`footprint signer ${i}`))));
const hex = (b) => '0x' + Buffer.from(b).toString('hex');
const out = [];
for (let i = 0; i < 100; i++) {
  const recipe = CID.create(1, dagCbor.code, await sha256.digest(toUtf8Bytes(`recipe ${i}`)));
  const output = CID.create(1, 0x70, await sha256.digest(toUtf8Bytes(`output ${i}`)));
  const runner = `runner ${i % 2 ? 'v8' : 'wasmtime'}`;
  const statement = { kind: 'derivation', recipe, output, runner };
  const id = CID.create(1, dagCbor.code, await sha256.digest(dagCbor.encode(statement)));
  const w = keys[i % keys.length];
  const sig = Signature.from(w.signingKey.sign(TypedDataEncoder.hash(domain, types, { recipe: recipe.bytes, output: output.bytes, runner })));
  const signature = getBytes(sig.serialized);            // r ‖ s ‖ v, v 27 or 28
  const block = dagCbor.encode({ statement, signer: getBytes(w.address), signature });
  out.push({ block: hex(block), id: id.toString(), signer: w.address.toLowerCase() });
}
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(path.join(process.argv[2], 'stmts.json'), JSON.stringify(out));
console.log(`stmts.json: ${out.length} signed statements by ${keys.length} keys`);
