# 0322a — half of every counted loop only walks a collection

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** missing feature
- **Symptom:** an index that exists only to be a cursor, 1,991 times

## The measurement

Across `packages/`, `core/` and `tools/`, matching the exact shape
`for (i32 v = 0; v < X.len(); v++)`:

| | |
|---|---:|
| `for` loops of any kind | 8,925 |
| of that shape | 4,196 |
| **whose counter is used only as `X[v]`, for the same `X`** | **1,991** |

The 1,991 are the ones that would become `for (T x in X)` one for one. The other 2,205 use the
counter for something else — comparing adjacent elements, a parallel array, arithmetic on the
position — and are not this issue.

47% of a very common shape, and about a fifth of every loop in the repository, spent writing a
cursor whose only job is to be dereferenced immediately.

## The narrow version, which is most of the value

```wac
for (u8 b in bytes) { … }
```

over an **array or a `Vec`**, desugared to the loop that is written by hand today. No iteration
protocol, no generators, nothing new in the type system — the desugaring knows the element type from
the collection and emits exactly what the 1,991 sites already contain.

`vision/SHOWCASE.md` has the general form, which also iterates a generator and does need coroutines.
That is a different and much larger feature. This issue is only the array case, and it is separable
because the desugaring for it terminates in existing constructs.

## Why this one is cheap where `0321a` is not

`0321a` — `is not null` narrowing — is a small checker change with a sweep behind it: the day it
lands, 1,730 unwraps become redundant and stop compiling. **This has no such edge.** Adding
`for … in` invalidates nothing; every counted loop keeps working, and the 1,991 sites can be
converted at leisure or never. It is purely additive, which is rare enough among the things in
`vision/` to be worth saying.

## What has to be decided

**Whether the binding is `const`.** `for (u8 b in bytes) { b = 0; }` writes to a copy in the obvious
desugaring, which is a silent no-op. Making it `const` refuses that and matches how a `match` arm's
binding already behaves — `[§enum-narrow-const]` says an arm's binding is const, and for the same
reason.

**What it does on a `Vec`.** `Vec` has `get(i)` rather than `[]`, so either the desugaring knows
about `Vec` — which is a built-in knowing about a library type — or `Vec` grows whatever the
desugaring calls. The second is cleaner and is a decision rather than work.

**Nothing about generators**, which the general form needs and this does not.
