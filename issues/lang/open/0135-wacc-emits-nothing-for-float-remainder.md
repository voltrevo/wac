# 0135 — wacc emits nothing for `%` on a float, so it answers the second operand

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export f64 fmod(f64 a, f64 b) { return a % b; }
```

| call | reference | wacc |
|---|---:|---:|
| `-7.0 % 2.0` | -1 | **2** |
| `7.0 % -2.0` | 1 | **-2** |
| `7.0 % 2.0` | 1 | **2** |
| `7.5 % 2.0` | 1.5 | **2** |

**wacc answers the second operand, every time.**

## Where, exactly

`emitBinary` in `emit.wac` has a branch per value type. The float branch handles `+ - * /` and the six
comparisons and **has no `kPercent()` case**, so `%` on an `f64` emits *no instruction*: both operands
are pushed and neither is consumed, and the value left on the stack is `b`.

The integer branches below it do have one — `fb.byte(u ? 112 : 111)` for `i32`, `fb.byte(u ? 130 : 129)`
for `i64` — which is why this is float-only and why it reads as an omission rather than a mistake.

## Why it was not caught

Nothing runs `spec/tour.wac`'s `selfTest()` under wacc. The reference does, in
`compiler/wacSpec.test.ts`, and the tour tests this exact function — `rem(-7.0, 2.0) -> -1.0` is on the
line below its definition. The tour is in wacc's corpus for *checking* and *emitting*, so wacc compiles
it into a module that validates and computes the wrong answer, and no test asks what it computes.

That gap is the other half of this issue and is worth its own fix: a wacc-side test that builds the
tour and asserts `selfTest()`, which is one `wacBind` call.

## The fix is not one opcode

wasm has no `f64.rem`. It has to be synthesised, and the tour's own comment says the obvious synthesis
is wrong: *"Writing `a - trunc(a/b)*b` yourself would NOT match, because the quotient rounds before
trunc sees it"*, with `rem(1.0, 0.1) -> 0.09999999999999995` as the case that catches it. So this wants
the exact algorithm the reference uses rather than an approximation.

**Until then, declining would be better than answering.** `packages/wacc` has a `blocked` channel for a
feature it cannot emit, and a caller told "unsupported" can act on it; one handed a module that returns
the wrong operand cannot. The cost to weigh is that the tour uses `%` on floats, so declining makes the
tour un-emittable by wacc and something in the corpus tests has to say that is expected.
