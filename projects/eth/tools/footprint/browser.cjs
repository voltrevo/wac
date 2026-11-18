// The browser side of docs/footprint.md: open a harness page in Playwright's Chromium, as a first visit (a fresh
// context: empty HTTP cache, no compiled code cached) and then as a second visit in the same context (warm), and
// record for each:
//   - first result: ms from navigation start to the page printing `result …` (a MutationObserver installed before
//     anything loads records performance.now() then);
//   - the page's own phase lines (fetch, verify);
//   - peak memory: the resident set (RSS) of Chromium's renderer processes, read from /proc every 20 ms from just
//     before navigation to the end of the run, less the same peak for a blank page in a fresh context. A page and its
//     workers, the JS heap, wasm memories and compiled code all live in the renderer, so this counts all of them.
//     (performance.measureUserAgentSpecificMemory is not exposed in this headless Chromium.)
//
//     node browser.cjs URL [RUNS] [--clock MS]       prints one JSON object per run
//
// --clock moves the page's Date (Date.now and new Date(), nothing else: performance.now and timers stay real, so the
// timings are not affected) to MS since the epoch, for a client that checks the data's age against the wall clock.
const { chromium } = require('playwright');
const fs = require('fs');

/** Total RSS, in bytes, of the processes descended from `root` (this script) whose command line says `--type=renderer`. */
function rendererRss(root) {
  let total = 0;
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (!cmd.includes('--type=renderer')) continue;
      const status = fs.readFileSync(`/proc/${d}/status`, 'utf8');
      const ppidChain = (pid) => { for (let p = pid, n = 0; p > 1 && n < 10; n++) { if (p === root) return true;
        p = Number((fs.readFileSync(`/proc/${p}/status`, 'utf8').match(/PPid:\s+(\d+)/) || [])[1] || 0); } return false; };
      if (!ppidChain(Number(d))) continue;
      total += Number(status.match(/VmRSS:\s+(\d+)/)[1]) * 1024;
    } catch (e) { /* gone */ }
  }
  return total;
}

function sampler(root) {
  let peak = 0;
  const t = setInterval(() => { peak = Math.max(peak, rendererRss(root)); }, 20);
  return () => { clearInterval(t); return Math.max(peak, rendererRss(root)); };
}

const args = process.argv.slice(2);
const url = args[0];
const runs = Number(args[1] || 3);
const clockAt = args.includes('--clock') ? Number(args[args.indexOf('--clock') + 1]) : null;

const observe = () => {
  window.__marks = {};
  const look = () => {
    const out = document.getElementById('out');
    if (!out) return;
    const t = out.textContent;
    if (!window.__marks.result && /(^|\n)result /.test(t)) window.__marks.result = performance.now();
    if (!window.__marks.exit && t.includes('[exit')) window.__marks.exit = performance.now();
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
};

async function measure(page, label, root) {
  const stop = sampler(root);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__marks && window.__marks.exit, null, { timeout: 300000, polling: 50 });
  const r = await page.evaluate(async () => {
    const out = document.getElementById('out').textContent;
    return {
      out,
      firstResultMs: window.__marks.result,
    };
  });
  const peak = stop();
  const phases = {};
  for (const m of r.out.matchAll(/phase (\w+) ([0-9.]+)/g)) (phases[m[1]] ||= []).push(Number(m[2]));
  const result = (r.out.match(/result (\S+)/) || [])[1] || null;
  return { label, firstResultMs: r.firstResultMs && Math.round(r.firstResultMs), phases, result,
           peakRendererRssBytes: peak,
           wallMs: Date.now() - t0, exit: (r.out.match(/\[exit (\d+)\]/) || [])[1] };
}

(async () => {
  const browser = await chromium.launch();
  console.error(`chromium ${browser.version()}`);
  const root = process.pid;
  for (let i = 0; i < runs; i++) {
    // The baseline: a blank page's renderer, in its own fresh context.
    const blank = await browser.newContext();
    const bp = await blank.newPage();
    const stopBlank = sampler(root);
    await bp.goto('about:blank');
    await bp.waitForTimeout(300);
    const base = stopBlank();
    await blank.close();
    console.log(JSON.stringify({ label: 'blank', peakRendererRssBytes: base }));
    const context = await browser.newContext();
    if (clockAt) await context.addInitScript((at) => {
      const Real = Date;
      const off = at - Real.now();
      class Pinned extends Real {
        constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
        static now() { return Real.now() + off; }
      }
      globalThis.Date = Pinned;
    }, clockAt);
    await context.addInitScript(observe);
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
    console.log(JSON.stringify(await measure(page, 'cold', root)));
    console.log(JSON.stringify(await measure(page, 'warm', root)));
    await context.close();
  }
  await browser.close();
})();
