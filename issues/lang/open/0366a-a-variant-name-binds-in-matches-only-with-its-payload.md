# 0366a — `Circle c matches s` is refused for an enum variant, though every variant is a type

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
enum Shape { Circle(f64 r), Square(f64 s) }
export f64 f() {
  Shape s = Shape.Circle(2.0);
  if (Circle c matches s) { return c.r; }
  return 0.0;
}
```

Expected: Answers 2.0 — spec ch13 makes each variant a subtype of its enum, so a type test against it binds as one against a struct subtype does.
Actual: *no Shape is ever a Circle*.

## Notes

`Circle(r) matches s` works, and `Circle c matches s` works when `Shape`/`Circle` are a struct hierarchy. From `vision/TECHNICAL.md`'s *matches binds a name*.
