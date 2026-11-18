// Browser entry for lc-lodestar.mjs: the page's query string gives `base`, `checkpoint`, `now` and `repeat`; lines go
// to #out, ending `[exit 0]`.
import { run } from './lc-lodestar.mjs';
const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
const line = (s) => { out.textContent += s + '\n'; };
run(q.get('base') || location.origin, q.get('checkpoint'), Number(q.get('now')), Number(q.get('repeat') || 1), line, q.get('mode') === 'finalized')
  .then(() => line('[exit 0]'), (e) => { line('error ' + (e && e.message)); line('[exit 1]'); });
