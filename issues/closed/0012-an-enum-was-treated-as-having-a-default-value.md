# 0012 — an enum was treated as having a default value

- **Status:** closed
- **Fixed in:** e64e47d
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** trap
- **Covered by:** `§enum-no-default`

The base struct's only field is the i32 tag, which has a default, so E[n]() allocated n values satisfying no variant and S() on a struct with an enum field produced one. Matching one trapped on 'illegal cast', blaming the arm rather than the construction.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
