# 0029 — `if (s is Circle)` does not narrow `s`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
enum Shape { Point, Circle(f64 radius) }

f64 radiusOrZero(Shape s) {
  if (s is Circle) {
    return s.radius;        // error: struct 'Shape' has no field 'radius'
  }
  return 0.0;
}
```

Expected: `s` narrowed to `Circle` inside the `if`.
Actual: it is still `Shape`, so the field read fails. The workarounds are a `match` with an
`else` arm, or an explicit `(s as! Circle).radius`.

## Notes

Deferred deliberately; recorded in enums.md, with the reasoning: a `match` arm gets away
without flow analysis because its extent is lexical and its type is fixed by the pattern, so
narrowing can be a *shadowing binding* rather than a retyping. An `if` has neither property
— the condition can be any expression, the negation matters (`if (!(s is Circle))`), and an
early `return` inside the branch changes what holds afterwards.

So this one genuinely needs flow-sensitive typing, which is a different kind of machinery
from anything the checker has. That is the reason it was deferred and the reason it should
stay deferred until something needs it badly.

The cheap subset, if it ever becomes worth it: narrow only when the condition is *exactly*
`ident is Type` and only inside the `then` block, ignoring negation and early exits.
That covers the common case, is a scope rule rather than an analysis, and is a decision to
take deliberately rather than the first step of a general implementation — a half-general
version that narrows in some conditions and not others is worse than none.
