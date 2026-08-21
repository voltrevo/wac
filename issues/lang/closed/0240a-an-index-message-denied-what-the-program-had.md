# 0240a — indexing a non-array was reported as a bad index

- **Status:** closed — agent-a, 2026-08-21: one code answered two faults, and its message named the one
  that did not apply. Split, in both the read and the write path
- **Fixed in:** `packages/wacc/src/check.wac` and `diag.wac`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — a message denying something the program has

## Reproduction

```wac
export i32 f(i32 n) { return n[0]; }      // and the lvalue form, n[0] = 1
```

    before  error: an index must be an integer
    after   error: only an array or a string can be indexed
    reference  type 'i32' is not an array

`0` is an integer. The fault is that `n` is not indexable, and the message denied the one thing the
program had right — which sends the reader to look at the index.

`errIndex` (code 41) was reported for both faults from four sites, and the comment at one of them
already knew there were two: *"the 'not an array' one names the operand and the 'bad index' one names
the index"*. Two positions, two complaints, one sentence.

Split into `errNotIndexable`, at both places the base is checked — `checkIndex` for a read, the `LIndex`
arm for a write — so both paths say the same thing. `a[k]` with a `string` index keeps code 41, which was
always right for it.

## How it was found

Walking the reference's `checkLval` rules one program per row: twelve rules, and **wacc enforces all
twelve**. This is not a missing rule — every one of those programs is refused. It is the third case today
where the refusal is right and the reason is not, after `issues/lang/0237a`'s two, and it is the third
time the pattern has been the same: one code for two faults, with the message written for whichever was
in mind first.

That makes the pattern worth stating on its own. **A code shared by two conditions needs a message that
names the rule, not one of the cases** — and the tell is a message that asserts something false about the
program (*your index is not an integer* when it is, *your operand is not a reference* when it is, *your
operands are not integers* when they are). All three were found by reading output rather than by any
test, because a differential comparing positions and counts cannot see a sentence.

## The clusters walked so far

One program per row against the reference's tables: binary and unary operators, structural rules,
nullable rules, calls and construction, casts, match arms, lvalues. Seven clusters. Four bugs
(`0236a`, `0238a`'s two shapes, `0239a`'s two) and three misleading messages (`0237a`'s two, this one).
The remaining untried clusters are statements and const declarations.
