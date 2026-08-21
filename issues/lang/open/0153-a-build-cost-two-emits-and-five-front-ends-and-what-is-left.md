# 0153 — a build cost two emits and five front ends; what is left after fixing that

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — `wac build` was 2.7× slower than the work it does

## Where this started

The website's bootstrap page compiles wacc with wacc in the reader's browser and prints the time. On
2026-08-18 it read:

    the reference compiler → stage A   389,417 bytes, 499 ms
    stage A compiles wacc → stage B    444,332 bytes, 707 ms
    stage B compiles wacc → stage C    444,332 bytes, 461 ms

while `wac build` on the same compiler took **4 736 ms** locally, and on `packages/box/src/bin/sh.wac`
**5 994 ms**. A tenfold gap on what looked like the same job.

## What it was not

Each of these was measured and none of them is the cause. They are recorded so nobody spends the day
again:

* **Not the sources.** `packages/wacc/src` was 1 352 555 bytes at the revision the deployed site was
  built from and 1 370 047 today — 1.3% apart. Same compiler, same input.
* **Not box being larger than wacc.** By bytes they are within 17%: wacc is 24 files / 1.47 MB of source
  producing 777 KB of wasm, box's shell 180 files / 1.72 MB producing 910 KB. Build time tracks *output*
  size at ~6 ms/KB either way, and the file count barely registers.
* **Not the embedding.** Under Deno, `emitFiles` on wacc's 16 files takes 483–491 ms and produces the
  same 444 516 bytes the browser produces in 461–707 ms. The hosts agree.
* **Not wasm tiering.** `--liftoff-only` makes it 5 882 ms against 2 496 baseline, so V8 is tiering the
  compiler up. `--no-liftoff` is *slower* (3 978 ms): compiling 777 KB with TurboFan up front costs more
  than it saves in a two-second run. Heap sizing (`--max-semi-space-size`, `--max-old-space-size`) and the
  platform thread pool changed nothing.
* **Not wacc's own codegen.** Under one host, wacc built by the reference and wacc built by wacc emit in
  567/536/485 ms and 605/498/496 ms — the same.

## What it was

**The bootstrap page calls `emitFiles` and nothing else**: one front end and an emit. A `wac build` does
five whole-graph walks and two emits' worth of work.

1. **`wacc.wac` did not use `buildFiles`.** The CLI called `diagnoseGraph`, then `blockedFiles`, then
   `emitFiles`, then `manifestFiles` — which derives `bindTypesLinked` *and* `exportSigsLinked` inside
   itself. Each takes `(paths, sources, entry)` and builds its own front end, because this compiler does
   no I/O and holds nothing between calls. `buildFiles` has existed for exactly this since
   `issues/lang/0129`; the CLI was the caller that never adopted it. `manifestWire` was added beside the
   existing `bindgenWire` so the manifest is built from metadata already in hand.

2. **`blockedOf` was a dry run of the emit, on every build.** It asks `canEmit` of every function and
   every method — a walk of every body — so it costs about what emitting costs and, on a program that
   compiles, returns the empty string. On box's shell that was **1 480 ms against 712 ms for the emit
   itself**. Nothing needs asking in advance: `declineFor` records `env.full` and `env.fullWhy` as the
   emit happens, which is what `emitDeclineLinked` already reads. `buildLinked` now emits and runs the
   speculative walk only when a decline actually happened — where its message earns the second front end,
   since `fullWhy` names the seventh call in a chain and `blockedOf` names the declaration
   (`issues/lang/0106`).

3. **`checkFilesWith` re-lexed and re-parsed its entry.** `issues/lang/0133` stopped the *import* loop
   re-reading each file once per importer and left the entry parsing itself on every call. In
   `diagnoseGraph`, where all 180 files take a turn as the entry, that is a second whole-graph parse.
   Worth ~5%, so the smallest of the three.

## The result

    wac build   packages/box/src/bin/sh.wac    5 994 → 2 245 ms    2.7×
    wac build   packages/wacc/example/wacc.wac 4 736 → 1 509 ms    3.1×

Byte-identical modules and manifests from the old and new compilers on `sh`, `sealedsh` and `wacc`; the
seed is a fixed point after one round; `packages/wacc` is 188 Deno tests and 24 wac files green.

It lands on every `wac build`, `wac run` and `wac test`, and on the Deno harness as well, since
`waccArtifacts` builds through `buildFiles`.

## Why a build is still ~4× the browser's number, and how much of that is real

For box's shell, 2 245 ms breaks down as:

| | |
|---|---:|
| `diagnoseGraph` | ~880 ms |
| front end | ~720 ms |
| emit | ~880 ms |

The browser's 461 ms is the front end and the emit for **wacc's 16 files**, and nothing else. Against the
same entry the comparison is Deno's `emitFiles` at 1 597 ms versus `wac build` at 2 245 ms — and the
difference is `diagnoseGraph`, the manifest and writing two files, none of which the demo does.

**`diagnoseGraph` is not waste.** `checkFiles` walks only the entry's bodies, so a type error in an
imported file was silent and the emitter turned it into a wasm validation failure with no source line —
`issues/lang/0118`. It checks every file *as an entry* to prevent that. Measured, it is 130 ms of shared
whole-graph parse plus **180 checks at about 5 ms each**, and the per-file cost does not scale with
closure size: `diagnoseFiles` costs 158 ms for a file with a closure of 1 and 117 ms for one with a
closure of 180. So the overlapping closures are *not* where the time goes, and there is no redundancy
left to remove there.

## What is left to try

* **Skip checking files that have not changed.** The compiler is pure — paths and sources in, a string
  out — so a diagnosis is cacheable by content hash. Nothing in the CLI or the host caches anything today.
* **Make the checker itself faster**, which needs profiling inside `C` rather than around it.
* The front end at ~720 ms for 180 files is ~4 ms a file and has not been looked at at all.

## What the front end's ~720 ms is made of — 2026-08-21, agent-a

There is still no profiler, but a *pure* function's whole cost can be priced by wrapping it so its body
runs twice and subtracting. On `describewac_test` (14.1 s, four front ends over closures up to 182 files):

| | |
|---|---:|
| `lex` | 2.5% |
| `parseProgram` | 18% |
| everything after — check, settle, emit | ~80% |

So the bullet above is right about where to look, and it is the *semantic* phases rather than the
front end in the narrow sense.

**One candidate inside them is now ruled out.** `C.findName` is a linear scan of the names table run
once per name resolved, which is the shape that had just been worth indexing twice elsewhere in a day
(`edgesOfIn`'s path lookup, and `isBuiltinSpec`). Priced the same way it is **51 ms of 14 150 ms —
0.4%**, so a hash index there buys nothing. Recorded because the scan is conspicuous and looks like
the answer.

**What the technique cannot price.** Doubling a *call site* prices that site, not the callee — it
undercounted `isBuiltinSpec` by more than half, because the loop doubled was one of several callers.
Body-doubling prices the callee but only where the function is pure: `lex` and `parseProgram` qualify
(the latter if the wrapper builds a second `P` from `p.src`/`p.toks`/`p.tokCount`), while `checkModule`
and `settleEmittable` mutate pre-populated state, so a second run does *less* work and the subtraction
means nothing. That is why the 80% is one row rather than three — pricing inside it needs either a real
profiler or a pure seam that does not exist yet.
