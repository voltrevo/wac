# 0022 — `x is UndefinedType` compiles and is always true

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer

An `is` test against a type name that does not exist is accepted with no error and
no warning, and evaluates to **true**. A typo, or a struct that has been renamed or
whose import was dropped, silently turns a runtime type test into a tautology.

## Reproduction

```wac
struct P { i32 x; }
struct Q { i32 y; }

export i32 typo()  { P p = P(1); return (p is Nonexistent) ? 1 : 0; }
export i32 real()  { P p = P(1); return (p is P) ? 1 : 0; }
export i32 other() { P p = P(1); return (p is Q) ? 1 : 0; }
```

Expected: `typo()` is a compile error — `Nonexistent` is not a type.
Actual: it compiles with zero diagnostics and returns `1`. `real()` returns `1` and
`other()` returns `0`, both correct.

## Notes

The comparison with the existing behaviour is what makes this worth fixing. A test
against a *real but unrelated* type is already handled well: `p is Q` returns false
and raises the `'P' as! 'Q' always traps` style warning added by audit-26. So the
unrelated case warns, and the meaningless case passes silently — the opposite of the
useful ordering.

Where it goes wrong is likely the parse of `is_expr`, which is
`or_expr , [ ("is" | "is" "not") , (type | "null" | or_expr) ]`. An `IDENT` on the
right can be a type or an expression, and an unknown `IDENT` appears to resolve as a
type that then never fails a lookup. Two plausible fixes:

- reject an `IDENT` in type position that is not a declared struct, enum or variant,
  which is what `is` needs; or
- fall back to treating it as an expression, which then fails with
  `undefined variable 'Nonexistent'` — the message a reader would expect.

The second is probably better: it also covers `p is someLocal`, which today is
rejected with `'is' identity requires reference types`, a message about the wrong
thing when the real problem is a misspelling.

Found while writing the crypto package; not blocking it. What made it visible was
using `is` on a value whose type name I had changed, and getting `true` back.
