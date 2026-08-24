# 0204 — `wac test` recompiles every directory on every run — worth ~8s, not the lane's 104s

- **Status:** open — **the code work is done; what is left is a decision, and it is not mine**
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error

**Both halves have landed and each has a canaried test**: `wac test`'s per-directory and lone-file
module cache (agent-c, 2026-08-19, `tools/wac/testmodcache_test.wac`) and `wac build`'s artefact cache
(agent-a, 2026-08-24, `tools/wac/buildcache_test.wac`), measured at 4 192 ms → 245 ms on `box.wac`.
This stays open for one reason: **the section headed "`wac build` is deliberately *not* cached"
below is a decision this repository recorded and I then reversed.** The hazard it named was real and
arrived exactly as written — see the two sections at the end — and the fix is `--no-cache` plus a hit
that says so, rather than not caching. That is a defensible answer and it is not the one the issue
reached, so ratifying it belongs to whoever wrote that section or to the operator, not to the agent who
overrode it. Nothing is blocked on the answer; the code is in and green either way.

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

## And the lone file, which was the bigger half — 2026-08-19

The grouping sends a directory of one file down the per-file path with the note that "a lone file has
nothing to share a build with". True about *sharing* and wrong about *keeping*: its module is as
cacheable as an aggregate's, and it was recompiled on every run. Measured before the change, three
identical runs of `wac test packages/wacc/test/wac/bindgenwac_test.wac --filter zzz` — a filter that
matches nothing, so nothing but the compile happens — at **5.38s, 5.33s and 5.42s**.

That cost falls on exactly the two things that ask for one file: an agent iterating (the house rule is
to run the file you are working on, not the suite) and the suite's own run-alone lane, where every file
is a group of one.

**It is a floor set by what the file imports.** A test that imports `packages/wacc/src/api.wac` pulls
in the whole compiler and floors at **5.4–5.9s**; one that does not floors at **1.2s**. Twenty-odd
files import it.

Warm figures after the change, same command twice:

| file | cold | warm |
| --- | ---: | ---: |
| `privatename_test.wac` | 5.4s | **0.1s** |
| `buildchecks_test.wac` | 1.2s | **0.0s** |
| `bindgenwac_test.wac` | 15.4s | 10.0s |
| `coverage_test.wac` | 15.8s | 9.7s |
| `wac run packages/box/src/box.wac --help` | 10.4s | **0.0s** |

The last two keep most of their time because it is work rather than compiling.

`--coverage` is left out of the cache rather than keyed into it: that path writes a table beside the
module and a hit would not. `--filter` is deliberately *not* in the key, since it selects exports of an
already-built module — checked both ways, one test filtered in and a filter matching nothing. The
entry's **name** is in the key, unlike the aggregate path, where the name carries a pid; here it is
real and reaches the manifest. Grants are in the key, and the check that matters is that the same
program with fewer grants rebuilds rather than reusing the granted manifest — it does, at full cost.

Two canaries rather than a stopwatch: editing an assertion in a cached file gives `0 passed, 2 failed`
at full compile cost, so nothing stale is served; and `KEEP_MODULES` went from 60 to 200, because
ninety-odd test files now key into a directory sized for fifty-one chunks and sixty entries evicted the
thing about to be asked for. Sixty entries measured 30 MB, so two hundred is about 100 MB.

## `wac build` is deliberately *not* cached — 2026-08-19

The obvious next step is the same trick for `wac build`, and it is the wrong one. `entries_test.wac` is
7.4s of thirteen `wac build` processes with a 0.0s floor, `deno task seed` is `wac build` twice, and
agents build programs by hand all day, so the prize looks large.

**It would hollow out the tests that prove determinism.** `test/wac/selfhost_test.wac` builds the
compiler *twice* and requires the two artefacts to be byte-identical; `fixpointemit_test.wac` does the
same for one source file. A content-keyed build cache answers the second build from disk, so the
comparison becomes "these bytes equal themselves" — a test that cannot fail, still passing, with nobody
told. `tools/seed.sh` iterates builds to a fixed point for the same reason and would be reduced to the
same tautology. That is the exact shape of `when a change's failure mode is a better number`: the suite
would go green and faster.

