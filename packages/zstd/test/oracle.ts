// The reference zstd, as a batch subprocess.
//
// Node's zlib carries zstd (22.15+) and Deno's `node:zlib` exposes it, which makes this a real oracle
// rather than a second implementation of the same misreading: a frame here came from the reference
// encoder, so a disagreement is ours.
//
// **The history is worth keeping, because it went round a loop.** There were two subprocesses:
// `test/oracle.mjs`, spawned per test file and fed a JSON job list over stdin, and a second copy
// inlined in `test/encode.test.ts` as a `node -e` script doing the same thing the other way. Both
// existed because the oracle was assumed to need Node — and it does, but Deno *is* Node here for that
// purpose, so `test/reference.ts` replaced them with one in-process module: no spawn, no base64
// round-trip, no second copy to drift.
//
// This is a subprocess again, and the reason is not that the in-process module was wrong. It is that
// the tests moved to wac (`issues/system/0161`), and a wac test reaches a JavaScript value by running
// a program. What the old arrangement was avoiding — *a spawn per job* — is still avoided: this reads
// a whole batch and answers it, which is the shape `packages/wactest/src/oracle.wac` describes.
//
// Reads one command per line on stdin and writes one answer per line, in order, then `DONE <n>`:
//
//   compress <level|-> <checksum:0|1> <hex>   →  frame <hex>
//   decompress <hex>                          →  plain <hex>   |  refused
//   blocktypes <hex>                          →  blocktypes <csv>
//   compressdict <dict-hex> <hex>             →  frame <hex>
//   compresswin <windowLog> <hex>             →  frame <hex>
//   writedesc <log> <counts-csv>              →  desc <hex>
//   withstream <desc-hex> <stream-hex>        →  bytes <hex>
//
// `level` of `-` means the reference's default. A `compress` of empty input is legal and produces a
// frame with no blocks.
//
// **`writedesc` and `withstream` are not the reference zstd**, and the distinction matters.
// `test/writer.ts` is an FSE description *writer* written from the same section of RFC 8878 as the
// decoder and deliberately not from it — a shared misreading would still agree, so it is a much
// better fuzzer than random bytes rather than an oracle. It travels here because it is JavaScript
// and a wac test reaches JavaScript by running a program, not because it is authoritative.

import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { withStream, writeDescription } from "./writer.ts";

const z = zlib as unknown as {
  zstdCompressSync(b: Uint8Array, opts?: { params?: Record<number, number> }): Uint8Array;
  zstdDecompressSync(b: Uint8Array): Uint8Array;
  constants: Record<string, number>;
};

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * The block types a frame uses, by walking its block headers.
 *
 * Header arithmetic only, and it is here rather than in the test because it describes the *oracle's*
 * output: a test that asserts "the corpus reached a compressed block" is asking what the reference
 * chose to emit, not what our decoder made of it.
 */
function blockTypes(buf: Uint8Array): string[] {
  const names = ["raw", "rle", "compressed", "reserved"];
  const out: string[] = [];
  let p = 4;
  const fhd = buf[p++];
  const fcs = fhd >> 6, single = (fhd >> 5) & 1, did = fhd & 3;
  if (!single) p++;
  p += [0, 1, 2, 4][did];
  p += fcs === 0 ? (single ? 1 : 0) : [1, 2, 4, 8][fcs];
  for (;;) {
    const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    const last = h & 1, type = (h >> 1) & 3, size = h >>> 3;
    out.push(names[type]);
    p = p + 3 + (type === 1 ? 1 : size);
    if (last) break;
  }
  return out;
}

/**
 * Standard input, under whichever runtime is running this.
 *
 * **It has to be Node, and that is not a preference.** Deno's `node:zlib` shim accepts zstd's
 * `dictionary` option and *ignores* it — a frame compressed against a dictionary comes back byte for
 * byte identical to one compressed without, so a test asserting that such a frame is refused would
 * be asserting it about an ordinary frame. Real Node honours it. The host-side arrangement had the
 * same split without saying so: `test/reference.ts` ran in-process under Deno and the dictionary
 * case reached for a separate `node -e`.
 *
 * The Deno branch stays because it costs three lines and the file is otherwise runtime-agnostic.
 */
