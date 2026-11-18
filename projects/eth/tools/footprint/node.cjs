// The Node side of docs/footprint.md: run a command, as a fresh process each time, and record
//   - first result: ms from spawning the process to its printing `result …` (cold: process start, module load and
//     compile, init, fetch, verify);
//   - its own phase lines (fetch, verify, …);
//   - peak RSS: the process's VmHWM (resident high-water mark), read from /proc as it runs.
//
//     node node.cjs LABEL RUNS -- COMMAND ARGS…        prints one JSON object per run
const { spawn } = require('child_process');
const fs = require('fs');

const argv = process.argv.slice(2);
const label = argv[0];
const runs = Number(argv[1]);
const cmd = argv.slice(argv.indexOf('--') + 1);

function hwm(pid) {
  try { return Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmHWM:\s+(\d+)/)[1]) * 1024; } catch (e) { return 0; }
}

function once() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', first = null, peak = 0;
    const poll = setInterval(() => { peak = Math.max(peak, hwm(child.pid)); }, 5);
    child.stdout.on('data', (d) => {
      peak = Math.max(peak, hwm(child.pid));
      out += d;
      if (first === null && /(^|\n)result /.test(out)) first = Number(process.hrtime.bigint() - t0) / 1e6;
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => {
      clearInterval(poll);
      const phases = {};
      for (const m of out.matchAll(/phase (\w+) ([0-9.]+)/g)) (phases[m[1]] ||= []).push(Number(m[2]));
      resolve({ label, firstResultMs: first && Math.round(first), phases, result: (out.match(/result (\S+)/) || [])[1] || null,
                peakRssBytes: peak, exit: code, stderr: code ? err.slice(-400) : undefined });
    });
  });
}

(async () => {
  for (let i = 0; i < runs; i++) console.log(JSON.stringify(await once()));
})();
