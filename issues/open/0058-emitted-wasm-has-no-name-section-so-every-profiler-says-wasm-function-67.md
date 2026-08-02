# 0058 — emitted wasm has no name section, so every profiler says `wasm-function[67]`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** missing feature
- **Symptom:** not implemented

`wasmBuildBin.ts` emits no custom `name` section, so nothing downstream can map a function
index back to the name in the source. Profiling a wac program means reading output like this
and guessing:

```
 56.6%  wasm-function[67],0xf73d8871d453,*
  8.9%  wasm-function[80],0xf73d8871d460,*
  5.6%  wasm-function[104],0xf73d8871d478,*
```

That is a real V8 `--prof` run over `packages/zstd`'s decoder in wac-mono. Better than half the
time is in one function and the profile cannot say which one. I worked out what `[67]` was from
unrelated evidence — that decode time scaled with sequences per megabyte — which happened to be
right, and would not have been if the hot function had been anything less obvious.

## Reproduction

Compile anything, and look for section id 0 with the name `name`:

```wac
export i32 twice(i32 x) { return x + x; }
```

Expected: a `name` subsection 1 mapping index → `twice`.
Actual: no custom section at all. Verified by walking the sections of a compiled module —
`packages/zstd/src/frame.wac` has none.

## Why this one rather than a profiler

The point is that wac does not need to build a profiler if it emits names. The name section is
standard and universally consumed: V8 `--prof`, Chrome DevTools' wasm frames, `perf`,
`wasm-objdump`, `wasm-opt` and every wabt tool already know how to read it. One small emitter
change makes all of them work on wac output, and none of them work without it.

Reasonable to gate behind an option like `coverage` — `{ names: true }`, on for `wacx build`
and for the test harness, off for a size-sensitive release build. Function names alone would
be most of the value; locals and struct field names are a nice-to-have.

## Notes

wac already has a usable *counting* profiler and I do not think that is widely known, including
by me until today. Compiling with `{ coverage: true }` and reading `__cov_get(i)` against
`compiled.coverage` gives per-point execution counts with file, line and `kind` — and `entry`
and `loop` points make that an execution-count profile, not just a coverage bitmap. Ranking a
zstd decode by count found a genuine hot spot in seconds:

```
   1048576 loop   xxh64.wac:39        <- once per byte of output
    701037 entry  fse.wac:301
    282472 loop   fse.wac:278
    233054 entry  buf.wac:64
```

So the gap is not "wac has no profiling". It is that the counting one is framed as coverage and
test attribution, so nobody reaches for it when they want to know what is slow — a sentence in
its docs would fix that, and is not this issue.

What counts genuinely cannot show is **time**, and the two answer different questions. The
change that actually mattered in that decoder was reducing thirteen bounds-checked array loads
per sequence to six. Loads are not branch points, so the counting profiler is blind to it by
construction: the count of the loop containing them never changed. Only a tick profile pointed
at that function, and only after I had guessed which function it was.
