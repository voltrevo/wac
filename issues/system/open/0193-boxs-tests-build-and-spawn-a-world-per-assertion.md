# 0193 — box's tests build and spawn a world per assertion, and the differentials re-derive their oracle every run

- **Status:** open
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — 4m23s to ask 130 questions

## The measurement

`packages/box`: 130 tests, **4m23s** in the suite, 351 s run file by file.

| | |
|---|---:|
| test files, each its own Deno process | 26 |
| `buildApp` call sites | **71** |
| distinct entries built | 5 — `sh.wac` ×14, `sealedsh.wac` ×7, `imaged.wac` ×7, `boxsh.wac` ×2, `box.wac` ×1 |
| spawns of a built app | ~100 (79 in `box.test.ts` alone) |
| one compile of `sh.wac` | 5.4 s warm, 7.5 s through the CLI |
| one `buildApp` cache hit | 0.3–0.4 s |
| one spawn of the built shell | **132 ms** |
| the same assertion in-process | **0–2 ms** |

Heaviest files: `box` 59 s, `fuzz` 46 s, `backings` 32 s, `sealed` 20 s, `corpus` 19 s.

## The four changes

1. **Freeze the differentials into vectors.** The corpus runs bash *and* our shell once per script,
   946 times, twice per suite (`packages/sh` 14 s, `packages/box` 24 s). All 946 expectations are
   **11 KB** — 5 KB of stdout, 6 KB of stderr, largest single output 0.1 KB. `tools/shVectors.ts`
   captures them with the oracle's version in the header; the replay is a wac test. Ten cases stay live
   as a drift canary.
2. **Move the tests with no external oracle in-process** — about 60 of ~128. `Shell` with
   `sh.external = boxRun` inside a `Frame` is what `example/boxsh.wac` wires up, and the frame captures
   the output. `packages/box/test/wac/inprocess_test.wac` is the keystone: a pipeline through box's
   applets, 1 ms.
3. **Make grants a manifest rewrite rather than a recompile.** `buildApp` keys its cache on grants, so
   one program compiles once per grant *set* — seven in `box.test.ts` alone. Two builds differing only
   in grants are byte-identical up to **797 104**, and the `wac.manifest` section starts at **797 107**:
   87.6% identical, and `withManifestSection` appends. So compile once, append the manifest per set.
4. **`fuzz.test.ts` keeps bash and drops our binary.** Its own header says "heavy — 716 MB and 58s,
   spawning a built binary per case".

## What stays end to end

`sealing` (13) — a sealed session's claim is about the *real* machine, and an in-process substitute
would be testing the substitute. `sealed` (2), `node_shell` (1, the point is Node), `rasterterm_live`
(4, a real browser), and one build-and-spawn smoke test per area so the boundary keeps coverage.

`routes.test.ts` already asserts the in-process and spawned routes are one program, and that they are
genuinely two routes. That is the licence for change 2, and it stays as the gate.

## Related

`issues/system/0192` — the per-file compile that remains after this, and which must not be answered by
merging test files together.

**Measurement discipline for anything claimed here**: the same file measured 59 s cold and 27 s warm on
the same night. A saving is only a saving if the two runs are in the same cache state.

## Done: the compile no longer depends on the grants — 2026-08-18

`waccArtifacts` — the whole-program compile that `buildApp`, `wacTestRun` and `wacCoverage` all sit on —
takes no grants and never did; only the *application* cache key included them, so the same 180 files
compiled once per grant set. It is cached now on what it actually reads: the sources, the entry, and
whether the build is instrumented or optimised.

    {"read":true}                                      5 702 ms   (a real compile)
    {"read":true,"write":true}                           641 ms
    {"net":true}                                         528 ms
    {"read":true,"write":true,"net":true,"env":true}     560 ms

against **5 378 ms** for a fresh grant set before. Canaried against staleness, which is the only way this
change can be wrong: warm and unchanged is 212 ms, touching one of the 180 files costs 4 675 ms and
produces a new entry, and restoring the file returns to 118 ms.

**A cost to keep an eye on**: this is a second on-disk cache — 17 MB so far against `.cache/app`'s 105 MB —
and nothing prunes either. `tools/prune-deno-cache.sh` sweeps Deno's transpile cache and not this. One
entry per *source set* rather than per source-set-times-grant-set, so it grows more slowly than the cache
it saves work for, but it grows.

## Done: the backings differential is in wac, and covers 946 scripts instead of 40 — 2026-08-18

`backingsprocess_test.wac` built three binaries and ran `CORPUS.slice(0, 40)` through each: 120 processes,
**29.8 s**. It is `packages/box/test/wac/backings_test.wac` now — three `Fs` values in one process — and
runs the **whole** corpus, 946 scripts on three backings, in **7.6 s of which about 6 s is the compile**.
The Deno file keeps the one claim that needs processes, that an image outlives one and a sealed session
does not, and is **2.0 s**.

