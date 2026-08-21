# 0246a — a ternary's branch-agreement rule has four literal guards and all four are the narrow one

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — the predicate and both family guards, together
- **Fixed in:** `packages/wacc/src/check.wac`, with `packages/wacc/test/wac/ternarybranches_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — branches that cannot agree are accepted when the non-string one is
  written as a compound literal

## Reproduction

```wac
export i32 f(bool b) { i32 n = b ? 1 + 1 : "a"; return n; }
```

Expected: refused. The reference says *"ternary branches have incompatible types: i32 and string"*,
and it refuses the direct form `b ? 1 : "a"` too.

Actual: no diagnostics. Measured beside its neighbours, which is where the shape shows:

| program | wacc | reference |
|---|---:|---|
| `b ? 1 : "a"` | 1 | refused |
| `b ? 1 : "a" + "b"` | 1 | refused |
| `b ? 1 + 1 : "a"` | **0** | refused |
| `b ? 1 + 1 : "a" + "b"` | **0** | refused |
| `b ? 1 : 2` | 0 | accepted |
| `b ? "a" : "b"` | 0 | accepted |
| `b ? 1 + 1 : 2 + 2` | 0 | accepted |
| `b ? s : 1` | 1 | refused |

The asymmetry is the tell: a compound literal on the **right** is caught and on the **left** is not.

## Why — four guards in one rule, and they interlock

`checkExpr`'s `Ternary` arm decides branch agreement with four literal tests, all of them
`litKindOf`-based, so none can see `1 + 1`:

```wac
if (isPlainLiteral(els) && !isPlainLiteral(then)) { … literalFits(c, lt, els) … }
else if (isPlainLiteral(then) && !isPlainLiteral(els)) { … }
if (litKindOf(then) == litNone() && litKindOf(els) == litNone()) { … both known types … }
else if (litKindOf(then) != litNone() && litKindOf(els) != litNone()) { … two literal families … }
```

For `b ? 1 + 1 : "a"` every one of them declines to speak:

* `isPlainLiteral(els)` is true and `isPlainLiteral(then)` is **false** — `isPlainLiteral` reads
  `litKindOf`, so `1 + 1` is not a literal to it — so the first branch runs, and it asks
  `typeOfExpr(then)`, which is `typeNone()` for two integer literals *by design*. Guarded on
  `lt != typeNone()`, so nothing.
* The third needs *neither* side to be a literal: `"a"` is one, so no.
* The fourth needs *both* to be literals by `litKindOf`: `1 + 1` is not, so no.

Which is why the right-hand form works and the left-hand one does not: swap the branches and it is the
*second* test that runs, `typeOfExpr("a" + "b")` answers `"string"` since `issues/lang/0245a`, and the
complaint lands.

## What to do, and the order that matters

`isPlainLiteral(Expr)` takes no `C`, so it cannot call `litFamily`. Give it one — all four call sites
have a `C` in scope — or add a compound-aware sibling beside it.

**Then the third and fourth guards have to move in the same change.** Making `isPlainLiteral` see
`1 + 1` turns `b ? 1 + 1 : "a"` into *two* plain literals, which sends it past the first two branches
and into the fourth — and the fourth is still keyed on `litKindOf`, so it declines too and the program
stays accepted. Fixing one guard here changes which guard is silent rather than the answer.
`issues/lang/0245a` is the precedent: a rule and a model of that rule have to be asked the same
question, and moving one alone made them disagree.

**Canary on counts, not refusals.** `b ? 1 : "a"` is refused *once* today, by the fourth guard; if the
first two start speaking for it as well it becomes two diagnostics where the reference gives one. The
row to watch is `b ? s : 1`, which `issues/lang/0170a` added and which this rule already reports
exactly once.

## Notes

Found by carrying `issues/lang/0244a`'s question — "which guards ask the narrow literal test" — past the
eleven that go through `reportLiteral`. That sweep also turned up three in array sizes and indices,
fixed in `0244a`, and one in a `switch` case value that needed no change. This is what is left of it,
and it is the one with interlocking branches rather than a single condition.

## Closed — and the "order that matters" above was right about four of the six

`isPlainLiteral` takes a `C` now and reads `litFamily`, and the two family guards below it read
`litFamily` in the same change. Six pairs, each a direct form beside its compound twin, all at one
diagnostic:

| pair | direct | compound, before | after |
|---|---:|---:|---:|
| an integer against a string literal | 1 | 0 | 1 |
| an integer against a string sum | 1 | 0 | 1 |
| a string literal against an integer | 1 | 0 | 1 |
| a bool literal against an integer | 1 | 0 | 1 |
| a named string against an integer | 1 | 0 | 1 |
| a float against a string literal | 1 | 0 | 1 |

**The lockstep is measured rather than argued.** Reverting only the two family guards, with the
predicate still widened, leaves **four of the six** failing — those four now have two literal branches,
so they walk past the arms that compare a literal against a type and into the family arm, which was
still asking `litKindOf` and declined as well. The other two are caught by the `literalFits` arm either
way. So "fixing one guard changes which guard is silent" is true of four rows and the number is in the
comment.

**Pinned at one, not at "more than zero".** The failure mode of this rule is speaking twice, and a `> 0`
assertion cannot see it. The reference is no help for the count here — it gives two for `b ? "a" : 1`
where wacc gives one, because wacc suppresses the second complaint about a fault it has already named
(`issues/lang/0238a`). So the oracle is the pair: the same program written two ways must get the same
answer, which is immune to that difference and is exactly the property that was broken.

Seven legal compound branches are pinned beside them — two integer sums, a sum against a named `i32`,
a float sum against a named `f64`, two string literals, the plain literal pair, an `i64` slot, and a sum
against a nullable. Widening `isPlainLiteral` also improves `typeOfExpr`: `b ? x : 1 + 1` in an `i64`
slot is typed now where it answered unknown.

Verified: `corpuscheck` over the repository, `typecheck` rung 3 with 0 false alarms and 0 contradicted,
`cases`, `illtyped`, `compoundlit`, `binaryoperands`, `specsingle`, `specmulti`, `codes`, `warnings`,
`matcharms`.
