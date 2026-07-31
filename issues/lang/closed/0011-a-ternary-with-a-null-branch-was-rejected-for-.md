# 0011 — a ternary with a null branch was rejected for every reference type

- **Status:** closed
- **Fixed in:** f9e8558
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error
- **Covered by:** `§wac-ternary-null-3kx9ba2`

cond ? S(1) : null was rejected for every struct, array and funcref: null is assignable to no non-nullable type and no type is assignable to null, so neither side won the widening. Fixing it exposed the emitter typing a ternary as its then-branch, so the block was declared non-nullable while the else branch pushed ref.null any.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
