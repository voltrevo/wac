# 0183 — mutation scoring runs `deno test`, and twenty packages no longer have one

- **Status:** open
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** no error — a measuring tool that withdraws from what it cannot see

## The measurement

Twenty packages under `packages/` now hold wac tests and **no `.test.ts` at all**:

    abi bignum bls bytes codec datetime ens fmt fs gzip lightclient mpt regex rlp ssz std tty
    unicode url zstd

`tools/mutate.ts` runs a mutant's tests with `testCommand`, which is a `deno test` over directories. For
one of those packages that finds nothing:

```
$ deno test --no-check --quiet --allow-read packages/gzip/
error: No test modules found                                    # exit 1
```

A scope whose baseline run fails is *unmeasurable* by design, and the tool says so — correctly, in a line
this file's own comments twice describe as reading like somebody else's problem:

> A red baseline looks like a broken suite; the suite was green. The tool had withdrawn itself from the
> repository's measurements and said so in a sentence nobody had reason to disbelieve.

`--package gzip --dry-run` still plans **40 mutants**, because planning reads sources and not test
modules. So the shape here is: the plan says forty, the run says nothing is measurable, and the
difference is a `deno test` that finds no files.

## Why it happened

`issues/system/0161` is moving the suite off Deno, and it is working: 122 `.test.ts` files were deleted
today and 82 `*_test.wac` added. The suite runner grew a third lane for those (`wac test`, 186 files,
186 ok tonight). The mutation tool did not — its unit of execution is still a Deno run, and it was never
told the tests had moved.

This is the same class as `issues/system/0005`'s history and as
`issues/lang/0112`: a measurement that stops seeing a construct reports a *better* number, or in this
case no number at all, and nothing else fails.

## What it would take

The pieces already exist and are already tested:

- `tools/mutate/native.ts` has `WAC_BIN` and `wacTestArgs(entry, filter)`, and its comment sets out the
  exit-code contract — `3` is "ran and failed", which is a kill; `4` is "nothing ran here", which must
  never read as one. `tools/mutate/native.test.ts` pins that mapping against the binary, including a
  fixture that fails on purpose.
- `tools/mutate/profile.ts`'s `nativeShare` already runs `wac test --coverage` per entry and reads the
  profile it writes.

What is missing is `mutate.ts` choosing that path for a scope with no `.test.ts`: the entries to run are
the `*_test.wac` files under the package, the filter is a test name rather than a Deno name (so
`denoTestName` translation is *not* wanted on this path), and the deadline machinery in
`tools/mutate/deadline.ts` needs a baseline measured the same way.

**A caveat worth measuring before building it:** a `wac test` run compiles its entry, so the per-mutant
cost is a compile plus a run rather than a Deno startup plus a run. Whether that is faster or slower than
the Deno path for a package like `gzip` is the first thing to find out, because the native lane was
introduced *for* speed and this would be its first load-bearing use.

## What must not be done

Do not let a scope with no tests score mutants as survived. It does not today — the baseline is red and
the mutants are excluded — and that is the safe direction. The fix is to give those scopes a real test
run, not to relax the baseline check.

## The measurement this asked for — 2026-08-17 21:03–21:10, agent-c

Taken on a quiet box: load average 0.94, no suite running, nothing else of mine in flight. `packages/gzip`
both ways, the Deno side from a worktree at `6b6f22a4` — this morning, before the package was converted.

**Whole package, which is *not* a runner comparison:**

| | |
|---|---|
| `wac test packages/gzip/test/wac/` | 37.3 s, 40.1 s — 15 files, **127 tests** |
| `deno test packages/gzip/` at `6b6f22a4` | 5.9 s, 5.5 s — **71 tests** |

The difference is not overhead. Two entries hold 36.6 s of the 38: `fuzz_test.wac` at 26.8 s and
`stream_test.wac` at 9.8 s, both differentials that spawn the real `gunzip` per case — three `exec(` sites
in `fuzz_test.wac` alone. The other thirteen entries total 5.4 s. The wac suite is also 127 tests against
71: it does more, and a package-level figure compares suites rather than runners.

**Per unit, which is what a mutant actually costs:**

| | |
|---|---|
| `wac test <one entry>` — `crc32_test.wac`, 5 tests | **125 ms** |
| `wac test <one entry>` — `inflate_test.wac`, larger | **949 ms** |
| `deno test <one file>` — `inflate.test.ts`, 8 tests | **603 ms** |
| `deno test --filter … packages/gzip/` (filter matches nothing) | **1 289 ms** |

So the native path's floor is a compile — about 125 ms for a small entry — where Deno's floor is a
process start plus a module graph, and pointing Deno at a *package* costs 1.3 s before it runs anything.
At the granularity mutation uses, the native path is competitive and usually cheaper.

**Which turns the question round.** The thing that decides the cost is not the runner but the
*selection*: pointing `wac test` at a whole package pays gzip's 38 s, of which 36.6 s is two differential
entries that almost no mutant needs. Running only the entries whose profile covers the mutated line pays
a fraction of a second. `nativeShare` already computes that mapping — per test, which points it reached —
so the selection this needs is the artefact the profiling lane was built to produce.

That also means the two slow entries are worth knowing about for their own sake: any mutation run that
takes them pays 26.8 s per mutant for one file's fuzz corpus, whichever runner executes it.

## Worse than unmeasurable: a mixed scope is green — 2026-08-17 21:15

The report above says the baseline is red and the mutants are excluded, which is the safe direction. That
is true only when *every* directory in the scope lacks tests. `testDirs` gives a mutant its own package
**and its dependents**, so the usual scope is mixed — and Deno does not object to a directory with no test
modules as long as another has some:

```
$ deno test --quiet … packages/bytes packages/wactest
ok | 0 passed | 0 failed | 12 filtered out          # exit 0
```

`packages/bytes` contributes nothing and nothing says so. So for a mutant in a wac-only package whose
dependents still have host tests:

- the baseline is **green**, not red, so the mutant is *measurable*;
- the tests that actually cover it — its own package's, now wac — never run;
- if no dependent's test happens to catch it, the verdict is **survived**.

A false survival is the one direction that costs work: it is a claim that nothing checks a behaviour,
about code whose tests exist and were not run, and `issues/system/0005` is a list of exactly that claim.
The safe reading in my first write-up applies only to a package nothing depends on.

A run over `--package bytes` is in flight to put a verdict on this rather than an inference; three mutants,
scope `packages/bytes packages/gzip`.

