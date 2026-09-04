# 0332a — the 64-bit reproduction `0033` was closed for want of

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question
- **Symptom:** wrong answer

`issues/lang/0033` — *no way to detect integer overflow* — was closed **documented, not built**. It
weighed three shapes, chose the middle one, and wrote the idioms into `spec/spec/types.md`. Its own
notes said what it was short of:

> No reproduction from the original shipped bug — the friction log records the cost without the
> case. Whoever picks this up should ask wac-json for it, since a real example would settle which of
> the three shapes is wanted.

`packages/bignum` has one, and it is at the width the chosen answer does not cover.

## Reproduction

`packages/bignum/src/big.wac`, in `divmod`'s quotient-digit refinement. The estimate is clamped, and
then the refinement forms `rhat << 32`:

```wac
u64 qhat = num / vTop;
u64 rhat = num % vTop;
if (qhat >= base) { qhat = base - 1; rhat = num - qhat * vTop; }   // rhat can land on exactly base
while (qhat != 0 && rhat < base) {                                 // <- the guard, added by the fix
  u64 rhs = (rhat << 32) | (un[j + n - 2] as u64);                 // 2^64 when rhat == base: wraps to 0
  if (qhat * vNext <= rhs) { break; }
  qhat = qhat - 1;
  rhat = rhat + vTop;
}
```

With `rhat` at exactly `base`, `rhat << 32` is 2^64, a `u64` wraps it to zero, and the comparison
runs against nothing — talking a correct digit down by one and losing 2^32 from the quotient. The
package README has the full account and the shape of input that reaches it: *"a divisor whose top
limb is `0xffffffff` and a remainder window just above it. Four hundred random operand pairs across
400-bit sizes never did."*

## Notes

**`spec/spec/types.md` documents two ways to detect overflow and says of the first that it does not
reach here.** Widen and narrow with `as!`:

> **Widen, then narrow with `as!`.** For any type narrower than 64 bits, compute in the wider type
> and let the checked cast catch it

and then, of the second:

> **Compare against an operand.** For 64-bit types there is no wider one, so unsigned wrap is
> detected by the result going backwards: `bool addWraps(u64 a, u64 b) { return a + b < a; }`

The comparison idiom is written for `+`. There is no stated idiom for a **shift** that leaves the
range, which is what this is: `rhat << 32` with `rhat` at 2^32 is not an addition going backwards,
it is a value that was never representable. The nearest thing a caller can write is a range check on
the operand before shifting — which is what the fix does, spelled as a loop condition, and the
reason the comment above it has to explain 2^64 to the next reader.

**What this settles about the three shapes.** `0033` weighed checked operators (`+!`), the
widen-and-narrow idiom, and a build mode. The evidence here:

- The idiom is the one that was chosen and it is the one that does not apply. So the documentation
  answer is complete for `i32`/`u32` and empty for `i64`/`u64`, and the bug landed in the empty
  half.
- A **build mode** would have caught it: bignum wants no wrapping anywhere, so a whole-module trap
  is not a compromise for this package, it is the specification. `packages/wacc/src/api.wac` already
  has `emitFilesChecked`, whose doc says *"`+`, `-` and `*` on an integer trap where the value does
  not fit"* — but not `<<`, and it is a property of the **build** rather than of the package, so a
  library cannot state *my arithmetic never wraps* to whoever links it. That is the thing to decide:
  whether the granularity is a build, a file, or a function.
- A **checked operator** would have had to be `<<!` here rather than `+!`, which widens `0033`'s
  "decision about every operator" from the arithmetic three to the shifts as well.

**Not urgent, and the bug is fixed.** The loop condition is correct and tested — the generator that
found it (runs of all-ones and all-zeros limbs) is in the suite and in `cov.ts`. This is filed
because `0033` asked for the case before deciding, and because the case says something the request
did not anticipate: the gap is not "64-bit addition", it is *any operation whose result leaves the
widest type there is*, and shifts get there faster than sums.
