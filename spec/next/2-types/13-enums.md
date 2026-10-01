# 13 — Enums

An enum is a type with a fixed set of variants, each optionally carrying named payload fields. Each
variant is itself a type, a subtype of the enum. `match` takes an enum apart, and the compiler checks
that every variant is handled.

## Declaring

```wac
// expect: emits
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

export i32 main() { return 0; }
```

Payload fields are named, like struct fields, because positional-only payloads make a three-field
variant unreadable at the use site. A variant with no payload takes no parentheses. Variants are
comma-separated, and a trailing comma is allowed.

`Shape` is a type, and so is each variant: `Circle` is a subtype of `Shape`.

Within one variant, payload field names must differ, as a struct's fields must. Two different variants
may share a field name, because they are different types:

```wac
// expect: emits
enum Ok { A(i32 x), B(i32 x) }

// ERROR: duplicate payload field 'x'
// enum Bad { A(i32 x, i32 x) }

export i32 main() { return 0; }
```

`[§enum-dup-payload-field]` Two payload fields of one variant with the same name are refused; two
variants may each have a field of the same name.

A variant name is a top-level name of its file, like a struct's — which is what lets it be written as a
type, and means another file imports it to name it ([01](../1-programs/01-names-and-identity.md)). So
two enums in one file cannot share a variant name:

```wac
// expect: emits
enum Shape { Circle(f64 r) }

// ERROR: duplicate name 'Circle'
// enum Hole { Circle(f64 r) }

export i32 main() { return 0; }
```

`[§enum-variant-name-collision]` A variant name that collides with another top-level name of its file is
refused.

Two files may declare enums with the same name, with variants of the same name, and they stay two
enums:

`[§enum-name-identity]` Same-named enums and variants in different files are different types, resolved
by identity rather than by name ([01](../1-programs/01-names-and-identity.md)).

## Constructing

A variant is built through its enum. A variant with no payload is a value, not a call:

```wac
// expect: answers main = 3
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

export i32 main() {
  Shape a = Shape.Point;
  Shape b = Shape.Circle(2.0);
  Shape c = Shape.Rect(3.0, 4.0);

  // ERROR: Point carries no payload
  // Shape d = Shape.Point();

  // ERROR: Circle carries a payload, and constructing it must supply one
  // Shape e = Shape.Circle;

  // ERROR: Rect carries two fields
  // Shape f = Shape.Rect(3.0);

  return 3;
}
```

`[§enum-construct-qualified-iuubvew]` A variant is constructed as `Enum.Variant(…)`, with every payload
field supplied in order, or as `Enum.Variant` when it has no payload.

`[§enum-construct-payload-required-uc2cir8]` Writing a payload-carrying variant without its arguments is
refused, as is supplying the wrong number of them. There is no spelling that constructs a variant with
missing payload.

## Matching

```wac
// expect: answers main = 12.0
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

f64 area(Shape s) {
  match (s) {
    Point:      { return 0.0; }
    Circle(r):  { return 3.14159 * r * r; }
    Rect(w, h): { return w * h; }
  }
}

export f64 main() { return area(Shape.Rect(3.0, 4.0)) + area(Shape.Point); }
```

An arm is a pattern, a colon, and a block. Bindings are positional and take their types from the
declaration — `r` is an `f64` — and are scoped to the arm. There is no fallthrough between arms.

`[§enum-match-basic]` `area(Shape.Rect(3.0, 4.0))` answers `12.0`: the arm for the subject's variant
runs, with its payload bound.

`[§enum-match-nopayload]` `area(Shape.Point)` answers `0.0`.

`match` is also an expression. Its arms give a value after the colon and are comma-separated:

```wac
// expect: answers main = 12.0
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

f64 area(Shape s) {
  return match (s) {
    Point:      0.0,
    Circle(r):  3.14159 * r * r,
    Rect(w, h): w * h,
  };
}

export f64 main() { return area(Shape.Rect(3.0, 4.0)); }
```

`[§enum-match-expr-4wnq7bk]` A `match` used as an expression answers its selected arm's value. Its arms'
types are combined as a ternary's branches are ([32](../5-inference/32-widening.md)), and it must be
total — exhaustive, or carrying a `default`.

Arms that leave instead of giving a value, nullable subjects, and the general shape of `match` as
control flow are [25](../3-expressions/25-control-flow.md)'s subject.

### Ignoring payloads

Omit the parentheses to ignore every payload field, or bind `_` to ignore one:

```wac
// expect: answers main = 1
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

bool isRound(Shape s) {
  return match (s) {
    Circle:      true,
    Rect(_, h):  h == 0.0,
    Point:       false,
  };
}

export i32 main() { return isRound(Shape.Circle(1.0)) ? 1 : 0; }
```

`[§enum-match-ignore]` A pattern with no parentheses ignores the payload, and `_` ignores one field.

A pattern binds all of a variant's payload or none of it:

```wac
// expect: emits
enum Shape {
  Point,
  Rect(f64 width, f64 height),
}

f64 width(Shape s) {
  return match (s) {
    Rect(w, _): w,
    Point:      0.0,

    // ERROR: Rect has two fields
    // Rect(w): w,

    // ERROR: Point has no payload
    // Point(x): 0.0,
  };
}

export i32 main() { return 0; }
```

`[§enum-match-arity-4jq7wnm]` A payload pattern whose length differs from the variant's payload is
refused. A name in the wrong position would silently be a different field.

### A variant inside a payload

In a payload position, `is Variant` tests the payload's variant instead of binding it:

```wac
// expect: answers main = 2
enum Fault { NotFound, IsDir, Denied }
enum Outcome { Ok(i32 v), Err(Fault e) }

i32 describe(Outcome r) {
  return match (r) {
    Ok(v):            0,
    Err(is NotFound): 1,
    Err(e):           2,
  };
}

export i32 main() { return describe(Outcome.Err(Fault.Denied)); }
```

`[§enum-payload-is-pattern-mec7vyh]` `is V` in a payload position matches when that payload field holds the
variant `V`, and binds nothing. Arms are tried in order, so a later, wider arm takes what it does not
match.

That is the only nesting a pattern has. A pattern does not destructure a payload's own payload — write a
`match` inside the arm instead, which computes the same thing.

## Exhaustiveness

A `match` must cover every variant. This is the point of the feature: the compiler finds the case that
was forgotten when a variant is added.

```wac
// expect: emits
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

f64 bad(Shape s) {
  // ERROR: match does not cover 'Rect'
  // match (s) {
  //   Point:     { return 0.0; }
  //   Circle(r): { return r; }
  // }
  return 0.0;
}

export i32 main() { return 0; }
```

`[§enum-match-inexhaustive]` A `match` that names neither every variant nor a `default` is refused, and
the diagnostic names a missing variant.

A `default` arm covers every variant not named:

```wac
// expect: answers main = 1.5
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

f64 radiusOr(Shape s, f64 fallback) {
  return match (s) {
    Circle(r): r,
    default:   fallback,
  };
}

export f64 main() { return radiusOr(Shape.Point, 1.5); }
```

`[§enum-match-else]` A `default` arm takes every variant the other arms do not name.

`default` is the arm that names no shape, which is why it is not `_`: `_` means *a value I am not
naming*, and `Err(_)` and `default` sit one bracket apart in the same match meaning different things.

A `default` that can never be reached, and a variant named twice, are errors rather than dead code:

```wac
// expect: emits
enum Shape {
  Point,
  Circle(f64 radius),
}

f64 covering(Shape s) {
  return match (s) {
    Circle(r): r,
    Point:     0.0,

    // ERROR: this default is unreachable — every variant is already named
    // default:   0.0,

    // ERROR: duplicate arm for 'Circle'
    // Circle(r2): r2,
  };
}

export i32 main() { return 0; }
```

`[§enum-match-else-unreachable]` A `default` arm in a `match` that already names every variant is
refused.

`[§enum-match-duplicate]` Two arms for one variant are refused.

A variant whose payload has no values need not be covered ([11](11-never-and-uninhabited.md)).

## Testing for a variant

`is` accepts a variant, bare or qualified by its enum:

```wac
// expect: answers main = 2
enum Shape {
  Point,
  Circle(f64 radius),
}

export i32 main() {
  Shape a = Shape.Circle(1.0);
  i32 n = 0;
  if (a is Circle) { n += 1; }
  if (a is Shape.Circle) { n += 1; }       // the same test

  // ERROR: a type test takes no payload
  // bool b = a is Shape.Circle(1.0);

  return n;
}
```

`[§enum-is-qualified-8jkq4wp]` `x is V` and `x is E.V` are the same variant test, for a variant with a
payload or without one. Writing a payload in the test is refused.

## Narrowing

Inside an arm, the subject has the arm's variant type, so its payload fields are reachable through it
directly:

