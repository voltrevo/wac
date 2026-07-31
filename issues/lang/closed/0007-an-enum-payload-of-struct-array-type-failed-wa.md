# 0007 — an enum payload of struct-array type failed wasm validation

- **Status:** closed
- **Fixed in:** 08fedd2
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm
- **Covered by:** `§enum-arm-payload-struct-array`

The variant structs are generated in the resolver and are not in the item list the type-annotation pass walks, so a payload of struct type keyed by name while every other reference to the same struct keyed by index. P[] then interned as two distinct array types.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
