# 0204 — `wac test` recompiles every directory on every run, and that lane is 46% of the suite

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error

## What it is

The `wac test` lane has no build cache. Every run compiles every test directory's aggregate module
from source — the test files, plus everything they import, transitively — and throws the result away.
Nothing under `native/v8/src/` caches a compiled module; `.cache` there holds only the temporary
aggregate `.wac` file, deleted after the run.

The Deno half of the repository does the opposite and has for a while: `harness/waccBuild.ts`'s
`waccArtifacts` keys a compile on `compilerKeyParts()` plus the content of every file it reads, and
`packages/platform/build.ts` does the same for a whole application through `appKey`. A warm
`buildNative` of an example is 33-69ms *because* of that. The binary that does the same job by hand
pays full price every time.

## Why it is worth a number rather than a guess

`tools/runTests.ts` now prints where the suite's time goes, and the answer was not what anyone
assumed:

```
── where the time went
   the Deno pass      89s   39%  4 workers
   run alone          35s   15%  2 file(s), one at a time
   `wac test`        104s   46%  4 workers
   in the lanes      229s
```

The wac lane is the largest, and it is 416 CPU-seconds of work at four workers with near-perfect
packing — a chunk report in the same commit shows the queue's wall clock tracking work/workers
closely, so this is *work*, not scheduling. Cutting it means doing less, and compiling the same
unchanged sources 49 times a run is the least defensible work in it.

**How much of that is compiling depends on the directory, and the two ends are far apart:**

| directory | files | one run | compile alone | compile share |
| --- | --- | --- | --- | --- |
| `packages/json/test/wac` | 9 | 653ms | 378ms | **58%** |
| `packages/crypto/test/wac` | 19 | 11.6s | not measured | small — the tests do real crypto |

Measured with `WAC_KEEP_AGGREGATE=1` to keep the generated aggregate, then `wac build` on that file
alone, which is the compile with no run at all.

So the win is somewhere between "a sixth of the lane" and "most of it", and **sizing it needs the
compile share of the biggest chunks** rather than of the two I happened to pick. The lane's new
report names the slowest three every run, which is where to take that measurement.

## What is not the problem

**Chunking is not multiplying the compile work**, which was the first thing suspected: a directory of
more than twelve files is split, and each chunk compiles the shared graph again. On `packages/crypto`
that costs 0.4s of 12s — 3% — while halving the wall clock. Worth re-checking on
`packages/wacc/test/wac`, whose graph is large and whose tests are cheap, since that is the shape
where it would bite.

## The decision this needs

The work is in `native/v8/src/main.rs`; the part that needs a decision is the key, because a stale
hit is a wrong answer rather than a slow one.

- **What identifies the compiler.** The seed (`native/v8/seed/wacc.wasm`) is gitignored and per-agent,
  and it changes whenever `packages/wacc/src` does. Hashing it is honest and means the cache misses
  every time wacc changes — which is often, and is exactly when a wrong hit would be worst.
- **What identifies the sources.** The transitive graph, not the entry: the compiler resolves imports
  itself, so the honest key is *what the build actually read*. Recording reads during the compile and
  keying on those contents needs no second resolver — the failure mode of a hand-listed graph is a
  hit that misses a file, which is the bug this whole issue would introduce.
- **Where it lives.** `.cache/` is per-checkout and already swept (`0136`); `$WAC_HOME/cache` is
  shared across an agent's checkouts. The first is safer, the second helps more.
- **Whether a wrong answer is possible at all.** `deno task seed`'s fixpoint check would catch a
  stale compiler but nothing would catch a stale *test* module, so the cache needs its own way of
  being proved: a canary that a poisoned entry fails the run rather than passing it.

## What it costs to not do

104s a run, of which some large fraction is recompiling code that did not change, on a box where
three agents share five cores and the suite has a twenty-minute cooldown because of it.
