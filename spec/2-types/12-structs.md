# 12 — Structs

A struct is a nominal type with named fields and methods. A struct value is a reference to an object
on the heap: assigning it, passing it or storing it shares the object rather than copying it.

## A struct value is a reference

```wac
// expect: answers sharedWrite = 99
struct Point { i32 x; i32 y; }

export i32 sharedWrite() {
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
// expect: answers constFields = 15
struct IdPoint {
  const i32 id;                            // fixed at construction
  i32 x;
  i32 y;
}

const struct Config {                      // every field is const
  i32 width;
  i32 height;
}

export i32 constFields() {
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
// expect: answers frozenSum = 6
// ---- frozen.wac ----
export const struct Frozen { i32 w; i32 h; }
// ---- main.wac ----
import { Frozen } from "./frozen.wac";

export i32 frozenSum() {
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
// expect: answers constructions = true
struct Link {
  i32 value;
  Link? next = null;
}

export bool constructions() {
  Link a = Link(3, null);                  // every field
  Link b = Link { value: 3 };              // next uses its default
  Link c = Link { next: a, value: 4 };     // any order

  // ERROR: positional construction supplies every field, defaults included
  // Link d = Link(3);

  return a.value == 3 && b.next is null && c.next is a;
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
// expect: answers nullNext = 42
struct Node { i32 val; Node? next; }

export i32 nullNext() {
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
// expect: answers defaulted = 3
struct Conn {
  i32 retries = 3;
  i32[] log;                               // empty by default
  Conn? fallback;                          // null by default
}

export i32 defaulted() {
  Conn c;                                  // read below unassigned: Conn's default
  Conn d = Conn { };                       // the same value, written as a construction
  return c.retries + d.log.len();
}
```

`[§wac-field-initialiser-default-28c4ffw]` A field initialiser gives the field a default, and a struct has a
default exactly when every field has one.

`[§wac-arr-field-default-k9wq3fm]` A field of array type defaults to an empty array, whatever the
element type.

`[§wac-struct-default-read-n6vdh42]` A local of a struct type with a default, read where it may be unassigned, holds
the value `T { }` constructs ([08](08-primitives.md), `wac-assign-default-on-demand`).

Defaults nest. A field of struct type has a default when that struct does:

```wac
// expect: answers nestedDefault = 0
struct Point { i32 x = 0; i32 y = 0; }
struct Line { Point start; Point end; }

export i32 nestedDefault() {
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
// expect: answers freshPerConstruction = true
struct Counter {
  i32[] seen = [0];                        // a fresh array per construction
}

export struct Bad {
  i32 a = 1;

  // ERROR: a field initialiser cannot read `this`
  // i32 b = this.a + 1;
}

export bool freshPerConstruction() {
  Counter c1;
  Counter c2;
  c1.seen[0] = 5;
  return c2.seen[0] == 0;                  // c2 has its own array
}
```

`[§wac-field-initialiser-each-8upxvn7]` A field initialiser is evaluated once for each construction that
uses it.

`[§wac-field-initialiser-no-this-tvimw93]` A field initialiser cannot refer to `this`, or to any other
field of the object being constructed.

A struct local declared without an initialiser may also be built a field at a time. Until its first use, each
field is tracked on its own; at the first use, every field must be assigned or have a default
([08](08-primitives.md), `wac-assign-parts`):

```wac
// expect: answers assignedLater = 7
// expect: answers frozenPort(8080) = 8080
struct Half {
  i32 retries = 3;
  i32 port;                                // no default
}

struct Fixed {
  const i32 port;
}

i32 use(Half h) { return h.retries + h.port; }

export i32 assignedLater() {
  Half h;
  h.port = 4;                              // retries takes its default at the first use
  return use(h);
}

export i32 neverAssigned() {
  Half g;

  // ERROR: 'g.port' is not assigned at g's first use, and has no default
  // return use(g);

  return 0;
}

export i32 frozenPort(i32 p) {
  Fixed f;
  f.port = p;                              // construction, not a write: f is not yet used

  // ERROR: 'f.port' is const, and was assigned already
  // f.port = p + 1;

  i32 seen = f.port;                       // the first use

  // ERROR: 'f.port' is const
  // f.port = 1;

  return seen;
}
```

