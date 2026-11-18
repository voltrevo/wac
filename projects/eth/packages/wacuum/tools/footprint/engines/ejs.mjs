// @ethereumjs/vm behind the interface in ../INTERFACE.md, for the footprint comparison (docs/footprint.md).
//
// Written the way the EthereumJS monorepo's own state-test runner (packages/vm/test/util.ts) sets up a case — a
// fresh MerkleStateManager per case, the pre-state put and committed, a VM over it, `runTx` — with one change for
// fairness: the transaction is not signed, and its sender is the fixture's, because neither wacuum's library nor
// revm's recovers it either. A thrown construction or run is a refused transaction, as in that runner.
//
// The functions answer Promises: @ethereumjs is asynchronous throughout and has no synchronous entry point.

import { Common, Mainnet } from '@ethereumjs/common'
import { MerkleStateManager, SimpleStateManager } from '@ethereumjs/statemanager'
import { createVM, runTx } from '@ethereumjs/vm'
import { createTx } from '@ethereumjs/tx'
import { createBlock } from '@ethereumjs/block'
import { verifyMerkleProof } from '@ethereumjs/mpt'
import { createEVM } from '@ethereumjs/evm'
import {
  Account, Address, bytesToHex, createAccountFromRLP, createAddressFromString, equalsBytes,
  hexToBytes, setLengthLeft, unpadBytes,
} from '@ethereumjs/util'
import { RLP } from '@ethereumjs/rlp'
import { KZG } from 'micro-eth-signer/kzg.js'
import { trustedSetup } from '@paulmillr/trusted-setups/small-kzg.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'

const big = (h) => (h === undefined || h === null || h === '0x' || h === '' ? 0n : BigInt(h))
const bytes = (h) => (h === undefined || h === null ? new Uint8Array(0) : hexToBytes(h === '0x' ? '0x' : h))

// @ethereumjs needs a KZG implementation for any blob transaction and for the point-evaluation precompile. This is
// the one its documentation names, with the smaller of the two published setups; it is made on first use, so a
// run with no blob in it does not pay for parsing the setup.
let kzg
const customCrypto = {
  get kzg() { return (kzg ??= new KZG(trustedSetup)) },
}

function commonFor(fork, chainId) {
  return new Common({ chain: { ...Mainnet, chainId: Number(chainId) }, hardfork: fork.toLowerCase(), customCrypto })
}

/** The transaction a case runs, unsigned, typed as wacuum's runner types it. */
function txData(t, idx) {
  const d = idx.data, g = idx.gas, v = idx.value
  const list = t.accessLists?.[d]
  let type = t.blobVersionedHashes ? 3 : t.maxFeePerGas !== undefined ? 2 : list ? 1 : 0
  if (t.authorizationList) type = 4
  const out = {
    type, nonce: big(t.nonce), gasLimit: big(t.gasLimit[g]), value: big(t.value[v]), data: bytes(t.data[d]),
    to: t.to ? t.to : undefined,
  }
  if (type === 0 || type === 1) out.gasPrice = big(t.gasPrice)
  else { out.maxFeePerGas = big(t.maxFeePerGas); out.maxPriorityFeePerGas = big(t.maxPriorityFeePerGas) }
  if (type >= 1) out.accessList = (list ?? []).map((e) => ({ address: e.address, storageKeys: e.storageKeys }))
  if (type === 3) { out.blobVersionedHashes = t.blobVersionedHashes; out.maxFeePerBlobGas = big(t.maxFeePerBlobGas) }
  if (type === 4) {
    out.authorizationList = t.authorizationList.map((a) => ({
      chainId: a.chainId, address: a.address, nonce: a.nonce, yParity: a.yParity ?? a.v, r: a.r, s: a.s,
    }))
  }
  return out
}

function blockFor(env, common) {
  return createBlock({
    header: {
      coinbase: env.currentCoinbase, number: big(env.currentNumber), timestamp: big(env.currentTimestamp),
      gasLimit: big(env.currentGasLimit), difficulty: big(env.currentDifficulty),
      mixHash: env.currentRandom, baseFeePerGas: big(env.currentBaseFee),
      excessBlobGas: env.currentExcessBlobGas !== undefined ? big(env.currentExcessBlobGas) : undefined,
    },
  }, { common, skipConsensusFormatValidation: true })
}

async function stateFrom(pre, common) {
  const sm = new MerkleStateManager({ common })
  await sm.checkpoint()
  for (const [addr, a] of Object.entries(pre)) {
    const address = createAddressFromString(addr)
    await sm.putAccount(address, new Account(big(a.nonce), big(a.balance)))
    await sm.putCode(address, bytes(a.code))
    for (const [k, v] of Object.entries(a.storage ?? {})) {
      if (big(v) === 0n) continue
      await sm.putStorage(address, setLengthLeft(bytes(k === '0x' ? '0x00' : k), 32), unpadBytes(bytes(v)))
    }
  }
  await sm.commit()
  await sm.flush()
  return sm
}

function logsHash(logs) {
  return bytesToHex(keccak_256(RLP.encode(logs ?? [])))
}

