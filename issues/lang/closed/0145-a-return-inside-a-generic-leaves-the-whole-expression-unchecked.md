# 0145 — a `return` inside a generic leaves the whole expression unchecked, and three sites resolve a bare name wrongly

- **Status:** closed — recall 973 → 977 of 993, and the three defects it named are fixed
- **Claimed by:** agent-c
- **Fixed in:** `fd04329f` — the written arity, the `return` walk and the fourth site; `059d196c` — the literal path walked, and a conditional of literals
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** not implemented — a missed diagnostic, no false answer

## Reproduction

```wac
struct Plain { i32 v;  i32 get(const this) { return zzz.v; } }
struct Gen<T> { T v;   T get(const this) { return zzz.v; } }
```

Expected: two *undefined name* diagnostics, which is what the reference gives.

Actual: one. The `Plain` line is reported and the `Gen<T>` line is not.

## Why

`checkStmt`'s `Return` arm:

```wac
string expected = declared;
if (!returnsAValue(expected)) { return; }     // ← and `checkExpr(c, e)` is at the *end* of the arm
```

`declared` is `typeOfTy(c, want)`, which answers unknown for `T` while `T` is unbound. So the arm
leaves before `checkExpr` and **nothing in the returned expression is walked at all** — no undefined
name, no operand mismatch, no arity. `T` makes the *comparison* impossible and says nothing about the
names inside the expression; one silence is standing in for the other.

Worth about 3% of recall on `mutateCheck`'s sweep, and it is the largest single cause left in
*undefined variable*, which is that sweep's most-missed family.

## What I tried, and why it is backed out rather than fixed

Walking the expression anyway is four lines and turns up three more defects, each of which has to be
fixed first. Recall went 954 → 962 of 993 and brought 71 false alarms and 17 contradictions with it.

**1. The slot has to be the declared type as *written*.** `typeOfTy` answers unknown for `Box<T>`, and
passing that on as "no slot" reported `return Box(x);` inside `Box<T> of(T x)` as *not callable* — a
bare generic construction does need a slot and this is one, since the rule reads only the template.
`writtenTy(c, want)` gives `Box<T>` and fixes those 71.

**2. A funcref type that mentions a type parameter is unnameable, and three places read that as "not a
funcref".** `typeOfTy` on `fn[U(T)]` returns unknown as soon as one component is unknown. So for

```wac
U applyTo<T, U>(T x, fn[U(T)] f) { return f(x); }
export i32 f() { return applyTo(7, dbl); }
```

`f(x)` resolves to the module-level `f` — which takes no arguments — and is refused for *its* arity.
That is `issues/lang/0143`'s defect again, arriving through the condition instead of the order, and it
is in **three** places: `checkCallee`, `typeOfExpr`'s bare-name call, and (fixed today)
`walkCalleeSig` in the emitter.

**3. Silencing on "unnameable" is too broad, and this is where I stopped.** Guarding those sites with
*a declared name whose type cannot be named means say nothing* fixes the false alarms and breaks real
checks: an **imported** name is in the declared-name table with no nameable type, so
`checkGraph`'s `give(3)` — where `give(Pending<i32> p)` comes from another module — stopped being
reported, and `spec/cases/0186`/`0187` (two modules' same-named types are two types) began to pass.

The way through is probably not a guard at all but the root cause: make `typeOfTy` keep a funcref's
*shape* when a component is a type parameter — `fn(T) -> U` rather than unknown — so the three sites
can see it is a funcref and `funcrefArity` can count it. That is a change to a representation the whole
file compares against, so it needs the sweeps run at each step, and it wants its own attempt rather
than being smuggled in beside a recall fix.

## Notes

`packages/wacc/test/missed.ts` prints the programs behind any row of `mutateCheck`'s table:

    deno run -A --unstable-net packages/wacc/test/missed.ts "undefined variable"

The reference has its own version of this hole one step further along: it misses an undefined name
inside a **generic enum's** method when the use is inside a `match` arm, where wacc (with the walk)
reports it. So a fix here will make wacc stricter than the reference on that shape, and
`mutateCheck`'s no-contradiction invariant is measured against the reference — worth knowing before
the sweep tells you in the form of a failure.

## The same shape at the literal path — found 2026-08-17, later

`checkStmt`'s `Return` arm has a second early exit with the same consequence:

```wac
      i32 lit = litKindOf(e);
      if (lit != litNone()) {
        reportLiteral(c, expected, e, errReturnTypeMismatch(), e.line, e.col);
        return;                       // ← and `checkExpr(c, e)` is at the end of the arm
      }
```

Harmless for a leaf, because a literal has nothing inside it. Not harmless the moment something
compound counts as a literal: `litFamily` already says `1 + 2` is one, and I extended it to
`cond ? 1 : 2` — which made the whole conditional a leaf to every caller taking that path, and a
conditional has a **condition**. `i32 n = p is null ? 1 : 0;` lost the warning about `is null` on a
non-null reference, and `reach.test.ts` lost `Ternary-cond` from its walk. Both caught it immediately,
which is the good news; the extension is reverted with the reason written where it was.

A binary is safe today only because *every* leaf of one has to be a literal for the family to be known,
and a condition is not one of a conditional's leaves. So this is latent rather than live — the fix is
the same as the one above: walk the expression whichever path answered it.

`typeOfExpr`'s own conditional rule is landed and is not affected: a literal branch takes the other
branch's type, which is what makes `cond ? x == y : true` a `bool` and left `cond ? 1 : 2` in an `i64`
slot alone.

## Closed — 2026-08-17

Fixed, and not the way this note proposed. It suggested making `typeOfTy` keep a funcref's *shape* when a
component is a type parameter; that would have put `fn(T) -> U` into every `assignable` in the file. What
the three sites actually want is narrower: **whether the name is a funcref, and how many arguments it
takes.** Both are in the type as *written*, so the arity is recorded at the declaration —
`C.nameFuncArity` — and nothing about what comparisons see changes.

With that, the four halves:

1. **The `return` is walked** when the declared type cannot be named, with the slot spelled from the
   written type so a bare generic construction still has one.
2. **`checkCallee`** treats an unnameable declared name of known arity as the funcref it is, and checks
   the count.
3. **`typeOfExpr`'s bare-name call** answers unknown rather than a same-named module function's return
   type.
4. **And a fourth site nobody had noticed, in value position:** `if (held != typeNone())` let an
   *untyped* declared name fall through to `funcValueType`, so a match binding from an unresolved variant
   answered with a module function of the same name. It arrived red through a merge —
   `packages/wactest/src/fixtures.wac` is the first file in the repository to name a function `bytes`,
   and `case Str(bytes): string.fromBytes(bytes)` in it was reported as passing a funcref where `u8[]`
   belongs.

The literal-path half is fixed too, which is what makes the conditional rule safe: `reportLiteral` and
return skipped everything inside a compound literal, so `i32 n = p is null ? 1 : 0;` lost the warning
about `is null` on a non-null reference the moment `cond ? 1 : 2` counted as one. Both callers walk the
expression either way now, the `Return` gate uses `litFamily` like the declaration one beside it, and
`reach.test.ts` and `test/wac/warnings_test.wac` — the two that caught it — are green.

What is left in the sweep's missed list is not this: two cases need template bodies instantiated, which is
a difference from the reference by design, and the rest are single corners.
