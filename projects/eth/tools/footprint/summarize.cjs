// The tables docs/footprint.md quotes, from OUT/results/*.jsonl (run.sh). Medians throughout; the first verify of a
// fresh process is the cold one, and in an x10 run the median of the 2nd–10th is the warm one.
//
//     node summarize.cjs RESULTS-DIR > report.md
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const read = (f) => fs.existsSync(path.join(dir, f))
  ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const med = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const kb = (n) => n == null ? '–' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
const mb = (n) => n == null ? '–' : (n / 1048576).toFixed(0) + ' MB';
const ms = (n) => n == null ? '–' : (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ms';
const out = [];
const line = (s = '') => out.push(s);

const sizes = read('sizes.jsonl');
if (sizes.length) {
  line('### Sizes'); line();
  line('| what | raw | gzip -9 | brotli -q 11 |'); line('| --- | ---: | ---: | ---: |');
  for (const s of sizes) line(`| ${s.name} | ${kb(s.raw)} | ${kb(s.gzip)} | ${kb(s.brotli)} |`);
  line();
}

function lcTable(file, title, browser) {
  const rows = read(file);
  if (!rows.length) return;
  const by = {};
  for (const r of rows) {
    const name = browser ? r.client : r.label;
    if (r.label === 'blank') { (by.__blank ||= []).push(r.peakRendererRssBytes); continue; }
    (by[name] ||= []).push(r);
  }
  const blank = med(by.__blank || []) || 0;
  line(`### ${title}`); line();
  if (browser) {
    line(`Chromium ${'(Playwright)'}; a blank page's renderer peaks at ${mb(blank)}, subtracted below.`); line();
    line('| client | first result, cold | first result, warm | fetch | verify (first) | one update | peak renderer RSS above blank | result |');
  } else {
    line('| client | first result (fresh process) | fetch | verify (first) | one update | peak RSS | result |');
  }
  line(browser ? '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |' : '| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  const names = Object.keys(by).filter((n) => n !== '__blank' && !/ (x10|finalized)$/.test(n));
  for (const n of names) {
    const rs = by[n];
    const cold = rs.filter((r) => r.label !== 'warm');
    const warm = rs.filter((r) => r.label === 'warm');
    const verifyOf = (r) => (r.phases.verify || r.phases.sync || [null])[0];
    const fetchOf = (r) => (r.phases.fetch || [null])[0];
    // One update: the full run less the run without the optimistic update (the same process shape otherwise), from
    // the warm x10 runs where there are any: the median of verifies 2–10, full minus finalized.
    const x10 = (by[n + ' x10'] || [])[0];
    const fin = by[n + ' finalized'] || [];
    const warmVerify = x10 ? med(x10.phases.verify.slice(1)) : null;
    const finVerify = med(fin.filter((r) => r.label !== 'warm').map(verifyOf));
    const fullVerify = med(cold.map(verifyOf));
    const oneUpdate = fullVerify != null && finVerify != null ? fullVerify - finVerify : null;
    const peak = browser ? med(cold.map((r) => r.peakRendererRssBytes - blank)) : med(cold.map((r) => r.peakRssBytes));
    const result = (cold.find((r) => r.result) || {}).result || '–';
    const verifyCell = `${ms(fullVerify)}${warmVerify != null ? ` (warm ${ms(warmVerify)})` : ''}`;
    if (browser) {
      line(`| ${n} | ${ms(med(cold.map((r) => r.firstResultMs)))} | ${ms(med(warm.map((r) => r.firstResultMs)))} | ${ms(med(cold.map(fetchOf)))} | ${verifyCell} | ${ms(oneUpdate)} | ${mb(peak)} | \`${result.slice(0, 10)}…\` |`);
    } else {
      line(`| ${n} | ${ms(med(cold.map((r) => r.firstResultMs)))} | ${ms(med(cold.map(fetchOf)))} | ${verifyCell} | ${ms(oneUpdate)} | ${mb(peak)} | \`${result.slice(0, 10)}…\` |`);
    }
  }
  line();
}
lcTable('lc-node.jsonl', 'Light client, Node', false);
const bls = read('bls-node.jsonl');
if (bls.length) {
  line('### BLS12-381, Node (median of 3, mainnet keys)'); line();
  line('| library | 512 keys decompressed and checked | aggregate of 512 | one verify |'); line('| --- | ---: | ---: | ---: |');
  for (const r of bls) line(`| ${r.label} | ${ms(r.phases.keys[0])} | ${ms(r.phases.aggregate[0])} | ${ms(r.phases.verify[0])} |`);
  line();
}
lcTable('lc-browser.jsonl', 'Light client, Chromium', true);

for (const f of fs.readdirSync(dir).filter((f) => /^(mpt|ipfs|stmt)-/.test(f))) {
  const rows = read(f);
  if (!rows.length) continue;
  line(`### ${f.replace('.jsonl', '')}`); line();
  line('| client | first result | per operation | peak memory | result |'); line('| --- | ---: | ---: | ---: | --- |');
  const by = {};
  for (const r of rows) (by[r.client || r.label] ||= []).push(r);
  for (const [n, rs] of Object.entries(by)) {
    if (n === 'blank') continue;
    const cold = rs.filter((r) => r.label !== 'warm');
    const per = med(cold.map((r) => (r.phases.per || [null])[0]));
    const peak = med(cold.map((r) => r.peakRssBytes || r.peakRendererRssBytes));
    line(`| ${n} | ${ms(med(cold.map((r) => r.firstResultMs)))} | ${per == null ? '–' : per.toFixed(3) + ' ms'} | ${mb(peak)} | \`${String((cold.find((r) => r.result) || {}).result || '–').slice(0, 14)}\` |`);
  }
  line();
}
process.stdout.write(out.join('\n') + '\n');
