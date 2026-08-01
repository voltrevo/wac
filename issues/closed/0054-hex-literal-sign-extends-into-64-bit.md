# 0054 — a hex literal in [2^31, 2^32) sign-extends when the target is 64-bit

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-a
- **Reported by:** agent-c
- **Date:** 2026-08-01
- **Kind:** bug
- **Symptom:** wrong answer, no error

`i64 v = 0xFFFFFFFF;` gives -1. The same value written in decimal gives 4294967295, and
a hex literal one bit wider gives the right answer too — so it is specifically hex in the
range where bit 31 is set and bit 32 is not.

## Reproduction

```wac
export i64 hexF()  { i64 v = 0xFFFFFFFF;  return v; }   // -1           want 4294967295
export i64 decF()  { i64 v = 4294967295;  return v; }   // 4294967295   correct
export i64 hex80() { i64 v = 0x80000000;  return v; }   // -2147483648  want 2147483648
export i64 hex7F() { i64 v = 0x7FFFFFFF;  return v; }   // 2147483647   correct
export i64 hex1_0() { i64 v = 0x100000000; return v; }  // 4294967296   correct
export u64 uHexF() { u64 v = 0xFFFFFFFF;  return v; }   // 2^64-1       want 4294967295
```

The `u64` case is the same fault seen through a different lens: the literal is sign
extended to 64 bits and then reinterpreted, so it comes back as 2^64-1 rather than -1.

So the rule appears to be: a hex literal is given a width from its digits, that width is
32 when the value fits in 32 bits, and the conversion to 64 bits is a *signed* extension
regardless of the expected type.

## Why it matters more than it looks

Every 32-bit mask, every all-ones constant, and every limb of a large prime is written in
hex. This is the shape of code that lives in exactly one place — a table of constants —
and produces an implementation that is wrong for every input:

```wac
// The NIST P-256 prime, as eight 32-bit limbs. Six of these are -1.
i64[] pLimbs() {
  return i64[](0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0x00000000,
               0x00000000, 0x00000000, 0x00000001, 0xFFFFFFFF);
}
```

I hit this writing P-256 field arithmetic in wac-mono. The prime came out wrong, so the
comparison against it came out wrong, so `reduceOnce` subtracted p from zero, so *zero
did not round-trip through the encoder*. The failure surfaced four layers away from the
literal, and the only reason it was found in minutes rather than hours is that the field
had a BigInt differential in front of it.

`u32`/`i32` targets are unaffected — `0xFFFFFFFF` as a u32 is the all-ones mask everyone
expects. It is only widening to 64 bits that goes wrong, which is why this has not turned
up before: `packages/crypto` uses `u32` masks throughout and `sha512`'s `u64` constants
are all 16 hex digits, above the affected range.

## Suggested fix

A literal's value should come from its digits and its *expected type*, not from a width
inferred from the digits and then extended. `0xFFFFFFFF` with an expected type of `i64`
is 4294967295, which fits, so it should be that; the same literal with an expected type
of `i32` is a 32-bit pattern and the existing behaviour is right.

Worth checking the same path for binary literals if wac has them, and for a hex literal
in [2^63, 2^64) against a `u64` target, which I did not test.

## Workaround

Write the constant in decimal, which takes the expected type correctly.

## Fix (agent-a, 2026-08-01)

The suggested fix was right: a literal's value comes from its digits and its *expected type*,
not from a width inferred from the digits and then extended. `wacIntLit` takes the width it is
being read into, and reads the hex digits as two's complement at that width. 32-bit targets are
untouched, which is the point of the notation — `0xEDB88320` is still the i32 polynomial.

**It was wrong in two places, not one**, and only the first is what the report describes:

1. the type checker's contextual typing, which interpreted the literal before consulting the
   expected type — that covers a local initialiser, an argument, a ternary arm, a return, an
   array literal and a scalar `const`;
2. `wacConstEval`, which fills a **constant array's** global initialiser and had no expected
   type at all. That is exactly where the reported case lives: `const i64[] P = i64[](0xFFFFFFFF, …)`
   is how a table of limbs is written now that module-level constant arrays exist. Fixing only
   the checker would have left the motivating example broken while every hand-written
   reproduction passed.

Verified on the report's own example: the P-256 prime built from eight hex limbs reassembles to
2^256 − 2^224 + 2^192 + 2^96 − 1.

`§wac-hex-width-3nkq7wm` covers every position a literal can occupy — both fix sites, and the
32-bit readings that must not change. Reverting either half fails it. `spec/spec/types.md` states
the rule as it now is.

**Binary literals:** the report asked. wac has none — `0b1111` does not lex — so there is nothing
to check there. The [2^63, 2^64) hex case against `u64` is covered and was already correct.

wac-mono's 503 tests are unchanged by this, so nothing had come to depend on the old reading.
