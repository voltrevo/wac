## Enums and match

*Implemented, except where marked otherwise below — but **new and thinly
exercised**. Treat a surprise here as a likely compiler bug rather than as
intended behaviour, and check the known gaps before working around one.*

Enums work across files: declare one in a module, import it, `match` on it. `[§enum-cross-file]`

The enum's name must be in scope in the file that matches on it, since the arms name
its variants. When it is not, the diagnostic says so specifically rather than claiming
the value is not an enum. `[§enum-cross-file]`

Two files may declare enums with the same name, and even variants with the same name.
`[§enum-name-identity]` This is worth stating only because it did not work: three
separate places resolved an enum by its name where they meant its identity.

The feature's tests were written alongside its implementation, from the same
understanding, so they agree with each other about more than they should. The first
outside consumer — porting `wacc`'s AST to sum types — found six bugs in roughly
twenty lines of use, five of them fixed in `08fedd2`. Expect more, and prefer adding
a case to `wacSpec.test.ts` over adapting your code to whatever it currently does.

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

A variant name is a file-scope name, exactly like a struct name — which is what lets
it be used as a type. So two enums in one file cannot share a variant name, and a
variant cannot share a name with a struct or function:

```wac
enum Shape { Circle(f64 r) }
enum Hole  { Circle(f64 r) }   // error: duplicate name 'Circle'
```

`[§enum-variant-name-collision]` This is a compile error.

The alternative — variants reachable only as `Shape.Circle`, with no file-scope name —
would avoid the collision and keep an enum of seventeen variants from claiming
seventeen names. It is rejected because a variant would then not be a type, and being
able to write `Circle c` is worth more than the namespace saved. Collisions are a
compile error rather than a silent surprise.

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

### An arm body is an ordinary block

Anything legal in a block is legal in an arm: locals, struct construction, array
creation, function references, nested control flow. There is nothing an arm restricts.

`[§enum-arm-walks-kubc3rt]` A type or function reference appearing *only* inside an
arm works exactly as it does anywhere else. Worth stating because it was not true:
five separate walks over statements had no `match` case, so a struct construct, an
array type, or a funcref signature reachable only through an arm was invisible to
them — and each failed at wasm validation or as a bogus "undefined function", never
at the point of the mistake.

### Break inside an arm

`break` in an arm binds to the enclosing loop, not to the `match`:

```wac
while (true) {
  match (e) {
    case Done:      break;      // leaves the loop
    case Working:   { }
  }
}
```

This differs from `switch`, where `break` leaves the switch. The reason is that arms
have no fallthrough, so there is nothing for a local `break` to mean — making it reach
the loop is the only reading that does anything, and it is what a tree walk with a
worklist wants.

`[§enum-match-break-loop]` The break leaves the loop, and the return checker knows
it does: a `while (true)` whose only exit is a `break` inside an arm is not an
infinite loop, so a function that falls off the end after it is still a missing-return
error.

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

### Matching a variant

A variant is an enum value, so it can be matched directly. The arms still cover the
whole enum:

```wac
Circle c = Shape.Circle(2.5);
match (c) {
  case Circle(r): return r;
  case Point:     return 0.0;    // unreachable, and required anyway
  case Rect(w, h): return w * h;
}
```

`[§enum-match-variant-subject]` This works, including on a construction expression:
`match (Shape.Rect(3.0, 4.0))`.

Requiring the unreachable arms is deliberate. Narrowing the requirement to what the
static type admits needs flow analysis, and an arm the tag comparison never selects
costs nothing.

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

Recursion may also go **through a struct**, which is what a container with methods
forces: variants cannot have methods, so a growable payload lives in a struct that
holds an array of the enum.

```wac
enum Val { Nil, Num(f64 v), Arr(ArrData a) }

struct ArrData {
  Val?[] items;
  i32 count;
  Val at(const this, i32 i) { return this.items[i]!; }
}
```

`[§enum-recursive-via-struct]` A recursive fold over that shape works: the enum's
payload names a struct, the struct's field is a nullable array of the enum, and
neither declaration precedes the other.

A payload field may be any type a struct field may be, including an array of structs:

```wac
enum Holder { Some(P[] xs), None }
```

`[§enum-arm-payload-struct-array]` This works. It did not at first: the variant
structs are generated inside the resolver and are not part of the item list the
type-annotation pass walks, so a payload of struct type was keyed by name while every
other reference to the same struct was keyed by index — and `P[]` interned as two
distinct array types, which surfaced only as a wasm validation failure.

Payload fields hold references, so this needs no indirection syntax. Construction is
bottom-up, so a non-null reference is always available by the time it is needed.

### Payload field names

Within one variant, payload field names must differ, exactly as a struct's fields must.
`[§enum-dup-payload-field]` `enum E { A(i32 x, i32 x) }` is a compile error.

Two *different* variants may share a field name, because they are different structs:
`[§enum-dup-payload-field]` `enum E { A(i32 x), B(i32 x) }` is fine.

### An enum has no default value

There is no such thing as a default variant, so an enum cannot be produced without
saying which variant it is. Two forms are therefore rejected:

```wac
E[] a = E[2]();      // error: type 'E' has no default value for array construction
struct S { E e; }
S s = S();           // error: struct 'S' has no default value
```

`[§enum-no-default]` Both are compile errors. Write the array as a literal, make the
element type nullable, or construct the struct positionally:

```wac
E[] a = E[](E.A(1), E.B);     // a literal needs no default
E[] b = E[n](fill: E.B);      // or give every element a value — the dynamic-size answer
E?[] c = E?[2]();             // nullable elements default to null
S s = S(E.A(1));              // positional construction supplies the field
```

A struct *holding* an enum is perfectly legal; only default-constructing one is not.
`[§enum-no-default]`

This is worth stating because the opposite was true and was silent. The base struct's
only field is the tag, which does have a default, so `E[n]()` allocated n bases and a
`match` on one trapped with `illegal cast` — blaming the arm rather than the
construction. Fixing it then briefly reported `struct S { E e; }` as "creates a
non-null recursive reference", because the recursive-field check and the
defaultability check shared one predicate; that was sound only while recursion was the
only reason a struct field could lack a default.

### Variants in a ternary

A ternary whose branches are two variants has the enum as its type, by the ordinary
closest-common-ancestor rule (see control.md) — the base struct is the ancestor of every
variant:

```wac
E e = cond ? E.A(9) : E.B;
```

`[§enum-ternary-variants]` This works, including when both branches are the same variant
and when one branch is already enum-typed.

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

`match` compiles to a comparison chain on the tag, then one downcast in the selected
arm. A `br_table` would be one jump regardless of variant count and is what the tag
makes possible, but `emitSwitch` uses a comparison chain for the same reason —
correctness first — so `match` matches it and the table remains a later change that
touches nothing but this function.

Even as a chain, the tag earns its place: the alternative is a `ref.test` per arm,
and an integer comparison is cheaper than a type test.

The tag is also why exhaustiveness is checkable at all: the compiler knows the
complete variant set from the declaration, so a missing arm is a static fact rather
than a runtime trap.
