# 18 — Unions

`union<A, B, …>` is a value of any one of its member types. It has no constructors: a member value is a
union value as it is. A union is taken apart by matching on its members' types.

## A member is a union value as itself

```wac
// expect: answers main = 3
union<f64, string, bool> parseCell(string text) {
  if (text == "true")  { return true; }
  if (text == "false") { return false; }
  if (text == "pi")    { return 3.14; }
  return text;
}

string render(union<f64, string, bool> cell) {
  return match (cell) {
    f64:    "number",
    string: cell,                          // cell is a string in this arm
    bool:   cell ? "yes" : "no",
  };
}

export i32 main() {
  return render(parseCell("true")).len();  // "yes"
}
```

`[§wac-union-member-is-value-86cfwkp]` A value of a member type is a value of the union, with nothing to
construct.

`[§wac-union-match-type-rj837up]` A `match` on a union has one arm per member type, and in each arm the
subject has that type. The arms must cover every member, or carry a `default`.

A member can also be tested and bound with `matches` ([25](../3-expressions/25-control-flow.md)):
`if (f64 n matches cell) { … }`.

## Normalisation

```text
union<union<Rect>, union<Circle>> = union<Rect, Circle>
union<Rect, Rect> = union<Rect>
union<Rect, Shape> = union<Shape>
union<Rect?, Circle> != union<Rect, Circle>?
```

