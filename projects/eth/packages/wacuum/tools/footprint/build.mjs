// Builds every engine in the comparison into dist/<engine>/, each as what a web page would ship: one ES module of
// glue and, for the wasm engines, one .wasm beside it. The drivers load every engine the same way: they fetch and
// compile the .wasm themselves (WebAssembly.compile, asynchronous everywhere), hand the compiled module to the
// glue, then import the glue — so a cold start measures the same steps for all of them.
//
//   wac       wacuum's EVM: `wac bindgen --js` of evmlib.wac, the module taken out of the glue's base64
//   wac-opt   the same module after binaryen's wasm-opt -O3 (WasmGC enabled): what an optimizer adds
//   revm-s    revm, opt-level s + wasm-opt -Oz        (revm-wasm/build.sh)
//   revm-3    revm, opt-level 3 + wasm-opt -O3        (revm-wasm/build.sh)
//   native    native.wac and native-none.wac, for the `wac` command itself (not a page's download)
//   ejs       @ethereumjs/vm 10.1.3 and what it needs, bundled and minified by esbuild for the browser
//
//     node build.mjs [--skip-revm]          (from tools/footprint, with `wac` on PATH)

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const wacuum = path.resolve(here, '../..')
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

fs.mkdirSync(dist, { recursive: true })

// ── wac ──
{
  const out = path.join(dist, 'wac')
  fs.mkdirSync(out, { recursive: true })
  const bound = path.join(out, 'bindgen.js')
  sh('wac', ['bindgen', 'tools/footprint/evmlib.wac', bound, '--js'], { cwd: wacuum })
  let js = fs.readFileSync(bound, 'utf8')
  const m = js.match(/const WASM = "([^"]*)";\n/)
  fs.writeFileSync(path.join(out, 'evmlib.wasm'), Buffer.from(m[1], 'base64'))
  // Everything up to the module's construction becomes "the module the driver compiled".
  const start = js.indexOf('const WASM = ')
  const end = js.indexOf('const $mod = new WebAssembly.Module(bytes);') + 'const $mod = new WebAssembly.Module(bytes);'.length
  js = js.slice(0, start) + 'const $mod = globalThis.__footprintModule;' + js.slice(end)
  fs.writeFileSync(path.join(out, 'evmlib.mjs'), js)
  fs.rmSync(bound)

  const opt = path.join(dist, 'wac-opt')
  fs.mkdirSync(opt, { recursive: true })
  sh(path.join(here, 'node_modules/.bin/wasm-opt'), ['-O3', '--enable-gc', '--enable-reference-types',
    '--enable-bulk-memory', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-mutable-globals',
    '--enable-multivalue', '--enable-exception-handling', '--enable-tail-call', '--enable-strings',
    path.join(out, 'evmlib.wasm'), '-o', path.join(opt, 'evmlib.wasm')])
  fs.copyFileSync(path.join(out, 'evmlib.mjs'), path.join(opt, 'evmlib.mjs'))
}

// ── wac's primitives alone (part 2): prims.wac, and a copy of it without ecrecover for the keccak-only size ──
{
  const out = path.join(dist, 'prims')
  fs.mkdirSync(out, { recursive: true })
  const full = fs.readFileSync(path.join(here, 'prims.wac'), 'utf8')
  const keccakOnly = full.replace(/import \{ ecrecover \}[^\n]*\n/, '').replace(/\nexport u8\[\] ecrecoverBytes[^\n]*\n/, '\n')
  const tmp = path.join(here, '.prims-keccak.wac')
  fs.writeFileSync(tmp, keccakOnly)
  for (const [name, src] of [['wac-keccak', tmp], ['wac-secp', path.join(here, 'prims.wac')]]) {
    const bound = path.join(out, name + '.bindgen.js')
    sh('wac', ['bindgen', src, bound, '--js'], { cwd: wacuum })
    let js = fs.readFileSync(bound, 'utf8')
    fs.writeFileSync(path.join(out, name + '.wasm'), Buffer.from(js.match(/const WASM = "([^"]*)";\n/)[1], 'base64'))
    const start = js.indexOf('const WASM = ')
    const end = js.indexOf('const $mod = new WebAssembly.Module(bytes);') + 'const $mod = new WebAssembly.Module(bytes);'.length
    fs.writeFileSync(path.join(out, name + '.mjs'), js.slice(0, start) + 'const $mod = globalThis.__footprintModule;' + js.slice(end))
    fs.rmSync(bound)
  }
  fs.rmSync(tmp)
}

// ── the native host's drivers: the tasks as wac programs, for the `wac` command's own V8 host ──
sh('wac', ['build', '--allow-read', 'tools/footprint/native.wac', '-o', 'tools/footprint/dist/native'], { cwd: wacuum })
sh('wac', ['build', 'tools/footprint/native-none.wac', '-o', 'tools/footprint/dist/native-none'], { cwd: wacuum })

// ── revm ──
if (!process.argv.includes('--skip-revm')) sh('sh', [path.join(here, 'revm-wasm/build.sh')])

// ── @ethereumjs ──
await esbuild.build({
  entryPoints: [path.join(here, 'engines/ejs.mjs')],
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
  outfile: path.join(dist, 'ejs/ejs.mjs'), logLevel: 'warning',
  define: { 'process.env.EJS_DEBUG': 'undefined' },
})

// The same bundle without the KZG trusted setup (blob transactions and point evaluation then fail): only to say
// how much of the bundle the setup is, since wacuum and revm embed just the one setup point they verify with.
await esbuild.build({
  entryPoints: [path.join(here, 'engines/ejs.mjs')],
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
  outfile: path.join(dist, 'ejs-nokzg/ejs.mjs'), logLevel: 'warning',
  define: { 'process.env.EJS_DEBUG': 'undefined' },
  plugins: [{ name: 'no-setup', setup(b) {
    b.onResolve({ filter: /trusted-setups/ }, () => ({ path: 'stub', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const trustedSetup = null' }))
  } }],
})

// ── the noble primitives, as a page would ship them for part 2 ──
await esbuild.build({
  stdin: { contents: `export { keccak_256 } from '@noble/hashes/sha3.js'; export { secp256k1 } from '@noble/curves/secp256k1.js'`,
    resolveDir: here },
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
  outfile: path.join(dist, 'noble/noble.mjs'), logLevel: 'warning',
})
for (const [name, src] of Object.entries({
  'noble-keccak': `export { keccak_256 } from '@noble/hashes/sha3.js'`,
  'noble-secp': `export { secp256k1 } from '@noble/curves/secp256k1.js'; export { keccak_256 } from '@noble/hashes/sha3.js'`,
  'ec-keccak': `export { keccak256 } from 'ethereum-cryptography/keccak.js'`,
  'ec-secp': `export { secp256k1 } from 'ethereum-cryptography/secp256k1.js'; export { keccak256 } from 'ethereum-cryptography/keccak.js'`,
})) {
  await esbuild.build({ stdin: { contents: src, resolveDir: here }, bundle: true, minify: true, format: 'esm',
    platform: 'browser', target: 'es2022', legalComments: 'none', outfile: path.join(dist, `prims/${name}.mjs`), logLevel: 'warning' })
}
console.log('built', fs.readdirSync(dist).join(' '))
