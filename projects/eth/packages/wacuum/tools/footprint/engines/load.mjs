// Loads one engine from dist/ the same way in Node and in Chromium: `read(path)` answers the bytes of a file under
// dist/ (fs in Node, fetch in the page), and `base` is the URL or file URL dist/ is at, for the glue's import.
// The wasm engines' modules are compiled with WebAssembly.compile, asynchronously, by this file rather than by
// their glue, so every wasm engine's cold start is the same three steps: read, compile, instantiate.

export const ENGINES = {
  wac: { wasm: 'wac/evmlib.wasm', glue: 'wac/evmlib.mjs', kind: 'wac' },
  'wac-opt': { wasm: 'wac-opt/evmlib.wasm', glue: 'wac-opt/evmlib.mjs', kind: 'wac' },
  'revm-s': { wasm: 'revm-s/revm_wasm_bg.wasm', glue: 'revm-s/revm_wasm.js', kind: 'bindgen' },
  'revm-3': { wasm: 'revm-3/revm_wasm_bg.wasm', glue: 'revm-3/revm_wasm.js', kind: 'bindgen' },
  ejs: { glue: 'ejs/ejs.mjs', kind: 'js' },
  'ejs-nokzg': { glue: 'ejs-nokzg/ejs.mjs', kind: 'js' },
  // Part 2: the primitives alone.
  'wac-keccak': { wasm: 'prims/wac-keccak.wasm', glue: 'prims/wac-keccak.mjs', kind: 'wac' },
  'wac-secp': { wasm: 'prims/wac-secp.wasm', glue: 'prims/wac-secp.mjs', kind: 'wac' },
  'noble-keccak': { glue: 'prims/noble-keccak.mjs', kind: 'noble' },
  'noble-secp': { glue: 'prims/noble-secp.mjs', kind: 'noble' },
  'ec-keccak': { glue: 'prims/ec-keccak.mjs', kind: 'ec' },
  'ec-secp': { glue: 'prims/ec-secp.mjs', kind: 'ec' },
}

/** The ecrecover precompile's contract over a secp256k1 and a keccak256 from a JavaScript library. */
function recoverWith(secp256k1, keccak) {
  return (input) => {
    const v = input[63]
    for (let i = 32; i < 63; i++) if (input[i] !== 0) return new Uint8Array(0)
    if (v !== 27 && v !== 28) return new Uint8Array(0)
    try {
      const sig = new Uint8Array(65)
      sig[0] = v - 27; sig.set(input.subarray(64, 128), 1)
      const pub = secp256k1.recoverPublicKey(sig, input.subarray(0, 32), { prehash: false, format: 'recovered' })
      const out = new Uint8Array(32)
      out.set(keccak(secp256k1.Point.fromBytes(pub).toBytes(false).subarray(1)).subarray(12), 12)
      return out
    } catch { return new Uint8Array(0) }
  }
}

/** ethereum-cryptography 3 re-exports noble's curve with its own (older-API) wrapper: recover through a Signature. */
function recoverWithEc(secp256k1, keccak) {
  return (input) => {
    const v = input[63]
    for (let i = 32; i < 63; i++) if (input[i] !== 0) return new Uint8Array(0)
    if (v !== 27 && v !== 28) return new Uint8Array(0)
    try {
      const sig = secp256k1.Signature.fromCompact(input.subarray(64, 128)).addRecoveryBit(v - 27)
      const pub = sig.recoverPublicKey(input.subarray(0, 32)).toRawBytes(false)
      const out = new Uint8Array(32)
      out.set(keccak(pub.subarray(1)).subarray(12), 12)
      return out
    } catch { return new Uint8Array(0) }
  }
}

export async function load(name, read, base) {
  const e = ENGINES[name]
  if (e.wasm) {
    const mod = await WebAssembly.compile(await read(e.wasm))
    if (e.kind === 'wac') {
      globalThis.__footprintModule = mod
      return await import(base + e.glue)
    }
    const glue = await import(base + e.glue)
    const exports = glue.initSync({ module: mod })
    // The namespace cannot carry the memory, so a plain object does, for the drivers to report its size.
    return { ...glue, linearMemory: exports.memory }
  }
  const m = await import(base + e.glue)
  if (e.kind === 'noble') return { keccak: m.keccak_256, ecrecoverBytes: m.secp256k1 && recoverWith(m.secp256k1, m.keccak_256) }
  if (e.kind === 'ec') return { keccak: m.keccak256, ecrecoverBytes: m.secp256k1 && recoverWithEc(m.secp256k1, m.keccak256) }
  return m
}