/** One case: whether it was refused, and the root, logs hash and gas it ended with. */
async function runCase(test, post, fork) {
  const common = commonFor(fork, test.config?.chainid ?? 1)
  const sm = await stateFrom(test.pre, common)
  const vm = await createVM({ common, stateManager: sm })
  const block = blockFor(test.env, common)
  let invalid = false, logs = [], gas = 0n
  try {
    const tx = createTx(txData(test.transaction, post.indexes), { common, freeze: false })
    const sender = createAddressFromString(test.transaction.sender)
    tx.getSenderAddress = () => sender
    const r = await runTx(vm, { tx, block })
    gas = r.totalGasSpent
    logs = r.receipt.logs
  } catch (e) {
    if (process.env.EJS_DEBUG) console.error(e.message)
    invalid = true
  }
  return { invalid, root: bytesToHex(await sm.getStateRoot()), logs: logsHash(logs), gas }
}

export async function runStateTests(json, fork) {
  const doc = JSON.parse(new TextDecoder().decode(json))
  let passed = 0, failed = 0, gas = 0n
  for (const test of Object.values(doc)) {
    const posts = test.post[fork]
    if (!posts) continue
    for (const post of posts) {
      const r = await runCase(test, post, fork)
      gas += r.gas
      const ok = (r.invalid === (post.expectException !== undefined)) && r.root === post.hash && r.logs === post.logs
      if (ok) passed++; else failed++
    }
  }
  return `${passed} ${failed} ${gas}`
}

/** For gen-bench.mjs: what the first case of a file ends with, to write into it as the expected post-state. */
export async function expectedPost(json, fork) {
  const test = Object.values(JSON.parse(new TextDecoder().decode(json)))[0]
  const r = await runCase(test, test.post[fork][0], fork)
  if (r.invalid) throw new Error('the benchmark transaction was refused')
  return r
}

/** One proof against a root: what `verifyMerkleProof` does, plus the root itself, which it does not check. */
async function proved(root, key, nodes) {
  if (nodes.length === 0 || !equalsBytes(keccak_256(nodes[0]), root)) throw new Error('proof does not start at the root')
  return verifyMerkleProof(key, nodes, { useKeyHashing: true })
}

export async function verifiedCall(json) {
  const doc = JSON.parse(new TextDecoder().decode(json))
  const root = hexToBytes(doc.stateRoot)
  const b = doc.block
  const common = commonFor(b.fork ?? 'Prague', b.chainId)
  // Plain maps rather than a trie: the proofs were the trie, and revm's CacheDB and wacuum's World are maps too.
  const sm = new SimpleStateManager({ common })
  for (const a of doc.accounts) {
    const address = createAddressFromString(a.address)
    const value = await proved(root, hexToBytes(a.address), a.accountProof.map(hexToBytes))
    if (value === null) continue
    const acct = createAccountFromRLP(value)
    const code = bytes(a.code)
    if (!equalsBytes(keccak_256(code), acct.codeHash)) return `error code of ${a.address}`
    await sm.putAccount(address, new Account(acct.nonce, acct.balance))
    if (code.length > 0) await sm.putCode(address, code)
    for (const s of a.storageProof) {
      const key = setLengthLeft(hexToBytes(s.key), 32)
      const v = await proved(acct.storageRoot, key, s.proof.map(hexToBytes))
      if (v !== null) await sm.putStorage(address, key, RLP.decode(v))
    }
  }
  const evm = await createEVM({ common, stateManager: sm })
  const block = createBlock({
    header: {
      coinbase: b.coinbase, number: big(b.number), timestamp: big(b.timestamp), gasLimit: big(b.gasLimit),
      mixHash: b.prevRandao, baseFeePerGas: big(b.baseFee),
    },
  }, { common, skipConsensusFormatValidation: true })
  const caller = createAddressFromString(doc.call.from)
  const to = createAddressFromString(doc.call.to)
  evm.journal.addAlwaysWarmAddress(caller.toString().slice(2))
  evm.journal.addAlwaysWarmAddress(to.toString().slice(2))
  for (const [addr] of evm.precompiles.entries()) evm.journal.addAlwaysWarmAddress(addr)
  const r = await evm.runCall({
    caller, origin: caller, to, data: bytes(doc.call.data), gasLimit: big(doc.call.gas), value: 0n, block,
  })
  if (r.execResult.exceptionError) return `error ${r.execResult.exceptionError.error}`
  return `ok ${bytesToHex(r.execResult.returnValue)} ${r.execResult.executionGasUsed}`
}

export function keccak(data) { return keccak_256(data) }

/** The ecrecover precompile's contract with @noble/curves, which is what @ethereumjs/evm's precompile reaches. */
export function ecrecoverBytes(input) {
  const hash = input.subarray(0, 32), v = big(bytesToHex(input.subarray(32, 64)))
  const r = input.subarray(64, 96), s = input.subarray(96, 128)
  if (v !== 27n && v !== 28n) return new Uint8Array(0)
  try {
    const sig = new Uint8Array(65); sig[0] = Number(v - 27n); sig.set(r, 1); sig.set(s, 33)
    const pub = secp256k1.recoverPublicKey(sig, hash, { prehash: false, format: 'recovered' })
    const addr = keccak_256(secp256k1.Point.fromBytes(pub).toBytes(false).subarray(1)).subarray(12)
    return setLengthLeft(addr, 32)
  } catch { return new Uint8Array(0) }
}
