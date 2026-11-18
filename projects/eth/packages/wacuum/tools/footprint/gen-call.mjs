// The verified-eth_call fixtures: real mainnet contract bytecode, real EIP-1186 proofs, in a state padded until its
// proofs are as deep as mainnet's are likely to be at the top of the trie. This container cannot reach an Ethereum
// RPC, so the state is built here rather than fetched; docs/footprint.md says so beside the numbers.
//
//   - WETH9, UniswapV2Factory, UniswapV2Router02 and UniswapV2Pair from the published npm artifacts
//     (@uniswap/v2-core and v2-periphery: the pair's init code hash is mainnet's, 0x96e8ac42…, which the router
//     checks), and three ERC-20 tokens from v2-periphery's test ERC20.
//   - Three pairs (A/WETH, WETH/B, B/C) with liquidity.
//   - 1,000,000 other accounts and 100,000 other WETH balances, so an account proof is 6–7 nodes and a WETH
//     storage proof 5–6, where mainnet's are about 8–9 and 6–8: the proofs are a little shorter than mainnet's.
//
// Two calls, each with the proofs of exactly what it reads (found by running it once with @ethereumjs's access
// list reporting):
//   quote.json     router.getAmountsOut(1e18, [A, WETH, B, C]): three pairs' reserves, CREATE2 addresses derived
//                  in the EVM, about 10k gas of execution over ~10 KB of code
//   balance.json   WETH.balanceOf(holder): the smallest useful verified call
//
//     node gen-call.mjs          (from tools/footprint; deterministic, about a minute)

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { Common, Mainnet } from '@ethereumjs/common'
import { MerkleStateManager, getMerkleStateProof } from '@ethereumjs/statemanager'
import { createVM, runTx } from '@ethereumjs/vm'
import { createTx } from '@ethereumjs/tx'
import { createBlock } from '@ethereumjs/block'
import { Account, bytesToHex, hexToBytes, createAddressFromString, setLengthLeft, bigIntToBytes, createContractAddress } from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import * as ejs from './engines/ejs.mjs'

const require = createRequire(import.meta.url)
const art = (p) => { const j = require(p); return '0x' + (j.bytecode ?? j.evm.bytecode.object).replace(/^0x/, '') }

const common = new Common({ chain: Mainnet, hardfork: 'prague' })
const sm = new MerkleStateManager({ common })
const vm = await createVM({ common, stateManager: sm })
const block = createBlock({ header: { number: 22_000_000n, timestamp: 1_750_000_000n, gasLimit: 36_000_000n, baseFeePerGas: 0n,
  coinbase: '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5', mixHash: '0x' + '11'.repeat(32) } }, { common, skipConsensusFormatValidation: true })

const ME = createAddressFromString('0x00000000000000000000000000000000000a11ce')
await sm.putAccount(ME, new Account(0n, 10n ** 24n))

const word = (v) => bytesToHex(setLengthLeft(typeof v === 'bigint' ? bigIntToBytes(v) : hexToBytes(v), 32)).slice(2)
const sel = (sig) => bytesToHex(keccak_256(new TextEncoder().encode(sig))).slice(2, 10)

async function send(to, data, value = 0n) {
  const tx = createTx({ type: 2, nonce: (await sm.getAccount(ME)).nonce, gasLimit: 16_000_000n, maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n, to, data, value }, { common, freeze: false })
  tx.getSenderAddress = () => ME
  const r = await runTx(vm, { tx, block, reportAccessList: true })
  if (r.execResult.exceptionError) throw new Error(`reverted: ${r.execResult.exceptionError.error}`)
  return r
}

async function deploy(code, args = '') {
  const nonce = (await sm.getAccount(ME)).nonce
  await send(undefined, code + args)
  return createAddressFromString(bytesToHex(createContractAddress(ME, nonce).bytes))
}

const weth = await deploy(art('@uniswap/v2-periphery/build/WETH9.json'))
const factory = await deploy(art('@uniswap/v2-core/build/UniswapV2Factory.json'), word(ME.toString()))
const router = await deploy(art('@uniswap/v2-periphery/build/UniswapV2Router02.json'), word(factory.toString()) + word(weth.toString()))
const erc20 = art('@uniswap/v2-periphery/build/ERC20.json')
const [A, B, C] = [await deploy(erc20, word(10n ** 30n)), await deploy(erc20, word(10n ** 30n)), await deploy(erc20, word(10n ** 30n))]
await send(weth.toString(), '0x' + sel('deposit()'), 10n ** 23n)

