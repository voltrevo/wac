# 0180 — `deno task coverage:fmt` crashes: a coverage driver cannot call a wac test that takes capabilities

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a measuring tool that stops before it measures

## Reproduction

```
deno task coverage:fmt
```

    error: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading '$ref')
        at .cache/cov_packages_fmt_test_wac_ftoa_test.wac.gen.ts:2559:121
        at test_ftoa_every_output_round_trips (…:2559:125)
        at packages/fmt/cov.ts:107:19

Pre-existing: it fails identically with `packages/wacc/src/{ast,parse,emit}.wac` reverted to `HEAD`, so
it is not the coverage-position work that found it.

## Why

`packages/fmt/test/wac/ftoa_test.wac:211` is

```wac
export string test_ftoa_every_output_round_trips(Core core, Cli cli) { … }
```

and the glue bindgen writes for a capability parameter unwraps the argument:

```ts
(($exports.test_ftoa_every_output_round_trips as CallableFunction)(
  ((v) => v === null ? null : v.$ref)(a0), ((v) => v === null ? null : v.$ref)(a1)))
```

`packages/fmt/cov.ts` calls the export with no arguments, because a coverage driver has no world to
give: it instruments a module and calls its tests, and nothing in that path builds a `Core` or a `Cli`.
`undefined.$ref` is the first thing that happens.

## Scope, measured

Five of the nineteen `coverage:*` tasks, run today: `fmt` is the only one that fails.

| task | |
|---|---|
| `coverage:fmt` | **crashes** |
| `coverage:bytes` | 0 |
| `coverage:bignum` | 0 |
| `coverage:json` | 0 |
| `coverage:codec` | 0 |

So this is the first package whose *coverage-driven* tests took capabilities, not a general breakage —
and it will happen again as `issues/system/0161`'s move of the suite into wac continues, since a wac
test reading its own fixtures is exactly what that step produces.

## What it would take

Two shapes, and the choice is why this is filed rather than fixed:

- **The driver builds a world**, the way `harness/wacTestRun.ts` already does for the test lane. Then a
  capability-taking test is measured like any other, and coverage stops being a second lane with a
  narrower idea of what a test is.
- **The driver skips tests it cannot call, loudly**, naming them in the report. Cheaper, honest, and it
  leaves those branches unmeasured — which for `ftoa` is the round-trip test, the one that walks the
  whole formatter.

The first is right if a world is cheap here; the second is what stops a red task from being the normal
state while somebody decides. Either way the crash has to become a sentence: a `TypeError` from
generated glue names neither the test nor the reason.

Related: `issues/system/0173` — a wac test cannot say which grant it needs — which is the same gap seen
from the lane side.

## Renumbered from 0179 — 2026-08-17

Filed as 0179 while another agent filed a different 0179 — `feToBytes` carrying three times with two
unobserved. Theirs reached the bare repo first, so this one moved; two files with one number fails the
uniqueness check in `compiler/wacSpec.test.ts` and makes master red for everybody.