async function readStdin(): Promise<string> {
  const maybeDeno = (globalThis as { Deno?: { stdin: { readable: ReadableStream } } }).Deno;
  if (maybeDeno !== undefined) {
    return new TextDecoder().decode(await new Response(maybeDeno.stdin.readable).arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  for await (const c of process.stdin) chunks.push(c as Uint8Array);
  return Buffer.concat(chunks).toString("utf8");
}

const input = await readStdin();
const out: string[] = [];
let n = 0;

for (const line of input.split("\n")) {
  if (line.length === 0) continue;
  n++;
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "compress") {
      const [level, checksum, data] = rest;
      // **Three fields, and a missing one is a `FAIL` rather than an empty input.** Asked
      // `compress 9 <hex>`, this read the hex as the checksum flag and `data` as undefined, so it
      // compressed nothing and answered `frame` — a valid frame of the empty string, which is
      // indistinguishable from a correct answer to a different question. A coverage exercise built six
      // frames that way and every one of them decoded, so nothing was red; what said so was the
      // *coverage*, four hundred branches short. An oracle cannot tell a missing argument from an
      // empty one unless it counts them.
      if (rest.length !== 3) {
        out.push(`FAIL compress: wants <level|-> <checksum:0|1> <hex>, got ${rest.length} field(s)`);
        continue;
      }
      const params: Record<number, number> = {};
      if (level !== "-") params[z.constants.ZSTD_c_compressionLevel] = Number(level);
      if (checksum === "1") params[z.constants.ZSTD_c_checksumFlag] = 1;
      out.push(`frame ${hex(z.zstdCompressSync(bytes(data ?? ""), { params }))}`);
    } else if (op === "compressdict") {
      // A dictionary the reference will use but this decoder must refuse: not implemented, and
      // the point is that such a frame fails rather than producing plausible rubbish.
      const [dict, data] = rest;
      // **A `Buffer`, not a `Uint8Array`.** Handed the latter, `node:zlib` silently ignores the
      // option and returns an ordinary frame — which decoded fine and left the test asserting that
      // a dictionary-free frame is refused, which it is not.
      out.push(`frame ${hex(z.zstdCompressSync(Buffer.from(bytes(data ?? "")), {
        dictionary: Buffer.from(bytes(dict ?? "")),
      } as unknown as { params?: Record<number, number> }))}`);
    } else if (op === "compresswin") {
      // A window smaller than the content, so a streaming decoder actually has to evict. Every
      // frame our own encoder emits declares a window larger than what it holds, so without this
      // the eviction path never runs.
      const [log, data] = rest;
      out.push(`frame ${hex(z.zstdCompressSync(bytes(data ?? ""), {
        params: { [z.constants.ZSTD_c_windowLog]: Number(log) },
      }))}`);
    } else if (op === "decompress") {
      try {
        out.push(`plain ${hex(z.zstdDecompressSync(bytes(rest[0] ?? "")))}`);
      } catch {
        // A refusal is an answer, not a harness failure: several tests exist to check that the
        // reference rejects what our encoder must never produce.
        out.push("refused");
      }
    } else if (op === "writedesc") {
      const [log, counts] = rest;
      const list = (counts ?? "").length === 0 ? [] : (counts ?? "").split(",").map(Number);
      out.push(`desc ${hex(writeDescription(list, Number(log)))}`);
    } else if (op === "withstream") {
      out.push(`bytes ${hex(withStream(bytes(rest[0] ?? ""), bytes(rest[1] ?? "")))}`);
    } else if (op === "blocktypes") {
      out.push(`blocktypes ${blockTypes(bytes(rest[0] ?? "")).join(",")}`);
    } else {
      out.push(`FAIL unknown op ${op}`);
    }
  } catch (e) {
    out.push(`FAIL ${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

out.push(`DONE ${n}`);
console.log(out.join("\n"));
