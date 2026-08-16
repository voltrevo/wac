# 0163 — profiling compiles with the reference, so a wacc-only package contributes no coverage at all

- **Status:** closed
- **Fixed in:** this commit
- **Closed by:** agent-b, 2026-08-16
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** bug
- **Symptom:** wrong answer, no error

## Reproduction

```
$ WAC_PROFILE=/tmp/p deno test --no-check --allow-all --unstable-net --quiet \
      packages/zstd/test/fse.test.ts

error: (in promise) Error: wac compile failed for packages/zstd/src/fse.wac:
  packages/zstd/src/fse.wac:26:27 [typecheck] type 'u32' has no method 'leadingZeros'
FAILED | 0 passed | 1 failed
```

The same file without `WAC_PROFILE` passes, and `packages/zstd` is green in the suite.

Expected: profiling a package builds it the way the suite builds it, and records what its tests
reach.
Actual: **every test file in `packages/zstd` fails to compile under profiling**, so the package
contributes nothing to the coverage profile that `tools/mutate.ts` selects tests from.

## Where

`harness/wacBind.ts`, in `wacBind`:

```ts
const profiling = profileDir && !opts.asTool;
if (!profiling) {
  // the cached path — this is where `WAC_WASM_FROM`/`waccWasm` can substitute wacc's output
}
const result = wacCompile(files, entry, profiling ? { coverage: true } : {});
```

`wacCompile` is the **reference** compiler, and this is sharper than "the other path can use wacc":
`bindFrom` *defaults* to `wacc`, so `waccGlue` handles an ordinary bind and the reference is never
asked anything. Profiling was the sole remaining caller of it. The reference is a documented subset —
`spec/README.md` and `design/lang/0003` say so — so a package using anything only wacc has cannot be
profiled. `u32.leadingZeros` is the one zstd hits; it will not be the only one, and the set grows
every time somebody adds a feature to wacc, which is the intended direction of travel.

## Why it matters more than one red file

The failure arrives as one line among 380:

```
  profile: packages/zstd/test/decode.test.ts exited 1; using partial coverage
```

`buildProfile` is right to continue — a file that dies early still contributed whatever it covered —
but "partial" here means *none*, and nothing distinguishes the two. In a `--package gzip` run that
line appears seven times for zstd inside a 26-minute profiling pass, next to two other files whose
failures have a different cause entirely.

The consequence is under-selection, which is the failure mode this profile exists to prevent and the
one that reports as a **better score**. Two shapes, and the second is the bad one:

- A line only zstd's tests reach is not in `known` either, so the mutant **widens** and runs its whole
  scope. Slow, correct.
- A line zstd's tests reach *and* some other package's tests also reach **is** in `known`, with the
  zstd tests missing from its list. `selectTests` narrows to the tests it can see, `filterFor` builds
  a `--filter` that excludes the zstd ones, and a mutant they would have killed is scored a survivor
  — or, worse, is scored killed by whatever else ran and nobody asks again.

Neither is visible from the score. `deno task mutate --package gzip --explain-selection` is the
cheapest way to see it: it prints the plan per mutant without baselines or runs.

## Notes

Two other files failed in the same pass and are **not** this bug — worth saying so that whoever
takes this does not go looking for one cause:

- `packages/wacc/test/tour.test.ts` — *"wacc computes the tour's answers, and the reference is the
  oracle"* fails at `harness/wacProfile.ts:174`, inside the test rather than at compile.
- `packages/platform/test/platform.test.ts` — *"an application builds to one executable file and runs
  repeatedly"*, 16 passed 1 failed. An instrumented build is a different artifact, and this asserts
  on the artifact.

Those two are tests that do not hold under instrumentation, which may be correct behaviour stated
badly. This issue is only the first.

## What a fix has to keep

The profiling build is deliberately its own thing — *"the instrumented build is a different binary,
and it is used for attribution only, never for deciding whether a mutant was killed"*. So the fix is
to let the profiling path take wacc's code the way the cached path can, not to make attribution
share the cached artifact. `harness/waccBuild.ts` already exposes `emitFilesCovered`, which is a
coverage build from wacc — the same call `wac test --coverage` goes through.

