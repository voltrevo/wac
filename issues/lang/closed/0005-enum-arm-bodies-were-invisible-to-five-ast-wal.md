# 0005 — enum arm bodies were invisible to five AST walks

- **Status:** closed
- **Fixed in:** 08fedd2
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm
- **Covered by:** `§enum-arm-walks-kubc3rt`

A struct construct, array type or funcref signature reachable only inside a match arm was invisible to the resolver's annotate pass, to array-type collection, and to funcref-signature collection (twice). Each failed at instantiation or as a bogus "undefined function", never at the point of the mistake.

Found by porting wacc's AST to sum types — the feature's first consumer outside its own
tests. See `~/notes/temporal/20260731/enums-and-wacc-parser-agent-a.md`.