Flatten nested unions, remove duplicate alternatives, and eagerly remove alternatives subsumed by
inheritance within the same access qualification. Normalise before selecting a literal's possible target
types. Const permission differences are preserved, as specified [below](#const-permissions):

```text
union<const Rect, const Shape> = union<const Shape>
union<Rect, const Shape>       // keep both
union<const Rect, Shape>       // keep both
```

```wac
// expect: answers main = 1
struct Shape { i32 x; }
struct Rect : Shape { i32 w; }

i32 width(union<Rect, Shape> s) {          // the same type as union<Shape>
  return match (s) {
    Shape: s.x,
  };
}

export i32 main() {
  union<f64, string> a = "x";
  union<string, f64> b = a;                // order does not make a different type
  return width(Rect(1, 2));
}
```

`[§wac-union-normalise-9awgxvb]` A union type is its normalised set of alternatives: nested unions are
flattened, duplicates removed, and an alternative removed when another of the same access qualification is
its ancestor. Order does not matter.

Normalisation does not use arbitrary implicit conversions as a licence to remove an alternative. In
particular it must not erase a recursive aggregate by observing that insertion into that aggregate is
possible ([below](#explicit-recursive-types)).

Singleton union wrappers remain significant during inference, even when their resolved value
representation is identical to that of their sole alternative ([32](../5-inference/32-widening.md)).

## Insertion selects the most specific alternative

For concrete alternatives, insertion selects the unique most specific compatible alternative, using the
source's static type. If none or more than one best candidate exists, reject:

```wac
// expect: emits
struct Shape { i32 x; }
struct Rect : Shape { i32 w; }

export i32 main() {
  union<Shape, string> a = Rect(1, 2);     // enters as Shape: the only compatible alternative

  // ERROR: f64 fits no alternative of union<Shape, string>
  // union<Shape, string> b = 1.5;

  return 0;
}
```

`[§wac-union-insert-specific-mv3jsue]` A value enters the unique most specific alternative compatible with its
static type, and is refused when there is none or more than one.

## A literal does not choose by range or spelling

```wac
// fragment — each line separately
union<u8, u64> a = 300; // ERROR: ambiguous, even though 300 does not fit u8.
union<i32, f64> b = 1.5; // ERROR: spelling does not select f64.
union[] c = [1, makeU32(), makeU64()]; // ERROR: 1 has two numeric targets.
union[] d = [1 as u32, makeU32(), makeU64()]; // union<u32, u64>[]

union<i32?, string?> e = null; // ERROR: two nullable alternatives.
union<i32, string>? f = null;  // OK: the outer nullable layer.
```

```wac
// expect: emits
export i32 main() {
  // ERROR: ambiguous — two numeric alternatives, even though 300 does not fit u8
  // union<u8, u64> a = 300;

  // ERROR: spelling does not select f64
  // union<i32, f64> b = 1.5;

  // ERROR: null could enter either nullable alternative
  // union<i32?, string?> e = null;

  union<i32, f64> c = 1.5 as f64;
  union<i32, string>? f = null;            // the outer nullable layer
  return 0;
}
```

`[§wac-union-literal-target-vmitw6m]` A numeric literal entering a union with more than one numeric alternative
is refused, whatever its range or spelling. `null` entering a union with more than one nullable alternative is
refused; an outer `?` on the union takes it.

Resolve a unique target first; only then validate its range, spelling, and `fromNumber` conversion. Eager
union normalisation precedes target selection. Bare `union` collects origins; an unresolved literal does not
create an alternative ([33](../5-inference/33-placeholders.md)).

## Unions, const and arrays

```text
widen(Rect, const Rect) = const Rect
widen(Rect[], const Rect[]) = const Rect[]
widen(Rect[], Shape[]) = error
widen(Rect[], const Shape[]) = error
widen(Rect[], const Rect[], const Shape[]) = error
```

Outer const restricts access; it does not introduce array covariance. Existing arrays are not converted
element by element. This also limits which concrete generic instantiations can be assigned after
inference; collecting a union does not itself establish that such an assignment is valid.

```wac
// expect: emits
struct Shape { i32 x; }
struct Rect : Shape { i32 w; }

export i32 main() {
  Rect[] rects = [Rect(1, 2)];
  const Rect[] view = rects;               // const added at the outside

  // ERROR: Rect[] is not a Shape[] — arrays are not covariant
  // Shape[] shapes = rects;

  // ERROR: nor is it a const Shape[]
  // const Shape[] shapesView = rects;

  return 0;
}
```

`[§wac-array-invariant-yyjkmz4]` `A[]` converts to `const A[]` and to nothing else: not to `B[]` or
`const B[]` for a parent `B` of `A`.

## Recursive unions

A cycle consisting only of forwarding between bare-union placeholders collects all reachable concrete
origins ([33](../5-inference/33-placeholders.md)). With none, it resolves to `union<never>`. Structural
constructors preserve references instead of endlessly expanding them:

```wac
// fragment — inside a function
Vec<union> values;
values.push(1 as i32);
values.push(values);
// Element type U = union<i32, Vec<U>>.
```

Without the first push, `U = union<Vec<U>>`, which resolves as `U = Vec<U>`. The initially empty vector
provides a possible starting value. This is different from a mandatory recursive field with no finite
inhabitant.

A cycle through `auto` follows path exclusion ([34](../5-inference/34-recursive-inference.md)); it does not
acquire a fixed-point inference rule merely because a union occurs on the cycle.

### Explicit recursive types

```wac
// fragment
struct Box<T> { T value; }
type A = union<i32, Box<A>>; // Valid, like a recursive enum.
```

```wac
// fragment
struct Box<T> { T value; }
type A = union<Box<A>>; // Equivalent to A = Box<A> after inference.
// Valid but uninhabitable; an implementation may warn.
```

```wac
// fragment
type A = union<A>; // ERROR: simplifies to A = A.
type U = union<null, U?>; // ERROR: simplifies to U = U?.
```

```wac
// fragment
type U = union<i32, U?>; // Valid: the union remains a recursive aggregate.
```

```wac
// expect: answers main = 1
struct Box<T> { T value; }
type A = union<i32, Box<A>>;
type U = union<i32, U?>;

// ERROR: simplifies to A2 = A2
// type A2 = union<A2>;

// ERROR: simplifies to U2 = U2?
// type U2 = union<null, U2?>;

export i32 main() {
  A nested = Box<A>(Box<A>(7 as i32));
  U wrapped = (7 as i32) as U?;
  return 1;
}
```

`[§wac-union-recursive-guard-e4vnb4j]` A union with two or more alternatives guards a recursive type, so
`type A = union<i32, Box<A>>` and `type U = union<i32, U?>` are valid. A singleton union does not, and
nullable layers alone do not: `type A = union<A>` and `type U = union<null, U?>` are refused.

Both alternatives of `union<i32, U?>` are needed. Substituting `U = i32?` does not satisfy the
contributions: `U?` would become `i32??`, which cannot fit into `i32?`. Nor is `i32` redundant merely
because it can be injected into `U` and then wrapped as `U?`: those operations construct an additional
layer rather than establish that the alternatives are equivalent.

A genuine multi-alternative union guards recursion; a singleton wrapper disappears for recursive-type
validity. Nullable layers alone do not guard recursion ([29](../4-static/29-static-dependencies.md)).
Uninhabitable types remain valid ([11](11-never-and-uninhabited.md)).

### Inferring a recursive nullable alternative

```wac
// fragment
T? last<T>(const Vec<T> values) {
  if (values.length == 0) {
    return null;
  }
  return values[values.length - 1];
}

void example() {
  Vec<union> history;

  history.push(7 as i32);
  history.push(last(history));
  history.push(last(history));
  // Element type U = union<i32, U?>.
}
```

The first push contributes `i32`; `last(history)` contributes its declared return type `U?`. The entries are
an integer, a non-null nullable containing that entry, and a non-null nullable containing the second entry.
Each call wraps the previous entry rather than merely copying it.

Choosing `U = i32?` would make `last(history)` return `i32??`, which cannot be pushed into `Vec<i32?>`.
Unwrapping the result before pushing would instead contribute only `U`, leaving `i32` as the only concrete
alternative.

### Computation can preserve opaque references

```wac
// fragment
type Maybe<T> { return typeref(T).pushNull(); }

// The same return type as T? in last<T> above:
Maybe<T> last<T>(const Vec<T> values) {
  if (values.length == 0) {
    return null;
  }
  return values[values.length - 1];
}
```

`Maybe<T>` is unnecessary for ordinary nullable types; it illustrates that a computed type can participate
in the same inference ([30](../4-static/30-computed-types.md)).

`pushNull` need not inspect `U`. A computed type can therefore return a wrapper around the incomplete
identity and let inference form this recursive type. `popNull` must discover an outer nullable layer; it can
return the opaque inner type without completing that inner type. If discovering the layer demands the same
completion already in progress, reject the recursive computation.

### Recursive types are not unlimited computation

An ordinary finite recursive type graph is distinct from a computation that keeps creating new
instantiations or performing more evaluation. The latter remains subject to the static evaluation limits
([28](../4-static/28-static-evaluation.md)). Report resource exhaustion as failure to determine the answer,
not proof of nontermination. Implementations may prove nontermination within a scope of their choosing, but
need not do so.

## Const permissions

Unions preserve incoming access permissions without making const references generally recoverable as
mutable references.

### Same object, different permissions

```wac
// fragment — inside a function
Rect r = makeRect();
const Rect c = r;

union<Rect, const Rect> a = r; // Mutable access recoverable.
union<Rect, const Rect> b = c; // Only const access recoverable.
```

The runtime object's mutability does not grant permission. The reference used to enter the union determines
the recorded permission. An ordinary const reference cannot be tested back into mutable access.

```wac
// expect: answers main = 1
struct Rect { i32 w; void grow(this) { this.w += 1; } }

i32 tryGrow(union<Rect, const Rect> value) {
  if (Rect r matches value) {
    r.grow();
    return 1;                              // entered mutable
  }
  return 0;                                // entered const
}

export i32 main() {
  Rect r = Rect(1);
  const Rect c = r;                        // the same object
  return tryGrow(r) - tryGrow(c);          // 1 - 0
}
```

`[§wac-union-permission-recorded-d7yfbag]` A union with both a mutable and a `const` alternative of one type
records which one a value entered by. Testing it back as mutable succeeds only for a value that entered
mutable, whatever object it is.

### Normalisation preserves permission distinctions

```text
union<Rect, Shape>             = union<Shape>
union<const Rect, const Shape> = union<const Shape>
union<Rect, const Rect>        // keep both
union<Rect, const Shape>       // keep both
union<const Rect, Shape>       // keep both
```

Inheritance subsumption within one qualification still simplifies alternatives. Adding const is not a reason
to erase a mutable alternative. A const alternative also cannot disappear into a mutable ancestor. These
possibilities are part of the union's type identity, not hidden capabilities of plain `const Rect`.

### Matching checks type and permission

```wac
// fragment
void example(union<Rect, const Rect> value) {
  if (Rect r matches value) {
    r.mutate(); // Requires both Rect runtime type and recorded mutable access.
  }
}
```

A `const Rect` pattern accepts either permission. In a match with ordered arms, put mutable `Rect` before
`const Rect` to handle the mutable case separately. These two patterns cover `union<Rect, const Rect>`; the
const pattern alone also covers it. The same permission check applies when matching a mutable ancestor such
as `Shape`.

A const-only union cannot manufacture a mutable alternative by inspecting the runtime object. Ordinary
inheritance narrowing must preserve access qualification.

### Conversions can discard, never restore, permission

```wac
// fragment — inside a function
union<Rect, const Rect> a = mutableRect;
union<const Rect> b = a; // Discards mutable access.
union<Rect, const Rect> c = b; // Still const; widening the type restores nothing.
```

```wac
// fragment — inside a function
union<Rect, const Circle> a = mutableRect;
union<const Rect, Circle> b = a;
// ERROR: the source's const Circle possibility cannot become mutable Circle.
```

All possible source cases must fit the destination, even if this initializer happens to choose `Rect`. An
accepted conversion to `union<const Rect, const Circle>` discards mutable permission where needed.

```wac
// expect: answers main = 0
struct Rect { i32 w; }
struct Circle { i32 r; }

i32 mutableIn(union<Rect, const Rect> v) {
  return match (v) {
    Rect:       1,
    const Rect: 0,
  };
}

export i32 main() {
  union<Rect, const Rect> a = Rect(1);
  union<const Rect> b = a;                 // discards mutable access
  union<Rect, const Rect> c = b;           // still const: widening restores nothing

  union<Rect, const Circle> d = Rect(2);

  // ERROR: d's const Circle possibility cannot become a mutable Circle
  // union<const Rect, Circle> e = d;

  return mutableIn(c);
}
```

`[§wac-union-permission-no-restore-dvm5zbj]` A conversion between unions may discard mutable permission and never
adds it. Every alternative of the source must fit the destination, whichever one the value actually holds.

### Outer const still applies deeply

```wac
// fragment
struct Unrelated {} // No inheritance relationship with Rect.

void inspect(const union<Rect, const Rect> value) {
  if (Rect r matches value) { // Never matches; may warn.
    r.mutate(); // Well-typed mutable receiver, but unreachable.
  }

  if (Unrelated u matches value) { // Never matches; may warn.
    // No possible value has this type.
  }

  if (const Rect r matches value) { // Matches either stored permission.
    // Rect writable = r; // ERROR: cannot convert const Rect to mutable Rect.
    // r.mutate();        // ERROR: requires a mutable receiver.
  }
}
```

A valid pattern with no possible matching value is unreachable, not an error; implementations may warn. The
mutable `Rect` pattern fails because the current access path is const, even if the stored permission is
mutable. The `Unrelated` pattern fails because the runtime type cannot match. Both conditions are always
false, and both bodies still undergo ordinary type checking. Pattern bindings retain their declared types
inside those bodies; no binding is produced at runtime.

The const pattern can extract a const reference. Assigning that reference to mutable `Rect`, or mutating
through it, remains a compile-time error, as shown by the commented-out lines.

`[§wac-union-outer-const-atzx4n3]` Through a `const` access path, a pattern for a mutable alternative never
matches, whatever permission the value was stored with; the `const` pattern does.

Recovering mutable access requires both recorded permission and permission through the current access path.
A const struct containing a union must not leak writable fields through that union. Extracting or copying
through const access cannot launder the original permission; another mutable alias may retain its own access.

### Representation

A union can use `anyref` when runtime type alone distinguishes the relevant cases. When const and mutable
possibilities overlap, use a representation conceptually containing `(bool, anyref)`, recording permission
alongside the payload. One flag serves multiple alternatives: one reference is active at a time.

The overlap includes inheritance, not only identical base types. For `union<Shape, const Rect>`, a `Rect`
runtime test alone cannot establish mutable permission. This representation is an implementation strategy,
not an observable layout guarantee. Payload boxing and other existing representation needs remain
independent of this permission flag.
