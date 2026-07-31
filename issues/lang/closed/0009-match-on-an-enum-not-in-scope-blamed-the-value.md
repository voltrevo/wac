# 0009 — match on an enum not in scope blamed the value's type

- **Status:** closed
- **Fixed in:** 0c34715
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** diagnostic
- **Symptom:** compile error
- **Covered by:** `§enum-cross-file`

Said 'match requires an enum value, got TyKind' when the real problem was that TyKind had not been imported. Cost me a wrong public claim that imported enums were broken.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
