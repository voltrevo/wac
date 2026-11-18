// Browser entry for lc-helios.mjs: the query string gives `checkpoint`; lines go to #out, ending `[exit 0]`. The page's
// clock is pinned by the harness (browser.cjs --clock).
import { run } from './lc-helios.mjs';
const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
const line = (s) => { out.textContent += s + '\n'; };
run(q.get('base') || location.origin, q.get('checkpoint'), line)
  .then(() => line('[exit 0]'), (e) => { line('error ' + (e && e.message)); line('[exit 1]'); });
