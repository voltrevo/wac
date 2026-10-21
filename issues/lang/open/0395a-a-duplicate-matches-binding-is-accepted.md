# 0395a — `R p matches m && R p matches n` compiles and silently uses the second `p`; two wordings are wrong

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
struct R { i32 v; }
export i32 f() { R? m = R(1); R? n = R(2); if (R p matches m && R p matches n) { return p.v; } return 0; }
```

Expected: refused — one name bound twice in one condition.
Actual: 2.

## Notes

Also two diagnostics: `T??` into `T?` says "cannot be assigned to a non-null type" (`T?` is nullable), and `t?.0`
gets struct-declaration help ("a field is `type name;`") in an expression. From the enums bug hunt.
