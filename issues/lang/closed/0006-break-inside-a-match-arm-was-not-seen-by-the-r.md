# 0006 — break inside a match arm was not seen by the return checker

- **Status:** closed
- **Fixed in:** 08fedd2
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** trap
- **Covered by:** `§enum-match-break-loop`

A break in an arm reaches the enclosing loop, but the return checker treated match as a break barrier the way it treats switch. So a while(true) whose only exit was a break in an arm passed the return check as infinite, the missing return went unreported, and the function trapped on the unreachable the emitter appends.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
