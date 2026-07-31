# 0014 — duplicate parameter names were accepted, and the second silently won

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, no error
- **Covered by:** `§wac-dup-param-4tnq8vx`

## Reproduction

```wac
export i32 dup(i32 a, i32 a) { return a; }
```

Expected: a compile error.
Actual: compiled. `dup(1, 2)` returned `2` — the second parameter shadowed the first,
which became unreachable. No warning.

## Notes

Not enum-related. A duplicate *field* was already an error, and a local shadowing a
parameter is well defined (`§wac-shadow-param-7apc0wt`); only this was neither. Applies
to methods as well as free functions.

Found while checking whether a duplicate payload field name in a variant was rejected
(issue 0015) — it was not, and neither was this, which is the more general case.
