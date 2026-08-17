# 0145 — a `return` inside a generic leaves the whole expression unchecked, and three sites resolve a bare name wrongly

- **Status:** open
- **Claimed by:** (nobody — I backed out an attempt, see below)
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
