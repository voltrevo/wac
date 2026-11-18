// The footprint harness's one server (docs/footprint.md): recorded mainnet light-client data over the beacon REST API
// (packages/lightclient/test/mainnet, as tools/beacon-replay.mjs serves it), and the harness's static pages, all from
// one origin and cross-origin isolated (COOP/COEP), which wac's browser host needs for its synchronous waits.
//
//     node tools/footprint/serve.mjs PORT STATIC-DIR [JSON-DIR]
//
// A request that does not accept application/octet-stream is answered from JSON-DIR (js/mkjson.mjs: the same values
// as the API's JSON), as a beacon node answers a client that asks for JSON.
//
// Every client is given exactly the same bytes. Requests are logged to stderr, so a run can show what each client
// asked for.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '../../packages/lightclient/test/mainnet');
const [port, root] = [Number(process.argv[2] || 8940), path.resolve(process.argv[3] || '.')];
const jsonDir = process.argv[4] && path.resolve(process.argv[4]);
const CHECKPOINT = '0xa8356934e2fba13cb82917ea04203c75ca84bb735cefe3cf2f35976628e1e937';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                '.json': 'application/json', '.css': 'text/css' };

function headers(extra) {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Eth-Consensus-Version',
           'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
           'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store', ...extra };
}
// The execution RPC some clients insist on (Helios resolves the finalized and latest blocks' bodies and checks their
// hashes): the blocks in data/blocks (mainnet's, with full transactions, fetched once by eth_getBlockByHash) by hash
// or number, and the chain id. Anything else is a JSON-RPC error, logged, so a report can say what a client asked for.
const blocksDir = path.join(here, 'data/blocks');
const blocks = fs.readdirSync(blocksDir).map((f) => JSON.parse(fs.readFileSync(path.join(blocksDir, f), 'utf8')).result);
function execution(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const one = (q) => {
      process.stderr.write(`  rpc ${q.method} ${JSON.stringify(q.params || []).slice(0, 120)}\n`);
      const ok = (result) => ({ jsonrpc: '2.0', id: q.id, result });
      if (q.method === 'eth_chainId') return ok('0x1');
      const b = blocks.find((x) => (q.method === 'eth_getBlockByHash' && String(q.params[0]).toLowerCase() === x.hash)
                                   || (q.method === 'eth_getBlockByNumber' && q.params[0] === x.number));
      if (b) return ok(b);
      return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'not recorded' } };
    };
    const q = JSON.parse(body);
    res.writeHead(200, headers({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify(Array.isArray(q) ? q.map(one) : one(q)));
  });
}

let wantsSsz = true;
function ssz(res, file) {
  if (!wantsSsz && jsonDir) {
    res.writeHead(200, headers({ 'Content-Type': 'application/json', 'Eth-Consensus-Version': 'fulu' }));
    return res.end(fs.readFileSync(path.join(jsonDir, file.replace('.ssz', '.json'))));
  }
  res.writeHead(200, headers({ 'Content-Type': 'application/octet-stream', 'Eth-Consensus-Version': 'fulu' }));
  res.end(fs.readFileSync(path.join(data, file)));
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  process.stderr.write(`${req.method} ${u.pathname}${u.search} accept=${req.headers.accept || ''}\n`);
  if (req.method === 'OPTIONS') { res.writeHead(204, headers({ 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST' })); return res.end(); }
  const p = u.pathname;
  if (req.method === 'POST' && p === '/execution') return execution(req, res);
  wantsSsz = (req.headers.accept || '').includes('application/octet-stream');
  if (p.startsWith('/eth/v1/beacon/light_client/bootstrap/')) {
    if (p.split('/').pop().toLowerCase() !== CHECKPOINT) { res.writeHead(404, headers({})); return res.end('unknown checkpoint'); }
    return ssz(res, 'bootstrap.ssz');
  }
  if (p === '/eth/v1/beacon/light_client/updates') return ssz(res, 'updates.ssz');
  if (p === '/eth/v1/beacon/light_client/finality_update') return ssz(res, 'finality.ssz');
  if (p === '/eth/v1/beacon/light_client/optimistic_update') return ssz(res, 'optimistic.ssz');
  // The recorded files themselves (proof.json, block.json …) and the harness's generated data (data/gen), for the
  // proof, IPFS and statement comparisons.
  if (p.startsWith('/data/')) {
    const name = path.basename(p);
    for (const d of [data, path.join(here, 'data/gen')]) {
      const f = path.join(d, name);
      if (fs.existsSync(f)) { res.writeHead(200, headers({ 'Content-Type': 'application/octet-stream' })); return res.end(fs.readFileSync(f)); }
    }
  }
  const f = path.join(root, path.normalize(p === '/' ? '/index.html' : p));
  if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    // Static files may be cached, so a second visit is a warm start; the beacon data never is.
    res.writeHead(200, headers({ 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' }));
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404, headers({})); res.end('not found');
}).listen(port, '127.0.0.1', () => process.stderr.write(`serving on ${port}\n`));