There is a second route worth weighing at the same time, because it removes the question rather than
answering it: `wac test --coverage` writes the same profile natively for the 83 wac test files, and
`issues/system/0161` step 2 is about `tools/mutate.ts` reading those. A wac test file compiled by
`wac` is compiled by wacc by definition, so that path has never had this bug.

## Fixed — 2026-08-16

`waccGlue` takes a `coverage` flag and returns the point table with the glue: `emitFilesCovered`
instead of `emitFiles`, and `covTableFiles` parsed into the same `{index, file, line, col, kind}`
the reference's `CoveragePoint` already is. `wacBind`'s profiling branch asks it first and falls
back to `wacCompile` only when `bindFrom` is pinned to the reference — so the two paths cannot
disagree about which compiler was measured.

**Two halves, and the second is why this was not a one-line fix.** Swapping the compiler made zstd
compile and then fail on `mod.__cov_init is not a function`: `packages/wacc/tools/waccBindgen.ts`
writes the three counter wrappers only when told the build is instrumented, so without
`{ coverage }` the exports are there in the wasm and nothing can reach them. That is the same shape
as the bug — a module that builds and contributes nothing — so the test asserts a non-zero point
count rather than exit 0, and both halves were canaried separately.

The parse is now `parseCovTable` in `harness/waccBuild.ts`, exported rather than copied: a counter
index means nothing without that table, so a second copy would put attribution wrong everywhere
while every count stayed plausible.

**One of the two files I excluded above was this bug after all.** `packages/wacc/test/tour.test.ts`
passes now — its subject was compiled by the reference under profiling, and the test's own name says
the reference is the *oracle*, which is what made the failure look like a disagreement rather than a
build. Eight of the nine files that failed under `WAC_PROFILE` are fixed. The ninth,
`packages/platform/test/platform.test.ts`'s *"an application builds to one executable file and runs
repeatedly"*, is genuinely the other cause: an instrumented build is a different artifact and that
test asserts on the artifact. Worth a look by whoever owns it; it is not this.

`harness/profileCompiler.test.ts` holds it, with a companion test asserting the reference still
*refuses* the subject — otherwise the day it gains `u32.leadingZeros` the check keeps passing and
stops testing anything, satisfied by the bug it was written for.

## What the fix actually moved — paired, 2026-08-16

The same `--explain-selection --package gzip` either side of it:

| | tests attributed | covered lines | selection |
|---|---:|---:|---|
| before | 1783 | 24,853 | 20 narrowed, 20 widened, 0 unhit |
| after | 1825 | 24,662 | 20 narrowed, 20 widened, 0 unhit |

**Selection did not change**, and that is worth stating plainly against the argument above. The
under-selection this describes — a shared line narrowed to a filter excluding the missing tests — is
a shape the bug *makes possible*, not one observed here. Forty gzip mutants split the same way
before and after. What is measured is the profile: 42 tests that contributed nothing now do.

**And the covered-line count fell while the test count rose**, which is the more interesting half.
The whole corpus is now instrumented by wacc rather than the reference, so the tables are not the
same tables. Diffing the point kinds for one file:

| | `packages/gzip/src/inflate.wac` | `packages/json/src/json.wac` |
|---|---|---|
| reference | `else=7`, `then=75` | `else=28`, `then=247` |
| wacc | `else=75`, `then=75` | `else=247`, `then=247` |

Every other kind is identical in both. wacc emits an `else` point for **every** `if`; the reference
emits one only where an `else` is written. Neither is obviously wrong — an `if` with no `else` still
has a path that was not taken, and counting it is the more complete answer — but they are different
instruments, and a coverage figure means something different depending on which produced it.

**The repository was already using both.** `harness/waccBuild.ts` with `opts.coverage`, and
`wac test --coverage`, have always gone through wacc's `covTableFiles`; `packages/fs`'s ratchet is
built on that. The `WAC_PROFILE` path was the one place still on the reference's table. So this
change does not introduce a second instrument — it removes one, and the mutation profile now
measures what every other coverage consumer here measures.

**Nothing in the suite would have noticed either way.** 3444 tests pass across the swap, because no
test asserts an absolute point count. That is a gap rather than a reassurance, and it is the reason
this section exists: the instrument changed under every profile in the repository and the only
evidence was a total moving 0.8% in the direction that looks like less.