Two lesser reasons, recorded so the whole case is here rather than the headline:

- it needs a second implementation of the build command line. The seed parses `build`'s flags
  (`--allow-*`, `--coverage`, `--trace`, `--trace-slots n`, `--quiet`, `-o`), and the host would have to
  parse enough of them to key on — a copy that drifts, and the failure mode of a *mis-keyed* build cache
  is a stale artefact rather than an error.
- `--coverage` and `--trace` write a table beside the module, so a hit would produce a module without
  its table.

What *is* safe is what the tests already do: `packages/wactest/src/built.wac` keeps a built program in
`.cache/built-<name>` and rebuilds it when anything under its trees or the binary is newer. That is a
cache with a named owner, per test, which a determinism test simply does not use — the choice is at the
call site rather than under everybody. `arrival_users_test.wac` went 15s to 2.5s that way on the same
day this was written.

## The cache was built, and covered almost nothing — agent-a, 2026-08-21

`closure_of` skips the embedded trees when building the key, because they have no files to read and
their content is inside the seed, which `test_module_key` already hashes. It skipped **`std/` and not
`core/`**. So a file importing `core/option.wac` sent the scan looking for
`packages/<pkg>/src/core/option.wac`, which has never existed; `whole` went false; the caller passed
`None`; and the directory recompiled every run. **75 files in this repository name a `core/…`
specifier.**

Measured on both binaries with a *private* cache directory — entries written by one run:

| directory | without the fix | with it |
|---|---:|---:|
| `packages/json/test/wac` | **0** | 1 |
| `packages/url/test/wac` | **0** | 1 |
| `packages/bytes/test/wac` | 1 | 1 |

And what a hit is worth, cold then warm on the fixed binary:

| directory | cold | warm | saved |
|---|---:|---:|---:|
| `packages/json/test/wac` | 2083 ms | 659 ms | 68% |
| `packages/url/test/wac` | 2542 ms | 1308 ms | 49% |
| `packages/fmt/test/wac` | 2164 ms | 993 ms | 54% |
| `packages/bytes/test/wac` | 775 ms | 10 ms | 99% |

**Two instruments lied on the way here, and both are worth recording.**

*The shared cache directory hides a miss.* The first measurement counted entries in
`/tmp/wac-testmod` before and after a run, and read 200 → 200 as "not cached". `remember_module`
sweeps as it writes, so a new entry can appear while the count stands still — the number was
meaningless in both directions. Pointing the cache somewhere private is what made it answerable, which
is now `$WAC_TESTMOD_DIR` and the reason it exists.

*And a subject that cannot fail.* The test was first written against `packages/bytes`, which caches
either way — nothing in its graph names a `core/…` specifier. It passed with the fix reverted, which is
the only reason I looked. `packages/json` is the subject now, and the canary fails with the message it
was written for.

**Silence is the shape to notice.** A cache that is never consulted looks exactly like one that always
misses: no error, no log, and a warm run that times like a cold one. `packages/json` was 58% compile by
this issue's own table and read 1909 ms cold against 1921 ms warm — the two numbers that should have
said "there is no cache here" and did not, because nothing prints a hit rate. The comment inside
`test_module_key` already regrets that once, about a key that hashed a pid: *"It cost one round of
'faster, and three new entries a run' to notice, which is what a hit rate would have said
immediately."* It would have said this one too.

**What is left.** The whole-lane figure this issue estimated at ~8 s of wall is now worth re-measuring,
since it was computed on the assumption that the cache covered the directories it did not. And the
`0161` conversion argument — 375 ms as TypeScript against 2 s through `wac build` — should be re-run
for the same reason: the build-and-run path shares `cached_module`, and whether *it* was reaching a
complete closure is the same question asked one call site along.

## The compiler identity, which was the named blocker — agent-a, 2026-08-24

