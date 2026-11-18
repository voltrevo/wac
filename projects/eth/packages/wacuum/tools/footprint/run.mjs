// The whole comparison in one command (docs/footprint.md): build every engine, measure sizes, then run every
// measurement in its own fresh process (the `wac` command's host, Node) or fresh browser (Chromium), `--repeat`
// times, and write
// dist/results.json and dist/results.md (the tables the report quotes).
//
//     wac task footprint                     from packages/wacuum; or, from tools/footprint:
//     node run.mjs [--repeat 3] [--skip-build] [--node-only] [--browser-only] [--engines a,b] [--tasks a,b] [--merge]
//
// Needs: `wac` on PATH (built from the pin in wac.lock), the execution-spec-tests fixtures
// (`wac task fixtures`), `npm ci` here, Rust with wasm32-unknown-unknown and wasm-bindgen-cli 0.2.100 for revm.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ENGINES } from './engines/load.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1] }
const flag = (name) => process.argv.includes(name)
const repeat = Number(arg('--repeat', 3))

if (!flag('--skip-build')) execFileSync('node', [path.join(here, 'build.mjs')], { stdio: 'inherit' })

// ── sizes: what a page downloads for each engine, raw, gzip -9 and brotli -q 11 ──
const sizes = {}
for (const [name, e] of Object.entries(ENGINES)) {
  const parts = [e.glue, e.wasm].filter(Boolean).map((f) => fs.readFileSync(path.join(dist, f)))
  const total = (f) => parts.reduce((n, b) => n + f(b), 0)
  sizes[name] = {
    files: [e.glue, e.wasm].filter(Boolean),
    raw: total((b) => b.length),
    gzip: total((b) => zlib.gzipSync(b, { level: 9 }).length),
    brotli: total((b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length),
    wasmRaw: e.wasm ? fs.statSync(path.join(dist, e.wasm)).size : 0,
  }
}

// ── runs ──
const EVM = ['wac', 'wac-opt', 'revm-s', 'revm-3', 'ejs']
const PRIMS = ['wac-keccak', 'wac-secp', 'noble-keccak', 'noble-secp', 'ec-keccak', 'ec-secp', 'wac', 'revm-3']
const plan = []
for (const e of ['none', ...EVM]) for (const t of ['cold', 'conformance', 'bench', 'call']) if (e !== 'none' || t === 'cold') plan.push([e, t])
for (const e of PRIMS) plan.push([e, 'prims'])
const onlyEngines = arg('--engines', null)?.split(','), onlyTasks = arg('--tasks', null)?.split(',')
const runs = plan.filter(([e, t]) => (!onlyEngines || onlyEngines.includes(e) || e === 'none') && (!onlyTasks || onlyTasks.includes(t)))

// The native host runs wac alone: its own baseline, then evmlib.wac called directly by native.wac.
const nativeRuns = [['none', 'cold'], ...['cold', 'conformance', 'bench', 'call', 'prims'].map((t) => ['wac-native', t])]
  .filter(([e, t]) => (!onlyEngines || onlyEngines.includes(e) || onlyEngines.includes('wac') || e === 'none') && (!onlyTasks || onlyTasks.includes(t)))
const tests = path.resolve(here, '../../fixtures/state_tests')
const command = (runtime, engine, task) => {
  if (runtime === 'native') {
    return engine === 'none' ? ['wac', path.join(dist, 'native-none.wasm')]
      : ['wac', path.join(dist, 'native.wasm'), task, here, tests]
  }
  const script = path.join(here, runtime === 'node' ? 'measure-node.mjs' : 'measure-browser.mjs')
  return ['node', '--max-old-space-size=8192', script, engine, task]
}

const results = []
for (const runtime of ['native', 'node', 'chromium']) {
  if (runtime !== 'chromium' && flag('--browser-only')) continue
  if (runtime === 'chromium' && flag('--node-only')) continue
  for (const [engine, task] of runtime === 'native' ? nativeRuns : runs) {
    for (let i = 0; i < repeat; i++) {
      process.stderr.write(`${runtime} ${engine} ${task} ${i + 1}/${repeat}\n`)
      // Node and the native host run under measure-proc.py, which adds the process's wall time and peak RSS.
      const argv = command(runtime, engine, task)
      const text = runtime === 'chromium'
        ? execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 1 << 26 })
        : execFileSync('python3', [path.join(here, 'measure-proc.py'), ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 })
      const r = JSON.parse(text.trim().split('\n').pop())
      if (r.error) throw new Error(`${runtime} ${engine} ${task}: ${r.error}`)
      results.push({ ...r, where: runtime, rep: i })
    }
  }
}

// --merge keeps an earlier results.json's runs of whatever this invocation did not run (by runtime, engine, task).
let all = results
const prior = path.join(dist, 'results.json')
if (flag('--merge') && fs.existsSync(prior)) {
  const key = (r) => `${r.where} ${r.engine} ${r.task}`
  const ran = new Set(results.map(key))
  all = [...JSON.parse(fs.readFileSync(prior, 'utf8')).results.filter((r) => !ran.has(key(r))), ...results]
}
fs.writeFileSync(prior, JSON.stringify({ when: new Date().toISOString(), sizes, results: all }, null, 1))
execFileSync('node', [path.join(here, 'report.mjs')], { stdio: 'inherit' })
