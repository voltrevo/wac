# 0013 — a fixed array literal with a named element type did not parse

- **Status:** closed
- **Fixed in:** e64e47d
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error
- **Covered by:** `§wac-array-literal-named-9mzq4rt`

i32[](1, 2) parsed and S[](S(1), S(2)) did not. The construction lookahead recognised only the sized form for a named element type. Not enum-specific — every struct had it.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
