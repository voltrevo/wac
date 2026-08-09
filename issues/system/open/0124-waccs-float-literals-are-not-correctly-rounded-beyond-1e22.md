# 0124 — wacc's float literals are not correctly rounded beyond ±1e22

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export u64 f() { return f64.toBits(1e300); }
```

| literal | reference | `wacc` | out by |
| --- | --- | --- | --- |
| `1e300` | 9094988921128908188 | 9094988921128908189 | 1 ulp |
| `1.7976931348623157e308` | 9218868437227405311 | 9218868437227405308 | 3 ulp |
| `2.2250738585072014e-308` | 4503599627370496 | 4503599627370495 | 1 ulp |

`5.0e-324`, `1e-300`, `0.1`, `3.14`, `1e22` and `1e23` are all exact, and so is every literal in the
spec suite — this is only reachable past the range where a power of ten is itself exact.

## Why

`packages/wacc/src/emit.wac`'s `parseFloat` accumulates the mantissa as an integer and scales it by a
power of ten, which is the right shape: one rounding, where multiplying a running `0.1` was several.
But a power beyond 10^22 is not exactly representable and 10^309 is not representable at all — so the
scale is applied **in steps of 22**, and each step rounds. Fourteen steps for `1e300` is fourteen
roundings, and the result lands a unit or two from the nearest.

`spec/spec/types.md` says rounding is to nearest, so this is a deviation rather than a licence.

## What it would take

The standard answer is a correctly-rounded decimal-to-binary conversion — Clinger's fast path for the
exactly-representable range (which is what `parseFloat` already does for |e| ≤ 22) and a slow path
with wider-than-`f64` arithmetic for everything else. wac has `i64` and no `u128`, so the slow path
wants either a small big-integer routine or the Eisel–Lemire 128-bit approach written out in two
`i64`s.

Worth its own slot rather than a corner of another: it is self-contained, it is testable against the
reference for every literal in the corpus, and getting it wrong is silent.

## How it was found

By running the spec suite's programs through `wacc` and comparing answers — the `§wac-f64bits`
case tests `5.0e-324`, which was zero before this and is right now. The three literals above are not
in the spec suite; they came from asking what else the same code path would get wrong.
