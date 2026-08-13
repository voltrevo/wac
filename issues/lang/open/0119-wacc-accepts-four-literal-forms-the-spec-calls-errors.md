# 0119 — wacc accepts literal forms the spec calls errors, and no oracle looks that way

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** diagnostic
- **Symptom:** no error

## Reproduction

Five programs the reference refuses and wacc compiles:

```wac
export f64 a() { return 1.5 as~ f64; }   // ref: cast from 'f64' to 'f64' is redundant
export i32 b() { return 1 as~ i32; }     // ref: cast from 'i32' to 'i32' is redundant
export i32 c() { return 1 as! i32; }     // ref: cast from 'i32' to 'i32' is redundant
export f64 d() { return 1 as~ f64; }     // ref: lossy cast not needed
export f64 e() { f64 s = 1 + 2; return s; }  // ref: type mismatch: expected f64, got i32
```

Expected: a compile error in each. `spec/spec/casts.md` — *"using `as~` where `as` would work is a
compile error"*, and the same for `as!` and `as@`. `spec/spec/types.md` — an integer literal takes
whatever **integer** type is expected of it, and *"no implicit conversions between any types"*, so
`f64 s = 1 + 2` is not a float sum.

Actual: all five compile and run.

**The rules themselves are implemented.** With a *variable* on the left, wacc and the reference agree
on all eight forms tested — `x as~ i64`, `x as! i32`, `x as@ f32`, the redundant same-type pair, and
the legal ones. The gap is only where the operand is a **literal**: wacc's checker has no type for one
until a slot gives it, and a cast's slot is its own target, so "is this cast redundant?" has nothing
to compare. The reference types a literal by its default — `i32`, or `f64` for a float — and asks the
same question.

## Why nothing caught it

This is the more useful half of the report.

Every oracle over real code checks **one direction**. `corpusCheck.test.ts` says it outright: *"the
reference compiles this cleanly, so we say nothing about it"* — the corpus is code that compiles, so
it can only catch a diagnostic wacc **invents**, never one it **misses**. Seeing less is safe; that
is the whole design, and it is right.

What would catch the other direction is mutation — `corpusMutate.test.ts` and `mutateCheck.test.ts`
break correct code and check that both compilers refuse it — but a mutation menu only produces the
mistakes it knows how to make, and **no operator in it swaps a cast operator or retypes a literal**.
So the forms above are not in the corpus (they would not compile under the reference, which the
suite still builds with), not in the spec's refused list, and not reachable by mutation.

The cheapest fix for the *class* is probably a mutation that rewrites `as` to `as~`/`as!`/`as@` and
one that moves a literal between an integer and a float slot. That finds this family and whatever
else shares its shape, rather than these five.

## Found by

Writing `spec/cases/0144` and `0145` for `issues/lang/0117` and marking them `// only: wacc` out of
habit. The reference refused them — not for the feature under test, but because the cases themselves
used `-16 as~ i64` and `f64 sum = 1 + 2`, which the spec forbids and wacc had accepted. The cases are
written legally now and **five of them turned out not to be wacc-only at all**: 0141 through 0145 are
met by the reference, so the markers came off and its runner covers 125 rather than 120.

That is worth its own line, because a marker that says *"do not ask the reference"* is a piece of
oracle turned off by hand — cheap to add for the wrong reason and invisible afterwards.