```wac
// expect: answers main = 7.0
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),
}

f64 widthOf(Shape s) {
  return match (s) {
    Rect:    s.width,                      // s is a Rect here
    Circle:  s.radius * 2.0,               // and a Circle here
    Point:   0.0,
  };
}

export f64 main() { return widthOf(Shape.Rect(3.0, 4.0)) + widthOf(Shape.Circle(2.0)); }
```

`[§enum-narrow]` In an arm, a subject that is a plain name has the arm's variant type:
`widthOf(Shape.Rect(3.0, 4.0))` answers `3.0`.

`[§enum-narrow-field]` A field that exists only on that variant is readable through the narrowed name:
`widthOf(Shape.Circle(2.0))` answers `4.0`.

This is not flow-sensitive typing. The arm introduces a new binding that shadows the subject, at the
variant type, for exactly the arm's extent ([01](../1-programs/01-names-and-identity.md)). Three things
follow from it being a binding:

```wac
// expect: answers main = 2.0
enum Shape {
  Point,
  Circle(f64 radius),
}

f64 first(Shape[] shapes) {
  return match (shapes[0]) {
    Circle(r): r,                          // nothing is named, but the payload still binds
    default:   0.0,
  };
}

f64 reassign(Shape s) {
  return match (s) {
    // ERROR: cannot assign to 's' — a matched subject is const within its arm
    // Circle: { s = Shape.Point; return 0.0; },

    // ERROR: duplicate binding 's'
    // Circle(s): s,

    default: 0.0,
  };
}

export f64 main() { return first([Shape.Circle(2.0)]); }
```

`[§enum-narrow-nonvariable]` When the subject is not a plain name, nothing narrows; payload bindings still
work.

`[§enum-narrow-const]` The narrowed subject is `const` within its arm.

`[§enum-narrow-collision]` A payload binding with the subject's name is refused, since both would occupy
the arm's scope.

A `default` arm narrows nothing: its subject still has the enum type, which is the reason to be in it.
Outside `match`, `if (x is V)` narrows in the same way ([12](12-structs.md)).

## Matching a variant

A variant value is an enum value, so it can be matched directly; the arms still cover the enum:

```wac
// expect: answers main = 2.5
enum Shape {
  Point,
  Circle(f64 radius),
}

export f64 main() {
  Circle c = Shape.Circle(2.5);
  return match (c) {
    Circle(r): r,
    Point:     0.0,                        // unreachable, and required anyway
  };
}
```

`[§enum-match-variant-subject]` A subject whose static type is a variant may be matched, and the arms must
still cover the whole enum.

Narrowing the requirement to what the static type admits would need flow analysis, and an arm that is
never selected costs nothing.

## An arm is an ordinary block

Anything legal in a block is legal in an arm — locals, constructions, nested control flow — and a `break`
or `continue` in an arm acts on the enclosing loop:

```wac
// expect: answers main = 3
enum Step { Work(i32 n), Done }

export i32 main() {
  Step[] steps = [Step.Work(1), Step.Work(2), Step.Done, Step.Work(100)];
  i32 total = 0;
  i32 i = 0;
  while (true) {
    match (steps[i]) {
      Work(n): { total += n; }
      Done:    { break; }                  // leaves the loop
    }
    i++;
  }
  return total;
}
```

`[§enum-arm-walks-kubc3rt]` An arm body may contain anything a block may.

`[§enum-match-break-loop]` `break` in an arm leaves the enclosing loop. A `while (true)` whose only exit is
such a `break` is not infinite for the purpose of checking that a function returns.

## Recursion

A payload may name the enum being declared, which makes trees expressible:

```wac
// expect: answers main = 3
enum Tree {
  Leaf(i32 value),
  Node(Tree left, Tree right),
}

i32 sum(Tree t) {
  return match (t) {
    Leaf(v):    v,
    Node(l, r): sum(l) + sum(r),
  };
}

export i32 main() { return sum(Tree.Node(Tree.Leaf(1), Tree.Leaf(2))); }
```

`[§enum-recursive]` A payload may have the type of its own enum: `sum(Tree.Node(Tree.Leaf(1),
Tree.Leaf(2)))` answers `3`.

Recursion may also go through a struct, which is what a container with methods needs:

