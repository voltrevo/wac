# 0233a — a shift whose left operand is a literal is typed from the amount, not from the slot

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** decision
- **Symptom:** compile error on a program the spec's literal rule appears to allow

## Reproduction

```wac
export i64 f(i32 count) { i64 x = 1 << count; return x; }
```

Both compilers refuse it, in the same place and for the same reason:

    wacc       error: initialiser does not match the declared type
                 --> s64.wac:1:37
                  |
                1 | export i64 f(i32 count) { i64 x = 1 << count; return x; }
                  |                                     ^ expected i64, found i32
                  = help: use `as!` for a checked conversion or `as~` for the nearest value

    reference  [typecheck] type mismatch: expected i64, got i32

**Nothing is silently wrong**, which is worth saying first: this is a clean refusal with a help
message, not 32-bit arithmetic quietly performed in a 64-bit slot. The two compilers agree, so it is
not a differential either.

## Why it looks like it should compile

`spec/spec/types.md` is explicit that a literal has no type of its own and takes one from what is
expected of it:

> Where nothing is expected of it, a literal keeps the width its own notation gives it — including as
> an operand of an operator … The **other operand counts as an expectation**, in either order and
> whether or not the literal is negated.

An `i64` slot is an expectation. `1` in `i64 x = 1;` is an i64, and `1 + n` for an `i64 n` is an i64.
But `1 << count` types the shift from `count`, because a shift's result is its *left* operand's type
and the amount is deliberately unconstrained — so the only type in reach is the amount's, which is the
one operand whose type the result is explicitly **not** supposed to follow.

So the two rules meet badly: "a shift's amount is not an operand" and "a literal takes the type
expected of it" are both right, and where the left operand is a literal there is nothing left to take
a type *from* except the thing the first rule excludes.

## Why the workaround is fine and the question is still real

`1 as~ i64 << count` and `((i64)1) << count`-shaped spellings work, and a program can always widen the
literal. The reason to decide rather than leave it: `1 << n` for a 64-bit mask is the single most
common idiom this affects, `u64` flag sets are exactly where it turns up, and the refusal points at the
literal with a cast help — which reads as "you wrote the wrong type" rather than "this compiler types
shifts from the amount".

## Where it is

`packages/wacc/src/emit.wac`, `typeOfE`'s `Binary` arm, in the shift row:

```wac
if (k == kShl() || k == kShr() || k == kShrU()) { return lt != "" ? lt : rt; }
```

The `: rt` is this issue. It is load-bearing today — `this.bitBuf & ((1 << count) - 1)` in
`packages/gzip/src/inflate.wac`'s `BitReader.peek` depends on it, and removing it declined that
method, then `readBits`, then `readByte`, then `gunzipStream`, then `gunzip`, then `dispatch`, then
`boxRun`, and the seed's `sh` payload failed to build. So whatever replaces it has to type that
expression too.

The reference reaches the same answer by a different route: slot typing has already run by the time
`checkBinaryOp` sees the operands, so its `lt` for `1` is whatever the context gave it. Which is the
shape of the fix — the type has to come from the slot, and the slot is known to `emitExprAt` and not
to a context-free `typeOfE`.

## Options

- **Type a shift's literal left operand from the slot.** Correct by the spec's own rule and the
  reference's own structure. `emitExprAt` already carries a wanted type; the shift row would need to
  be reached with it, which means the wanted type has to get into `typeOfE` or the decision has to
  move to where it already is. The larger of the three, and the only one that makes `1 << n` mean what
  it looks like.
- **Say in the spec that a shift is typed from its amount when its left operand is a literal.** Cheap,
  records practice, and makes the refusal correct rather than surprising. It also makes the spec state
  an exception to its own literal rule, which the document does not do elsewhere.
- **Leave it and improve the message.** The refusal's help currently suggests a cast on the literal,
  which is the right advice by accident. Naming the cause — *"a shift takes its type from the value
  being shifted, and `1` here has none"* — would cost one sentence and no semantics.

**Recommended: the third now, the first when someone is next in `emitExprAt`.** The idiom is common
enough that the message will be read often and cheap to fix; the real repair is a slot-typing change
that wants its own run at the corpus and is not worth bundling with a diagnostic.

## Found by

`issues/lang/0170a` item 2, tightening `typeOfE(Binary)` so that operands which disagree have no type.
The shift row had to be exempted, and asking *why* the exemption falls back to the amount is what
surfaced this.
