// dist/results.json → dist/results.md: the tables docs/footprint.md quotes. Every figure is the median of the
// repeated runs (each in a fresh process or browser); the spread is given as min–max where it matters.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { when, sizes, results } = JSON.parse(fs.readFileSync(path.join(here, 'dist/results.json'), 'utf8'))

const med = (xs) => { const s = xs.filter((x) => x !== undefined).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : undefined }
const pick = (where, engine, task, f) => med(results.filter((r) => r.where === where && r.engine === engine && r.task === task).map(f))
const range = (where, engine, task, f) => {
  const xs = results.filter((r) => r.where === where && r.engine === engine && r.task === task).map(f).filter((x) => x !== undefined)
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : undefined
}
const kb = (n) => (n / 1024).toFixed(0) + ' KiB'
const f = (x, d = 1) => (x === undefined ? '–' : x.toFixed(d))
const engines = [...new Set(results.map((r) => r.engine))]
const has = (e, t) => results.some((r) => r.engine === e && r.task === t)
const wheres = [...new Set(results.map((r) => r.where))]
const runtimes = Object.fromEntries(wheres.map((w) => [w, results.find((r) => r.where === w).runtime]))

const out = []
const line = (s = '') => out.push(s)
line(`Measured ${when}; ${Object.entries(runtimes).map(([w, r]) => `${w}: ${r}`).join('; ')}.`)
line()
line('### Size (what a page downloads: glue + wasm)')
line()
line('| engine | files | raw | gzip -9 | brotli 11 |')
line('|---|---|---:|---:|---:|')
for (const [e, s] of Object.entries(sizes)) line(`| ${e} | ${s.files.join(' + ')} | ${kb(s.raw)} | ${kb(s.gzip)} | ${kb(s.brotli)} |`)

// Outside a browser the rows mix two runtimes: wac on its own host (the primary wac row) and every engine,
// wac's module included and labelled, under Node. In Chromium every engine runs in the same page.
const groups = [
  { title: 'outside a browser', rows: [['native', 'wac-native', 'wac — native `wac` host (V8)'],
    ...['wac', 'wac-opt', 'revm-s', 'revm-3', 'ejs'].map((e) => ['node', e, e.startsWith('wac') ? `${e} — wac's wasm under Node` : `${e} — Node`])],
    base: [['native', 'wac host'], ['node', 'Node']] },
  { title: 'Chromium', rows: ['wac', 'wac-opt', 'revm-s', 'revm-3', 'ejs'].map((e) => ['chromium', e, e]), base: [['chromium', 'renderer']] },
]
const peak = (w, e, t) => pick(w, e, t, (r) => (w === 'chromium' ? r.rendererPeakMiB : r.peakRssMiB))
for (const g of groups) {
  const rows = g.rows.filter(([w, e]) => has(e, 'cold') && results.some((r) => r.where === w && r.engine === e))
  if (rows.length === 0) continue
  line()
  line(`### EVM, ${g.title}`)
  line()
  line('Cold start is from before the engine is read to the first verified call\'s answer (balance.json); process wall ' +
       'is the whole process, exec to exit, for that alone. Peak memory is the process\'s maxrss (Chromium: the ' +
       'renderer\'s VmHWM). With nothing loaded: ' + g.base.map(([w, n]) => `${n} ${f(peak(w, 'none', 'cold'))} MiB` +
       (w !== 'chromium' ? `, ${f(pick(w, 'none', 'cold', (r) => r.procWallMs), 0)} ms process wall` : '')).join('; ') + '.')
  line()
  line('| engine | cold → first result ms | process wall ms | peak MiB: cold | conformance | bench | call | conformance (85 files) ms | passed / failed |')
  line('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const [w, e, label] of rows) {
    const c = (k) => pick(w, e, 'conformance', (r) => r.conformance?.[k])
    line(`| ${label} | ${f(pick(w, e, 'cold', (r) => r.coldMs))} | ${f(pick(w, e, 'cold', (r) => r.procWallMs), 0)} | ${f(peak(w, e, 'cold'))} | ${f(peak(w, e, 'conformance'))} | ${f(peak(w, e, 'bench'))} | ${f(peak(w, e, 'call'))} | ${f(c('ms'), 0)} | ${f(c('passed'), 0)} / ${f(c('failed'), 0)} |`)
  }
  line()
  line('| engine | arith Mgas/s | keccak Mgas/s | sstore Mgas/s | ecrecover Mgas/s | balance call ms | quote call ms | linear memory MiB |')
  line('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const [w, e, label] of rows) {
    const b = (n) => pick(w, e, 'bench', (r) => r.bench?.[n].mgasps)
    const c = (n) => pick(w, e, 'call', (r) => r.call?.[n].ms)
    line(`| ${label} | ${f(b('arith'))} | ${f(b('keccak'))} | ${f(b('sstore'))} | ${f(b('ecrecover'))} | ${f(c('balance'), 3)} | ${f(c('quote'), 3)} | ${f(pick(w, e, 'bench', (r) => r.linearMemoryMiB))} |`)
  }
}
for (const w of wheres) {
  const prim = engines.filter((e) => results.some((r) => r.where === w && r.engine === e && r.task === 'prims'))
  if (prim.length === 0) continue
  line()
  line(`### Primitives, ${w}`)
  line()
  line('| engine | cold → first result ms | keccak256 32 B /s | keccak256 1 KiB /s | ecrecover /s | peak MiB |')
  line('|---|---:|---:|---:|---:|---:|')
  for (const e of prim) {
    const p = (k) => pick(w, e, 'prims', (r) => r.prims?.[k])
    line(`| ${e} | ${f(pick(w, e, 'prims', (r) => r.coldMs))} | ${f(p('keccak32'), 0)} | ${f(p('keccak1k'), 0)} | ${f(p('ecrecover'), 0)} | ${f(peak(w, e, 'prims'))} |`)
  }
}
line()
line('Spread (min–max over the repeats) of the throughput figures:')
line()
for (const w of wheres) for (const e of engines.filter((e) => results.some((r) => r.where === w && r.engine === e && r.task === 'bench'))) {
  const parts = ['arith', 'keccak', 'sstore', 'ecrecover'].map((n) => { const r = range(w, e, 'bench', (x) => x.bench?.[n].mgasps); return `${n} ${f(r?.[0])}–${f(r?.[1])}` })
  line(`- ${w} ${e}: ${parts.join(', ')}`)
}
fs.writeFileSync(path.join(here, 'dist/results.md'), out.join('\n') + '\n')
console.log(out.join('\n'))
