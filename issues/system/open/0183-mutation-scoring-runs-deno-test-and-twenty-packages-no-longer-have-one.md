# 0183 — mutation scoring runs `deno test`, and twenty packages no longer have one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
