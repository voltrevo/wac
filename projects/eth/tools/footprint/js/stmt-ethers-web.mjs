// Browser entry for stmt-js.mjs with ethers: `?repeat=N`; lines go to #out, ending `[exit 0]`.
import { run } from './stmt-js.mjs';
import { recover } from './stmt-ethers.mjs';
const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
const line = (s) => { out.textContent += s + '\n'; };
run(location.origin, recover, Number(q.get('repeat') || 10), line).then(() => line('[exit 0]'), (e) => { line('error ' + (e && e.message)); line('[exit 1]'); });
