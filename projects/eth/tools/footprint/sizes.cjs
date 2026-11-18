// Sizes for docs/footprint.md: for each named set of files, raw bytes, gzip (level 9) and brotli (quality 11), each
// file compressed alone (as a server would send it) and summed.
//
//     node sizes.cjs NAME=FILE[,FILE…] …                 prints one JSON object per set
const fs = require('fs');
const zlib = require('zlib');

for (const spec of process.argv.slice(2)) {
  const [name, list] = spec.split('=');
  let raw = 0, gz = 0, br = 0;
  const files = [];
  for (const f of list.split(',')) {
    const b = fs.readFileSync(f);
    const g = zlib.gzipSync(b, { level: 9 }).length;
    const r = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
    raw += b.length; gz += g; br += r;
    files.push({ file: f.split('/').slice(-2).join('/'), raw: b.length, gzip: g, brotli: r });
  }
  console.log(JSON.stringify({ name, raw, gzip: gz, brotli: br, files }));
}