Two things the move found:

* the old sample was **vacuous**. Breaking the host arm outright made 2 of the 40 cases differ and 38
  agree — the head of the corpus is the shell language, not the world. That is what made running all 946
  the right answer rather than a better sample.
* `tools/corpusBackings.ts` says six scripts name an absolute path this machine has and are compared on
  two arms. It is **30**, measured with that file's own regex. The wac port agrees with it exactly, script
  for script, which is how the port was checked.

The corpus is thin on filesystem work either way — 43 of 946 scripts redirect anywhere — so a differential
about filesystems is mostly running scripts that never open one. Worth a corpus of its own; not filed yet.

## Done: the fuzz differential is captured vectors, and the generator is in wac — 2026-08-18

`fuzz.test.ts` ran four seeds × thirty scripts × two stdin shapes × two shells: **480 processes, 38 s**,
every suite run, to ask what bash does about scripts that are fixed by their seed.

* `tools/shellFuzz.ts` is `tools/wac/shfuzz.wac`. The port is exact and was **checked rather than
  assumed**: both grew a `--print` mode and were diffed byte for byte over **1,400 scripts and seven
  seeds**. The first attempt drifted — a `r.pick` inside an array literal is evaluated before the pick
  that chooses between its elements — and seed 1 agreed for ten scripts before it showed.
* `packages/box/test/fuzz-vectors.txt` is bash's answer to all 120, **11 KB**, captured by
  `--capture`. `packages/box/test/wac/fuzz_test.wac` replays them in process (**7.7 s, ~6 s of it the
  compile**) and keeps eight of them live against bash as the drift canary.
* `fuzz.test.ts` keeps the one shape a `Frame` cannot express — standard input open and silent, which is
  what wac-mono 0113 needed — and spawns 120 times for it: **19 s**, down from 38 s. That gap is
  `issues/system/0195`, and it is the only reason the file still exists.

One answer per script rather than one per stdin shape, and that is measured: bash answers **identically
for all 120** under both, checked by running both ways and diffing. The two shapes were never about bash.

**Found in passing** (`issues/system/0196`): the caret-blink browser test went red twice in full box runs
and green alone, on the *precondition* that 0159's fix left in front of its sampling guard. Its message
says a sample cost 1 ms, so the guard let it through — what was starved was the renderer, not the sampler.

## Where this stops, and why — 2026-08-18

`packages/box` measured file by file: **351 s at the start of this issue, 184 s now.** The suite (parallel,
both lanes) went from 4m23s to about 3m40s.

| | ms | |
|---|---:|---|
| `box.test.ts` | 23 828 | the coreutils differential, 26 tests, none over 3 s |
| `fuzz.test.ts` | 20 631 | 120 spawns for the held-open stdin shape — `0195` |
| `sealed.test.ts` | 15 725 | processes, deliberately |
| `notdir.test.ts` | 11 578 | ~90 spawns: GNU as oracle, twice per case |
| `routes.test.ts` | 11 202 | 80 spawns: called against spawned, which needs both |
| `shell.test.ts` | 8 528 | about spawning; cannot move |
| **`wac/backings_test.wac`** | **7 201** | 946 scripts × 3 backings — **6 s of it is the compile** |
| **`wac/fuzz_test.wac`** | **6 878** | 120 replays — 6 s of it is the compile |
| **`wac/corpus_test.wac`** | **6 702** | 301 replays — 6 s of it is the compile |
| **`wac/inprocess_test.wac`** | **6 101** | 3 assertions — 6 s of it is the compile |
| the other 19 Deno files | 500–5 200 each | one cached build and a Deno start |

**Step 2 — "move the ~60 tests with no external oracle in-process" — is now blocked by `0192`, and the
arithmetic says so plainly.** A `*_test.wac` that imports box's world costs about **6 s of compile**,
every run, because `wac test` compiles each file's import graph from scratch. The Deno files it would
replace cost **0.5–5 s each**. `pipeUngranted.test.ts` is 514 ms; moving it to wac would make it 6 s.

So the conversions that paid are the ones where spawning dominated — `backings` (29.8 s → 1.5 s + a
7.2 s wac file that also does 24× more work) and `fuzz` (38 s → 20.6 s + 6.9 s). What is left is either
about processes on purpose (`sealed`, `sealing`, `shell`, `routes`, `node_shell`, `rasterterm_live`,
and the 120 spawns `0195` forces) or already at the floor.

**The floor is the work now**, and it is the same shape in both lanes: a per-file cost paid to ask a
handful of questions. `0192` on the wac side is worth more than every remaining conversion in this issue
put together — 205 wac test files at ~6 s of compile each — and it is what would make the other ~60
assertions nearly free to move.

