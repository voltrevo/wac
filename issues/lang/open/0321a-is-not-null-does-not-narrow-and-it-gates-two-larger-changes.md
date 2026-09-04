# 0321a — `is not null` does not narrow, and it gates two larger changes

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question — the feature is small, the migration is not
- **Symptom:** every nullable access after a successful null test still needs `!`

## Reproduction

```wac
struct N { i32 v; }
export i32 f(N? c) { if (c is not null) { return c.v; } return 0; }
```

    error: …
      = help: unwrap it with `!`, or test it with `is null` first

The same in a loop condition. Meanwhile the neighbouring test **does** narrow:

```wac
export f64 g(Shape s) { if (s is Circle) { return s.r; } return 0.0; }   // compiles
```

## Why, which `0029` already answers

`issues/lang/closed/0029` implemented narrowing and its resolution says how and how far:

> The restricted form is implemented: `if (ident is Type)` narrows in the then-block, via a `const`
> shadowing binding […] What does not narrow, all documented: `is not`, a field or index on the
> left, and any other condition shape.

So this is not an inconsistency nobody noticed. `is Circle` narrows by **substituting** the type
named; `is not null` names the type **excluded**, and the mechanism has no subtraction. For
nullables the subtraction is the trivial case — `T?` minus null is `T` — which is why this is worth
raising as a special case rather than as the general flow-sensitive typing `0029` declined.

## What it gates, measured

**Removing `Option`.** `Option` narrows, because `case Some(v)` binds the payload; `T?` does not.
The tree is already **811 nullable declarations to 86 `Option` mentions** across 19 files, so
deleting `Option` is finishing a migration rather than starting one — except that the **21**
`case Some(v)` arms would each trade a bound name for an unwrap. With narrowing first, it is pure
subtraction.

**Sentinels becoming `T?`.** There are **515** negative-sentinel returns in 166 files, and eight of
eight sampled were an index or position with `-1` for absent rather than a comparator. The dominant
one is `indexOf`: **734** call sites, **355** of which compare the result against `-1` or `0`. Its
miss is a tagged claim, `[§wac-str-indexof-miss-k4mf8js]`. Without narrowing each of those 355 sites
becomes a null test *and* an unwrap; with it, a test and a name.

## What it costs, which is the reason this is a question

**Unwrapping a non-nullable is an error** — measured — so the day `is not null` narrows, every
`if (c is not null) { … c! … }` in the tree is a redundant unwrap that no longer compiles. There are
**1,445** null tests and **1,730** unwraps across `packages/`, `core/` and `std/`.

`0029` hit this exact shape and wrote it up:

> a feature that removes the need for a workaround will break code using the workaround, and the
> docs are code too […] Contained, as it turned out: `rg` found no use of the idiom anywhere.

It will not be contained here. That is the decision: a small, well-precedented checker change
against a mechanical sweep of a scale nothing in this repository has attempted, versus leaving two
larger changes more expensive than they need to be.

## Not this

Not general flow-sensitive typing, which `0029` considered and declined. Not narrowing through a
field or an index, which has no name to shadow. Only `ident is not null` in a condition, narrowing
`ident` to its non-null type for the then-block — the same lexical extent and the same shadowing
mechanism that already exists.
