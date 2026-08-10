# 0091 — a wacc-built http server truncates its responses

- **Status:** open
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
