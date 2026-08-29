// Driving the TypeScript→JavaScript transform: files in, one bundle out.
//
// `design/system/0009`. The transform is a wac program with **one function** — `u8[] transform(u8[])`
// — so nothing crosses this boundary but bytes: no capabilities, no scheduler, no marshalling, and
// nothing here that knows what TypeScript is. It packs the sources into a store-only zip, hands the
// bytes over, and hands back what comes out.
//
// ## Why this is a module and not three copies
//
// Three callers want exactly this and each was going to grow its own: `run.js` is the command line
// the bootstrap uses, `bootstrap/js/assembleCommand.js` builds the self-contained JavaScript command,
// and `packages/platform/build.ts` builds pages. A zip writer and a memory protocol repeated three
// times is three places for a fencepost to differ, and the symptom would be a bundle that is subtly
// truncated rather than an error.
//
// ## Plain JavaScript, and no imports at all
//
// The machine running a bootstrap has deno or node and nothing else — no npm, no network, no
// bundler. That is the whole constraint the transform exists to satisfy, and a host that needed a
// package would defeat it. Everything here is standard: `WebAssembly`, `TextEncoder`, typed arrays.

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

/**
 * Bundle a file set.
 *
 * `wasm` is the compiled transform. `files` is `[name, bytes]` pairs, and `entry` names the one the
 * bundle starts from — it must be among them, and the transform says so if it is not.
 *
 * Answers `{ ok: true, bytes }` or `{ ok: false, error }`. A thrown exception would be wrong here:
 * a refusal is the transform doing its job — `design/system/0009` D4 is that it refuses rather than
 * guesses — and every caller has somewhere better to put the message than a stack trace.
 */
export function bundleFiles(wasm, files, entry) {
  const e = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;

  const members = [["entry", new TextEncoder().encode(entry)]];
  for (const [name, data] of files) members.push([name, data]);
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
  if (new TextDecoder().decode(bytes.slice(0, 8)) === "wac-ts: ") {
    return { ok: false, error: new TextDecoder().decode(bytes) };
  }
  return { ok: true, bytes };
}
