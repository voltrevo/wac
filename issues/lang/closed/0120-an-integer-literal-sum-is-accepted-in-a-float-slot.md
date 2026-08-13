# 0120 — an integer literal sum is accepted in a float slot

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** diagnostic
- **Symptom:** no error

## Reproduction

```wac
export f64 f() { f64 s = 1 + 2; return s; }
```

Expected: a compile error. `spec/spec/types.md` — an integer literal takes whatever **integer** type
is expected of it, and *"no implicit conversions between any types"*. The reference says
`type mismatch: expected f64, got i32`.

Actual: accepted, and it computes `3.0` in floating point.

A single literal is fine: `f64 x = 1;` is refused by both. It is the **arithmetic** form that slips
through — `litKindOf` answers `litNone` for a `Binary`, so the literal-adoption rules never look at
it, and `typeOfExpr` of two literals is unknown, and unknown is silence.

## Where the fix goes, and why it is not the cast one

`issues/lang/0119` fixed the same shape for casts, by giving a literal *operand* its notation default
in one place — `castOperandType`. This one is not a cast: the site is the assignment and argument
paths, which go through `literalFits`/`acceptsLiteral`, and the question is what the **type of an
expression made only of literals** is. The emitter already answers it (`typeOfE` returns `f64` when
either side is a float literal, `issues/lang/0117`); the checker does not.

## Measured, 2026-08-13: nothing here would break

Every `.wac` test file and every `spec/cases` program that is *meant* to compile — 166 of them, the
two places only wacc ever sees — put through the reference: **it refuses none of them.** (It refused
two before `issues/lang/0119`, which is how that issue found them.) So the rule can be enforced
without rewriting anything; the risk this issue was worried about is not there.

## Why it is not the two-line change it looks like

The obvious fix is to extend `litKindOf` so a `Binary` of two literals of the same family answers that
family — then `acceptsLiteral` refuses an integer literal in a float slot, and `integerLiteralFits`
already answers *true* for anything that is not a literal token, so the range machinery stays quiet.

It cannot be written there as it stands. **`litKindOf` takes an `Expr` and no `C`**, so it cannot read
the operator's token kind — and the operator decides everything: `1 + 2` is an integer literal sum,
while `1 == 1` is a `bool` and `bool b = 1 == 1;` must keep compiling. Marking every `Binary` of two
literals as an integer literal makes that program an error.

So the change is either a `C` parameter through `litKindOf`'s callers, or a second entry point beside
it that the assignment and argument paths call. Both are ordinary; neither is a line. Whoever takes
it should also decide whether `(1 + 2) as i64` shifts — `castOperandType` asks `litKindOf` too, and
today answers *unknown* for that expression while the emitter's `typeOfE` answers `f64` for the float
version of it (`issues/lang/0117`). Those two should agree.


## Fixed

`litFamily(C c, Expr e)` sits beside `litKindOf` rather than replacing it: same question, with the
operator's token available. A `Binary` of two literals of the same family *is* that family for the
rules that ask — except across a comparison or a logical operator, which answers a `bool` however its
operands are spelled, so `bool b = 1 == 1;` keeps compiling. Mixed families answer nothing rather
than guessing, which leaves `1.5 * 2` reported by the operand rule that already covers it.

Three places had to move together, which is the part worth knowing: the two statement gates decide
*whether* to ask the literal question, and `literalFits`, `reportLiteral` and `foundType` ask it
again on the way down. Changing only the gates did nothing at all — the path re-asked `litKindOf` and
got *not a literal* three lines later.

Twelve forms compared against the reference afterwards, all agreeing: the four that must now be
refused, and the eight that must not move — `u32 x = 1 + 2` and `i64 x = 1 + 2` (adoption within the
integer family), `f32 x = 1.5 * 2.0` (the width the slot picks), `1 << 4`, a nested `(1 + 2) * 3` in
both an integer and a float slot, and a literal too large for `i32` in a `u32` slot.

`spec/cases/0146`. The corpus is unchanged: 174 wacc tests, 531 spec tests, all 73 programs, and the
package suites for json, fmt and quic.
