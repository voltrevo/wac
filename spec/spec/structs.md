## Structs

Structs are WasmGC struct types — heap-allocated, garbage-collected references.
Fields are mutable by default. Assignment aliases (copies the reference, not the
data).

### Field mutability

`const` makes a field immutable after construction. `const struct` makes all
fields immutable.

```wac
struct Point {
  i32 x;
  i32 y;
}

struct IdPoint {
  const i32 id;          // immutable after construction
  i32 x;
  i32 y;
}

const struct Config {     // all fields immutable
  i32 width;
  i32 height;
}
```

`[§wac-const-field-inftga5]` Writing to a `const` field is a compile error.
`[§wac-const-struct-g9apxwr]` Writing to any field of a `const struct` is a compile
error.

### Exporting

`export` makes a struct type importable from another file. Only exported structs
can be imported — see [imports.md](imports.md).

`export` and `const` are independent and may be written together, `export` first:

```wac
export struct Point { i32 x; i32 y; }
export const struct Frozen { i32 w; i32 h; }
```

`[§wac-struct-export-m3kq8wp]` An `export struct` can be imported from another
file; a struct without `export` cannot.
`[§wac-struct-export-const-r7nf4jq]` `export const struct` is accepted, and both
modifiers take effect — the type is importable and every field is immutable.

### Construction

Three forms:

```wac
Point p = Point(3, 4);           // positional — struct.new, fields in declaration order
Point q = Point { x: 3, y: 4 }; // named — struct.new, order-independent
Point r = Point();               // default — struct.new_default, all zero/null
```

`[§wac-struct-positional-ycapwjx]` `p.x` is `3`, `p.y` is `4`.
`[§wac-struct-named-4y8pg2j]` `Point { y: 4, x: 3 }` produces the same result as
`Point(3, 4)`.
`[§wac-struct-default-ar2wgyf]` `r.x` is `0`, `r.y` is `0`.

Positional requires all fields in declaration order. Named requires every field
whose type is **not** nullable, in any order.

`[§wac-struct-partial-76iq9nc]` `Point(3)` is a compile error — must provide all
fields.

`[§wacc-struct-nullable-optional]` A **nullable** field may be left out of a named
construction, and is `null` when it is: `string? title` already says that absence is
one of its values, and writing `title: null` to say what the type says is ceremony a
reader still has to check. A field whose type has no null must be written, because
there is no value that means absent and any default would be a guess.
`spec/cases/0136` and `0137`; the reasoning is `design/lang/0007`.

```wac
struct Opts { string name; string? title; }

Opts a = Opts { name: "a" };              // title is null
Opts c = Opts { title: "t" };             // refused — `name` is required
```

*wacc only, as the omissions table in [compiler/README.md](../../compiler/README.md) records, and it
is the first divergence in a rule that is not JSX. The tag says so: a `§wacc-` clause is one the seed
does not implement, where a `§wac-` clause is the language both compilers answer for. That
distinction is not decoration — `compiler/wacSpec.test.ts` harvests every `err(...)` program it holds
as "the spec calls this illegal", so a clause the spec makes **legal** in wacc cannot be asserted
there at all.*

Nullable fields accept `null` as a positional argument:

```wac
struct Node { i32 val; Node? next; }
Node n = Node(42, null);   // val=42, next=null
```

`[§wac-struct-null-arg-h7kp3wn]` `Node(42, null).val` is `42` and
`Node(42, null).next is null` is `true`.

### Default values

A struct has a default value (usable with `T()` and `T[N]()`) if all its
fields have defaults:

- Primitives: `0`, `0.0`, `false`
- Nullable references (`T?`): `null`
- Non-null struct references (`T`): `T()` if T itself has a default (recursive)
- Non-null array references (`T[]`): an empty (zero-length) array — always
  defaultable regardless of whether `T` itself has a default, since no
  elements need to be constructed

Non-null recursive references have no default — the construction would be
infinite:

```wac
struct Node {
  i32 val;
  Node next;      // error: Node has no default (recursive non-null ref)
}

struct Node {
  i32 val;
  Node? next;     // ok: next defaults to null
}
```

`[§wac-recursive-nodefault-1os4yl4]` A struct with a non-null recursive reference
field is a compile error.

