// The work each measurement does, the same in Node and in the page. Every function takes the engine's API (as
// engines/load.mjs answers it) and `read`, and answers plain numbers. Every engine call is awaited: @ethereumjs
// answers Promises, and awaiting a plain value costs the others a microtask, which is nothing at these scales.
//
// Timing is wall clock (performance.now()). A repeated measurement reports the median of its runs.

export const BENCH = ['arith', 'keccak', 'sstore', 'ecrecover']
export const CALLS = ['balance', 'quote']

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1] }

/** The first result: what a cold start ends with. An EVM engine verifies a call; a primitive hashes one word. */
export async function first(api, read, files) {
  if (api.verifiedCall) {
    const r = await api.verifiedCall(await read(files.call('balance')))
    if (!r.startsWith('ok ')) throw new Error(r)
    return r
  }
  return api.keccak(new Uint8Array(32))
}

/** The conformance subset: every file once, totals. */
export async function conformance(api, read, files) {
  const inputs = []
  for (const [f, fork] of files.subset) inputs.push([await read(f), fork])
  const t0 = performance.now()
  let passed = 0, failed = 0, gas = 0
  for (const [bytes, fork] of inputs) {
    const [p, fl, g] = (await api.runStateTests(bytes, fork)).split(' ').map(Number)
    passed += p; failed += fl; gas += g
  }
  return { passed, failed, gas, ms: performance.now() - t0 }
}

/** One throughput workload: a warm-up run, then `runs` timed ones. */
export async function bench(api, read, files, name, runs = 3) {
  const bytes = await read(files.bench(name))
  const once = async () => {
    const t0 = performance.now()
    const r = await api.runStateTests(bytes, 'Prague')
    const ms = performance.now() - t0
    const [p, , g] = r.split(' ').map(Number)
    if (p !== 1) throw new Error(`${name}: ${r}`)
    return { ms, gas: g }
  }
  await once()
  const rs = []
  for (let i = 0; i < runs; i++) rs.push(await once())
  const ms = median(rs.map((r) => r.ms))
  return { ms, gas: rs[0].gas, mgasps: rs[0].gas / ms / 1000 }
}

/** One verified call, warm: `runs` calls after five, each from the fixture's bytes (parsing and proofs included). */
export async function call(api, read, files, name, runs = 50) {
  const bytes = await read(files.call(name))
  const expect = JSON.parse(new TextDecoder().decode(bytes)).expect
  let answer
  for (let i = 0; i < 5; i++) answer = await api.verifiedCall(bytes)
  const [okE, outE] = expect.split(' ')
  const [okA, outA, gasA] = answer.split(' ')
  if (okA !== 'ok' || outA !== outE) throw new Error(`${name}: answered ${answer}, @ethereumjs ${expect}`)
  const times = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await api.verifiedCall(bytes)
    times.push(performance.now() - t0)
  }
  return { ms: median(times), gas: Number(gasA) }
}

/** ops/s of `f` over about `budget` ms, after a warm-up of the same length. */
function rate(f, budget = 1000) {
  for (const end = performance.now() + budget / 2; performance.now() < end;) f()
  let n = 0
  const t0 = performance.now()
  let t = t0
  while (t - t0 < budget) { for (let i = 0; i < 64; i++) f(); n += 64; t = performance.now() }
  return n / ((t - t0) / 1000)
}

/** Primitives: keccak256 of 32 bytes and of 1 KiB, and ecrecover, each as ops/s; checked against known answers. */
export async function prims(api, ecInput, ecAddress) {
  const w32 = new Uint8Array(32).fill(7), k1 = new Uint8Array(1024).fill(7)
  const out = { keccak32: rate(() => api.keccak(w32)), keccak1k: rate(() => api.keccak(k1)) }
  if (api.ecrecoverBytes) {
    const got = Array.from(api.ecrecoverBytes(ecInput), (b) => b.toString(16).padStart(2, '0')).join('')
    if (got !== ecAddress) throw new Error(`ecrecover answered ${got}, want ${ecAddress}`)
    out.ecrecover = rate(() => api.ecrecoverBytes(ecInput))
  }
  return out
}
