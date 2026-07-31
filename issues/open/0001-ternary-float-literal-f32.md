# 0001 — a float literal in a ternary always types as f64

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
export f32 f(bool y) { f32 x = y ? 1.5 : 2.5; return x; }
```

Expected: compiles; both branches are f32 literals in an f32 context.
Actual: `type mismatch: expected f32, got f64`.

Workaround: cast each branch, `y ? 1.5 as f32 : 2.5 as f32`.

## Notes

The emitter is already prepared for this — `emitExpr`'s `float` case picks `f32.const`
when the expected type is f32, and since the ternary now passes its result type down to
both branches, the emission would be right. It is the checker that has no context to
offer: it types each branch independently, gets f64 from a bare float literal, unifies to
f64, and only then compares against the declared f32.

So the fix belongs in the checker, and it is the same shape as `wacIntLit`: integer
literals already take their width from context. Doing it for floats means threading an
expected type into the ternary's branch inference.

Found while writing a test for `§wac-ternary-null-3kx9ba2` and noted in
`spec/spec/control.md` rather than left to be rediscovered.