```wac
struct Foo {
  i32[] data;     // ok: defaults to an empty array
}
```

`[§wac-arr-field-default-k9wq3fm]` `Foo().data.len()` is `0`.

```wac
struct Line {
  Point start;
  Point end;
}
```

`[§wac-nested-default-tctff6b]` `Line()` creates a Line where `start` and `end`
are both default Points (all zeros). Nested defaults are constructed
recursively.

### Field access

```wac
i32 x = p.x;             // struct.get
p.x = 10;                // struct.set
```

### Assignment is aliasing

Assigning a struct copies the reference, not the data:

```wac
export i32 alias() {
  Point a = Point(1, 2);
  Point b = a;
  b.x = 99;
  return a.x;             // returns 99
}
```

`[§wac-alias-9j8cnc7]` `alias()` returns `99` — `a` and `b` point to the same
object.

### Methods

Methods are declared inside the struct body. They compile to regular wasm
functions with the struct ref as an implicit first parameter.

- `this` — mutable access to non-const fields
- `const this` — readonly, no field writes through this (deep)
- No `this` parameter — static method

```wac
struct Counter {
  i32 count;
  const i32 id;

  i32 getCount(const this) {
    return this.count;
  }

  void inc(this) {
    this.count += 1;      // ok: count is not const
    this.id = 5;          // error: id is const
  }

  void reset(this) {
    this.count = 0;
  }

  Counter create(i32 id) {
    return Counter(0, id);
  }
}
```

`[§wac-method-ta71o2i]` `Counter.create(1)` returns a Counter with count=0, id=1.
`[§wac-method-inc-09hcqkq]` After `c.inc()`, `c.getCount()` returns `1`.
`[§wac-method-const-d5zjb9i]` `this.id = 5` inside `inc` is a compile error — id
is const.

Methods work correctly on structs with mixed reference and primitive fields:

```wac
struct Node { i32 val; Node? next; }

struct Stack {
  Node? top;
  i32 count;

  void push(this, i32 val) {
    Node n = Node();
    n.val = val;
    n.next = this.top;
    this.top = n;
    this.count++;
  }

  i32 len(const this) {
    return this.count;
  }
}
```

`[§wac-method-mixed-fields-r4kn7wp]` After `s.push(10); s.push(20)`,
`s.len()` returns `2`.

Note: methods must use `this.field` to access struct fields and
`this.method()` to call methods — bare names without `this.` are not resolved
against the struct:

```wac
struct Foo {
  i32 count;

  i32 getCount(const this) {
    return count;           // error: 'count' is not defined
  }
}
```

`[§wac-bare-field-q3wn8v5]` Bare `count` inside a method is a compile error —
use `this.count`.

```wac
Counter c = Counter.create(1);
c.inc();
i32 n = c.getCount();    // 1
```

Methods compile to mangled functions: `Counter$getCount(ref $Counter) -> i32`.
Method calls desugar: `c.inc()` becomes `Counter$inc(c)`.
Static calls: `Counter.create(1)` becomes `Counter$create(1)`.

### Subtyping

Structs can extend other structs with `: Parent`. Subtypes append fields — they
cannot override or remove parent fields. Maps to WasmGC's `sub` type
constructor.

```wac
struct Shape {
  f64 x;
  f64 y;
}

struct Rect : Shape {
  f64 w;
  f64 h;
}

struct Circle : Shape {
  f64 radius;
}
```

Compiles to:

```wasm
(type $Shape (struct (field $x f64) (field $y f64)))
(type $Rect (sub $Shape (struct (field $x f64) (field $y f64) (field $w f64) (field $h f64))))
(type $Circle (sub $Shape (struct (field $x f64) (field $y f64) (field $radius f64))))
```

A subtype ref is assignable to a parent ref:

```wac
Rect r = Rect(0.0, 0.0, 10.0, 20.0);
Shape s = r;              // ok: Rect is a Shape
```

`[§wac-subpos-order-m7kx3qf]` Positional construction requires parent fields first, in declaration order — Shape fields (x, y) then Rect fields (w, h).

`[§wac-subtype-assign-jjrjz7g]` Assigning a Rect to a Shape variable compiles and
the Shape fields are accessible.

