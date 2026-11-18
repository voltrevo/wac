// The BLS micro-benchmark of docs/footprint.md for the JavaScript-side libraries, the same three phases as
// tools/footprint/wac/blsbench.wac on the same bytes (data/gen/bls.bin):
//   herumi   bls-eth-wasm through @chainsafe/bls (what Lodestar's light client uses, in Node and the browser)
//   blst     @chainsafe/blst 2.x, native (the version @lodestar/light-client depends on; Node only)
//   noble    @noble/curves' bls12-381, pure JavaScript
// Key validation: each library's own "from bytes" with its validation on (herumi and blst check the subgroup; noble's
// fromHex does curve and subgroup checks).
//     node bls-js.mjs BASE IMPL [REPEAT]      IMPL herumi | blst | noble
const [base, impl, rep] = process.argv.slice(2);
const repeat = Number(rep || 5);
const b = new Uint8Array(await (await fetch(`${base}/data/bls.bin`)).arrayBuffer());
const n = (b.length - 96) / 48;
const keys = Array.from({ length: n }, (_, i) => b.slice(i * 48, i * 48 + 48));
const sig = b.slice(n * 48);
const msg = new Uint8Array(32).fill(7);

let fromBytes, aggregate, verify;
if (impl === 'herumi') {
  const bls = (await import('@chainsafe/bls/herumi')).default;
  fromBytes = (k) => { const p = bls.PublicKey.fromBytes(k); p.keyValidate?.(); return p; };
  aggregate = (ks) => bls.PublicKey.aggregate(ks.map((k) => bls.PublicKey.fromBytes(k)));
  verify = () => bls.verify(keys[0], msg, sig);
} else if (impl === 'blst') {
  const blst = await import('./node_modules/@lodestar/light-client/node_modules/@chainsafe/blst/index.js');
  fromBytes = (k) => blst.PublicKey.fromBytes(k, true);
  aggregate = (ks) => blst.aggregatePublicKeys(ks.map((k) => blst.PublicKey.fromBytes(k, true)));
  verify = () => blst.verify(msg, blst.PublicKey.fromBytes(keys[0], true), blst.Signature.fromBytes(sig, true));
} else if (impl === 'noble') {
  const { bls12_381: bls } = await import('@noble/curves/bls12-381.js');
  const G1 = bls.G1.Point;
  fromBytes = (k) => { const p = G1.fromBytes(k); p.assertValidity(); return p; };
  aggregate = (ks) => ks.map((k) => { const p = G1.fromBytes(k); p.assertValidity(); return p; }).reduce((a, p) => a.add(p));
  verify = () => bls.longSignatures.verify(bls.longSignatures.Signature.fromBytes(sig), bls.longSignatures.hash(msg), G1.fromBytes(keys[0]));
} else throw new Error('IMPL herumi | blst | noble');

const med = (xs) => xs.slice().sort((a, c) => a - c)[Math.floor((xs.length - 1) / 2)];
const tk = [], ta = [], tv = [];
let answer;
for (let r = 0; r < repeat; r++) {
  const t0 = performance.now();
  for (const k of keys) fromBytes(k);
  const t1 = performance.now();
  aggregate(keys);
  const t2 = performance.now();
  try { answer = verify(); } catch (e) { answer = 'threw: ' + e.message; }
  const t3 = performance.now();
  tk.push(t1 - t0); ta.push(t2 - t1); tv.push(t3 - t2);
}
console.log(`phase keys ${med(tk).toFixed(3)}`);
console.log(`phase aggregate ${med(ta).toFixed(3)}`);
console.log(`phase verify ${med(tv).toFixed(3)}`);
console.log(`result keys-ok verify=${answer}`);
