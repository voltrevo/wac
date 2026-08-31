# 0306b — a comparison of two i64 constants is folded on their low 32 bits

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 main() {
  return (-9223372036854775807 - 1 < 0) ? 1 : 0;
}
```

Expected: `1` — that is `i64`'s minimum, and it is negative.
Actual: `0`.

The same value in a **variable** compares correctly, which is what says this is the constant path:

```wac
export i32 main() {
  i64 m = -9223372036854775807 - 1;
  return (m < 0) ? 1 : 0;                 // answers 1, correctly
}
```

## The rule: only the low 32 bits are compared

Six magnitudes, and every one of them fits "truncate both sides to 32 bits, then compare as i32":

| expression | low 32 bits of the left side | folded | correct |
|---|---|---|---|
| `-2147483647 < 0` | `0x80000001` = −2147483647 | 1 | 1 |
| `-2147483649 < 0` | `0x7FFFFFFF` = **+2147483647** | **0** | 1 |
| `-4294967296 < 0` | `0x00000000` = 0 | **0** | 1 |
| `-4294967297 < 0` | `0xFFFFFFFF` = −1 | 1 | 1 |
| `-8589934592 < 0` | `0x00000000` = 0 | **0** | 1 |
| `-1000000000000 < 0` | `0x2B5E3AF0` = +727379968 | **0** | 1 |

`-4294967297` is *right by luck* — its low word happens to be negative — which is the shape that makes
this survive casual testing. Anything whose low word is non-negative gets the wrong answer, and any
value under 2³¹ in magnitude gets the right one, so every hand-written test passes.

It is not specific to `<` or to i64's minimum. The original finding was `>=`:

```wac
(-9223372036854775807 - 1) >= 4294967296     // answers true
```

both sides truncate to `0x00000000`, so `0 >= 0` holds.

## How it was found

`tools/wac/langfuzz.wac`, the wac port of `tools/fuzz.ts`, on its first corpus — **4 of 200 seeds**
(9, 53, 84, 131). Seed 9's program is:

```wac
export i32 main() {
  i32 v0 = ((2147483647 / 10) ^ (false ? 2 : 7));
  return ((true ? ((-9223372036854775807 - 1) >= 4294967296) : (false && true))
          ? ((true ? v0 : v0) + (v0 + v0))
          : ((true ? v0 : v0) * 65536));
}
```

It answered `644245089`, which is `3 * v0` — the **then** arm — where the condition is false and the
answer is `-859111424`. The generator's oracle had the arithmetic right: asked for
`((2147483647 / 10) ^ 7) * 65536` on its own, the compiler also answers `-859111424`.

This is the intersection the fuzzer exists for. A wrong *fold* is invisible unless the folded value
then selects between two arms that differ, which is a comparison inside a ternary inside an
expression — three features crossed, and no feature-at-a-time sweep puts them together.

## The same fault in a ternary, which widens what this is about — 2026-08-31

The generator grew loops, casts and helpers and immediately produced a second shape:

```wac
export i32 main() { return (((true ? 2147483648 : 2147483648) / 3) as~ i32); }
```

Expected `715827882`; answers **−715827882**, which is `2147483648` read as an i32 (−2147483648),
divided by 3. The literal lost its top half inside the ternary.

The controls say it is about **context**, not about ternaries:

| shape | answer |
|---|---|
| `i64 v = (true ? 2147483648 : 2147483648);` then clamp | correct |
| `i64 a = 2147483648; i64 v = (true ? a : a);` then clamp | correct |
| `((2147483648 / 3) as~ i32)` — arithmetic, no ternary | correct |
| `(((true ? 2147483648 : 2147483648) / 3) as~ i32)` | **wrong** |

So with an expected type the literal is an i64, and plain arithmetic types it by its own width. What
fails is a wide literal under an operator **whose result type is not its operand type** and with no
expected type to inherit — a ternary, and the comparison at the top of this issue. `spec/tour.wac`
says a literal too wide for i32 is an i64 *by its own width*, so both are the same rule not being
applied.

That is one fault with two faces, which is why it is here rather than in a second issue. A fix should
be tested against both reproductions.

## Notes

`issues/lang/0281b` was `as~` to i32 wrapping instead of clamping **when its operand is constant**, so
that is the second defect in the constant path in this family, and both are about a 64-bit value
losing its top half. Whoever takes this should look at whether one place is responsible for both.

`tools/wac/langfuzz_test.wac` skips these four seeds by name while this is open, and says so — it does
not assert the wrong answers, so fixing this will not make it red.