Parent methods work on subtypes:

```wac
struct Shape {
  f64 x;
  f64 y;

  f64 getX(const this) { return this.x; }
}
```

`[§wac-subtype-method-2s28pfb]` `getX` can be called on a Rect or Circle.

### Method inheritance and override

Subtypes inherit all parent methods. A subtype defining a method with the same
name as a parent method must use `override`:

```wac
struct Shape {
  f64 x;
  f64 y;

  string name(const this) { return "shape"; }
}

struct Circle : Shape {
  f64 radius;

  override string name(const this) { return "circle"; }
}
```

`[§wac-override-k7fn3qp]` `Circle` can override `name` with `override` keyword.

Omitting `override` when a parent has the same method name is a compile error:

```wac
struct BadRect : Shape {
  f64 w;

  string name(const this) { return "rect"; }  // error: must use override
}
```

`[§wac-override-missing-m4jw2rk]` Defining a method that collides with a
parent method without `override` is a compile error.

Using `override` when there is no parent method to override is also a compile
error:

```wac
struct BadShape {
  override string foo(const this) { return ""; }  // error: nothing to override
}
```

`[§wac-override-spurious-p9qn5xl]` Using `override` with no parent method is a
compile error.

### Static methods are not inherited

Static methods are not inherited. A subtype must define its own static methods:

```wac
struct Base {
  Base make() { return Base(); }
}

struct Sub : Base {
  i32 extra;
}

Sub s = Sub.make();           // error: Sub has no static method 'make'
```

`[§wac-nostatic-inh-r3kf8wp]` Calling an inherited static method on a subtype is a compile error.

Note: `override` is a source-level check only. WasmGC has no virtual dispatch —
which method runs depends on the static type at the call site, not the runtime
type.

```wac
export string testStaticDispatch() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c;
  return s.name();
}
```

`[§wac-static-disp-x4rk7m2]` `testStaticDispatch()` returns `"shape"` — dispatch
is static, based on declared type, not runtime type.

To dispatch dynamically, use `is`/`as!`:

```wac
string getName(Shape s) {
  if (s is Circle) { return (s as! Circle).name(); }
  return s.name();
}
```

`[§wac-override-dispatch-r2km6jf]` `getName` on a Circle returns `"circle"`,
on a plain Shape returns `"shape"`.

### Type testing and casting

`is` and `is not` test the runtime type. `as` casts between reference types.
These map to `ref.test` and `ref.cast`.

```wac
f64 area(Shape s) {
  if (s is Circle) {
    // `s` is narrowed to Circle here, so no cast is needed [see Narrowing below].
    return 3.14159265358979 * s.radius * s.radius;
  }
  if (s is Rect) {
    return s.w * s.h;
  }
  return 0.0;
}
```

`[§wac-is-dz9jg1l]` A Circle `is Circle` returns true, `is Rect` returns false.
`[§wac-as-trap-d10qz88]` Casting a Circle `as Rect` traps.
`[§wac-is-not-fwatmyk]` A Circle `is not Rect` returns true.

An inherited method's result type is the method's own, wherever it was declared.
`[§wac-inherited-method-type-9dkq3wv]` `s.get() + 1` on a subtype works. Worth a tag only
because it did not: the emitter resolved methods through a struct's own map, so an inherited
one was mistyped and the addition was emitted as `f64.add` over two `i32`s — while the call
on its own was always correct, since a different path resolved it properly.

### Narrowing

`if (x is T)` narrows `x` to `T` inside the then-block, so no cast is needed there:

```wac
f64 area(Shape s) {
  if (s is Circle) {
    return 3.14159265358979 * s.radius * s.radius;   // `s` is a Circle here
  }
  if (s is Rect) {
    return s.w * s.h;
  }
  return 0.0;
}
```

`[§wac-narrow-if-2mkq8vp]` This works for hand-written struct hierarchies and for enum
variants alike, nests, and applies in an `else if` arm.

The rule is deliberately small, and is a **scope rule rather than flow-sensitive typing**:
the name is shadowed by a `const` binding at the narrower type whose extent is the block,
exactly as a `match` arm's narrowing works (see enums.md). Three things follow.

