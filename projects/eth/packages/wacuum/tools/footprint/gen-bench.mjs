// The throughput workloads, written as execution-spec-tests state tests so that every engine runs them through the
// same `runStateTests` it runs the conformance set through. Each is one transaction of about 25M gas into a loop:
//
//   arith      stack arithmetic and a backward jump: the interpreter itself
//   keccak     KECCAK256 of one word per iteration
//   sstore     a fresh storage slot per iteration, so the state root at the end hashes ~1,100 new slots
//   ecrecover  STATICCALL to the ecrecover precompile with a valid signature: secp256k1 inside the EVM
//
// The post-state root and logs hash in each file are what @ethereumjs/vm computes; a run of the other engines that
// passes is a run that agreed with it on every account and slot. Regenerate with `node gen-bench.mjs` (from
// tools/footprint); the output is deterministic.

import fs from 'node:fs'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import * as ejs from './engines/ejs.mjs'

const hex = (n, bytes) => n.toString(16).padStart(bytes * 2, '0')
const push = (n, bytes) => hex(0x5f + bytes, 1) + hex(n, bytes)
const push32 = (h) => '7f' + h

const op = {
  STOP: '00', ADD: '01', MUL: '02', SUB: '03', XOR: '18', KECCAK256: '20', POP: '50', MSTORE: '52',
  SSTORE: '55', JUMPI: '57', JUMPDEST: '5b', GAS: '5a', STATICCALL: 'fa', SWAP1: '90',
  DUP1: '80', DUP2: '81', DUP3: '82',
}

/** `prelude`, then a loop of `body` run `n` times with the counter on top of the stack, then STOP. */
function loop(n, body, prelude = '') {
  const head = prelude + push(n, 4)
  const top = head.length / 2
  const tail = push(1, 1) + op.SWAP1 + op.SUB + op.DUP1 + push(top, 2) + op.JUMPI + op.STOP
  return '0x' + head + op.JUMPDEST + body + tail
}

const work = (op.DUP1 + op.DUP1 + op.MUL + op.DUP2 + op.ADD + op.DUP2 + op.XOR + op.POP).repeat(4)
const arith = loop(195000, work)
const keccak = loop(330000, op.DUP1 + push(0, 1) + op.MSTORE + push(32, 1) + push(0, 1) + op.KECCAK256 + op.POP)
const sstore = loop(1100, op.DUP1 + op.DUP1 + op.SSTORE)

// One valid signature, so that every call recovers a key rather than failing early.
const priv = keccak_256(new TextEncoder().encode('footprint'))
const msg = keccak_256(new TextEncoder().encode('a message'))
const sig = secp256k1.sign(msg, priv, { prehash: false, format: 'recovered' })
const v = 27 + sig[0]
const input = [bytesToHex(msg), hex(v, 32), bytesToHex(sig.subarray(1, 33)), bytesToHex(sig.subarray(33, 65))]
const store = input.map((w, i) => push32(w) + push(i * 32, 1) + op.MSTORE).join('')
// STATICCALL(gas, 0x01, 0, 128, 128, 32), result popped.
const call = push(32, 1) + push(128, 1) + push(128, 1) + push(0, 1) + push(1, 1) + op.GAS + op.STATICCALL + op.POP
const ecrecover = loop(7800, call, store)
{
  // The same signature for the primitives comparison, with the address it must recover to.
  const pub = secp256k1.getPublicKey(priv, false)
  const address = '00'.repeat(12) + bytesToHex(keccak_256(pub.subarray(1)).subarray(12))
  fs.mkdirSync('fixtures', { recursive: true })
  fs.writeFileSync('fixtures/ecrecover.json', JSON.stringify({ input: input.join(''), address }, null, 1) + '\n')
}

const SENDER = '0xa94f5374fce5edbac8e2f8b6d8b4f4e4c7c5b9a1'
const TARGET = '0x00000000000000000000000000000000000c0de0'

function stateTest(name, code) {
  return {
    [name]: {
      env: {
        currentCoinbase: '0x2adc25665018aa1fe0e6bc666dac8fc2697ff9ba', currentGasLimit: '0x0393870000',
        currentNumber: '0x01', currentTimestamp: '0x03e8', currentRandom: '0x' + '00'.repeat(31) + '20',
        currentDifficulty: '0x00', currentBaseFee: '0x07', currentExcessBlobGas: '0x00',
      },
      pre: {
        [SENDER]: { nonce: '0x00', balance: '0x3635c9adc5dea00000', code: '0x', storage: {} },
        [TARGET]: { nonce: '0x01', balance: '0x00', code, storage: {} },
      },
      transaction: {
        nonce: '0x00', gasPrice: '0x0a', gasLimit: ['0x01c9c380'], to: TARGET, value: ['0x00'], data: ['0x'],
        sender: SENDER, secretKey: '0x' + '00'.repeat(31) + '01',
      },
      post: { Prague: [{ hash: '', logs: '', indexes: { data: 0, gas: 0, value: 0 } }] },
      config: { chainid: '0x01' },
    },
  }
}

// The root is what @ethereumjs computes: search it out by asking for the case with a wrong root and reading back
// what it computed is not something the interface offers, so this runs it through a small hook instead.
fs.mkdirSync('fixtures/bench', { recursive: true })
for (const [name, code] of Object.entries({ arith, keccak, sstore, ecrecover })) {
  const t = stateTest(name, code)
  const { root, logs, gas } = await ejs.expectedPost(new TextEncoder().encode(JSON.stringify(t)), 'Prague')
  t[name].post.Prague[0].hash = root
  t[name].post.Prague[0].logs = logs
  fs.writeFileSync(`fixtures/bench/${name}.json`, JSON.stringify(t, null, 1) + '\n')
  console.log(name, 'gas used', gas, 'code bytes', (code.length - 2) / 2)
}
