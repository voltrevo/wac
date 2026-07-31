# 0002 — an enum value cannot be a module constant

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error
- **Covered by:** `§wac-modconst-ref-9jvq2mt`

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


## Resolution

Generalised, as the notes suggested: any constant of reference type, not an enum feature.
`struct.new` is a constant instruction in the GC proposal, so a struct, a variant, or an
array of either is built once in a global's initialiser.

Four things it needed beyond the obvious emission:

The resolver never annotated a **const initialiser** at all, so `const P ORIGIN = P(3, 4)`
reported "undefined function or struct 'P'". Harmless while a constant could only be a
scalar. Same omission family as issue 0005.

`notCompileTimeConstant` runs **before** inference, so the `variantTypeIndex` annotation
the emitter relies on is not set yet and the variant has to be resolved through the file
scope instead.

The parser calls every `name(...)` a construction, so `P(f())` was accepted as constant —
`f()` is itself a `construct` node with no arguments to reject. The check now requires the
name to resolve to a struct.

And struct constants were initially **substituted at each use** like scalars, so two
mentions were two objects and the value was rebuilt every time — which defeats the point.
They get a global now, as arrays already did. There is a test that observes the identity
through a mutable field, because that is the only way to tell.

Left as-is: a **string** constant is still substituted. It is immutable, so only its
identity would differ and nothing can observe that.
