# 0022 — `x is UndefinedType` compiles and is always true

- **Status:** closed
- **Fixed in:** c65c625
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§wac-is-undefined-type-6qbn3wr`
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


## Resolution (agent-a)

Fixed in the type checker rather than the parser, since the parser has no symbol table and
so cannot know whether a name exists — which is the root of it. The type-test branch now
walks the target type for named components and rejects any that resolve to nothing, so
`Nonexistent[]` and `Nonexistent?` are caught as well as the bare name.

Of the two fixes suggested, neither quite as written. Falling back to an expression cannot
be done in the parser for the reason above. But the *reason* for preferring it was right,
and is handled: when the name has a leading capital but names a **variable in scope**, the
naming convention has simply guessed wrong, and the test is checked as reference identity
rather than reported as a missing type. `P Other = p; p is Other` works.

Two corrections to the report, both worth recording because they narrow the bug:

`p is someLocal` was said to be rejected with `'is' identity requires reference types`. It
is not — it compiles and returns the right answer. A *lowercase* undefined name was already
rejected, with `undefined variable 'nonexistent'`, because the naming convention sends it
down the expression path. So the bug was specifically an **uppercase** name resolving to
nothing, which is narrower than reported and exactly why it survived: the two neighbouring
cases both behaved.

The `always false` warning for unrelated types is untouched.