`[§wac-struct-decl-pending-rx5fvj2]` A struct local's fields may be assigned one at a time before its first use. At the
first use, a field neither assigned nor defaulted is refused; a defaulted one takes its default.

`[§wac-struct-const-field-init-u4dtpsm]` Before a struct local's first use, assigning a `const` field is construction:
it is allowed once. After the first use, it is a write, and refused.

A struct with a field of its own type that is not nullable has no default, since building one would
never end — and it is still a valid type ([11](11-never-and-uninhabited.md)).

## Methods

A method is declared in the struct body. Its receiver is written as its first parameter: `this` for
access that may write, `const this` for access that may not. A method with no receiver belongs to the
type:

```wac
// expect: answers countAfterInc = 1
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

export i32 countAfterInc() {
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
export struct Foo {
  i32 count;

  i32 getCount(const this) {
    // ERROR: undefined name 'count' — write this.count
    // return count;
    return this.count;
  }
}
```

`[§wac-bare-field-q3wn8v5]` A bare field name inside a method is refused; fields are reached through
`this`.

Methods work alike on fields of every kind:

```wac
// expect: answers stackLen = 2
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

export i32 stackLen() {
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
// expect: answers inheritedX = 5.0
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

export f64 inheritedX() {
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

export struct Sub : Base {
  i32 extra;
}

export Base viaBase() {
  // ERROR: Sub has no method 'make'
  // Sub s = Sub.make();

  return Base.make();
}
```

`[§wac-nostatic-inh-r3kf8wp]` A method without a receiver belongs to the type that declares it, and is
not available through a subtype.

## Virtual methods

A method declared `virtual` may be overridden by a subtype, and a call to it dispatches on the
runtime type of the receiver:

```wac
// expect: answers dispatch = 80
struct Base {
  virtual i32 fire(const this) { return 0; }
}

struct Kid : Base {
  override i32 fire(const this) { return 40; }
}

export i32 dispatch() {
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

export struct Kid : Base {
  // ERROR: Base.fire is not virtual
  // i32 fire(const this) { return 40; }

  // ERROR: Base.fire is not virtual
  // override i32 fire(const this) { return 40; }

  // ERROR: Base.aim is virtual, and an implementation here must say override
  // i32 aim(const this) { return 1; }

  // ERROR: nothing to override
  // override i32 missing(const this) { return 1; }
}
```

`[§wac-nonvirtual-final-7a4kz3t]` A subtype may not declare a method with the name of a parent method
that is not `virtual`, with or without `override`.

`[§wac-override-required-fgt5fkj]` A subtype method with the name of a parent's `virtual` method must be
marked `override`.

`[§wac-override-spurious-p9qn5xl]` `override` on a method with no parent method of that name is
refused.

One object answering two ways depending on which static type reached it is what shadowing would
allow, and it is not allowed.

## Private members

`private` on a field, a method or a static member makes it visible only inside its struct's body — its methods,
static methods and field initialisers. The rest of the module cannot name it, any more than another module can:

```wac
// expect: answers deposited(10, 20) = 30
// expect: answers depositCount(10, 20) = 1
export struct Account {
  private i32 cents;
  private i32 deposits = 0;

  Account open(i32 cents) { return Account(cents, 0); }   // inside the body: every field is in reach

  void deposit(this, i32 c) {
    this.cents = this.cents + c;
    this.tally();
  }
  i32 balance(const this) { return this.cents; }
  i32 count(const this) { return this.deposits; }

  private void tally(this) { this.deposits = this.deposits + 1; }
}

export i32 deposited(i32 a, i32 b) {
  Account acct = Account.open(a);
  acct.deposit(b);

  // ERROR: 'cents' is private to Account
  // acct.cents = 1000000;

  // ERROR: 'cents' is private to Account
  // i32 peek = acct.cents;

  // ERROR: 'tally' is private to Account
  // acct.tally();

  return acct.balance();
}

export i32 depositCount(i32 a, i32 b) {
  Account acct = Account.open(a);
  acct.deposit(b);
  return acct.count();
}
```

`[§wac-private-member-dgsxduu]` A `private` field, method or static member is visible only inside the body of the
struct that declares it. Naming it anywhere else is refused.

### Construction from outside

