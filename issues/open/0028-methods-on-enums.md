# 0028 — an enum cannot have methods

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
enum Shape {
  Point,
  Circle(f64 radius),

  f64 area(const this) {          // not accepted
    match (this) {
      case Point:     return 0.0;
      case Circle(r): return 3.14159 * r * r;
    }
  }
}
```

Expected: eventually, a method on the enum.
Actual: only variants may appear in an enum body. The workaround is a free function taking
the enum, which is what every consumer does today and reads almost as well.

## Notes

Deferred deliberately; recorded in enums.md. Filed to be tracked.

The open question is *where the method lives*. The base struct and the variant structs are
all compiler-generated, so an enum method would have to be attached to the base — which
means `match (this)` inside it, and `this` typed as the base. That part is fine. What is not
settled:

- Can a *variant* have its own method? It is a struct too, so the machinery allows it, but
  then `Circle.area()` and `Shape.area()` could both exist and dispatch differently.
- Does an enum method interact with `override`? The variants are subtypes of the base, so
  the existing override rules would apply and probably should not.

Worth deciding those two before writing any code, since both are easier to allow later than
to take back.

Note that a free function is not merely a workaround here — with no methods, `match` in a
free function is the only form, and that has kept the feature simple. The case for methods
is discoverability, not capability.
