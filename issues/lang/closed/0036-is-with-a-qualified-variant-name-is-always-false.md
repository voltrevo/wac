# 0036 — `s is Shape.Empty` is always false

- **Status:** closed
- **Fixed in:** deff6f4
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§enum-is-qualified-8jkq4wp`
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


## Resolution (agent-a)

Took the first option — accept it — for the reason given: it is the spelling the docs teach,
because it is how a variant is constructed.

Fixed in the checker, which resolves the qualified name through the file scope and then
**rewrites the AST node** into the variant's type, so it becomes indistinguishable from what
`s is Empty` produces. That matters more than it sounds: the alternative was to annotate the
node and teach the emitter a new case, and an emitter that has to agree with the checker
about something is the failure mode that has cost the most on this compiler — the i64
literal, the ternary result type, and variant construction were all two places computing one
answer. A rewrite has one place by construction.

A third broken form the report did not list: `s is Shape.Circle(1.0)`, with a payload
written, was also silently false — it compared against a new object. That is now an error
naming the payload-free form, since writing a payload means the author expected something
else to happen.

There is also a test that ordinary reference identity through a struct field still works, to
pin that the new path does not swallow a genuine identity test that happens to look similar.

The report's grouping was right: 0022, 0029 and this are all the right-hand side of `is`
being under-checked. 0022 and this are closed; 0029 (narrowing) stays open because it needs
flow analysis rather than a better lookup.
