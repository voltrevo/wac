// The EIP-712 recovery of stmt-js.mjs with viem.
import { hashTypedData, recoverAddress } from 'viem';
import { domain, types, hex } from './stmt-js.mjs';
export const recover = async (st, sig) => (await recoverAddress({
  hash: hashTypedData({ domain, types, primaryType: 'Derivation', message: { recipe: hex(st.recipe.bytes), output: hex(st.output.bytes), runner: st.runner } }),
  signature: hex(sig),
})).toLowerCase();
