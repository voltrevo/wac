# 0008 — enums were resolved by name where identity was meant

- **Status:** closed
- **Fixed in:** 0c34715
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm
- **Covered by:** `§enum-name-identity`

annotateType only annotated scope entries of kind struct, so an enum used as a type never got a resolvedTypeIndex; and emitCall/emitField searched every enum in the program by name. Two files declaring the same enum name exposed both: a variant was not assignable to its own enum, and a variant constructor emitted nothing, surfacing as an array.set two arguments short.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
