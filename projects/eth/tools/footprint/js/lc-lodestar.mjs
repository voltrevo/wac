// The light-client task of docs/footprint.md for Lodestar's light client (@lodestar/light-client), the same task
// tools/footprint/wac/lcbench.wac does: fetch the bootstrap, the period's updates, the finality and the optimistic
// update (all first, so transport is timed apart), then verify them in order with Lodestar's own spec functions and
// return the execution state root the optimistic header proves (with `finalizedOnly`, the optimistic update is left out
// and it is the finalized header's: the steps Helios takes before it calls itself synced).
//
// Verification is Lodestar's: `validateLightClientBootstrap` (header root against the checkpoint, committee branch),
// then `LightclientSpec`'s `onUpdate`, `onFinalityUpdate` and `onOptimisticUpdate`, which run
// `validateLightClientUpdate` (sync-committee BLS, finality and committee branches, execution branch) and the store
// rules. BLS is @chainsafe/bls 8.2.0, which uses herumi's wasm (bls-eth-wasm) in both Node and a browser here: it
// would take native blst in Node only from @chainsafe/blst 1.x, which this light client does not depend on (it
// depends on 2.x) and which no longer installs (docs/footprint.md).
import { createBeaconConfig } from '@lodestar/config';
import { mainnetChainConfig, genesisData } from '@lodestar/config/networks';
import { ssz } from '@lodestar/types';
import { LightclientSpec } from '@lodestar/light-client/spec';
import { validateLightClientBootstrap } from './node_modules/@lodestar/light-client/lib/spec/validateLightClientBootstrap.js';

const hex = (b) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.replace(/^0x/, '').match(/../g), (h) => parseInt(h, 16));

async function get(url) {
  const r = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** The updates endpoint's chunked list: an 8-byte little-endian length, a 4-byte fork digest, then the SSZ. */
function chunks(b) {
  const out = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = 0; at + 12 <= b.length;) {
    const n = Number(v.getBigUint64(at, true));
    out.push(b.subarray(at + 12, at + 8 + n));
    at += 8 + n;
  }
  return out;
}

export async function run(base, checkpoint, now, repeat = 1, log = console.log, finalizedOnly = false) {
  const t0 = performance.now();
  const boot = await get(`${base}/eth/v1/beacon/light_client/bootstrap/${checkpoint}`);
  const ups = await get(`${base}/eth/v1/beacon/light_client/updates?start_period=1906&count=1`);
  const fin = await get(`${base}/eth/v1/beacon/light_client/finality_update`);
  const opt = finalizedOnly ? null : await get(`${base}/eth/v1/beacon/light_client/optimistic_update`);
  const t1 = performance.now();
  log(`phase fetch ${(t1 - t0).toFixed(3)}`);
  const config = createBeaconConfig(mainnetChainConfig, unhex(genesisData.mainnet.genesisValidatorsRoot));
  const T = ssz.fulu;
  let result = '';
  for (let i = 0; i < repeat; i++) {
    const v0 = performance.now();
    const bootstrap = T.LightClientBootstrap.deserialize(boot);
    validateLightClientBootstrap(config, unhex(checkpoint), bootstrap);
    const spec = new LightclientSpec(config, { allowForcedUpdates: false }, bootstrap);
    for (const u of chunks(ups)) spec.onUpdate(now, T.LightClientUpdate.deserialize(u));
    spec.onFinalityUpdate(now, T.LightClientFinalityUpdate.deserialize(fin));
    if (finalizedOnly) {
      result = hex(spec.store.finalizedHeader.execution.stateRoot);
    } else {
      spec.onOptimisticUpdate(now, T.LightClientOptimisticUpdate.deserialize(opt));
      result = hex(spec.store.optimisticHeader.execution.stateRoot);
    }
    log(`phase verify ${(performance.now() - v0).toFixed(3)}`);
  }
  log(`result ${result}`);
  return result;
}
