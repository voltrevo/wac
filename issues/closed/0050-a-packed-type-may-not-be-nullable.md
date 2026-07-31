# 0050 — a nullable packed type was accepted everywhere the packed type was refused

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error, and a wrong diagnostic

## Reproduction

`u8` is refused as a slot type — that is `§wac-arr-packed` — and `u8?` was accepted in every one
of the same positions:

```wac
struct W { u8? p; }            // accepted; `u8 p` is "packed type cannot be used as a struct field"
i32 g(u16? x) { return 0; }    // accepted; `u16 x` is refused
i8? h() { return null; }       // accepted; `i8` is refused
```

A local was refused, but for the wrong reason and with a message about the initialiser:

```wac
u8? x = 1;    // "type mismatch: expected u8?, got i32"
```

## Cause

`isPackedElem` tested the type as written, so a `nullable` wrapper hid the primitive from every
check that used it. One predicate served two questions: "is this packed storage in an array
element" and "is this a packed type in a slot", and only the first is about the type as written.

## Fix

Two predicates. `isPackedElem` stays strict — an array element's packed storage is the point — and
`isPackedSlot` looks through a nullable, for the field, parameter, return-type and local checks.

Then the array case had to be decided rather than inherited. `u8?[]` is a nullable-*reference*
array, so its storage is real and it very nearly works. It is refused anyway: unwrapping an element
gives a `u8`, and a `u8` cannot be a local, a parameter, a field or a return type, so the value has
nowhere to go. **A type whose values cannot be held is not a type.** `hasNullablePacked` refuses it
in any slot, with a message naming the two things that say what was meant — `i32?`, or a packed
array with a separate `bool[]` of presence flags.

## Notes

Noticed while probing nullable primitives for issue 0045 and not filed then, which was a mistake:
the `u8? x = 1` message was visible in that session's output and I read past it. Filed and fixed
together here because a two-line issue that says "I saw this and moved on" is worth less than the
fix.

`§wac-packed-nullable-2knq6wv` covers the four slot positions, the array positions, and the two
alternatives compiling and returning the same answer.
