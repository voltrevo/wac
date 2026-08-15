# 0129 — a build repeats the whole front end five times, so 77% of compile time is not code generation

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** performance
- **Symptom:** not implemented — the API has no shape that lets a caller parse once and ask several questions

## Reproduction

`harness/waccBuild.ts` builds one program with five calls into wacc's API — `diagnoseGraph`,
`blockedFiles`, `emitFiles`, `bindTypesFiles`, `exportSigsFiles`. Every one of them takes
`(paths, sources, entry)`, raw text, and every one of them starts by calling `linkFiles` and then
lexing and parsing the whole concatenated blob. Timing them separately, mean of 3 after a warm-up:

| program | files | KiB | `emitFiles` | all five | emit's share |
|---|---:|---:|---:|---:|---:|
| `packages/zstd/src/frame.wac` | 7 | 69 | 14 ms | 61 ms | 23% |
| `packages/json/src/json.wac` | 11 | 90 | 20 ms | 93 ms | 22% |
| `packages/wacc/src/api.wac` | 15 | 1090 | 391 ms | 1862 ms | 21% |
| `packages/box/src/box.wac` | 170 | 1325 | 988 ms | 5039 ms | 20% |

Emitting is a fifth of a build across a 20x range of program sizes, which is what you would expect
if the other four calls are mostly repeating the front end. `exportSigsFiles` is the clearest case:
it returns one line per exported function, and it costs 596 ms on box.

Over every program in the repo — `harness/programs.ts`, 76 programs, 36.0 MiB of source:

| phase | time |
|---|---:|
| `diagnoseGraph` | 20.5 s |
| `blockedFiles` | **37.2 s** |
| `emitFiles` | 24.8 s |
| `bindTypesFiles` | 13.2 s |
| `exportSigsFiles` | 12.6 s |
| total | 108.2 s |

`deno task bench:compile --all` prints that table, and `deno task bench:compile` the per-program one
above. **`blockedFiles` is the largest single phase and costs half again what emitting does** — to
produce an error message for a case that almost never fires.

So a cold build of everything is 108 s, of which 83 s is not code generation. Builds are cached
(`harness/buildCache.ts`), so this is paid once per program rather than once per test — but a change
to a widely-imported file invalidates most of the graph, and with three agents sharing one box that
happens often. `issues/system/0154` is about the suite being slow at the push; this is a large part
of what it is waiting for.

It costs memory on the same pattern. Peak RSS for one phase, each in its own process so a
collection during one does not show up as another's saving — `VmHWM`, against a baseline process
that binds wacc and stops:

| phase | peak MiB | above baseline |
|---|---:|---:|
| baseline (wacc bound, nothing compiled) | 129 | — |
| `diagnoseGraph` | 223 | 92 |
| `blockedFiles` | 279 | **153** |
| `emitFiles` | 240 | 111 |
| `bindTypesFiles` | 226 | 102 |
| `exportSigsFiles` | 225 | **101** |

`exportSigsFiles` returns one line per exported function and allocates 101 MiB to do it, which is
the same finding the timings give, in the other unit. All five in one process — a real build — peaks
at 320 MiB RSS for a 1.3 MB program.

Note what it is *not*: each `*Linked` call opens with `i32[512]`, `i32[65536]`, `string[32768]` and
`string[512]`, and I expected those to be the story. They are about 0.5 MB of a 100 MiB phase. The
cost is the parse tree, so trimming the fixed arrays would buy nothing — only parsing once would.

## What is actually repeated

Not just the parse. Each of the four `*Linked` walks runs the same prefix: `linkFiles`, `lex`,
`parseProgram`, `collectDeclarations`, `assignGlobals`, and then **`settleEmittable`** — the
emitter's fixed-point iteration over every declaration. `settleEmittable` has five call sites and
four of them are these walks. So what is recomputed is the whole front end and the settled `Env`,
not a syntax tree.

That is deliberate, and `emitBlockedOf` says why: *"The same fixed point the emitter runs, because
the answer has to be the same."* `issues/lang/0090` is what happens otherwise — the blocked report
and the emitter answered with different algorithms, and 29 of 335 files were missing an export the
report could not have mentioned. Running the identical analysis twice is how they were kept
honest. It is the right instinct and the wrong mechanism: **one analysis with two outputs** agrees
by construction and costs half as much.

The phases bound the shared part. `exportSigsFiles` is the prefix plus a cheap terminal walk and
costs 12.6 s, so the prefix is at most that; the four walks therefore repeat something like 36 s of
the repo's 108 s between them. `blockedFiles` is 37.2 s because its *walk* is expensive too — it
re-derives per declaration what the emitter is about to derive anyway.

So the shape to aim for is not "parse once and ask four questions". It is **settle once and emit
four outputs**: the wasm, the export signatures, the bind types, and the blocked reason all fall
out of one settled `Env`, which is the thing every one of them currently rebuilds.

## Notes

**Memoisation cannot fix this, and that is a language rule rather than an oversight.** wac has no
mutable globals, so wacc cannot hold a parsed `Program` between two calls even if it wanted to.
There is no cache to add. The only lever is the shape of the API.

The author already hit this once and solved it the right way. `manifestFiles` takes the emitted
module as a *parameter* rather than emitting it again, and says why: "compiling twice to answer one
question is the kind of thing that makes a self-hosted build slower than the one it replaces." The
other four calls are the same situation, unaddressed.

Two shapes would work:

- **One call that answers everything.** `buildAll(paths, sources, entry)` returning a struct with
  the wasm, the export signatures, the bind types and the blocked reason — link, lex and parse once,
  then run the four walks over the one `Program`. This suits the no-mutable-globals rule exactly:
  one call, one parse, no state held across the boundary.
- **An opaque handle.** `open(paths, sources, entry)` returning a reference the host passes back to
  each query. More flexible and a worse fit — it needs a large AST to survive as a host-held
  reference, and every caller has to remember to close over it.

The first is the one to do. The work is not the design, it is that `bindTypesLinked` and
`exportSigsLinked` lex and parse inline, so they would need `…OfProgram` inner forms the way
`emitLinked` and `blockedLinked` already have `emitModuleOfWith` and `emitBlockedOf` taking a
pre-linked blob. That is a refactor inside `emit.wac`, which is 7,600 lines and under everything, so
it wants doing deliberately rather than alongside something else — which is why this is filed rather
than fixed.

**A cheaper partial, if the full change waits.** `blockedFiles` alone is 1,498 ms of box's 5,039 and
runs on every build to produce a message for a case that almost never happens — it answers "why was
this module not emitted in full". Emitting a blocked program is safe (that is what "not in full"
means), so the call could move after `emitFiles` and run only when something downstream declines,
which is roughly 30% of a build for a change confined to `harness/waccBuild.ts`. It is a real trade
rather than a free win: today a blocked program is caught eagerly with a clear message, and
deferring it means a partial module gets further before anyone says why. Worth someone's judgement,
not mine to decide unilaterally.
