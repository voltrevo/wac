# 0325a — three copies of `itoa64` answer a single minus sign at `i64` minimum

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** a wrong answer, one character long, at one input

## The measurement

`itoa64` has five definitions. Two are byte-identical and correct; three are separate
implementations and none of them handles `i64` minimum:

| where | body | `i64` min |
|---|---|---|
| `packages/wactest/src/itoa64.wac` | identical to `fmt`'s | correct |
| `packages/fmt/src/itoa.wac` | — | correct |
| `packages/json/bench/throughput.wac` | its own, 11 lines | **`"-"`** |
| `packages/fs/test/wac/cov_probe.wac` | its own, 10 lines | no min case |
| `packages/platform/example/wacland.wac` | its own, 12 lines | no min case |

The three write

```wac
i64 n = neg ? 0 - v : v;
while (n > 0) { … }
```

and `0 - v` at `i64` minimum overflows back to itself, so the loop never runs and the function
returns the sign alone. Measured, not reasoned: `itoa64(0x8000000000000000).len()` is **1**, against
3 for `itoa64(-42)` in the same program.

`packages/fmt`'s own comment is where the correct handling is explained — the same hazard one type
down, for `i32` minimum, special-cased there because *"negating it overflows back to itself, so the
loop below would never terminate on it."*

## Not reachably wrong today, which is the point

A JSON throughput bench, a coverage probe and an example. None is handed `i64` minimum and none will
be. This is what a copy that has drifted looks like **before** it costs anything — which is
`f8d9b489`'s phrase for the same shape in `dirOf`: five copies, four different answers at `/a`, none
reachably wrong, all but one deleted.

Distinct from `0314b`, which is explicitly about **byte-identical** duplicates — 37 names and 105
copies, checked by hashing. These three are not copies of anything; they are re-derivations that
came out differently, and hashing does not find them.

## The fix `dirOf` used

`packages/fmt` exports the tested one. The bench and the probe can import it; the example is a
demonstration of the platform and may want to stay self-contained, in which case it should say so at
the line, as `source_probe` does in `f8d9b489`.
