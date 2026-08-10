# 0090 — linked emission drops exported functions without saying so

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

This matters beyond one package, because `corpusEmit.test.ts` counts a file
*whole* exactly when `blockedFiles` is empty. A file that silently loses
three quarters of its API is counted whole, so **rung 4's "335 of 342 whole"
overstates what is actually emitted** — by how much, nobody currently knows.
That number should be recomputed against the exports the source declares
rather than against the emitter's own opinion of whether it was blocked.

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