Construction sets fields, so it obeys the same boundary. Positional construction supplies every field, and is
refused outside the body of a struct with any private field. Named construction outside may leave out a private
field that has a default, and may not name one:

```wac
// expect: answers headroom = 5
export struct Quota {
  i32 limit;
  private i32 used = 0;

  i32 left(const this) { return this.limit - this.used; }
}

export struct Sealed {
  private i32 secret;
  Sealed make(i32 s) { return Sealed(s); }
}

export i32 headroom() {
  Quota q = Quota { limit: 5 };            // used takes its default

  // ERROR: 'used' is private to Quota
  // Quota forged = Quota { limit: 5, used: -100 };

  // ERROR: Quota has private fields — positional construction is for its own body
  // Quota forged = Quota(5, -100);

  // ERROR: 'secret' is private to Sealed and has no default — build one with Sealed.make
  // Sealed s = Sealed { };

  return q.left();
}
```

`[§wac-private-construction-4zbaya5]` Outside its struct's body, positional construction of a struct with a private
field is refused, and named construction may not name a private field. A private field without a default can
therefore be set only by the struct's own code — which is how a struct guards an invariant.

Building a local field by field ([08](08-primitives.md)) is construction too: outside the body, a private field
cannot be assigned, so it must have a default to fill it at the local's first use.

### Subtypes do not see a parent's private members

```wac
// expect: emits
struct Account {
  private i32 cents = 0;
  i32 balance(const this) { return this.cents; }
}

export struct Savings : Account {
  i32 rate;

  i32 interest(const this) {
    // ERROR: 'cents' is private to Account
    // return this.cents * this.rate / 100;

    return this.balance() * this.rate / 100;
  }
}
```

`[§wac-private-not-inherited-acpickk]` A subtype's body is not its parent's: a parent's private members are not visible
in it. A subtype's methods reach them only through the parent's non-private methods.

The subtype's own construction follows the rule above. Positional construction of `Savings` takes `Account`'s fields
first (see Subtypes), so it is refused everywhere, `Savings`' own body included; named construction works when
every private parent field has a default. A subtype of a struct with a private field that has no default cannot be
constructed at all, and declaring it is refused.

A private method keeps its name taken. A subtype may not declare a method with a parent's private method's name, as
for any method that is not `virtual` (`wac-nonvirtual-final`), and `private virtual` is refused: an override in a
subtype would need to see what it replaces.

### Private members and static reflection

Static evaluation that reflects on a struct's fields ([30](../4-static/30-computed-types.md)) sees a private field —
its name and its type — so code computing a type from a struct's shape sees the whole shape. It cannot read or write
the field's value through reflection outside the struct's body.

`[§wac-private-reflection-jp3cgxs]` Static reflection reports a private field's name and type. Reading or writing a
private field's value through reflection is subject to `private` exactly as a written field access is.

## Type tests and casts

`x is T` tests the runtime type of a reference, and `x is not T` is its negation. `as` widens to a
parent, which cannot fail; `as!` narrows to a subtype, and traps if the object is not one
([24](../3-expressions/24-casts.md)):

```wac
// expect: traps downcast
struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
struct Circle : Shape { f64 radius; }

export i32 downcast() {
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

export i32 typeTest() {
  Point p = Point(1);

  // ERROR: undefined type 'Nonexistent'
  // bool b = p is Nonexistent;

  return p.x;
}
```

`[§wac-is-undefined-type-6qbn3wr]` A type test naming a type that is not in scope is refused.

### A test narrows

Inside the block a test guards, the tested name has the narrower type, so no cast is needed:

```wac
// expect: answers rectArea = 200.0
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

export f64 rectArea() { return area(Rect(0.0, 0.0, 10.0, 20.0)); }
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
// expect: answers identity = true
struct Point { i32 x; i32 y; }

export bool identity() {
  Point a = Point(1, 2);
  Point b = a;
  Point c = Point(1, 2);
  return a is b && a is not c;
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
// expect: answers reversedEnds = 3010
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

export i32 reversedEnds() {
  LinkedList l = LinkedList.create();
  l.pushBack(10);
  l.pushBack(20);
  l.pushBack(30);
  l.reverse();
  return l.front() * 100 + l.back();       // 30 * 100 + 10
}
```
