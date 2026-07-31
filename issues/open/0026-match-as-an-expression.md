# 0026 — `match` is a statement, not an expression

- **Status:** open
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
enum Shape { Point, Circle(f64 radius) }

f64 area(Shape s) {
  f64 a = match (s) {          // not accepted
    case Point:     0.0,
    case Circle(r): 3.14159 * r * r,
  };
  return a;
}
```

Expected: eventually, some expression form.
Actual: `match` is a statement only. The workaround is a `return` in every arm, or a
mutable local assigned in each arm.

## Notes

Deferred deliberately when enums landed and recorded in enums.md under "What this is not,
in this draft". Filed now so it is tracked rather than only described.

The work is result-type unification across arms — the same problem the ternary already
solves for two branches (closest common ancestor, plus the `null` widening added in issue
0011), generalised to n. Reusing that logic rather than writing a second copy is the point
to get right; two places computing one type is how the i64-literal and ternary-variant bugs
happened.

Also needs a syntax decision. The statement form reuses `case X:` with statement bodies,
so an expression form needs a way to write "this arm's value" — an expression after the
colon and a comma separator, as sketched above, or `=>`. The sketch keeps one arm syntax;
`=>` reads better for a single expression. Worth deciding before implementing, not during.

Lower value than it looks: the statement form is what a tree walk needs, and every consumer
so far (`wacc`'s printer, `json`, `fmt`) wanted a `return` per arm anyway.
