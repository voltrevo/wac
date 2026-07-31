# 0027 — patterns are one level deep

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
enum Tree { Leaf(i32 value), Node(Tree left, Tree right) }

i32 firstLeaf(Tree t) {
  match (t) {
    case Node(Leaf(v), r): return v;      // not accepted
    case Node(l, r):       return firstLeaf(l);
    case Leaf(v):          return v;
  }
}
```

Expected: eventually, a pattern that matches a variant inside a payload.
Actual: a binding is a name, so the inner `Leaf(v)` is a parse error. The workaround is a
nested `match` inside the arm, which works and is only more verbose.

## Notes

Deferred deliberately; recorded in enums.md. Filed to be tracked.

The interesting part is not the parsing but exhaustiveness: once patterns nest, "does this
match cover every case" stops being a set-membership check over variant names and becomes a
real analysis. That is the whole reason it was deferred, and it is worth being honest that
the current exhaustiveness check would have to be replaced rather than extended.

Also needs a decision on whether nesting composes with the narrowing rule. Narrowing works
today because an arm's binding is a *shadow* with a lexically fixed type; a nested pattern
introduces bindings at depth, and it is not obvious the same trick still applies.

Low priority. A nested `match` in the arm is a faithful workaround with no correctness cost,
which is not true of the other items here.


## Judgement, after the other five (agent-a, 2026-07-31)

Not implementing this now, and recording that as a decision rather than leaving it to look
like neglect. The other five deferred enum items are resolved — `match` as an expression
(0026), methods (0028) and narrowing (0029) are implemented; the two performance items (0030,
0031) are measured and declined with the numbers attached. This is the only one left, and it
is the one I would still not do.

Three reasons, in order of weight:

**The workaround is exact.** A nested `match` inside the arm computes the same thing, with no
correctness cost and no lost expressiveness — only more lines. That is not true of any of the
other five: narrowing's absence forced a cast, and the missing expression form forced a
mutable local.

**It replaces the exhaustiveness check.** Nesting turns "does this cover every variant" from a
set-membership question into a pattern-matrix analysis. Exhaustiveness is the single thing
enums are most valued for here, and it is currently simple enough to be obviously right. Making
it subtle to gain an ergonomic shorthand is a bad trade at this stage.

**Nothing is asking for it.** Four consumers use enums now — `wacc`'s AST, `json`, `fmt`, and
the spec's own tests — and none has needed a nested pattern. `wacc`'s printer, the most
match-heavy code in the repo, is one level deep everywhere.

What would change my mind: a consumer where the nested `match` genuinely obscures the code, or
a decision to implement the general exhaustiveness analysis for another reason, at which point
this comes along nearly free.

Note for whoever does take it: 0031's warning applies here. `match` currently tries arms in
source order, which is unobservable only because patterns cannot overlap. Nested patterns can
overlap, so arm order becomes semantic and `br_table` stops being a drop-in optimisation.
