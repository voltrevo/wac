# 0002 — an enum value cannot be a module constant

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
enum E { A(i32 v), B }
const E X = E.A(7);
const E[] TABLE = E[](E.A(1), E.B, E.A(3));
```

Expected: both accepted, the way `const u32[] K = u32[](...)` is.
Actual: `constant 'X' needs a compile-time value` for each.

## Notes

Module constants are substituted at each use rather than stored, so a constant whose
value allocates has nowhere to live. Constant *arrays* were given real storage
(`59236ae`, "Constant arrays: one shared table, built once"), which is the mechanism
this needs — an enum constant is the same problem: allocate once at instantiation,
share the reference.

The array case is the more useful of the two: a dispatch table of variants is a natural
thing to write, and building it in a function means rebuilding it per call.

Worth deciding whether this generalises to "any constant of reference type" rather than
being an enum feature. A `const S POINT = S(0, 0);` has exactly the same shape.
