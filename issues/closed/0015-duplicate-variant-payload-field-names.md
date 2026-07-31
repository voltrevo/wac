# 0015 — duplicate payload field names in a variant were accepted

- **Status:** closed
- **Fixed in:** fca718c
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, no error
- **Covered by:** `§enum-dup-payload-field`

## Reproduction

```wac
enum E { A(i32 x, i32 x), B }
```

Expected: a compile error, as `struct S { i32 x; i32 x; }` already is.
Actual: compiled.

## Notes

A variant's payload becomes struct fields, and the resolver's duplicate-field check runs
over hand-written struct declarations only — the generated variant structs skipped it.

Two *different* variants sharing a field name is legal and must stay legal: they are
different structs. `enum E { A(i32 x), B(i32 x) }` is fine.
