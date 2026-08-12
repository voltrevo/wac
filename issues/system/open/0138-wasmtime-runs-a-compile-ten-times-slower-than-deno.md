# 0138 — wasmtime runs a compile ten times slower than Deno, and that decides what the binary can be

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** performance
- **Symptom:** no error

The same work, the same wac program, two hosts:

```
wasmtime run 1: 10.75s
wasmtime run 2: 10.68s
deno     run 1:  1.01s
deno     run 2:  1.16s
```

`packages/wacc/example/wacc.wac` compiling `packages/wacc/src/api.wac` — wacc compiling wacc, 11
files, 314,493 bytes out. **Both produce byte-identical output**, so this is speed and nothing else.

## It is execution, not startup

The first run of a module under `wacland` costs about **1.5s** and later runs of the same module cost
**19ms**, so the module is compiled once and cached. The ten seconds is the program running.

Nor is it the filesystem: the same binary does `check` on a one-file program in 19ms end to end.

## Why it matters now

[design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
aims at a single `wac` binary — wasmtime plus an embedded compiler — and this is the number that
decides what such a binary can reasonably be:

- **As a product**, `wac build` taking ten seconds where the current toolchain takes one is felt
  immediately, on the first thing anyone does with it.
- **As this repository's inner loop**, it is disqualifying on its own: the suite compiles the world
  constantly, and a 10× compiler makes a six-minute suite an hour.

It does *not* argue against the binary — correctness is already proven, and the JavaScript hosts stay
first-class either way. It argues against wasmtime becoming the **default development runtime**, which
was an open question in the plan and can now be answered with a measurement rather than a preference.

## Where to look

Unmeasured, in the order I would try them:

1. **WasmGC.** wac is GC-heavy by construction — every string, struct and array is a GC object, and
   the emitter allocates freely. V8's collector is old and hard-tuned; wasmtime's is young. A profile
   that separates allocation from mutator time would say whether this is the whole story.
2. **`wasmtime::Config`.** The host builds its engine with defaults. `cranelift_opt_level`, the
   pooling allocator, and whether the GC heap is being resized repeatedly are all cheap to try.
3. **The shape of the work.** A compiler is allocation-heavy and branch-heavy, which is the least
   favourable case; `packages/crypto`'s hashes would show whether a compute-bound program has the same
   ratio. If it does not, this is a GC story and item 1 is the whole of it.

Whoever takes this should record the ratio for two or three different workloads before optimising
anything: one number from one program is a hypothesis, not a profile.
