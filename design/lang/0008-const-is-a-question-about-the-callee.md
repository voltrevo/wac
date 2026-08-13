# 0008 — const should be inferred from what a function does, not declared on every parameter

- **Status:** proposed
- **Date:** 2026-08-13
- **Author:** agent-b
- **Answers:** `issues/lang/0052`, open since 2026-07-31

## The hole

`spec/spec/variables.md` says `const` on a reference means no writes through it at any depth
(`§wac-const-deep-j6b1nyg`). Four lines defeat it:

```wac
struct S { i32 v; }
void mutate(S s) { s.v = 1; }
void bad(const S s) { mutate(s); }   // accepted, and it writes through a const reference
```

Every *assignment* position is guarded. The hole is the **argument** position, and it is the same for
a const field, a const array element and `const this`.

## Why the obvious fix was abandoned

`issues/lang/0052` records three enforcement points, each of which refused correct code. The first —
refuse a const-rooted argument for a non-const parameter — is the one everybody reaches for, and its
cost is now measured rather than estimated:

```
parameters in packages/*/src/*.wac                     8,295
  of reference type (struct, array, string)            4,996
  of those marked const today                             28
distinct funcref signatures                                94
  taking a reference-typed parameter                       64
```

**4,996 parameters would have to declare read-only-ness, and 28 do.** That is not a checker change
with a migration attached; it is a migration with a checker change attached, and every one of those
annotations is a claim a reader has to check.

The funcref row is worse than large — it is impossible. `fn[bool(K, K)]` has nowhere to write
`const`, so `Map<K, V>`, which takes its equality that way, cannot be written under the rule at all.
That is what pushed the issue to "const has to be part of the type", and a type-system change to fix
an argument-position hole is a heavy answer.

## The proposal: ask the callee, do not ask the author

**A function's parameters are read-only or not as a matter of fact, and the compiler already has the
body.** Compute, for each function, which of its parameters it writes through — directly, or by
passing them on to a parameter that is itself written through — and refuse a const-rooted argument
only where the callee actually writes.

Nothing is annotated. The three cases that defeated the declared form all pass:

| case from 0052 | under this rule |
| --- | --- |
| `bytesEq(m.key, key)` — reads only | **allowed**: `bytesEq` writes through neither parameter |
| `Map.keys()` copying out of a const container | **allowed**: copying is not writing through the source |
| `mutate(s)` from `bad(const S s)` | **refused**, which is the bug |

It is the same shape as the `NOT_COVERED` ledgers: a property the code already has, read off it,
rather than a promise a person repeats.

### What it costs

One pass over the declarations, to a fixed point — a parameter is *written* if the body assigns
through it, or passes it to a parameter already known to be written. Fixed points over a call graph
are what the emitter's `settleEmittable` already does, so the shape exists in this codebase.

Two things it does **not** do, stated so they are not discovered later:

- **A funcref call cannot be answered.** `this.eq(a, b)` reaches whatever the funcref holds, and the
  answer is only known where the value was made. Every implementation of a given signature could be
  required to agree, which turns 64 signatures into a checked property; or the call could be allowed,
  leaving the residual hole precisely where it is today. This note proposes allowing it and **saying
  so in the spec** — a stated hole is worth more than an unstated one, and the alternative asks
  authors to annotate the thing they cannot see.
- **Const does not travel out of a return.** `tour.wac` documents that as deliberate and this changes
  nothing about it.

### Why not `const` in the type anyway

Because the cost is 4,996 declarations against a hole whose remaining reach, after this proposal,
is one construct — and because a declared `const` is a claim that can be wrong, while an inferred one
is a measurement that cannot. The type-system change stays available if the funcref residue ever
matters more than the annotations would cost.

## What would have to be true before this lands

1. The fixed point terminates and is cheap on this repository — 4,667 declarations, so it wants
   measuring, not assuming.
2. It refuses the four-line reproduction and each of `0052`'s three cases keeps compiling, as a spec
   case covering both directions.
3. `spec/spec/variables.md` states the funcref residue in the same paragraph as the guarantee, so
   the guarantee is not read as stronger than it is.
