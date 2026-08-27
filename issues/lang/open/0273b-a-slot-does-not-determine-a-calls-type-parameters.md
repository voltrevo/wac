# 0273b — a slot does not determine a call's type parameters, and `design/lang/0011` asked for it to

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** decision
- **Symptom:** a program that reads as though it should compile, and a criterion that cannot be ticked

`design/lang/0011` is implemented for free functions, and one half of one acceptance criterion is not:

```wac
Vec<T> empty<T>() { return Vec<T>(T[0](), 0); }

Vec<i32> a = empty<i32>();          // works
Vec<i32> b = empty();               // error: nothing in the call says what T is
```

Criterion 2 asks for both. The first is what that document built; the second is a different feature
wearing the same clothes, and it is a **decision** rather than work left over, which is why this is
filed rather than finished.

## Why it is not just the rest of the work

`spec/spec/generics.md` says it, and says it as a limit rather than a gap:

> A return type alone does not determine `T`; that is a deliberate limit rather than an oversight, and
> lifting it would mean propagating an expected type into a call, which is the same restriction the
> struct case documents above.

The struct case it points at is the one that *does* propagate: `Vec<i32> v = Vec(…)` takes its
arguments from the declaration, through eight positions `[§wac-generic-expected-position-3qmz8vk]`
enumerates. So the machinery for "the slot supplies it" exists for constructions and stops at calls.

**That asymmetry is the actual question.** Either it is principled — a construction *is* the type it
produces and a call merely returns one — or it is where the implementation happened to stop. The spec
asserts the first without arguing it.

## What each answer costs

**Leave it.** `empty<i32>()` is four characters and says what it does. The cost is that the two
spellings sit beside each other with no rule a reader can state: `Vec<i32> v = Vec(…)` needs no
argument and `Vec<i32> v = empty()` does, and both are "the slot knows".

**Lift it.** Then `empty()` works and criterion 2 closes. The cost is a genuinely new dependency —
the expected type has to reach the call before its type parameters are bound, and
`design/lang/0012` §1 already documents the ordering trap that produces: infer from every non-lambda
argument first, use the result as each lambda's target, synthesise only for letters still unknown. A
slot-directed binding is a third source of truth to order against those two, and the failure mode is a
disagreement reported as a complaint about a letter rather than about the program.

## What is measurable now, and what is not

**Nothing in the tree wants it**: there are no generic free functions in `packages/`, `std/` or
`core/` at all — that absence is `design/lang/0011`'s own evidence and it is unchanged, because the
feature landed today and nothing has been written against it yet. So this cannot be decided on usage;
it has to be decided on the rule.

**What can be measured is the other half.** `empty<i32>()`, `zero<i32>()`, `id<i32>` as a value, and
the same across a module boundary all work and are pinned by `spec/cases/0239`–`0244`. Whoever takes
this decision should write a few generic free functions first and see whether writing the argument is
ever annoying, because right now nobody has written one.

## Notes

**Not urgent.** Every program is writable without it, which is the distinction `design/lang/0012`
draws for its own subject: comfort rather than capability.

**Related.** `design/lang/0012` is the other ergonomic question hanging off this area, and it shares
the ordering problem. If both are taken they should be taken together, because the rule for "which
source of truth binds a letter first" has to cover all three at once.
