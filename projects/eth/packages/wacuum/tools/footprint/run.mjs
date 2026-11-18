// The whole comparison in one command (docs/footprint.md): build every engine, measure sizes, then run every
// measurement in its own fresh process (Node) or fresh browser (Chromium), `--repeat` times, and write
// dist/results.json and dist/results.md (the tables the report quotes).
//
//     wac task footprint                     from packages/wacuum; or, from tools/footprint:
//     node run.mjs [--repeat 3] [--skip-build] [--node-only] [--browser-only] [--engines a,b] [--tasks a,b]
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

const results = []
for (const runtime of ['node', 'chromium']) {
  if (runtime === 'node' && flag('--browser-only')) continue
  if (runtime === 'chromium' && flag('--node-only')) continue
  const script = path.join(here, runtime === 'node' ? 'measure-node.mjs' : 'measure-browser.mjs')
  for (const [engine, task] of runs) {
    for (let i = 0; i < repeat; i++) {
      process.stderr.write(`${runtime} ${engine} ${task} ${i + 1}/${repeat}\n`)
      const text = execFileSync('node', ['--max-old-space-size=8192', script, engine, task], { encoding: 'utf8', maxBuffer: 1 << 26 })
      const r = JSON.parse(text.trim().split('\n').pop())
      if (r.error) throw new Error(`${runtime} ${engine} ${task}: ${r.error}`)
      results.push({ ...r, where: runtime, rep: i })
    }
  }
}

fs.writeFileSync(path.join(dist, 'results.json'), JSON.stringify({ when: new Date().toISOString(), sizes, results }, null, 1))
execFileSync('node', [path.join(here, 'report.mjs')], { stdio: 'inherit' })
