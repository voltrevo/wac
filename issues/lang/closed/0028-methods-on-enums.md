# 0028 — an enum cannot have methods

- **Status:** closed
- **Fixed in:** b4bf8ca
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§enum-methods-6vkq2wn`
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


## Resolution (agent-a)

Methods attach to the enum's generated base struct, so `this` is the enum type and
`match (this)` reaches a variant. Variants come first, comma-separated; methods follow, and
are told apart by shape — a type, a name, a parameter list, which a variant cannot have — so
no separator keyword is needed.

Both open questions, decided rather than deferred:

- **A variant may not have its own method.** Only the enum does. `Circle.area()` and
  `Shape.area()` dispatching differently is a distinction nobody has asked for, and allowing
  it later is easier than taking it back.
- **`override` is refused.** The variants are compiler-generated subtypes, so an override
  would mean per-variant virtual dispatch — a different feature, better refused than
  half-supported.

A third question the parser forced, which the notes did not raise: a **static** method would
be called `Shape.make()`, which is already how a variant is constructed. So a method here
must take `this`, and may not take a variant's name — `E.name` has to mean one thing.

## What the first three tests missed

The three obvious tests — a method on a literal, on a variable, calling another — all passed
while the resolver's annotation pass ignored enum method bodies completely. They could not
catch it, because each used only types already in scope elsewhere in the file.

A fourth test names a struct, an array type and a function that appear *only* inside the
method body. That failed with "undefined function or struct 'Q'", and it is the seventh
appearance of issue 0005's shape.

Worth generalising: **a feature's own tests use whatever is already in scope, so they do not
exercise the walks.** Reaching a type only through the new construct is what does. That
belongs in the checklist for any AST addition, next to "run it, do not just compile it".

Also recorded honestly in the code: attaching the methods to the base *declaration* is
currently redundant — Phase 3 registers the callable entries from the EnumDecl, and type
collection reaches the bodies through `result.funcs`. It is kept because the declaration
should describe what the struct has, and any walk reading `structDecl.methods` — as several
do for hand-written structs — would otherwise skip an enum's methods silently.