async function pool(x, xAmount, y, yAmount) {
  await send(factory.toString(), '0x' + sel('createPair(address,address)') + word(x.toString()) + word(y.toString()))
  const r = await vm.evm.runCall({ caller: ME, to: factory, gasLimit: 1_000_000n, block,
    data: hexToBytes('0x' + sel('getPair(address,address)') + word(x.toString()) + word(y.toString())) })
  const pair = createAddressFromString('0x' + bytesToHex(r.execResult.returnValue).slice(26))
  await send(x.toString(), '0x' + sel('transfer(address,uint256)') + word(pair.toString()) + word(xAmount))
  await send(y.toString(), '0x' + sel('transfer(address,uint256)') + word(pair.toString()) + word(yAmount))
  await send(pair.toString(), '0x' + sel('mint(address)') + word(ME.toString()))
}
await pool(A, 3n * 10n ** 24n, weth, 1000n * 10n ** 18n)
await pool(weth, 2000n * 10n ** 18n, B, 5n * 10n ** 24n)
await pool(B, 10n ** 24n, C, 7n * 10n ** 23n)

// The padding: accounts at pseudo-random addresses, and WETH balances in its `balanceOf` mapping (slot 3).
for (let i = 0; i < 1_000_000; i++) {
  const a = keccak_256(new TextEncoder().encode(`account ${i}`)).subarray(12)
  await sm.putAccount(createAddressFromString(bytesToHex(a)), new Account(BigInt(i % 7), BigInt(i + 1) * 10n ** 15n))
  if (i % 50_000 === 0) await sm.flush()
}
for (let i = 0; i < 100_000; i++) {
  const holder = keccak_256(new TextEncoder().encode(`holder ${i}`)).subarray(12)
  const slot = keccak_256(hexToBytes('0x' + word(bytesToHex(holder)) + word(3n)))
  await sm.putStorage(weth, slot, bigIntToBytes(BigInt(i + 1) * 10n ** 16n))
  if (i % 50_000 === 0) await sm.flush()
}
await sm.flush()
const stateRoot = bytesToHex(await sm.getStateRoot())

const calls = {
  quote: { to: router, data: '0x' + sel('getAmountsOut(uint256,address[])') + word(10n ** 18n) + word(64n) + word(4n) +
    [A, weth, B, C].map((x) => word(x.toString())).join('') },
  balance: { to: weth, data: '0x' + sel('balanceOf(address)') + word(ME.toString()) },
}
fs.mkdirSync('fixtures/call', { recursive: true })
for (const [name, c] of Object.entries(calls)) {
  // What the call reads, from a run that reports it: the access list, plus the caller and the callee, which an
  // access list leaves out because they are warm already.
  await sm.checkpoint()
  const r = await send(c.to.toString(), c.data)
  await sm.revert()
  const reads = new Map([[ME.toString(), []], [c.to.toString(), []]])
  for (const e of r.accessList ?? []) reads.set(e.address, [...(reads.get(e.address) ?? []), ...e.storageKeys])
  const accounts = []
  for (const [addr, slots] of reads) {
    const a = createAddressFromString(addr)
    const proof = await getMerkleStateProof(sm, a, slots.map(hexToBytes))
    accounts.push({ ...proof, code: bytesToHex(await sm.getCode(a)) })
  }
  const fixture = {
    stateRoot,
    block: { fork: 'Prague', coinbase: block.header.coinbase.toString(), number: '0x' + block.header.number.toString(16),
      timestamp: '0x' + block.header.timestamp.toString(16), gasLimit: '0x' + block.header.gasLimit.toString(16),
      prevRandao: bytesToHex(block.header.mixHash), baseFee: '0x0', chainId: '0x1' },
    call: { from: ME.toString(), to: c.to.toString(), data: c.data, gas: '0x' + (30_000_000).toString(16) },
    accounts,
  }
  const text = JSON.stringify(fixture, null, 1) + '\n'
  fixture.expect = await ejs.verifiedCall(new TextEncoder().encode(text))
  fs.writeFileSync(`fixtures/call/${name}.json`, JSON.stringify(fixture, null, 1) + '\n')
  const nodes = accounts.reduce((n, a) => n + a.accountProof.length + a.storageProof.reduce((m, s) => m + s.proof.length, 0), 0)
  console.log(name, fixture.expect.slice(0, 80), `${accounts.length} accounts, ${accounts.reduce((n, a) => n + a.storageProof.length, 0)} slots, ${nodes} proof nodes, ${text.length} bytes`)
}