```wac
// expect: answers main = 2
enum Val { Nil, Num(f64 v), Arr(ArrData a) }

struct ArrData {
  Val?[] items;
  i32 count;
  Val at(const this, i32 i) { return this.items[i]!; }
}

i32 depth(Val v) {
  return match (v) {
    Arr(a):  1 + depth(a.at(0)),
    default: 0,
  };
}

export i32 main() {
  Val inner = Val.Arr(ArrData([Val.Num(1.0)], 1));
  return depth(Val.Arr(ArrData([inner], 1)));
}
```

`[§enum-recursive-via-struct]` An enum's payload may name a struct whose fields hold the enum, and neither
declaration need precede the other.

`[§enum-arm-payload-struct-array]` A payload field may have any type a struct field may, including an array
of structs.

Construction is bottom-up, so a non-null payload always has a value by the time it is needed. An enum
whose every variant requires itself is uninhabited, and still valid ([11](11-never-and-uninhabited.md)).

## An enum has no default value

There is no default variant, so an enum value cannot be produced without saying which variant it is:

```wac
// expect: answers main = 3
enum E { A(i32 n), B }
struct S { E e; }

export i32 main() {
  // ERROR: E has no default value
  // E[] a = E[].defaulted(2);

  // ERROR: S has no default value — its field e has none
  // S s = S { };

  E[] b = [E.A(1), E.B];                   // a literal needs no default
  E[] c = E[].filled(2, E.B);              // nor does a fill value
  E?[] d = E?[].defaulted(2);              // nullable elements default to null
  S s = S(E.A(1));                         // positional construction supplies the field
  return b.len() + 1;
}
```

`[§enum-no-default]` An enum type has no default, so neither does a struct with a field of it; both are
refused where a default is needed.

A struct holding an enum is legal — only default-constructing one is not.

## Variants combine to their enum

Two variants of one enum combine to the enum, so a ternary or array literal of variants has the enum's
type:

```wac
// expect: answers main = 2
enum E { A(i32 n), B }

export i32 main() {
  bool cond = true;
  E e = cond ? E.A(9) : E.B;
  E[] all = [E.A(1), E.B];
  return all.len();
}
```

`[§enum-ternary-variants]` A ternary whose branches are variants of one enum has the enum as its type,
including when both are the same variant.

Variants may appear in every position a struct may:

```wac
// expect: answers main = 1
enum Shape {
  Point,
  Rect(f64 width, f64 height),
}

i32 countRects(Shape[] shapes) {
  i32 n = 0;
  for (Shape s in shapes) {
    match (s) {
      Rect:    { n++; }
      default: { }
    }
  }
  return n;
}

export i32 main() { return countRects([Shape.Rect(1.0, 2.0), Shape.Point, Shape.Point]); }
```

`[§enum-array]` An array of an enum, iterated and matched, answers `1` for one `Rect` and two `Point`s.

## Methods

An enum may declare methods after its variants. `this` is the enum, and `match (this)` reaches the
variant:

```wac
// expect: answers main = 24.0
enum Shape {
  Point,
  Circle(f64 radius),
  Rect(f64 width, f64 height),

  f64 area(const this) {
    return match (this) {
      Point:      0.0,
      Circle(r):  3.14159 * r * r,
      Rect(w, h): w * h,
    };
  }

  f64 twiceArea(const this) { return this.area() * 2.0; }
}

export f64 main() { return Shape.Rect(3.0, 4.0).twiceArea(); }
```

`[§enum-methods-6vkq2wn]` An enum's methods take `this` as the enum, may take further parameters, and may
call each other through `this`. A method with no receiver, an `override`, and a method named like a
variant are refused.

Variants come first and methods follow. A method is recognised by its shape — a type, a name and a
parameter list — which a variant cannot have.

Two shapes are refused deliberately. An `override` would mean per-variant virtual dispatch, a
different feature. A method with no receiver would be called `Shape.make()`, which is already how a
variant is constructed, so that spelling has to keep meaning one thing.

## Across files

```wac
// expect: answers main = 1
// ---- k.wac ----
export enum Kind { A, B }
export struct Holder { Kind kind; }
export Holder mk() { return Holder(Kind.A); }
// ---- main.wac ----
import { Holder, mk } from "./k.wac";          // Kind itself is not imported

export i32 main() {
  Holder h = mk();
  return match (h.kind) {
    A: 1,
    B: 2,
  };
}
```

`[§enum-cross-file]` An enum declared in one module may be matched in another, and the matching file need not
import the enum: an arm resolves its variants through the subject's type.

It is the same rule as reading a field whose type was never imported. An enum is identified by what it
is, not by a name that is unique only within one file.
