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

