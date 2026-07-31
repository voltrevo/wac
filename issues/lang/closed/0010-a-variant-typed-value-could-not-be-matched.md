# 0010 — a variant-typed value could not be matched

- **Status:** closed
- **Fixed in:** f9e8558
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error
- **Covered by:** `§enum-match-variant-subject`

match (Shape.Circle(2.0)) types its subject as Circle rather than Shape, and so does a variable declared Circle c. Both were rejected with 'match requires an enum value, got Circle'.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
