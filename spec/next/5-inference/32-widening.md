# 32 — Widening

Several places combine the types of several expressions into one: the branches of a ternary, the elements of an
array literal, the arms of a value-giving `match`, the returns of an `auto` function. They all use the same
operation, `widen`, which is order-independent and variadic. It does not invent unions, numeric conversions, or
an `anyref` fallback.

## Widen the whole collection

```text
widen(Rect, Circle) = Shape
widen(i32, i64) = error
widen(i32, string) = error
widen(i32, string, union<i32, string>) = union<i32, string>
```

The final example must not fail because a pairwise fold visits `i32` and `string` first. An explicit `anyref`
contribution takes precedence for types it accepts:

```text
widen(union<Rect>, anyref) = anyref
```

```wac
// expect: answers main = 3
struct Shape { i32 x; }
struct Rect : Shape { i32 w; }
struct Circle : Shape { i32 r; }

export i32 main() {
  bool c = true;
  Shape s = c ? Rect(1, 2) : Circle(2, 3);      // widen(Rect, Circle) = Shape
  Shape[] all = [Rect(1, 2), Circle(2, 3)];     // the same, for array elements

  i32 x = 1;
  i64 y = 2;

  // ERROR: i32 and i64 do not widen — there is no implicit numeric conversion
  // auto bad = c ? x : y;

  // ERROR: i32 and string have no common type
  // auto worse = [x, "s"];

  return all.len() + s.x;
}
```

`[§wac-widen-common-ancestor-rkp3up8]` `widen` of reference types with a common ancestor is the nearest one. Different
numeric types, and types with no common ancestor, do not widen.

`[§wac-widen-order-independent-3g9dmiy]` `widen` considers every contribution at once: its result does not depend on
their order, and a combination that succeeds as a whole is not refused because some pair of its inputs would not
widen.

```wac
// expect: answers main = 3
export i32 main() {
  i32 a = 1;
  string b = "s";
  union<i32, string> c = 2;
  auto all = [a, b, c];                    // union<i32, string>[]: the union absorbs both
  return all.len();
}
```

## Explicit unions contribute alternatives

```text
widen(union<Rect>, union<Circle>) = union<Rect, Circle>
widen(union<Shape>, Rect) = union<Shape>
widen(union<Rect>, Shape) = error
widen(union<Rect, Triangle>, Circle) = error
widen(union<i32>, never) = union<i32>
widen(union<never>, i32) = error
```

Collect and normalise all explicit-union alternatives first. Ordinary inputs must fit the resulting alternatives;
they do not add new alternatives. Bare `union` is a different operation: it collects origins without this widening
restriction ([33](33-placeholders.md)).

`[§wac-widen-union-39ruxmm]` Explicit union contributions are combined into one normalised union; every other
contribution must fit one of its alternatives, and adds none.

Singleton union wrappers remain significant during inference, even when their resolved value representation is
identical to that of their sole alternative. An empty collection is `union<never>`, not an early substitution of
plain `never`.

Normalisation — flattening, duplicates, and inheritance subsumption within one access qualification — is
[18](../2-types/18-unions.md)'s subject.

## Context can opt into union collection

```wac
// fragment — inside a function with bool cond
auto a = cond ? makeI32() : "foo";  // ERROR
union b = cond ? makeI32() : "foo"; // union<i32, string>
union<i32, string> c = cond ? 5 : "foo"; // 5 receives i32
union d = cond ? 5 : "foo"; // ERROR: no numeric target
```

The expected union reaches the ternary's alternatives, and array element contexts work the same way. An
independently inferred helper is checked in its own context; a caller's union does not repair an invalid helper
body.

```wac
// expect: answers main = 1
i32 makeI32() { return 4; }

export i32 main() {
  bool cond = true;

  // ERROR: i32 and string do not widen
  // auto a = cond ? makeI32() : "foo";

  union b = cond ? makeI32() : "foo";     // union<i32, string>
  union<i32, string> c = cond ? 5 : "foo"; // 5 takes i32 from the expected union

  // ERROR: 5 has no numeric target
  // union d = cond ? 5 : "foo";

  return 1;
}
```

`[§wac-widen-expected-union-cyghd6c]` An expected union type reaches each branch of a ternary and each element of an
array literal, which enter it individually rather than being widened first.

For concrete alternatives, insertion selects the unique most specific compatible alternative, using the source's
static type. If none or more than one best candidate exists, reject. Numeric literals require an unambiguous target
before checking their value or spelling ([09](../2-types/09-numeric-literals.md)). Unresolved routing follows
[33](33-placeholders.md).

## Null is `never?`

`null` in type position is conventional sugar for `never?`; the null literal has that concrete type. Expand the sugar
before counting nullable layers. Widen nonnullable bases and take the maximum outer nullability depth.

```text
widen(never, T) = T
widen(null, i32) = i32?
widen(null?, i32) = i32??
widen(null, i32??) = i32??
widen(null, null) = null
```

```wac
// fragment
auto nothing() { return null; } // null, meaning never?
```

```wac
// expect: answers main = 1
struct Shape { i32 x; }
struct Square : Shape { i32 s; }
struct Circle : Shape { i32 r; }

export i32 main() {
  bool c = false;
  Square? sq = null;
  Circle? ci = Circle(1, 2);

  auto a = c ? Square(1, 2) : null;        // Square?
  auto b = c ? sq : ci;                    // Shape?: the common ancestor, one layer
  i32?? deep = null;
  auto d = c ? deep : null;                // i32??: the greater depth
  return a is null && b is not null && d is null ? 1 : 0;
}
```

`[§wac-widen-nullable-depth-ydzkqaz]` Widening takes the greatest nullable depth among the contributions, over the
widened non-nullable bases. `null` contributes depth one over `never`.

The union wrapper rules above still apply: `union<never>` is not plain `never` while inference is taking place.
Nullability inside individual union alternatives is not pulled outside the union.

## Const and array invariance

```text
widen(Rect, const Rect) = const Rect
widen(Rect[], const Rect[]) = const Rect[]
widen(Rect[], Shape[]) = error
widen(Rect[], const Shape[]) = error
widen(Rect[], const Rect[], const Shape[]) = error
```

Outer const restricts access; it does not introduce array covariance. Existing arrays are not converted element
by element. This also limits which concrete generic instantiations can be assigned after inference; collecting a
union does not itself establish that such an assignment is valid ([18](../2-types/18-unions.md)).

`[§wac-widen-const-csasq5s]` Widening a type with its `const` form gives the `const` form. Arrays widen only to their
own element type's `const` form.

## Where widening applies

The same operation decides the type of:

- a ternary's two branches ([25](../3-expressions/25-control-flow.md));
- an array literal's elements ([15](../2-types/15-arrays.md));
- a value-giving `match`'s arms ([13](../2-types/13-enums.md));
- an `auto` local's initialiser, and an `auto` function's returns ([33](33-placeholders.md),
  [34](34-recursive-inference.md)).