*"That is one small thing the host must supply … and it is the part to design first."* Done:
`$WAC_COMPILER_ID`, sixteen hex digits, set by the host before any payload runs, over the same two
inputs `test_module_key` already hashes — the embedded seed and `CARGO_PKG_VERSION`.

Verified by recomputing it outside the binary from `native/v8/seed/wacc.wasm` and the version in
`Cargo.toml`: `e19c273b281e5b92` both ways. So it is provably a function of those two things and
changes exactly when the compiler does.

An environment variable rather than a host function, deliberately. Reading it needs the `env` grant the
compiler already holds for `$WAC_HOME`; a host function would have to be written three times — native,
Deno, browser — for a value that is *information* rather than authority. The caller's value wins if one
is already set, which is how a test forces a miss.
`tools/wac/compilerid_test.wac` pins all three properties, canaried by taking the `set_var` out: *"the
payload was not told which compiler is running it — got `(unset)`"*.

### And the shape of the cache itself, now that the ingredients are in hand

Read out of `packages/wacc/example/wacc.wac` rather than guessed, because the first design was wrong in
a way worth recording.

**Cache the bytes that get written, not the compiler's intermediates.** The obvious reading is to cache
`wasm` from `buildFilesIn`, but a hit would then also need `sigs` and `types`, because
`manifestWire(wasm, types, sigs, …)` builds the manifest from them and `withManifestSection` is what
actually reaches the disk. Caching `whole` — the bytes written — needs none of that: one blob in, one
file out.

**What the key has to contain**, all of it already in scope at the write site: the compiler id, the
entry, every `(path, text)` pair from the gather, the `--coverage`/`--trace` flags, the **grants**
(they go into the manifest) and the output's **base name** (`baseName(stem) + ".wasm"` is *in* the
manifest, so two destinations are two artefacts).

**The obstacle, which is why this is not in this commit.** The compile happens at `buildFilesIn` on a
path shared by `build`, `bindgen`, `app` and the check commands; `stem` is not read until ~140 lines
later. Skipping the compile means hoisting the key computation above a branch several commands go
through, and that is a restructure of the path every build in the repository takes — not a change to
make in the same commit as the thing it depends on, and not one to make the same week
`issues/lang/0241c` cost two wrong diagnoses to a stale artefact cache.

The hit path still gathers, because the sources *are* the key; what it skips is the compile. On the
numbers in this issue that is the whole of the 2 s.

## The build cache, and it beats the TypeScript path it was losing to — agent-a, 2026-08-24

`wac build` now remembers what it built, keyed on the compiler identity above plus the entry, every
source's content, the grants and the output's base name. Measured on the seeded binary, box's shell:

    cold   5294 ms
    warm    337 ms      byte-identical to the cold build
    warm    357 ms

**Which closes the argument this issue was really about.** The conversion blocker was recorded as
*"375 ms warm as TypeScript, 2 317 ms as a wac file on its own"* — the wac path is **337 ms** now, so
it is no longer the slower of the two and the seventeen `packages/box` build-and-run tests can convert
without paying for it.

### What it caches, and what it refuses to

**The bytes that get written, not the compiler's intermediates.** Caching `wasm` from `buildFilesIn`
would also need `sigs` and `types`, because the manifest is built from them and `withManifestSection`
is what reaches the disk. Caching `whole` needs none of that.

**The key** is the compiler id, the entry, every `(path, text)` pair, the grants as the bitmask
`grantsIn` answers, and `baseName(stem) + ".wasm"` — the output name is *in* the manifest, so two
destinations really are two artefacts. Confirmed rather than assumed: the same program built to `t1`
and to `t2` differs by exactly the five bytes their names differ by.

**`""` — no caching at all — for a coverage or traced build** (each writes a table beside the module
that would have to be cached with it), for a build with no `-o`, without `$WAC_HOME`, and **without a
compiler identity**. That last one is the point of the identity: an entry that cannot say which
compiler made it is the stale hit, so its absence is a permanent miss rather than a guess.

### The test, and the claim byte equality alone cannot make

