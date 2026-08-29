// The whole host for `packages/ts`: bytes in, bytes out.
//
//     deno run -A packages/ts/host/run.js transform.wasm entry.ts [more.ts ...] > out.js
//     node        packages/ts/host/run.js transform.wasm entry.ts [more.ts ...] > out.js
//
// `design/system/0009`. This is what the bootstrap needs and the reason the transform's interface is
// one function: no capabilities cross, so there is no `Pending`, no scheduler, no marshalling and
// nothing here that knows what TypeScript is. It packs the files into a store-only zip, hands over
// the bytes, and prints what comes back.
//
// **Plain JavaScript with no imports**, because the machine running it during a bootstrap has deno
// or node and nothing else — no npm, no network, no bundler. That is the whole constraint the
// transform exists to satisfy, and a host that needed a package would defeat it.

const args = (typeof Deno !== "undefined" ? Deno.args : process.argv.slice(2));
if (args.length < 2) {
  const w = (s) => (typeof Deno !== "undefined" ? Deno.stderr.writeSync(new TextEncoder().encode(s)) : process.stderr.write(s));
  w("usage: run.js <transform.wasm> <entry.ts> [more.ts ...]\n");
  w("       packs the files into a zip, runs the transform, prints the bundle\n");
  exit(2);
}

function readFile(p) {
  if (typeof Deno !== "undefined") return Deno.readFileSync(p);
  return new Uint8Array(require("fs").readFileSync(p));
}
function writeOut(b) {
  if (typeof Deno !== "undefined") { Deno.stdout.writeSync(b); return; }
  process.stdout.write(Buffer.from(b));
}
function writeErr(s) {
  if (typeof Deno !== "undefined") { Deno.stderr.writeSync(new TextEncoder().encode(s)); return; }
  process.stderr.write(s);
}
function exit(c) {
  if (typeof Deno !== "undefined") Deno.exit(c);
  process.exit(c);
}

// ── A store-only zip, written ────────────────────────────────────────────────
//
// Thirty lines, and the reason the transform takes a zip rather than a bespoke format: what comes
// out of here can be opened with `unzip -l` when a bootstrap goes wrong.

const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries) {
  const parts = [];
  const dir = [];
  let at = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, data] of entries) {
    const n = new TextEncoder().encode(name);
    const c = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
                  ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0)];
    dir.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
              ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(n.length),
              ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(at), ...n]);
    parts.push(new Uint8Array(head), n, data);
    at += head.length + n.length + data.length;
  }
  const dirBytes = dir.flat();
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length),
               ...u16(entries.length), ...u32(dirBytes.length), ...u32(at), ...u16(0)];
  parts.push(new Uint8Array(dirBytes), new Uint8Array(end));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── The call ─────────────────────────────────────────────────────────────────

const mod = new WebAssembly.Module(readFile(args[0]));
const e = new WebAssembly.Instance(mod, {}).exports;

const files = args.slice(1);
const members = [["entry", new TextEncoder().encode(files[0])]];
for (const f of files) members.push([f, readFile(f)]);
const input = zip(members);

// **Every view is taken after the `mem_ensure` before it.** Growing the memory detaches the
// `ArrayBuffer` a caller was holding — `packages/platform/host/marshal.ts` learnt this the same way.
e.$bind$mem_ensure(input.length);
new Uint8Array(e.$bind$mem.buffer).set(input, 0);
const ref = e.$bind$arr_u8_from_mem(input.length);
const out = e.transform(ref);
const n = e.$bind$arr_u8_len(out);
e.$bind$mem_ensure(n);
e.$bind$arr_u8_to_mem(out);
const bytes = new Uint8Array(e.$bind$mem.buffer).slice(0, n);

// `wac-ts: ` is the transform's whole error protocol — a prefix no bundle can begin with.
const head = new TextDecoder().decode(bytes.slice(0, 8));
if (head === "wac-ts: ") {
  writeErr(new TextDecoder().decode(bytes) + "\n");
  exit(1);
}
writeOut(bytes);
