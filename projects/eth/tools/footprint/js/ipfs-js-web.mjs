// Browser entry for ipfs-js.mjs: `?repeat=N&hash=platform|noble`; lines go to #out, ending `[exit 0]`.
import { run } from './ipfs-js.mjs';
const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
const line = (s) => { out.textContent += s + '\n'; };
run(location.origin, Number(q.get('repeat') || 5), line, q.get('hash') || 'platform').then(() => line('[exit 0]'), (e) => { line('error ' + (e && e.message)); line('[exit 1]'); });
