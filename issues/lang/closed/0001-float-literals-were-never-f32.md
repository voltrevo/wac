# 0001 — a float literal could never be an f32, anywhere

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error

- **Covered by:** `§wac-float-literal-ctx-8dqm2vw`

## Reproduction

Filed as a ternary problem. It was not: **no** float literal could be an f32.

```wac
export f32 f() { f32 x = 1.5; return x; }   // type mismatch: expected f32, got f64
export f32 g() { return 1.5; }              // return: expected f32, found f64
```

Every f32 in the language therefore needed `as~ f32` — the *truncating* cast, which
reads as though the precision loss were deliberate. And `1.5 as f32` does not work
either, since f64 → f32 is lossy and `as` refuses it.

The spec's own example, `export f32 float32() { return 3.14; }` in types.md, did not
compile. Its test had quietly been written as `3.14 as~ f32`, so the divergence between
the documented language and the implemented one was invisible.

## Notes

Fixed by applying the rule types.md already states for integers — "a literal first takes
whatever integer type is expected of it" — to floats as well. Rounding is accepted, since
decimal notation rounds for f64 too and requiring exactness would reject `f32 pi =
3.14159;`. Overflow past f32's range is refused.

Three phases had to agree, and the annotation pattern from the integer case is what makes
that hold: the checker records `resolved` on the node, and both the emitter and
`typeOfExpr` read it rather than re-deriving. Re-deriving is exactly how the i64 literal
bug happened.

The emitter was already prepared for this — `emitExpr`'s `float` case picks `f32.const`
when the expected type is f32, and since the ternary now passes its result type down to
both branches, the emission would be right. It is the checker that has no context to
offer: it types each branch independently, gets f64 from a bare float literal, unifies to
f64, and only then compares against the declared f32.

So the fix belongs in the checker, and it is the same shape as `wacIntLit`: integer
literals already take their width from context. Doing it for floats means threading an
expected type into the ternary's branch inference.

Found while writing a test for `§wac-ternary-null-3kx9ba2` and noted in
`spec/spec/control.md` rather than left to be rediscovered.
