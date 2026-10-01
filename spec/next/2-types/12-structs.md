# 12 — Structs

A struct is a nominal type with named fields and methods. A struct value is a reference to an object
on the heap: assigning it, passing it or storing it shares the object rather than copying it.

## A struct value is a reference

```wac
// expect: answers main = 99
struct Point { i32 x; i32 y; }

export i32 main() {
  Point a = Point(1, 2);
  Point b = a;
  b.x = 99;
  return a.x;                              // 99: one object, two names
}
```

`[§wac-alias-9j8cnc7]` Assigning a struct copies the reference, not the object: a write through `b` is
seen through `a`.

References compare by identity with `is` ([below](#identity)). `==` on a struct is
an operator like any other, and a struct has it only if it implements it
([22](../3-expressions/22-operators.md)).

## Fields

Fields are mutable unless marked `const`. A `const struct` has only `const` fields:

```wac
// expect: answers main = 15
struct IdPoint {
  const i32 id;                            // fixed at construction
  i32 x;
  i32 y;
}

const struct Config {                      // every field is const
  i32 width;
  i32 height;
}

export i32 main() {
  IdPoint p = IdPoint(7, 1, 2);
  Config c = Config(5, 3);
  p.x = 3;

  // ERROR: 'id' is a const field
  // p.id = 8;

  // ERROR: Config is a const struct
  // c.width = 6;

  return p.id + p.x + c.width;
}
```

`[§wac-const-field-inftga5]` Writing to a `const` field after construction is refused.

`[§wac-const-struct-g9apxwr]` Writing to any field of a `const struct` is refused.

`export` and `const` are independent, and may be written together:

```wac
// expect: answers main = 6
// ---- frozen.wac ----
export const struct Frozen { i32 w; i32 h; }
// ---- main.wac ----
import { Frozen } from "./frozen.wac";

export i32 main() {
  Frozen f = Frozen(2, 4);

  // ERROR: Frozen is a const struct
  // f.w = 1;

  return f.w + f.h;
}
```

`[§wac-struct-export-const-r7nf4jq]` `export const struct` is accepted, and both modifiers take effect:
the type is importable and every field is immutable.

What `const` does to a *reference* — deeply, and wherever it travels — is
[17](17-const.md)'s subject.

## Construction

Parentheses supply every field, in declaration order. Braces name fields, in any order, and may leave
out the ones that have a default:

```wac
// expect: answers main = 1
struct Link {
  i32 value;
  Link? next = null;
}

export i32 main() {
  Link a = Link(3, null);                  // every field
  Link b = Link { value: 3 };              // next uses its default
  Link c = Link { next: a, value: 4 };     // any order

  // ERROR: positional construction supplies every field, defaults included
  // Link d = Link(3);

  return a.value == 3 && b.next is null && c.next is a ? 1 : 0;
}
```

`[§wac-struct-positional-ycapwjx]` `Point(3, 4)` sets the fields in declaration order: `x` is `3` and
`y` is `4`.

`[§wac-struct-partial-76iq9nc]` Positional construction with fewer arguments than fields is refused.

`[§wac-struct-positional-no-defaults-e74g4rk]` Positional construction supplies every field, including
fields that have defaults; a default never fills a missing positional argument.

`[§wac-struct-named-4y8pg2j]` Named construction takes fields in any order: `Point { y: 4, x: 3 }` is
the same as `Point(3, 4)`.

`[§wac-struct-named-defaults-y5em4qj]` Named construction may leave out a field that has a default, which
it then takes; a field with no default must be named.

A nullable field's default is `null`, so it may always be left out of braces. `null` is an ordinary
positional argument:

```wac
// expect: answers main = 42
struct Node { i32 val; Node? next; }

export i32 main() {
  Node n = Node(42, null);
  Node m = Node { val: 1 };                // next is null

  // ERROR: 'val' has no default and must be named
  // Node e = Node { next: n };

  return n.next is null && m.next is null ? n.val : 0;
}
```

`[§wac-struct-null-arg-h7kp3wn]` `null` may be passed positionally for a nullable field:
`Node(42, null).next is null`.

## Defaults

A field has a default when its type has one ([08](08-primitives.md)) — a nullable type's is `null`,
an array type's is empty — or when it has an initialiser. A struct has a default exactly when every
field does:

```wac
// expect: answers main = 3
struct Conn {
  i32 retries = 3;
  i32[] log;                               // empty by default
  Conn? fallback;                          // null by default
}

export i32 main() {
  Conn c;                                  // every field has a default, so Conn does
  Conn d = Conn { };                       // the same, written as a construction
  return c.retries + d.log.len();
}
```

`[§wac-field-initialiser-default-28c4ffw]` A field initialiser gives the field a default, and a struct has a
default exactly when every field has one.

`[§wac-arr-field-default-k9wq3fm]` A field of array type defaults to an empty array, whatever the
element type.

`[§wac-struct-default-decl-th9q22u]` A local of a struct type that has a default is constructed from the
defaults when declared without an initialiser; `T { }` constructs the same value.

Defaults nest. A field of struct type has a default when that struct does:

```wac
// expect: answers main = 0
struct Point { i32 x = 0; i32 y = 0; }
struct Line { Point start; Point end; }

export i32 main() {
  Line l;                                  // start and end are default Points
  return l.start.x + l.end.y;
}
```

`[§wac-nested-default-tctff6b]` A field whose struct type has a default takes that default, constructed
recursively.

A field initialiser runs at each construction, not once. It cannot read another field — there is no
`this` while the object is being built — and it cannot reach the world, since a struct body has no
capability in scope:

```wac
// expect: answers main = 1
struct Counter {
  i32[] seen = [0];                        // a fresh array per construction
}

struct Bad {
  i32 a = 1;

  // ERROR: a field initialiser cannot read `this`
  // i32 b = this.a + 1;
}

export i32 main() {
  Counter c1;
  Counter c2;
  c1.seen[0] = 5;
  return c2.seen[0] == 0 ? 1 : 0;          // c2 has its own array
}
```

`[§wac-field-initialiser-each-8upxvn7]` A field initialiser is evaluated once for each construction that
uses it.

`[§wac-field-initialiser-no-this-tvimw93]` A field initialiser cannot refer to `this`, or to any other
field of the object being constructed.

A declaration of a struct without a default leaves the fields that have none unassigned. They must be
written before the object is used:

```wac
// expect: answers main = 7
struct Half {
  i32 retries = 3;
  i32 port;                                // no default
}

i32 use(Half h) { return h.retries + h.port; }

export i32 main() {
  Half h;
  h.port = 4;                              // retries is already 3

  // ERROR: 'g.port' is never assigned
  // Half g;
  // i32 bad = use(g);

  return use(h);
}
```

`[§wac-struct-decl-pending-v69zid6]` Declaring a local of a struct type without an initialiser assigns the
fields that have defaults and leaves the rest unassigned. Using the object before every field is
assigned is refused.

A struct with a field of its own type that is not nullable has no default, since building one would
never end — and it is still a valid type ([11](11-never-and-uninhabited.md)).

## Methods

A method is declared in the struct body. Its receiver is written as its first parameter: `this` for
access that may write, `const this` for access that may not. A method with no receiver belongs to the
type:

```wac
// expect: answers main = 1
struct Counter {
  i32 count;
  const i32 id;

  i32 getCount(const this) { return this.count; }

  void inc(this) {
    this.count += 1;

    // ERROR: 'id' is a const field
    // this.id = 5;
  }

  Counter create(i32 id) { return Counter(0, id); }   // no receiver: Counter.create
}

export i32 main() {
  Counter c = Counter.create(1);
  c.inc();
  return c.getCount();
}
```

`[§wac-method-ta71o2i]` A method with no receiver is called on the type: `Counter.create(1)` answers a
`Counter` with `count` 0 and `id` 1.

`[§wac-method-inc-09hcqkq]` A method taking `this` may write fields: after `c.inc()`, `c.getCount()`
answers `1`.

`[§wac-method-const-d5zjb9i]` Writing a `const` field inside a method is refused, as it is anywhere
else.

Fields and methods are reached through `this`. A bare field name inside a method is not in scope:

```wac
// expect: emits
struct Foo {
  i32 count;

  i32 getCount(const this) {
    // ERROR: undefined name 'count' — write this.count
    // return count;
    return this.count;
  }
}

export i32 main() { return 0; }
```

`[§wac-bare-field-q3wn8v5]` A bare field name inside a method is refused; fields are reached through
`this`.

Methods work alike on fields of every kind:

```wac
// expect: answers main = 2
struct Node { i32 val; Node? next; }

struct Stack {
  Node? top;
  i32 count;

  void push(this, i32 val) {
    this.top = Node(val, this.top);
    this.count++;
  }

  i32 len(const this) { return this.count; }
}

export i32 main() {
  Stack s = Stack(null, 0);
  s.push(10);
  s.push(20);
  return s.len();
}
```

`[§wac-method-mixed-fields-r4kn7wp]` After `s.push(10); s.push(20)`, `s.len()` answers `2`.

A method may also be named by a symbol rather than a word ([21](21-symbols.md)), which is how a type
implements an operator ([22](../3-expressions/22-operators.md)). A field declared `static` belongs to
the type rather than to each instance ([27](../4-static/27-static-declarations.md)).

## Subtypes

A struct may extend one other struct with `: Parent`. It inherits the parent's fields and methods and
adds fields after them. A subtype value may be used wherever its parent is expected:

```wac
// expect: answers main = 5.0
struct Shape {
  f64 x;
  f64 y;
  f64 getX(const this) { return this.x; }
  i32 tag(const this) { return 1; }
}

struct Rect : Shape {
  f64 w;
  f64 h;
}

export f64 main() {
  Rect r = Rect(5.0, 0.0, 10.0, 20.0);     // x, y, then w, h
  Shape s = r;                             // a Rect is a Shape
  i32 t = r.tag() + 1;                     // an inherited method keeps its result type
  return s.getX();
}
```

`[§wac-subpos-order-m7kx3qf]` Positional construction of a subtype takes the parent's fields first, in
declaration order, then the subtype's own.

`[§wac-subtype-assign-jjrjz7g]` A subtype value may be assigned to its parent type, and the parent's
fields are readable through it.

`[§wac-subtype-method-2s28pfb]` A parent's methods may be called on a subtype.

`[§wac-inherited-method-type-9dkq3wv]` An inherited method's result has the type it was declared
with: `r.tag() + 1` is an `i32` addition.

A method with no receiver is not inherited:

```wac
// expect: emits
struct Base {
  Base make() { return Base(); }
}

struct Sub : Base {
  i32 extra;
}

export i32 main() {
  // ERROR: Sub has no method 'make'
  // Sub s = Sub.make();

  Base b = Base.make();
  return 0;
}
```

`[§wac-nostatic-inh-r3kf8wp]` A method without a receiver belongs to the type that declares it, and is
not available through a subtype.

## Virtual methods

A method declared `virtual` may be overridden by a subtype, and a call to it dispatches on the
runtime type of the receiver:

```wac
// expect: answers main = 80
struct Base {
  virtual i32 fire(const this) { return 0; }
}

struct Kid : Base {
  override i32 fire(const this) { return 40; }
}

export i32 main() {
  Kid  k = Kid();
  Base b = k;
  return k.fire() + b.fire();              // 40 + 40: dispatch is on the runtime type
}
```

`[§wac-virtual-dispatch-a4xhpib]` A call to a `virtual` method runs the implementation of the receiver's
runtime type, whatever static type the call is made through.

`[§wac-override-virtual-8bj3d46]` `override` in a subtype replaces a parent method marked `virtual`.

A method that is not virtual can be neither overridden nor shadowed. Both halves are required —
`virtual` is the base granting the override, and `override` is the subtype taking it:

```wac
// expect: emits
struct Base {
  i32 fire(const this) { return 0; }
  virtual i32 aim(const this) { return 0; }
}

struct Kid : Base {
  // ERROR: Base.fire is not virtual
  // i32 fire(const this) { return 40; }

  // ERROR: Base.fire is not virtual
  // override i32 fire(const this) { return 40; }

  // ERROR: Base.aim is virtual, and an implementation here must say override
  // i32 aim(const this) { return 1; }

  // ERROR: nothing to override
  // override i32 missing(const this) { return 1; }
}

export i32 main() { return 0; }
```

`[§wac-nonvirtual-final-7a4kz3t]` A subtype may not declare a method with the name of a parent method
that is not `virtual`, with or without `override`.

`[§wac-override-required-fgt5fkj]` A subtype method with the name of a parent's `virtual` method must be
marked `override`.

`[§wac-override-spurious-p9qn5xl]` `override` on a method with no parent method of that name is
refused.

One object answering two ways depending on which static type reached it is what shadowing would
allow, and it is not allowed.

## Type tests and casts

`x is T` tests the runtime type of a reference, and `x is not T` is its negation. `as` widens to a
parent, which cannot fail; `as!` narrows to a subtype, and traps if the object is not one
([24](../3-expressions/24-casts.md)):

```wac
// expect: traps main
struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
struct Circle : Shape { f64 radius; }

export i32 main() {
  Circle c = Circle(0.0, 0.0, 5.0);
  Shape s = c as Shape;                    // widening: always succeeds
  i32 n = 0;
  if (s is Circle) { n += 1; }             // true
  if (s is not Rect) { n += 1; }           // true
  Rect r = s as! Rect;                     // traps: s is a Circle
  return n;
}
```

`[§wac-is-dz9jg1l]` `x is T` is true exactly when `x`'s runtime type is `T` or a subtype of it.

`[§wac-is-not-fwatmyk]` `x is not T` is its negation.

`[§wac-as-trap-d10qz88]` A downcast with `as!` to a type the object does not have traps.

The type named in a test must exist:

```wac
// expect: emits
struct Point { i32 x; }

export i32 main() {
  Point p = Point(1);

  // ERROR: undefined type 'Nonexistent'
  // bool b = p is Nonexistent;

  return 0;
}
```

`[§wac-is-undefined-type-6qbn3wr]` A type test naming a type that is not in scope is refused.

### A test narrows

Inside the block a test guards, the tested name has the narrower type, so no cast is needed:

```wac
// expect: answers main = 200.0
struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
struct Circle : Shape { f64 radius; }

f64 area(Shape s) {
  if (s is Circle) {
    return 3.0 * s.radius * s.radius;      // s is a Circle here
  } else if (s is Rect) {
    return s.w * s.h;                      // and a Rect here
  }
  return 0.0;
}

export f64 main() { return area(Rect(0.0, 0.0, 10.0, 20.0)); }
```

`[§wac-narrow-if-2mkq8vp]` `if (x is T)` narrows the name `x` to `T` within the block it guards, and in
an `else if` arm. `&&` narrows from either operand; `||` and `is not` narrow nothing. Only a plain name
narrows — not a field or an index — and the narrowed name is `const` within the block.

It is a scope rule, not flow-sensitive typing: the name is shadowed for the block by a `const`
binding at the narrower type, exactly as a match arm binds its payload. A test that also needs a new
name is `matches` ([25](../3-expressions/25-control-flow.md)).

## Identity

`x is y`, where `y` is a value rather than a type or `null`, compares references: whether the two are
the same object.

```wac
// expect: answers main = 1
struct Point { i32 x; i32 y; }

export i32 main() {
  Point a = Point(1, 2);
  Point b = a;
  Point c = Point(1, 2);
  return a is b && a is not c ? 1 : 0;
}
```

`[§wac-refid-same-k7fn4wp]` `a is b` is true when `a` and `b` are the same object.

`[§wac-refid-diff-m4jw3rk]` Two objects built separately are not the same object, whatever their
fields hold.

So `is` has three meanings, decided by its right side: a type tests the runtime type, `null` tests
absence ([10](10-nullability.md)), and a value tests identity.

A reference is comparable but not hashable: comparing two costs nothing, but a stable hash of an
object needs a stored field, and the language does not put one on every object. A type that wants to
be a hash key carries its own ([39](../7-library/39-map-and-hash.md)).

## A worked example

```wac
// expect: answers main = 3010
struct Node { i32 val; Node? next; }

struct LinkedList {
  Node? head;
  Node? tail;
  i32 count;

  LinkedList create() { return LinkedList(null, null, 0); }

  void pushBack(this, i32 val) {
    Node n = Node(val, null);
    if (this.tail is null) {
      this.head = n;
    } else {
      this.tail!.next = n;
    }
    this.tail = n;
    this.count++;
  }

  void reverse(this) {
    Node? prev = null;
    Node? cur = this.head;
    this.tail = this.head;
    while (cur is not null) {
      Node? next = cur!.next;
      cur!.next = prev;
      prev = cur;
      cur = next;
    }
    this.head = prev;
  }

  i32 front(const this) { return this.head!.val; }
  i32 back(const this) { return this.tail!.val; }
}

export i32 main() {
  LinkedList l = LinkedList.create();
  l.pushBack(10);
  l.pushBack(20);
  l.pushBack(30);
  l.reverse();
  return l.front() * 100 + l.back();       // 30 * 100 + 10
}
```
