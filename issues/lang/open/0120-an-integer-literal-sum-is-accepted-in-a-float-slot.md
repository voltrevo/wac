# 0120 — an integer literal sum is accepted in a float slot

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** diagnostic
- **Symptom:** no error

## Reproduction

```wac
export f64 f() { f64 s = 1 + 2; return s; }
```

Expected: a compile error. `spec/spec/types.md` — an integer literal takes whatever **integer** type
is expected of it, and *"no implicit conversions between any types"*. The reference says
`type mismatch: expected f64, got i32`.

Actual: accepted, and it computes `3.0` in floating point.

A single literal is fine: `f64 x = 1;` is refused by both. It is the **arithmetic** form that slips
through — `litKindOf` answers `litNone` for a `Binary`, so the literal-adoption rules never look at
it, and `typeOfExpr` of two literals is unknown, and unknown is silence.

## Where the fix goes, and why it is not the cast one

`issues/lang/0119` fixed the same shape for casts, by giving a literal *operand* its notation default
in one place — `castOperandType`. This one is not a cast: the site is the assignment and argument
paths, which go through `literalFits`/`acceptsLiteral`, and the question is what the **type of an
expression made only of literals** is. The emitter already answers it (`typeOfE` returns `f64` when
either side is a float literal, `issues/lang/0117`); the checker does not.

Worth measuring before writing it: how much of the repository's code says `f64 x = 1 + 2` today. The
corpus compiles under the reference, so package sources are clean by construction — the risk is in
the two places only wacc ever sees, which is exactly where 0119's two pieces of illegal code were
found: `.wac` test files and `// only: wacc` spec cases.
