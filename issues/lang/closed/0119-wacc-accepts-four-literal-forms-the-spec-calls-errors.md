# 0119 — wacc accepts literal forms the spec calls errors, and no oracle looks that way

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
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


## Fixed, and what it found

`checkCast` asked *what is this operand?* in **three places**, and all three answered "nothing" for a
literal. One `castOperandType` now answers for all three: a literal falls back to its own notation —
`f64` for a float, `i32` for an integer with a reading there, `i64` for one without — and the
existing rules do the rest. Sixteen forms compared against the reference afterwards, all agreeing,
including `'a' as i32` (redundant) and both `i31ref` directions.

It found two pieces of **illegal code in this repository** that nothing had ever put through the
reference:

- `packages/quic/test/wac/varint_test.wac` — `151288809941952652 as i64` and
  `4611686018427387903 as i64`. The reference refuses that file at exactly those two lines. It is a
  wac test file, so the only thing that compiled it was wacc.
- `spec/cases/0139` — `(0 as u32).leadingZeros()` and twelve more like it. The case is
  `// only: wacc`, so the reference never ran it, and it only compiled because casts on literals were
  unchecked. Written through typed locals now, which is how the language says *this value is a u32*.

Both are the same shape as the mislabelled cases that started this: **code that only one compiler
ever sees is code with one opinion about it.** A `.wac` test file and a `// only: wacc` case are
exactly the two places that happens here.

`f64 s = 1 + 2` is **not** fixed — an integer literal in a float slot is an assignment rather than a
cast, and a different site. Left open as its own thing rather than folded in here, because the fix
above is one function and that one is the literal-adoption table.
