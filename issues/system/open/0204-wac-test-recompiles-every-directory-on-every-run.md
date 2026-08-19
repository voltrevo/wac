# 0204 — `wac test` recompiles every directory on every run — worth ~8s, not the lane's 104s

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
closely, so this is *work*, not scheduling. Cutting it means doing less — and recompiling unchanged
sources 49 times a run looked like the least defensible work in it, which is why this was filed. The
measurement below says it is 9% of the part that matters, and that is the finding rather than the
cache.

**How much of that is compiling: 9% where it matters.** Measured with `WAC_KEEP_AGGREGATE=1` to keep
the generated aggregate, then `wac build` on that file alone — the compile with no run at all.

| directory | files | one run | compile alone | compile share |
| --- | --- | --- | --- | --- |
| `packages/wacc/test/wac` (one chunk of 11) | 11 | 24.1s | **2.25s** | **9%** |
| `packages/json/test/wac` | 9 | 653ms | 378ms | 58% |
| `packages/crypto/test/wac` | 19 | 11.6s | not measured | small — those tests do real crypto |

**So the headline this issue was filed with is wrong, and the correction is the useful part.** The
compile share is large only where the total is small. `packages/json` is 58% compile and 0.65s;
`packages/wacc` is 9% compile and 24s, and it is the lane's three slowest chunks — 86s of 334s. The
aggregate there is 54 files and a megabyte of wasm, and it compiles in 2.25s.

A cache is therefore worth roughly **30s of the lane's 334s of work — about 8s of wall** — which is
real, cheap to keep honest, and not the thing to do first. **The lane is dominated by test execution,
not compilation**, and that reframes the brief it came out of: what is left in this suite is mostly
work that is genuinely being done, so the next lever is which tests belong in a lane everyone waits
for (`// test-lane: heavy`, with a measured cost) rather than how fast the compiler is.

The measurement that would change this answer is a directory with a large graph *and* cheap tests.
`packages/wacc` looked like that shape and is not: its tests emit modules and spawn processes.

## What is not the problem

**Chunking is not multiplying the compile work**, which was the first thing suspected: a directory of
more than twelve files is split, and each chunk compiles the shared graph again. On `packages/crypto`
that costs 0.4s of 12s — 3% — while halving the wall clock, and on `packages/wacc`, the case that
looked worst, the shared graph is 2.25s, so four chunks cost about 7s of extra work across the whole
lane and buy three-quarters of that directory's wall clock back. It stays.

## It also blocks the rest of `0161` — 2026-08-18

The suite arithmetic above makes this issue look small. The conversion work does not, and that is the
better argument for it.

`issues/system/0161` is moving TypeScript tests to `*_test.wac`, and `packages/box` is the largest pool
left — seventeen files. Many of them **build an application and run it**, which is the shape this
repository's capability model asks for: the grants a program has are the ones its build declared. On the
Deno side that build is 375 ms because `buildApp` reuses a content-keyed artefact. Through `wac build`
the same build is ~2 s, every run.

Measured on `packages/box/test/pipeUngranted.test.ts`, converted and then reverted for this reason
(`issues/system/0193` carries the table): 375 ms warm as TypeScript, 2 317 ms as a wac file on its own,
and **+2.1 s marginal** inside `packages/box/test/wac` — 11.2 s to 13.3 s across seventeen files. The
per-directory aggregate (`0192`) does not help, because what recompiles is not the test's own graph but
the application the test shells out to build.

So every remaining build-and-run conversion trades 375 ms for 2 s until this exists. Seventeen of them
would be about 30 s a run — which is the same order as the whole saving estimated above, arriving from
the other direction.

**And the cache belongs on the wac side, not in the Rust.** `wac build` is
`packages/wacc/example/wacc.wac` — it resolves the import graph itself and prints "N bytes from M
file(s)" — so the artefact, the file set and the flags are all in hand there. What is *not* in hand is
the identity of the compiler doing the compiling: the seed is embedded in the binary and a wac program
cannot hash it. That is one small thing the host must supply — the seed's hash, as an environment
variable or a capability — and it is the part to design first, because a cache that cannot tell which
compiler produced an entry is the stale-hit bug this issue would introduce.

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

About 30 CPU-seconds a run of recompiling code that did not change — 8s of wall on five cores. Small
enough that the reason to do it is the hand-run case rather than the suite: `wac test` on one
directory pays its whole compile before running anything, which is 2.25s of a 24s wacc chunk and 378ms
of a 653ms json one, and that is the loop somebody sits in while fixing a test.

## Built, 2026-08-19 — and the saving is smaller than the compile share suggests

`native/v8/src/main.rs` now keys the built aggregate on the aggregate's own text, the content of every
`.wac` it reaches, the grants, `--coverage`, the binary's version and the embedded seed's bytes; hits
come from one shared directory, swept to the newest sixty.

Measured per directory, three runs each on a box three agents share:

| directory | no cache | cached |
| --- | ---: | ---: |
| `packages/json/test/wac` | 2 570 / 2 059 / 1 756ms | 1 906 / 1 027 / 1 370ms |
| `packages/url/test/wac` | ~1 850ms | ~1 570ms |

So **0.3-0.7s a chunk**, which over fifty-one chunks is 15-35s of the lane's work — a few seconds of
wall at four workers, and most of the benefit is an agent re-running one directory while iterating.

**The compile share overstated it, and that is worth recording.** Timing `wac build` on a kept
aggregate said 674ms of an 887ms run for `packages/url`; the cache saves about 280ms there. Two
reasons: `wac build` writes artefacts to disk that the in-process path does not, and the 887ms run had
no `--allow-run`, so its oracle-driven tests failed early and the denominator was too small. A share
measured with a *different command* than the one being sped up is a different measurement.

Two bugs on the way in, both of the shape this repository keeps producing:

- the key hashed the aggregate's *path*, which carries the pid, so every run wrote a new entry and hit
  nothing. It looked like "faster, and three new entries a run" — a hit count would have said it at
  once.
- a hit skipped `build_module`, which is where V8 is started, so the first cached run panicked with
  `Invalid global state`. It presented as a 4ms directory with no failures, which is exactly what a
  run that never happened looks like from outside.

