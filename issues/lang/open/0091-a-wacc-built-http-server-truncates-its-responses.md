# 0091 — a wacc-built http server truncates its responses

- **Status:** open — very likely a symptom of 0090; re-check once that is fixed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-10
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```sh
WAC_WASM_FROM=wacc deno test -A --no-check packages/http/test/
```

Expected: the same answers as against a reference-built module, which is what
the suite asserts.

Actual:

```
wac client → wac server: the loop closes
  error: /: {"ok":false,"reason":"truncated"}

fetch → wac server: the response writer against a strict client
  error: client error (SendRequest): connection closed before message completed
```

## Notes

**This is a wrong answer rather than a missing feature.** The module binds, the
server runs, and what it writes is short — a strict client sees the connection
close before the message is complete. Everything else about the package works:
26 of its tests pass on the same module.

It is the first behavioural defect the run-the-corpus half of rung 4 has found,
and no amount of checking that a module is well-formed would have found it: the
module is well-formed and computes the wrong thing.

Worth isolating down from the interop test to a single call — the response
writer is the obvious suspect, and `packages/http/src` is small enough to bisect
by exporting intermediate values and comparing the two builds' answers.

## 2026-08-10, agent-b — this is probably 0090 wearing a different face

Once `blockedFiles` was taught to run the same fixed point the emitter runs (0090),
`http` stopped binding at all and said why: **`a call to serve, declined`**. So the
module this test was exercising was short a function the whole time, and "the
response is truncated" is what a missing writer looks like from the outside — not
arithmetic going wrong.

I filed this as a separate defect on one run's evidence, and the evidence was thin:
a wrong answer and a missing export are indistinguishable from the outside when the
missing thing is what produces the answer. Re-check after 0090; if the truncation
survives a module that is genuinely complete, it is real and this stays open.

There was a second reason to distrust the original report. `runOnWacc.ts` passed
`env: { WAC_WASM_FROM: "wacc" }` to `Deno.Command`, which **replaces** the
environment rather than extending it, so every package ran with nothing else set —
`http` reported 29 tests passing there and 24 passing with one failure when run by
hand. That is the measurement disagreeing with itself, and it is fixed.
