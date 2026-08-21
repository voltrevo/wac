# 0180 — `deno task coverage:fmt` crashes: a coverage driver cannot call a wac test that takes capabilities

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — verified fixed by the driver rewrite, not by me
- **Fixed in:** `tools/wac/covledger.wac`, which takes a `Core`, a `Cli` and grants; and `packages/fmt/test/cov_ledger.wac`
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

## All twenty-one `coverage:*` tasks, measured — 2026-08-17, agent-b

Two crash, not one, and the second has the same cause:

| task | |
|---|---|
| `coverage:fmt` | crashes — `ftoa_test.wac`, as above |
| `coverage:crypto` | crashes — `rsa_test.wac`, `test_a_forged_block_that_is_wrong_in_one_place_is_refused` |
| the other nineteen | exit 0 |

`crypto`'s arrived this morning, when `packages/crypto/test/wac/rsa_test.wac` stopped taking a host
callback and started taking `(Core core, Cli cli)` so it could reach `test/oracle.mjs`. That is
exactly the shape this issue predicts more of, and it is worth saying plainly: **`issues/system/0161`
is trading a working coverage lane for a working test lane, one package at a time.** The nine files
converted today in `crypto`, `tls`, `tor` and `git` all take capabilities. `tls`, `tor` and `git`
have no `coverage:*` task, so only `crypto` shows it.

That makes the second option above — skip and name — worth more than it looks. A red task is not a
measurement, and the packages being converted are the ones with the most oracle-driven tests.

`coverage:std` was also red and is a different bug, fixed rather than filed: `packages/std/cov.ts`
still named `packages/std/test/traps.wac`, which moved to `test/wac/traps_test.wac` on 2026-08-16
when std's trap tests were converted. It had been failing with `NotFound` since, which is a day of a
coverage task being red for a reason nobody was looking at — **the same commit that moves a test has
to grep for its old path**, and `cov.ts` is not somewhere the link guard reaches, since the path is
inside a string in TypeScript rather than in a document.

## Verified fixed — agent-a, 2026-08-21

Both named crashes are gone, and the mechanism is the first of the two options rather than the second.

    deno task coverage:fmt      exit 0, no TypeError, no `$ref`
    deno task coverage:crypto   exit 0, no TypeError, no `$ref`

**`packages/fmt/cov.ts` no longer exists.** The driver the issue names was replaced by
`tools/wac/covledger.wac`, whose entry point is
`measure(Core core, Cli cli, string entry, string[] grants, string[] exports)` — it takes a world and
the grants, which is exactly *"the driver builds a world, the way `harness/wacTestRun.ts` already does
for the test lane"*. So a capability-taking test is measurable now, and coverage stopped being a second
lane with a narrower idea of what a test is.

Two details worth keeping, because they answer the issue's other halves:

* **The crash did become a sentence**, in the sense the issue asked for: `covledger.wac`'s report names
  the files it skipped rather than dying, and the comment beside it says the skip list walks the raw
  points so that a test file contributing nothing is still named.
* **And `packages/fmt` went further than the issue required.** Its ledger exercises a purpose-built
  `cov_exercise.wac` instead of calling test exports, and its header states the thing that makes the
  whole arrangement honest: *"A coverage figure cannot tell you whether the assertions ran — it is a
  measure of what executed, and an oracle that could not be reached executes nothing."* Grants are
  passed anyway, because dropping them would leave fifteen tests passing vacuously inside the driver.

**Not canaried by reverting**, and that is worth stating plainly rather than implying otherwise: the fix
was somebody else's rewrite of the driver, not a change I made, so there is nothing of mine to revert.
What I verified is that the reproduction behaves, that the file it blames is gone, and that the
replacement takes the arguments whose absence caused it. The standing tripwire is the gate, which runs
all twenty-one `coverage:*` lanes.

The related gap `issues/system/0173` — a wac test cannot say which grant it needs — is untouched by this
and stays open.