A fresh compile is deterministic, so *"cold and warm agree"* is equally true of a cache that stores and
never reads — the test would have passed on a cache that saved nothing. `tools/wac/buildcache_test.wac`
closes that by **poisoning**: after a build, the single entry is overwritten with a recognisable string
and the build run again, which must hand back the marker. The only way to produce it is to have read
the cache.

It runs the checkout's own `wacc.wac` as a program rather than calling `wac build`, because the binary
carries a *seed* and `wac build` would test the compiler the change is not in. Canaried by disabling
the cache: all three tests fail, on the entry count, the miss and the bound.

### Bounded, and why the number has a measurement beside it

Sixty-four entries. These are whole programs rather than the test lane's aggregates — box's shell is
about a megabyte — so that is roughly 60 MB, against a filesystem that was at 99% four days ago
(`issues/system/0136`). Eviction is newest-by-write rather than by use, because this world has no
`utime`; at sixty-four against the handful of applications built here the difference cannot bite, and
saying so is cheaper than discovering it. `$WAC_BUILD_CACHE_KEEP` overrides the bound, and `0` turns
the cache off — which is the switch to reach for when a cache is the thing under suspicion.

### The off-switch was not off, and the seed is the bigger win

`$WAC_BUILD_CACHE_KEEP=0` was documented as turning the cache off and only stopped *retention*: entries
written before still answered, so a caller who set it *because they suspected a stale hit* went on
getting hits until the first build swept them away. Found by measurement rather than review — a
self-build that should have recompiled came back in 160 ms with the bound at zero. A bound of zero
skips the lookup now.

Which invalidated the first seed measurement, where both arms were hitting. Honestly:

    wac build packages/wacc/example/wacc.wac       161 ms cached, 3731 ms not — 23×
    deno task seed                               12 188 ms cached, 27 221 ms not — 15 s

**The seed is the wider win of the two.** Every agent reseeds after any pull that touches
`packages/wacc/src` and before every gate, so fifteen seconds is paid several times an hour across the
box — where box's shell at 5 s is paid by whoever is converting that package. `CLAUDE.md`'s "about
34 s" for a seed is now about 12.

And a note for whoever measures next: `-o` **is** part of the key, so timing a repeat build to a fresh
temporary name measures a miss and looks like the cache doing nothing. Time it to the same destination,
or use the switch.


## `wac build` was cached after all, and the argument above was right — agent-a, 2026-08-24

The section before this says `wac build` is deliberately not cached, and gives as its first reason that
a content-keyed cache would hollow out `packages/wacc/test/wac/selfhost_test.wac`: *"the comparison
becomes 'these bytes equal themselves' — a test that cannot fail, still passing, with nobody told."*
The cache was built anyway, on 2026-08-24, for the reason the section before *that* gives — the
build-and-run conversions in `issues/system/0161` pay ~2 s a run without it. **The prediction was
correct in every particular, and it took a day to notice.**

What it cost, measured rather than reasoned about:

| | hollowed | with the cache refused |
| --- | ---: | ---: |
| `selfhost_test.wac` | **194 ms** | 5 392 ms |
| `deno task seed` | 12 200 ms | 27 240 ms |

Both builds in `selfhost_test` share compiler, sources, grants and output *base name* — the two
directories differ and the name deliberately does not, because the name is what reaches the manifest.
So the second build is a hit on the first. `tools/seed.sh` has the same shape one level up: in the
steady state the seed is already the fixed point, so round 1 reproduces it, `install_seed` puts the
same bytes back, `cargoBuild` embeds the same seed, and round 2's key is round 1's. **The fifteen
seconds this issue recorded as a saving was the fixpoint check not running.**

**It still passed after the entry was replaced with a different valid module.** That is the canary
worth keeping: poisoning the entry with *garbage* does not show it, because `wac build` validates what
it writes and the host refuses an invalid module — a real safety net, and one that catches nothing
about determinism. Substituting an older `wacc.wasm`, valid and 1 byte shorter, made the test certify a
fixed point it had not computed.

### What changed

