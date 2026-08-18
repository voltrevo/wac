#!/usr/bin/env -S deno run
// RFC 4253 §7.2's key derivation, transcribed, as an oracle for `src/kex.wac`'s `deriveKey`.
//
// **This file is the reference, not the test.** It is a reading of the RFC written independently of
// the wac implementation, in a different language and against a different hash — WebCrypto's
// SHA-256 rather than `packages/hash`'s — so the two agree only if both read the RFC the same way.
// Round-tripping `deriveKey` against itself would say nothing at all.
//
// The rule worth having an oracle for only shows up beyond one hash block:
//
//     K1 = HASH(K || H || X || session_id)
//     K2 = HASH(K || H || K1)
//     K3 = HASH(K || H || K1 || K2)
//
// The extension hashes **everything produced so far**, not just the previous block. Hashing only the
// previous block gives the right first 32 bytes and wrong ones after — and the only key this
// protocol needs that is longer than a hash is chacha20-poly1305's 64, so nothing else would catch
// it. Hence the lengths on the wac side: 33 and 64 and 100 straddle the boundary, and 1 and 16 and
// 32 check that a short request is truncated rather than padded.
//
// `K` is the mpint form of the shared secret, not its raw bytes — the other rule a transcription
// gets wrong, and the reason the caller sends three secrets: one plain, one with the top bit set so
// a zero byte is prepended, and one with leading zeroes to strip.
//
//   derive <k-hex> <h-hex> <sid-hex> <letter> <needed> <ours-hex>   (judges)
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.
//
// No flags: WebCrypto and stdin are all this needs, and a `--allow-*` it does not use would be a
// grant the suite could not later notice going missing.

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 20);
  for (;;) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function bytesOf(h: string): Uint8Array {
  const out = new Uint8Array((h ?? "").length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const hex = (b: Uint8Array) =>
  Array.from(b).map((v) => v.toString(16).padStart(2, "0")).join("");

// `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`: WebCrypto's `BufferSource`
// excludes a SharedArrayBuffer-backed view, and `cat` below always allocates a plain one.
const sha256 = async (b: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", b));

function cat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The mpint form of K, which is what the RFC means by K here — not the raw bytes. */
function mpint(v: Uint8Array): Uint8Array<ArrayBuffer> {
  let at = 0;
  while (at < v.length && v[at] === 0) at++;
  const body = v.slice(at);
  const pad = body.length > 0 && (body[0] & 0x80) !== 0;
  const n = body.length === 0 ? 0 : body.length + (pad ? 1 : 0);
  const head = new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  return body.length === 0 ? head : cat(head, pad ? new Uint8Array([0]) : new Uint8Array(0), body);
}

async function derive(
  k: Uint8Array,
  h: Uint8Array,
  sid: Uint8Array,
  letter: number,
  needed: number,
): Promise<Uint8Array> {
  const base = cat(mpint(k), h);
  let out = await sha256(cat(base, new Uint8Array([letter]), sid));
  while (out.length < needed) out = cat(out, await sha256(cat(base, out)));
  return out.slice(0, needed);
}

const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
const out: string[] = [];
const say = (s: string) => {
  if (out.length < 20) out.push(`FAIL ${s}`);
};

for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "derive") {
      const [kHex, hHex, sidHex, letterText, neededText, oursHex] = rest;
      const letter = Number(letterText);
      const needed = Number(neededText);
      const want = await derive(bytesOf(kHex), bytesOf(hHex), bytesOf(sidHex), letter, needed);
      const at = `derive(K ${kHex.slice(0, 8)}…, letter ${letter}, ${needed} bytes)`;
      if (want.length !== needed) {
        say(`${at}: the reference itself produced ${want.length} bytes`);
      } else if (oursHex !== hex(want)) {
        // One line, and that is a constraint rather than a style. `oracle.wac` splits on newlines
        // and keeps only the lines beginning `FAIL`, so a two-line message loses its second half
        // silently — the caller sees the header and not the bytes it exists to show.
        say(`${at}: got ${oursHex}, want ${hex(want)}`);
      }
    } else {
      say(`unknown op ${JSON.stringify(op)}`);
    }
  } catch (e) {
    say(`${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const l of out) console.log(l);
console.log(`DONE ${lines.length}`);
