# 0036 — `s is Shape.Empty` is always false

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer

The bare variant name works in an `is` test. The *qualified* name — the same
spelling used to construct the variant — compiles and is always false for a
payload-less variant.

## Reproduction

```wac
enum Shape { Circle(f64 r), Rect(f64 w, f64 h), Empty }

export i32 bare()      { Shape s = Shape.Empty; return (s is Empty) ? 1 : 0; }
export i32 qualified() { Shape s = Shape.Empty; return (s is Shape.Empty) ? 1 : 0; }
```

Expected: both return 1, or the qualified form is a compile error.
Actual: `bare()` returns 1, `qualified()` returns 0, with no diagnostic.

## Notes

`Shape.Empty` on the right of `is` is parsed as a variant *construction*, not a
type. So the test becomes reference identity against a freshly built `Empty`, which
is never the same object — hence always false.

The give-away is the payload case, which fails differently:

```wac
export i32 c(Shape s) { return (s is Shape.Circle) ? 1 : 0; }
// error: 'Shape.Circle' needs a payload (r)
```

That message only makes sense if the right-hand side is being read as a
construction. A variant with a payload is therefore *rejected* while a
payload-less one silently returns false — the same inversion as 0022, where an
undefined type name silently returns true while a real-but-unrelated one warns.

`Shape.Empty` is the natural thing to write, because it is exactly how the variant
is constructed and how `match` arms are introduced elsewhere in the docs. Someone
reaching for it gets a value that is always false and no hint why.

Two fixes, and 0022 probably wants the same decision:

- accept a qualified variant name in type position, so `s is Shape.Empty` means
  what `s is Empty` means; or
- reject it with a message naming the bare form.

The first is friendlier and matches the construction syntax. Either is better than
a silent false. Related: 0022 (`is` against an undefined type is always true) and
0029 (`is` does not narrow) — all three are the right-hand side of `is` being under-
checked.

Found while probing enums after `enums.md` warned that the feature's tests and its
implementation were written from the same understanding.
