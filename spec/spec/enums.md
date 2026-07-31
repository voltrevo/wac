## Enums and match

*Draft. Nothing here is implemented yet.*

An enum is a type with a fixed set of variants, each optionally carrying payload
fields. It compiles to the struct hierarchy you would otherwise write by hand: a
base struct for the enum, a subtype per variant, and a tag the compiler maintains.

### Declaring

```wac
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}
```

Payload fields are named, like struct fields, because positional-only payloads make
a three-field variant unreadable at the use site. A variant with no payload takes no
parentheses.

`Shape` is a type. So is each variant: `Circle` is a subtype of `Shape`, which is
what makes narrowing work.

### Constructing

Qualified by the enum name, consistent with how static methods are already called:

```wac
Shape a = Shape.Point;
Shape b = Shape.Circle(2.0);
Shape c = Shape.Rect(3.0, 4.0);
```

A payload-less variant is a value, not a call — `Shape.Point`, not `Shape.Point()`.

Two enums may use the same variant name; `Shape.Circle` and `Hole.Circle` are
distinct types.

### Matching

```wac
export f64 area(Shape s) {
  match (s) {
    case Point:
      return 0.0;
    case Circle(r):
      return 3.14159 * r * r;
    case Rect(w, h):
      return w * h;
  }
}
```

Arms are `case Pattern:` followed by statements, exactly like `switch` — same
implicit break, same absence of fallthrough. Reusing that shape rather than
introducing `=>` keeps one arm syntax in the language.

Bindings are positional and take their types from the declaration: `r` is `f64`.
They are scoped to the arm.

`[§enum-match-basic]` `area(Shape.Rect(3.0, 4.0))` returns `12.0`.
`[§enum-match-nopayload]` `area(Shape.Point)` returns `0.0`.

### Ignoring payloads

Omit the parentheses to ignore every payload, or name a binding `_` to ignore one:

```wac
export bool isRound(Shape s) {
  match (s) {
    case Circle:        return true;
    case Rect(_, h):    return h == 0.0;
    case Point:         return false;
  }
}
```

`_` may repeat within a pattern; any other duplicate binding name is an error, as
elsewhere in the language.

`[§enum-match-ignore]` `isRound(Shape.Circle(1.0))` returns `true`.

### Exhaustiveness

A `match` must cover every variant. This is the point of the feature: the compiler
catches the case you forgot when a variant is added.

```wac
export f64 bad(Shape s) {
  match (s) {
    case Point:      return 0.0;
    case Circle(r):  return r;
  }
}
```

`[§enum-match-inexhaustive]` This is a compile error: `match does not cover 'Rect'`.

An `else` arm opts out, and then no variant is required:

```wac
export f64 radiusOr(Shape s, f64 fallback) {
  match (s) {
    case Circle(r): return r;
    else:           return fallback;
  }
}
```

`[§enum-match-else]` `radiusOr(Shape.Point, 1.5)` returns `1.5`.

An `else` arm that cannot be reached, because the other arms already cover
everything, is an error rather than dead code:

`[§enum-match-else-unreachable]` A covering `match` with an `else` arm is a compile
error: `else arm is unreachable — all variants are covered`.

Listing the same variant twice is likewise an error:

`[§enum-match-duplicate]` `case Circle(r): ... case Circle(r2): ...` is a compile
error.

### Narrowing

Inside an arm the subject has the variant's type, so its fields are reachable
directly and no cast is written:

```wac
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

export f64 widthOf(Shape s) {
  match (s) {
    case Rect:   return s.width;    // `s` is a Rect here
    case Circle: return s.radius * 2.0;
    case Point:  return 0.0;
  }
}
```

`[§enum-narrow]` `widthOf(Shape.Rect(3.0, 4.0))` returns `3.0`.
`[§enum-narrow-field]` `widthOf(Shape.Circle(2.0))` returns `4.0` — the arm reads
`radius`, which only exists on `Circle`.

This is not flow-sensitive typing. The arm introduces a **new binding that shadows
the subject**, at the variant type, and block-scope shadowing is already part of the
language (see naming.md). So the rule is lexical and needs no analysis: the name means
the variant type for exactly the arm's extent, and the outer binding is untouched
after it.

Three consequences follow from that being a binding rather than a retyping.

**Narrowing happens only when the subject is a plain variable**, since otherwise
there is no name to shadow:

```wac
export f64 first(Shape[] shapes) {
  match (shapes[0]) {
    case Circle: return 1.0;        // nothing named to narrow
    else:        return 0.0;
  }
}

export f64 firstNarrowed(Shape[] shapes) {
  Shape s = shapes[0];              // name it, and the arm narrows it
  match (s) {
    case Circle: return s.radius;
    else:        return 0.0;
  }
}
```

`[§enum-narrow-nonvariable]` Matching on `shapes[0]` compiles, and its arms see no
narrowed name; reading a variant field off the subject expression in such an arm is
a compile error.

**The narrowed binding is `const`.** Assigning to it would raise the question of
which binding is being written, and neither answer is good: writing the shadow
discards the value at the end of the arm, and writing through to the outer one would
let the shadow's type go stale.

```wac
export f64 reassign(Shape s) {
  match (s) {
    case Circle: { s = Shape.Point; return 0.0; }   // error
    else:        return 0.0;
  }
}
```

`[§enum-narrow-const]` This is a compile error: `cannot assign to 's' — a matched
subject is const within its arm`.

**A payload binding may not reuse the subject's name**, because both would occupy the
arm's scope:

`[§enum-narrow-collision]` `case Circle(s)` where the subject is also `s` is a
compile error: duplicate binding.

The `else` arm narrows nothing — its subject is still the enum type, which is the
whole reason to be in `else`.

Narrowing costs nothing at run time. The `br_table` on the tag has already selected
the arm, so the binding is an unchecked downcast: the same instruction an explicit
`as!` would emit, minus the type test that the dispatch made redundant.

### Recursion

A payload may name the enum being declared, which is what makes trees expressible:

```wac
enum Tree {
  Leaf(i32 value),
  Node(Tree left, Tree right),
}

export i32 sum(Tree t) {
  match (t) {
    case Leaf(v):      return v;
    case Node(l, r):   return sum(l) + sum(r);
  }
}
```

`[§enum-recursive]` `sum(Tree.Node(Tree.Leaf(1), Tree.Leaf(2)))` returns `3`.

Payload fields hold references, so this needs no indirection syntax. Construction is
bottom-up, so a non-null reference is always available by the time it is needed.

### Enums in other positions

Anywhere a struct type works:

```wac
export i32 countRects(Shape[] shapes) {
  i32 n = 0;
  for (i32 i = 0; i < shapes.len(); i++) {
    match (shapes[i]) {
      case Rect:  n++;
      else:       { }
    }
  }
  return n;
}
```

`[§enum-array]` An `Shape[]` of one `Rect` and two `Point`s gives `1`.

A nullable enum must be unwrapped before matching — `match` requires a non-null
subject, so a nullable one is `match (s!)` or an `is null` check first. Extending
`match` to handle null as a case is deferred.

`[§enum-match-nullable]` `match (s)` where `s` is `Shape?` is a compile error:
`match requires a non-null value`.

### What this is not, in this draft

**Not an expression.** `match` is a statement. The expression form is on the
roadmap and needs result-type unification across arms, which is a separate step; the
statement form is what a tree walk needs and is worth having on its own.

**No nested patterns.** `case Node(Leaf(v), r)` is not accepted. Patterns are one
level deep.

**No methods on enums.** The base and variant structs are compiler-generated, so
where a user's methods would live is an open question.

**No narrowing outside `match`.** `if (s is Circle) { ... }` does not narrow `s`.
That would be flow-sensitive typing, which needs an analysis rather than a scope
rule — a `match` arm gets away without one only because its extent is lexical and
its type is fixed by the pattern.

**No integer representation for payload-less enums.** An enum whose variants all
lack payloads could compile to a plain `i32` rather than heap-allocated structs. That
is an optimisation, and correctness comes first.

### How it compiles

Given the declaration above, the compiler generates roughly:

```wac
struct Shape  { i32 tag; }
struct Point : Shape { }
struct Circle : Shape { f64 radius; }
struct Rect : Shape { f64 width; f64 height; }
```

with `tag` assigned in declaration order and set by each constructor.

`match` compiles to a `br_table` on the tag, then one unchecked downcast in the
selected arm. The tag matters: a chain of `ref.test` per arm would need one type test
per variant, so a 17-variant AST walk would average eight or nine tests per node. A
table is one jump regardless of variant count, and that is the difference between
this being convenient and being the right way to write a tree walk.

The tag is also why exhaustiveness is checkable at all: the compiler knows the
complete variant set from the declaration, so a missing arm is a static fact rather
than a runtime trap.
