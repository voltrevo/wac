# 0054 — a hex literal in [2^31, 2^32) sign-extends when the target is 64-bit

- **Status:** open
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
