// The light-client task of docs/footprint.md for Helios (@a16z/helios, its wasm build): a provider on mainnet,
// started from the checkpoint, with the replay server as its consensus RPC (and, since Helios requires one, as its
// execution RPC, which this task never queries), until `waitSynced()`. Helios fetches its own data, so its transport
// is inside the timing, as the report says. The clock is pinned to the recording's time, since Helios checks how old
// the data is against the wall clock.
import { createHeliosProvider } from '@a16z/helios';

export async function run(base, checkpoint, log = console.log) {
  const t0 = performance.now();
  const provider = await createHeliosProvider({
    executionRpc: base + '/execution', consensusRpc: base, network: 'mainnet', checkpoint,
  }, 'ethereum');
  const t1 = performance.now();
  log(`phase init ${(t1 - t0).toFixed(3)}`);
  await provider.waitSynced();
  const t2 = performance.now();
  log(`phase sync ${(t2 - t1).toFixed(3)}`);
  // What it believes: the finalized block, answered from its own verified state (the replay server answers only the
  // blocks it was given, so a number that came from anywhere else would show as an RPC error).
  const fin = await provider.request({ method: 'eth_getBlockByNumber', params: ['finalized', false] });
  log(`result ${fin.stateRoot}`);
  return provider;
}
