// The EIP-712 recovery of stmt-js.mjs with ethers 6.
import { TypedDataEncoder, recoverAddress } from 'ethers';
import { domain, types, hex } from './stmt-js.mjs';
export const recover = async (st, sig) =>
  recoverAddress(TypedDataEncoder.hash(domain, types, { recipe: st.recipe.bytes, output: st.output.bytes, runner: st.runner }), hex(sig)).toLowerCase();
