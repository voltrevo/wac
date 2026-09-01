# 0306b — a comparison of two i64 constants is folded on their low 32 bits

- **Status:** open — **the ternary face is fixed, the comparison face is not**
- **Partly fixed in:** `packages/wacc/src/emit.wac` — `integerLiteralsFitI32` gained `Ternary` and
  `MatchExpr` cases, so a wide literal one shape deep no longer defeats `0281b`'s guard. Measured
  with `tools/wac/langfuzz.wac`: 10 disagreements in 200 seeds, then 3.
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

## Where each face lives — agent-b, 2026-08-31

**Two faces, two sites.** They are the same rule not being applied, and they are not the same fix.

### The ternary face: a blind `else` in `integerLiteralsFitI32`

`packages/wacc/src/emit.wac:11551`. The walk knows `IntLit`, `Unary` and `Binary`, and ends:

    else: { return true; }

A `Ternary` falls into it and answers *"the literals fit an i32"*. The cast arm at `emit.wac:7762`
uses that answer as its guard — the fix `issues/lang/0281b` landed —

    if (from == "" && !isFloatLiteral(operand) && narrowIntegerName(to)
        && !integerLiteralsFitI32(src, lexed, operand)) {
      want2 = "i64";
    }

so with the wide literal one shape deeper than the walk can see, `want2` stays at the cast's target,
`2147483648` emits as `i32.const -2147483648`, and the clamp `as~` promises has already been
pre-empted. `0281b` fixed the bare literal; this is the same bug with a ternary in the way.

The unsafe default is the whole of it: `else: return true` means *"nobody looked, so assume they
fit"*, and every shape that carries a value out untouched is a silent hole. `Ternary` and
`MatchExpr` are those shapes; `Cast` and `Call` are not, because they give the literal a type.

**The ternary face is fixed — 2026-08-31.** `integerLiteralsFitI32` now has a `Ternary` case (its
arms, not its condition, whose value does not leave the expression) and a `MatchExpr` case (each
arm's value). Measured against the fuzzer's 200-seed sweep: **10 disagreements before, 3 after** —
16, 42, 52, 54, 77, 119 and 128 all cleared.

The `else: return true` default stays, with a comment saying what belongs above it: any shape that
carries a value out untouched. `Cast` and `Call` do not, because they give the literal a type.

### The comparison face: `operandType` answering empty, and its own comment

`packages/wacc/src/emit.wac:8848`. It asks each side its type and answers the first non-empty one —
and **a literal has no type of its own**, so two literals leave it empty and the caller reads empty
as `i32`. The comment beneath it already says so, about floats:

> Two literals leave this empty, and the caller reads empty as `i32`. `1.0 == 1.0` is therefore
> compared with `i32.eq` against two `f64` constants — `§wac-cmpfloat` in `issues/lang/0116`'s list.

So **this face is the integer twin of `cmpFloat`**, which `0116` records in detail, including that
the obvious repair was tried and measured: answering `"f64"` when either side is a float literal
fixed that case and broke *twelve* corpus files — `0 invalid` before, `12 invalid` after, and the
same twelve back to zero when it came out. `bisect32` in `packages/fmt` returns an `f32` and computes
with literals.

That comment also names the fix it thinks is right, which is worth more than this reproduction:

> The fix has to reach the `want` the emitter already has at the operator, which this function is not
> given.

So do not repair this one by deciding from the literals' family. It has been tried in the float case
and it is the wrong shape of answer.

### And tried again, for integers, on 2026-08-31 — reverted

I thought the integer case escaped that warning. A float literal's family does not say whether the
slot wants `f32` or `f64`, but an integer literal past i32's range *cannot* be an i32, so `i64` looked
like a fact rather than a preference. The patch was:

```wac
if (!isFloatLiteral(left) && !isFloatLiteral(right)
    && !(integerLiteralsFitI32(src, lexed, left) && integerLiteralsFitI32(src, lexed, right))) {
  return "i64";
}
```

It cleared the fuzzer completely — 200 seeds at 0 disagreements, and 400 more from seed 1000 — and it
**broke `spec/cases/0294`**, which is `issues/lang/0281b`'s own case. The module became invalid wasm.

The line that did it is not one of the casts; it is the check at the end:

```wac
low == (0 - 2147483648)
```

`low` is an `i32` local, so `operandType` answers `"i32"` from the *left* and the right side is
emitted with `want = "i32"` — correctly. But `(0 - 2147483648)` is itself a binary of two literals,
and inside it my change answered `"i64"`, so `i64.sub` ran where the slot had promised an i32.

**That is the warning above, exactly.** The literals' width is not the answer even when it looks like
a fact, because a slot one level up may already have decided, and this function cannot see it. The
float attempt broke twelve corpus files; this one broke one, and only because a single case happened
to write the shape.

**What is left for whoever takes this.** The answer has to be conditioned on the `want` the emitter
holds at the operator — which is available, since the `Binary` arm sits inside `emitExprAt`. The
distinction that makes it tractable: for an *arithmetic* binary the caller's `want` is the slot and
should win, and for a *comparison* the caller's `want` is the result type (`bool`) and imposes nothing
on the operands, so there the literals' width is free to decide. Passing `want` into `operandType`
and answering `"i64"` only when nothing narrower has been imposed is the shape that fits both.

**This face is what the three remaining seeds are.** `tools/wac/langfuzz_test.wac` excuses 21, 74 and
188; seed 74's program carries `(-2147483649 <= 2147483648)` and `(-2147483649 > 1000000000000)`,
neither of which goes near the walk the ternary fix touched.

Seed 21 is worth noting for whoever takes this: its answer **changed** under the ternary fix, from
727379968 to −2147483648, without becoming right. So that program carries both faces, and a fix for
this one should be checked against it rather than against 74 alone — a single reproduction that
happens to hold only one face is how half a bug gets closed.

## Notes

`issues/lang/0281b` was `as~` to i32 wrapping instead of clamping **when its operand is constant**, so
that is the second defect in the constant path in this family, and both are about a 64-bit value
losing its top half. Whoever takes this should look at whether one place is responsible for both.

`tools/wac/langfuzz_test.wac` skips these four seeds by name while this is open, and says so — it does
not assert the wrong answers, so fixing this will not make it red.