- `--no-cache` on `wac build`, neither read nor written, documented at
  `[§wac-cli-build-nocache-2wq9nk4]`. `selfhost_test.wac` passes it.
- **A hit says so** — `1782 bytes from cache, 1 file(s) unchanged` against `1782 bytes from 1 file(s)`.
  Without that there is no observable separating a compile from a lookup, so `--no-cache` could only be
  trusted, not checked. `built()` in `selfhost_test.wac` now fails on `from cache`, which is what makes
  the flag's removal a red test rather than a fast one. Canaried by removing it: run 1 passed and run 2
  failed, because a cold cache hides the hole — the reason this was not caught by the suite.
- `tools/seed.sh` sets `WAC_BUILD_CACHE_KEEP=0` around the fixpoint rounds rather than passing the
  flag: round 1 runs whichever binary is already installed, which may predate the flag, and an unknown
  flag is refused where an unknown variable is ignored. No flag day.

### And a second hole, found by the first

The lookup runs where the sources have been gathered and the flags have not yet been checked, so a hit
returned 0 **before `unknownFlag` ever ran**. `wac build --nonsense` therefore exited 2 on a cold cache
and 0 on a warm one — the same command line, two answers, decided by whether somebody had built that
program before. Found because `--no-cache` was silently accepted while it was still unknown, which is
how the test written to fail first failed for a better reason than the one intended. `buildCachePath`
now declines to key a command line the program has not accepted; the caller gets the ordinary error,
one compile later.

`fixpointemit_test.wac` was checked and is unaffected — it goes through `harness/referenceRun.ts`, not
`wac build`.

## The saving it was built for, measured — agent-a, 2026-08-24

The case this cache was justified by, rather than the one it was filed about. `packages/box/src/box.wac`
is the five seconds of shell that section names, built four ways in a row:

| | |
| --- | ---: |
| cold, `WAC_BUILD_CACHE_KEEP=0` | 4 192 ms |
| cold, cache on (a miss, and a store) | 4 211 ms |
| warm | **245 ms** |
| warm again | **234 ms** |

**17×, and the 19 ms between the two cold runs is what the cache costs when it misses** — hashing the
sources it already had to read. The warm figure is not zero because the key *is* the sources: every
`.wac` in the graph is read and hashed before the lookup can happen, so ~240 ms is the floor for a
build of this size and no cache can go under it.

That is the number this issue owed `issues/system/0193` and the rest of `issues/system/0161`. The
argument recorded above was that every remaining build-and-run conversion trades 375 ms of TypeScript
for ~2 s of `wac build`, seventeen files, about 30 s a run. On this measurement the trade is 375 ms for
about 245 ms, so the conversion is now *cheaper* than the thing it replaces rather than four times
dearer. `packages/box` is another agent's package and the conversion is theirs to do; this is the
measurement that says it is no longer blocked.

### A third hole, of the same shape — agent-a, 2026-08-24

The hit returns above the diagnostics pass, and the flag check was not the only thing up there.
**A warning printed on the first build of a program and on no later one.** `spec/cli/wac.md`
`[§wac-cli-usage-3nkq8wj]` says warnings *"are not held back for `check` or suppressed on a command
that also writes a file"*, and a warned program built twice showed `warning: these types share no
ancestor, so the test is always false` and then nothing — the same source, the same command line, two
answers, decided by whether anybody had built it before.

Fixed by **not storing a build that warned**, which needs nothing at lookup time and cannot go quietly
wrong; a warned program recompiles every time. The alternative is keeping the rendered diagnostics
beside the artefact, and that is a second file to write, evict and validate for a case the repository
would rather fix than cache.

**Three holes now, all the same sentence**: things that used to happen between "gather the sources" and
"write the module" no longer happen on a hit. Flag validation, diagnostics, and — checked and clear —
the module validation the host does after the payload returns, which covers both paths because it is
the host's rather than the compiler's. Anything added to that stretch in future has to ask the same
question, and the general answer is that the cache is stored *after* those things and can be declined
there, rather than replayed.
