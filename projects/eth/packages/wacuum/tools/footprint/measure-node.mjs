// One measurement in a fresh Node process: `node measure-node.mjs <engine> <task>` prints one JSON line.
//
//   cold        load the engine and produce its first result (tasks.first); nothing else, so the process's peak
//               RSS is the engine's resting footprint plus one small call
//   conformance the 85-file subset (subset.txt)
//   bench       the four throughput workloads
//   call        the two verified calls, warm
//   prims       keccak256 and ecrecover rates
//
// Every task starts cold, so `coldMs` is in every line. `peakRssMiB` is the process's high-water RSS
// (getrusage's maxrss), which includes Node itself: compare against the `none` engine, which loads nothing.

const t0 = performance.now()
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load } from './engines/load.mjs'
import * as tasks from './tasks.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../fixtures/state_tests')
const read = async (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(here, 'dist', p))
const files = {
  subset: fs.readFileSync(path.join(here, 'subset.txt'), 'utf8').trim().split('\n')
    .map((f) => [path.join(fixtures, f), { cancun: 'Cancun', prague: 'Prague', osaka: 'Osaka' }[f.split('/')[0]]]),
  bench: (n) => path.join(here, 'fixtures/bench', n + '.json'),
  call: (n) => path.join(here, 'fixtures/call', n + '.json'),
}
const hexBytes = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16))

const [engine, task] = process.argv.slice(2)
const out = { engine, task, runtime: `node ${process.version}` }
if (engine !== 'none') {
  const api = globalThis.__api = await load(engine, read, pathToFileURL(path.join(here, 'dist')).href + '/')
  out.loadMs = performance.now() - t0
  await tasks.first(api, read, files)
  out.coldMs = performance.now() - t0
  out.sinceProcessStartMs = performance.now() // performance's origin is the process's start
  if (task === 'conformance') out.conformance = await tasks.conformance(api, read, files)
  if (task === 'bench') { out.bench = {}; for (const b of tasks.BENCH) out.bench[b] = await tasks.bench(api, read, files, b) }
  if (task === 'call') { out.call = {}; for (const c of tasks.CALLS) out.call[c] = await tasks.call(api, read, files, c) }
  if (task === 'prims') {
    const ec = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/ecrecover.json'), 'utf8'))
    out.prims = await tasks.prims(api, hexBytes(ec.input), ec.address)
  }
}
if (globalThis.__api?.linearMemory) out.linearMemoryMiB = globalThis.__api.linearMemory.buffer.byteLength / 2 ** 20
out.peakRssMiB = process.resourceUsage().maxRSS / 1024
console.log(JSON.stringify(out))
