// One measurement in a fresh Chromium: `node measure-browser.mjs <engine> <task>` prints one JSON line.
//
// Each run launches a new browser with a new profile, so nothing — no HTTP cache, no V8 code cache, no compiled
// wasm — survives from one run to the next, and the cold start is a first visit's. The page is served from
// localhost, so "load" is compile and instantiate (or parse and evaluate, for JavaScript), not the network.
//
// Memory, read after the task:
//   rendererPeakMiB   the renderer process's high-water RSS (VmHWM from /proc): all of the page, Blink and V8
//                     included, so compare against the `none` engine, which loads nothing
//   jsHeapUsedMiB     CDP's JSHeapUsedSize at that moment, after a forced GC: WasmGC objects live in this heap,
//                     so it is wacuum's live data; linear memory does not
//   linearMemoryMiB   the size of a linear-memory engine's (revm's) memory, which only grows: its peak
// (performance.measureUserAgentSpecificMemory would cover both, but headless Chromium does not offer it.)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// The Playwright this machine has preinstalled, with its Chromium; a CommonJS require finds it from anywhere, where
// an ES import would look only in this package's node_modules.
const { chromium } = createRequire(import.meta.url)('playwright')

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../fixtures/state_tests')
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.txt': 'text/plain' }

/** A static server for this directory, /fx/ being the state tests, with the headers cross-origin isolation needs. */
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = url.startsWith('/fx/') ? path.join(fixtures, url.slice(4)) : path.join(here, url)
    if (!file.startsWith(here) && !file.startsWith(fixtures)) { res.writeHead(403).end(); return }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
        'cache-control': 'no-store' })
      res.end(body)
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

export async function measure(engine, task) {
  const server = await serve()
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(`http://127.0.0.1:${server.address().port}/page.html?engine=${engine}&task=${task}`)
    await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 30 * 60 * 1000, polling: 100 })
    const out = await page.evaluate(() => window.__result)
    if (out.error) return out
    out.runtime = `chromium ${browser.version()}`
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    out.jsHeapUsedMiB = metrics.find((m) => m.name === 'JSHeapUsedSize').value / 2 ** 20
    const sys = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo')
    const peaks = sys.processInfo.filter((p) => p.type === 'renderer').map((p) => {
      const status = fs.readFileSync(`/proc/${p.id}/status`, 'utf8')
      return Number(status.match(/VmHWM:\s+(\d+)/)[1]) / 1024
    })
    out.rendererPeakMiB = Math.max(...peaks)
    out.renderers = peaks.length
    return out
  } finally {
    await browser.close()
    server.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [engine, task] = process.argv.slice(2)
  console.log(JSON.stringify(await measure(engine, task)))
}
