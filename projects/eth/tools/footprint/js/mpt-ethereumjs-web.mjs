// Browser entry for mpt-ethereumjs.mjs: `?repeat=N`; lines go to #out, ending `[exit 0]`.
import { run } from './mpt-ethereumjs.mjs';
const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
const line = (s) => { out.textContent += s + '\n'; };
run(location.origin, Number(q.get('repeat') || 200), line).then(() => line('[exit 0]'), (e) => { line('error ' + (e && e.message)); line('[exit 1]'); });
