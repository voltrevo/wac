# 0056 — arrays have no bulk copy, though the emitter already writes one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-01
- **Kind:** missing feature
- **Symptom:** slow

`spec/spec/arrays.md` gives arrays `[]` get, `[]` set, `.len()` and `fill:`. There is no way to
copy a range of one array into another, so every wac program writes the loop by hand:

```wac
for (i32 i = 0; i < count; i++) {
  dst[at + i] = src[start + i];
}
```

`array.copy` — `0xFB 0x11` — does exactly this in one instruction, and **the compiler already emits
it**: `atoms/wac/wasmBuildBin.ts` uses it in the bindgen helpers and in the string builtins. It is
the language surface that is missing, not the capability.

## What it costs, measured

Found while working out why the streaming gzip compressor is slower than the whole-input one. The
difference turned out to be almost entirely one `Buf.pushBytes` — the streaming path accumulates its
input into a buffer, and the whole-input path never copies at all.

For 1.056 MB of text, decomposed by cutting the work down a piece at a time:

| what runs | ms | adds |
|---|---:|---:|
| read callbacks only, input dropped | 0.61 | — |
| + accumulate into a `Buf` | 1.95 | **1.34** |
| + CRC-32 | 2.96 | 1.01 |
| + LZ77 and Huffman coding | 6.97 | 4.01 |

The whole-input compressor does the same job in 5.40 ms, so the gap is 1.57 ms and the copy is 1.34
of it. **A megabyte copied one element at a time runs at about 790 MB/s** — which is what a
per-element loop over a GC array costs, and it is the single largest avoidable cost in that path.

Not a gzip problem: `packages/bytes`' `Buf.pushBytes`, `Buf.dropFront` and `Buf.bytes` are all this
loop, and every one of them is on somebody's hot path.

## What to expose

Whatever fits the language best — the point is one instruction rather than a loop. A method form
reads like the rest of the array surface:

```wac
dst.copyFrom(src, srcStart, dstStart, count);
```

Both arrays must have the same element type, which `array.copy` requires anyway, and the runtime
already bounds-checks both ranges — so an out-of-range copy traps exactly as an out-of-range index
does, with no extra checking to write.

Worth considering `array.fill` (`0xFB 0x10`) at the same time and for the same reason: `fill:` at
construction is already spelled, but re-filling an existing array is another hand-written loop.

## Why it is worth doing

It is the rare change that is cheap in the compiler and wide in effect: the instruction is emitted
already, the semantics are the loop everyone is writing, and it makes every buffer, decoder and
codec in `wac-mono` faster without any of them changing shape.

## Numbering

Filed as 0055, which was taken by the callback/array bind bug (closed the same day).
Renumbered to 0056 on the later push, per `README.md`. Nothing else changed.
