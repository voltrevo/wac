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

for (const w of wheres) {
  const evm = engines.filter((e) => has(e, 'cold') && e !== 'none')
  const baseline = w === 'node' ? pick(w, 'none', 'cold', (r) => r.peakRssMiB) : pick(w, 'none', 'cold', (r) => r.rendererPeakMiB)
  line()
  line(`### EVM, ${w}`)
  line()
  line(`Cold start is from before the engine's files are read to the first verified call's answer (balance.json). ` +
       `Peak memory is the ${w === 'node' ? 'process\'s maxRSS' : 'renderer\'s VmHWM'}; the same with nothing loaded is ${f(baseline)} MiB.`)
  line()
  line('| engine | load ms | cold → first result ms | peak MiB, cold | peak MiB, conformance | peak MiB, bench | conformance (85 files) ms | passed / failed |')
  line('|---|---:|---:|---:|---:|---:|---:|---:|')
  const mem = (e, t) => pick(w, e, t, (r) => (w === 'node' ? r.peakRssMiB : r.rendererPeakMiB))
  for (const e of evm) {
    const c = (k) => pick(w, e, 'conformance', (r) => r.conformance?.[k])
    line(`| ${e} | ${f(pick(w, e, 'cold', (r) => r.loadMs))} | ${f(pick(w, e, 'cold', (r) => r.coldMs))} | ${f(mem(e, 'cold'))} | ${f(mem(e, 'conformance'))} | ${f(mem(e, 'bench'))} | ${f(c('ms'), 0)} | ${f(c('passed'), 0)} / ${f(c('failed'), 0)} |`)
  }
  line()
  line('| engine | arith Mgas/s | keccak Mgas/s | sstore Mgas/s | ecrecover Mgas/s | balance call ms | quote call ms | linear memory MiB |')
  line('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const e of evm) {
    const b = (n) => pick(w, e, 'bench', (r) => r.bench?.[n].mgasps)
    const c = (n) => pick(w, e, 'call', (r) => r.call?.[n].ms)
    line(`| ${e} | ${f(b('arith'))} | ${f(b('keccak'))} | ${f(b('sstore'))} | ${f(b('ecrecover'))} | ${f(c('balance'), 3)} | ${f(c('quote'), 3)} | ${f(pick(w, e, 'bench', (r) => r.linearMemoryMiB))} |`)
  }
  line()
  line(`### Primitives, ${w}`)
  line()
  line('| engine | cold → first hash ms | keccak256 32 B /s | keccak256 1 KiB /s | ecrecover /s | peak MiB |')
  line('|---|---:|---:|---:|---:|---:|')
  for (const e of engines.filter((e) => has(e, 'prims'))) {
    const p = (k) => pick(w, e, 'prims', (r) => r.prims?.[k])
    line(`| ${e} | ${f(pick(w, e, 'prims', (r) => r.coldMs))} | ${f(p('keccak32'), 0)} | ${f(p('keccak1k'), 0)} | ${f(p('ecrecover'), 0)} | ${f(pick(w, e, 'prims', (r) => (w === 'node' ? r.peakRssMiB : r.rendererPeakMiB)))} |`)
  }
}
line()
line('Spread (min–max over the repeats) of the throughput figures:')
line()
for (const w of wheres) for (const e of engines.filter((e) => has(e, 'bench'))) {
  const parts = ['arith', 'keccak', 'sstore', 'ecrecover'].map((n) => { const r = range(w, e, 'bench', (x) => x.bench?.[n].mgasps); return `${n} ${f(r?.[0])}–${f(r?.[1])}` })
  line(`- ${w} ${e}: ${parts.join(', ')}`)
}
fs.writeFileSync(path.join(here, 'dist/results.md'), out.join('\n') + '\n')
console.log(out.join('\n'))