Only the exact shape `ident is Type` narrows. `[§wac-narrow-if-2mkq8vp]` `is not` does not,
because it says nothing about the then-block. Neither does a field or index on the left,
since there is no name to shadow.

`&&` narrows from **either** operand, because reaching the block means both held; `||`
narrows from neither. `[§wac-narrow-if-2mkq8vp]` Note that the parentheses matter: `is` binds
looser than `&&`, so it is `(s is Circle) && ...`.

The narrowed name is `const` within the block. `[§wac-narrow-if-2mkq8vp]` Assigning to it
would raise the question of which binding is written, and the outer one is deliberately
untouched — which is also why nothing needs to be analysed about what holds after the block.

Because the cast is no longer needed, `(s as! Circle)` inside such a block is now a redundant
upcast and reported as one. The migration is to drop it; this document's own example used to
carry it.

The type named on the right must exist. `[§wac-is-undefined-type-6qbn3wr]`
`p is Nonexistent` is a compile error — `undefined type 'Nonexistent'`.

Worth stating because it used to compile with no diagnostic and return **true**, so a
typo, a rename, or a dropped import silently turned a type test into a tautology. The
comparison is what made it obvious: a test against a real but unrelated type already
warned that it can never be true, so the meaningless case was the one passing quietly.

Which side of `is` a bare name belongs to is decided by naming convention — an initial
capital reads as a type, lowercase as a value (see operators.md). When the name has a
capital but names a *variable* in scope, the convention has simply guessed wrong, and the
test is checked as reference identity rather than reported as a missing type.
`[§wac-is-undefined-type-6qbn3wr]`

For reference types, `as` performs `ref.cast` (traps on failure). This is
distinct from numeric `as` (lossless conversion) — the compiler distinguishes
them by operand type.

### Reference identity

`is` with a value (not a type or `null`) compares reference identity — whether
two references point to the same object. Maps to `ref.eq`.

```wac
export bool testIdentity() {
  Point a = Point(1, 2);
  Point b = a;
  Point c = Point(1, 2);
  return a is b;              // true: same object
}

export bool testDistinct() {
  Point a = Point(1, 2);
  Point c = Point(1, 2);
  return a is c;              // false: different objects
}
```

`[§wac-refid-same-k7fn4wp]` `testIdentity()` returns `true`.
`[§wac-refid-diff-m4jw3rk]` `testDistinct()` returns `false`.

`is not` works for negation:

```wac
if (a is not c) { ... }      // true: different objects
```

### Deep const

Calling a non-const method through `const this` is an error — const is deep:

```wac
struct Inner {
  i32 val;
  void mutate(this) { this.val = 1; }
}

struct Outer {
  Inner inner;
  
  void tryMutate(const this) {
    this.inner.mutate();     // error: const is deep
  }
}
```

`[§wac-deep-const-j4fn2xq]` Calling a non-const method through const this is a compile error — const is deep.

Deep const cannot be laundered through intermediate values. A reference
obtained *through* a const reference is itself const, however it was obtained:

```wac
struct Outer2 {
  Inner inner;
  Inner getInner(const this) { return this.inner; }
  void tryMutate(const this) {
    this.getInner().mutate();   // error: result of a call through const this is const
  }
}
```

`[§wac-deep-const-accessor-w3kf8nq]` Calling a non-const method on the result
of a method call made through a const receiver is a compile error.

```wac
struct Counter2 {
  i32 count;
  void mutate(this) { this.count = 99; }
  void tryMutate(const this) {
    Counter2 c = this;   // ok: binding stays reassignable...
    c.mutate();          // error: ...but the object it references is const
  }
}
```

`[§wac-deep-const-alias-p6mk2wf]` Assigning a const reference to a plain local
is allowed (read-only cursors like `Node? cur = this.head; cur = cur!.next;`
depend on it), but the constness travels with the reference: writes and
non-const method calls through the new binding are compile errors, and the
reference may not be stored into a struct field or array element (which would
make it reachable as mutable).

The three meanings of `is`:
- `x is Type` — runtime type test (`ref.test`)
- `x is null` — null test (`ref.is_null`)
- `x is y` — reference identity (`ref.eq`)
