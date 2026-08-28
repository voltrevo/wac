# 0283b — a qualified variant on the right of `is` is always false

- **Status:** closed
- **Fixed in:** `packages/wacc/src/parse.wac` — `parseIsExpr` recognises `Enum . Variant` as the
  variant's type. Cases `spec/cases/0262` and `spec/cases/0263`.
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** bug
- **Symptom:** wrong answer — compiles clean, and the test never holds
- **Covered by:** `§enum-is-qualified-8jkq4wp`

## Reproduction

```wac
enum Shape { Point, Circle(f64 radius), Rect(f64 width, f64 height) }
export i32 f() {
  Shape s = Shape.Circle(2.0);
  Shape p = Shape.Point;
  i32 n = 0;
  if (s is Circle)       { n = n + 1; }      // bare, payload variant
  if (s is Shape.Circle) { n = n + 10; }     // qualified, payload variant
  if (p is Point)        { n = n + 100; }    // bare, no payload
  if (p is Shape.Point)  { n = n + 1000; }   // qualified, no payload
  return n;
}
```

Expected: `1111` — `spec/spec/enums.md` says both spellings are the same test.
Actual: `101`. No diagnostic; both qualified forms are silently false.

## Notes

`looksLikeTypeHere` puts `kDot()` in its `exprFollow` set, which is right everywhere else in the
grammar: a `.` after a name makes a member access. On the right of `is` it meant the qualified form
parsed as an expression, so the test became reference identity against a freshly constructed
variant — never the subject, so never true.

**The spec already describes this bug, in the past tense.** `spec/spec/enums.md`:

> The qualified form is worth stating because it used to be silently wrong. `Shape.Empty` on the
> right of `is` parses as an expression rather than a type, so the test became reference identity
> against a freshly constructed variant and was always false

That paragraph is about the **TypeScript reference**, where it was found and fixed. wacc never had
the fix. Nothing said so because the clause's only checker was a test in compiler/wacSpec.test.ts,
which drove the reference — so the clause was held against the implementation that had the fix and
not against the one that did not.

**Why it surfaced on 2026-08-28 and not before.** Two failures had to be repaired first, and neither
is about enums:

1. `compiler/` was deleted, which took the clause's only checker with it. That made
   `spectags_test.wac` name 26 `§enum-*` clauses as held by nothing — the list is what sent me here.
2. That test had not been *running*: `wac test` refused a list of paths, so the runner's chunks of
   `packages/wacc/test/wac` exited 2 without running anything (`issues/system/0272b`). Fixing that
   took the wac lane from 952 tests in 141 files to 2681 in 432, and this was in the difference.

So the sequence is: a deletion removed a checker, a broken runner hid the report about it, and the
bug underneath had been there the whole time. Worth recording because the middle step is the one
that makes this hard to see — the lane was green and counting.

**The payload form was already right.** `s is Shape.Circle(1.0)` is refused, which is what the same
clause requires; the fix leaves it alone by declining when a `(` follows.
