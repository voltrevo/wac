# 0029 — `if (s is Circle)` does not narrow `s`

- **Status:** closed (restricted form)
- **Fixed in:** 9014759
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-narrow-if-2mkq8vp`
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


## Correcting my own reasoning (agent-a)

The notes above say the cheap subset "is a decision to take deliberately rather than the
first step of a general implementation", and imply it still needs machinery the checker does
not have. That conflates the general case with the restricted one, and is wrong about the
restricted one.

`if (s is Circle) { ... }`, narrowing only in the `then` block and only when the condition is
*exactly* `ident is Type`, is a **scope rule**, not an analysis. It is the same mechanism a
`match` arm already uses: introduce a `const` shadowing binding at the narrowed type whose
extent is lexical. Nothing has to be traced through control flow, because:

- the extent is the block, which the parser has already delimited;
- the shadow is `const`, so it cannot be reassigned to something outside the narrowed type —
  exactly the reason a match arm's narrowing is const;
- the outer binding is untouched, so what holds after the block is unchanged and there is
  nothing for an early `return` inside the block to invalidate.

Negation, `&&`, and any other condition shape simply do not narrow. That is a smaller
language than flow-sensitive typing, and it is what TypeScript, Kotlin and C# all started
from — my "worse than none" claim does not survive contact with the fact that the restricted
form is sound, lexical, and already implemented once in this compiler.

So: implementing the restricted form, and documenting precisely when it applies. The general
case stays unimplemented and this issue's original reasoning about *it* still stands.


## Resolution (agent-a)

The restricted form is implemented: `if (ident is Type)` narrows in the then-block, via a
`const` shadowing binding — the same mechanism a `match` arm uses, and sound for the same
lexical reasons. It works for hand-written struct hierarchies as well as enum variants, so it
is not an enum feature.

`&&` narrows from **either** operand, since reaching the block means both held. An earlier
version consulted only the left, on the reasoning that a right-hand narrowing "would have to
hold for the left to have been evaluated" — that is the question for narrowing *inside* a
condition, not for the block, and the block is all this governs. `||` narrows from neither.

What does not narrow, all documented: `is not`, a field or index on the left (no name to
shadow), and any other condition shape.

## The regression this caused, which is the interesting part

Narrowing makes `if (x is T) { T t = x as! T; ... }` a **redundant upcast**, which the
compiler already rejects with "upcast is always safe — use 'as'". That idiom is exactly what
structs.md documented and what one spec test demonstrated, so implementing the feature broke
its own documentation.

Contained, as it turned out: `rg` found no use of the idiom anywhere in wac-mono, so the only
casualties were wac's own example and test. Both updated — and the test now also covers
narrowing *through a field*, where there is no name to shadow and the cast is still the way
to do it, so the thing the old test was really about is still tested.

Worth naming the general shape: **a feature that removes the need for a workaround will break
code using the workaround**, and the docs are code too. Checking the consumers with `rg`
before deciding took a minute and turned an unknown into a two-file change.

## Still open in spirit

The general case — negation, narrowing that survives an early `return`, narrowing inside the
condition itself — needs flow-sensitive typing, and the original reasoning about *that* stands
unchanged. Whoever wants it should file a new issue rather than reopen this one, because the
restricted form is not a step toward it: it is a different mechanism that happens to cover the
common case.
