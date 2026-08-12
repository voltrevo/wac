# 0138 — wasmtime's default collector costs 25x on escaping allocation; the residue after fixing it is 4x

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

## Found: it is the collector, and wasmtime ships a better one

Reduced to a 4.8 KB module with no imports — seven exported `i32 -> i32` functions, two runners.
The reproduction is packaged for sending outside this repository; `bench.wac` is in it for
provenance and nothing in it needs wac to run.

| export | V8 | wasmtime DRC | copying | null |
|---|---|---|---|---|
| `compute` — arithmetic, no allocation | 0.08s | 0.08s | — | — |
| `mutateArray` — one array, mutated 20M times | 0.08s | 0.09s | — | — |
| `allocStructs` — a struct per iteration, dropped | 0.12s | 0.75s | — | — |
| `escapingStructs` — a struct per iteration, **kept** | 0.16s | **4.13s** | 0.33s | 0.17s |
| `strings` — 2M short strings, kept | 0.05s | **3.04s** | 0.24s | 0.24s |

Compute is at parity and mutating a long-lived object is at parity, so this is neither codegen nor
allocation: it is what the collector does when a reference is **stored into the heap**. The
`escaping*` cases exist because a non-escaping allocation can be scalar-replaced by either engine —
and the ratio is worst exactly where the stores are.

**wasmtime's default is deferred reference counting and it is the wrong one for this.** `wacland`
now chooses `Collector::Copying`, which on wacc compiling itself is:

    drc      12.33s
    copying   4.47s
    null      4.51s

Copying and null are the same, so the collector's own cost is now negligible; what is left is a
**~4x** gap against Deno's 1.1s that has nothing to do with GC. That is the remaining question, and
it is a different one — worth its own measurement rather than being folded in here.

`WACLAND_GC=drc|copying|null` selects it at run time, so the next person can measure rather than
take this on trust.

## What this changes about the plan

design/lang/0003 asked whether a `wac` binary on wasmtime could be the toolchain. At 10x the answer
was leaning no; at 4x — for a compile that takes about a second — it is a different conversation, and
the JavaScript hosts stay first-class either way. The residual 4x is the thing to understand before
anyone decides.

## Where the remaining 4x already shows, for whoever picks it up

The same microbenchmark, with the copying collector, still has it — so the residue does not need the
compiler to reproduce:

| export | V8 | wasmtime copying | ratio |
|---|---|---|---|
| `compute` | 0.08s | 0.08s | 1.0x |
| `mutateArray` | 0.08s | 0.09s | 1.1x |
| `escapingArrays` | 0.19s | 0.97s | **5.1x** |
| `strings` (2M) | 0.05s | 0.24s | **4.8x** |

Arithmetic and in-place mutation are at parity; anything that *allocates* is 5x even with the
barriers gone. So the remaining question is allocation throughput — V8 bump-allocates into a nursery
and collects generationally, and whatever wasmtime's copying collector does per `struct.new` /
`array.new` costs about five times that. It is one measurement away from being either a wasmtime
issue worth reporting or something about how this compiler emits allocation.

Note `escapingArrays` is 0.33s under `null` and 0.97s under `copying` — so the copying collector is
not free either, it is merely far cheaper than DRC.
