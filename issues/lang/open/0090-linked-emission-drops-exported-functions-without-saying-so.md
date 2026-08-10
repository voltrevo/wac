# 0090 — linked emission drops exported functions without saying so

- **Status:** open
- **Claimed by:** agent-b, 2026-08-10
- **Reported by:** agent-b
- **Date:** 2026-08-10
- **Kind:** bug
- **Symptom:** not implemented

## Reproduction

```sh
deno run -A packages/wacc/tools/runOnWacc.ts json
# FAIL json  21 passed  missing export: objectPastEnd
```

Directly, over `packages/json/src/json.wac` and its import graph:

```
blockedFiles says: ""
reference exports 4, wacc exports 1
missing from wacc: canonicalize, parse, parseNumberValue
```

Expected: either the module exports what the source says it exports, or
`blockedFiles` names the feature that stopped it.

Actual: three of the four exported functions are absent and **`blockedFiles`
reports nothing at all**.

## Notes

This matters beyond one package, because `corpusEmit.test.ts` counted a file
*whole* exactly when `blockedFiles` was empty — the emitter's opinion of itself.

**Measured: 29 of the 335 files counted whole are missing at least one export
the source declares.** `corpusEmit` checks this against the reference's export
list now and prints both numbers on every run, so the gap stays visible while
the defect is open. A sample:

    packages/ethrpc/src/getproof.wac   2/2 missing — proofOf, proofOfSlots
    packages/ethrpc/src/header.wac     1/1 missing — headerOf
    packages/fs/test/wac/fs_test.wac  11/11 missing
    packages/json/src/json.wac         3/4 missing — canonicalize, parse, parseNumberValue
    packages/json/src/parse.wac        1/11 missing — parseDocument

`parse.wac` is the specimen to work from: ten of its eleven exports emit and one
does not, so whatever the trigger is, it is inside one function rather than
anything about the file or its imports. Its survivors are all trivial `i32`
returns and `parseDocument` calls methods on a struct, which is a lead and not
yet a finding — an imported type in a signature was the first guess and is
**not** it: return position, parameter position and a nullable return all emit
fine in a two-file case.

`env.funcOk` is the mechanism: a fixed point in `emitModuleOf` declines a
function whose body it cannot emit, and `canEmit` records the reason in
`env.blocked`. Somewhere between that and `blockedLinked` the reason is lost
for this graph — note the deliberate `savedBlocked` restore around the
instance-discovery pre-pass, which is correct on its own terms and is the kind
of place a real reason could go missing with it.

Two minimal cases that do **not** reproduce it — a plain two-file import, and
an entry using a struct from its import — both emit every export with
`blocked=""`. So it needs something `json` has and those do not; finding that
is the first step.
