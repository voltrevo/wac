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
