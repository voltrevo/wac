# 10 — Nullability

A value is never absent unless its type says it may be. `T?` is `T` or `null`; `T` is never `null`.

`?` does not flatten. `T??` is a type of its own, with three states, and every one of them can be
written down.

## `null` inhabits a nullable type and no other

```wac
// expect: answers main = 1
struct Point { i32 x; i32 y; }

export i32 main() {
  Point p = Point(1, 2);
  Point? q = null;
  q = p;                                   // T widens to T?

  // ERROR: a nullable value cannot be assigned to a non-null one
  // p = q;

  // ERROR: Point is non-null
  // Point r = null;

  // ERROR: i32 is non-null — i32? is the nullable form
  // i32 x = null;

  i32? y = null;
  return q is null ? 0 : 1;
}
```

`[§wac-nullassign-b3xk8p5]` A nullable value cannot be assigned to a non-null slot.

`[§wac-null-assign-k3fn8wp]` `null` may be assigned to any nullable type.

`[§wac-null-nonnull-m8qj5xf]` `null` may not be assigned to a non-null type.

`[§wac-null-primitive-p7hd6wn]` `i32 x = null` is refused because `i32` is non-null — not because a
number cannot be nullable.

## Every type but `void` may be nullable

```wac
// expect: answers main = 2000000001
i32? pick(bool cond) { return cond ? 1 : null; }

export i32 main() {
  i32? a = 2000000000;                     // the full range of i32
  i32? b = null;
  i32 got = a is null ? 0 : a!;
  return got + pick(true)! + (b ?? 0);
}
```

`[§wac-nullable-primitive-4mzq7vp]` A nullable number holds the full range of its type, and works in
every position a nullable reference does: a declaration, an assignment, a field, an array element,
an argument, a return, a ternary branch, a match arm and an enum payload.

A nullable number needs somewhere to put its absence, which no wasm number has, so an implementation
typically boxes it. That costs an allocation per non-null value and is otherwise invisible — except at
a host boundary, where it is a reference ([48](../8-tooling/48-bindgen.md)).

## `!` unwraps, and traps on `null`

```wac
// expect: traps main
struct Point { i32 x; i32 y; }

Point? find(bool here) { return here ? Point(1, 2) : null; }

export i32 main() {
  i32 x = find(true)!.x;                   // 1: unwrap, then read
  Point p = find(false)!;                  // traps
  return x;
}
```

`[§wac-unwrap-trap-y1iep2p]` `!` on a nullable value answers the value, and traps when it is `null`.

```wac
// expect: emits
struct Point { i32 x; i32 y; }

export i32 main() {
  Point p = Point(1, 2);

  // ERROR: `!` needs a nullable operand; Point is never null
  // Point q = p!;

  return p.x;
}
```

`[§wac-unwrap-needs-nullable-uj5bjv7]` `!` on a value whose type is not nullable is refused: there is no
absence for it to assert against.

Postfix `!` is unwrapping; prefix `!` is logical negation ([22](../3-expressions/22-operators.md)).

## Testing for `null`

```wac
// expect: answers main = 2
struct Point { i32 x; i32 y; }

export i32 main() {
  Point? q = Point(1, 2);
  i32 n = 0;
  if (q is not null) { n += 1; }
  if (null is null) { n += 1; }
  return n;
}
```

`[§wac-isnull-kxsqi4g]` `x is null` is true exactly when `x` is `null`, and `x is not null` is its
negation. `null is null` is `true`.

A test against `null` on a type that is never null is allowed, and always false:

```wac
// expect: answers main = 0
struct Box { i32 v; }

export i32 main() {
  Box b = Box(1);
  return b is null ? 1 : 0;                // may warn: Box is never null
}
```

`[§wac-nonnull-isnull-k8fn3wp]` `x is null` on a non-null type is allowed, and is `false`.

`[§wac-nonnull-isnull-may-warn-udv9kfr]` An implementation may warn about it, since one branch of the test
can never run.

It is allowed rather than refused because a generic needs it. `struct Slot<T> { T v; bool
empty(const this) { return this.v is null; } }` has to instantiate for nullable and non-nullable `T`
alike ([19](19-generics.md)).

Matching a nullable subject — with a `null` arm — is [25](../3-expressions/25-control-flow.md)'s
subject.

## `T??` has three states

```wac
// expect: answers main = 4
struct Node { i32 v; }

export i32 main() {
  Node   n = Node(1);
  Node?? a = null;                         // absent
  Node?? b = null as Node?;                // present, holding a null
  Node?? c = n;                            // present, holding n

  i32 k = 0;
  if (a is null) { k += 1; }               // true
  if (b is not null) { k += 1; }           // true: b is present
  if (b! is null) { k += 1; }              // true: what it holds is null
  if (c!! is n) { k += 1; }                // true
  return k;
}
```

`[§wac-nullable-nested-ak7583p]` `T??` is distinct from `T?`. A bare `null` is the outer absence; a
present `T??` may hold `null` or a `T`; and `!` removes one layer at a time.

`[§wac-null-as-typed-ifyaj6m]` `null as T?` is a `T?` holding `null`, so it reaches a `T??` present.
Widening a typed value wraps it: a `T?` assigned to a `T??` is present whatever it holds.

```wac
// expect: emits
struct Node { i32 v; }

export i32 main() {
  Node?? two = null;

  // ERROR: Node?? cannot be assigned to Node? — it has a state Node? cannot hold
  // Node? one = two;

  Node? one = two ?? null;                 // the two absences merged, said out loud
  return 0;
}
```

`[§wac-nested-not-collapsed-m6cz4gb]` A `T??` does not convert to a `T?`; collapsing its two absences is
written `?? null`.

This is why a container's `pop` can answer `T?` for any `T` and still say whether it was empty: at
`T = Node?`, a popped `null` element arrives present ([38](../7-library/38-vec.md)).

## `null` is `never?`

`null` in type position is conventional sugar for `never?` ([11](11-never-and-uninhabited.md)), and
the null literal has that concrete type. When the types of several values are combined —
ternary branches, array elements, return statements — nonnullable bases are widened and the greatest
outer nullable depth is kept ([32](../5-inference/32-widening.md)):

```text
widen(never, T) = T
widen(null, i32) = i32?
widen(null?, i32) = i32??
widen(null, i32??) = i32??
widen(null, null) = null
```

```wac
// expect: answers main = 1
auto nothing() { return null; }            // null, meaning never?

auto maybe(bool c) {
  if (c) { return 1 as i32; }
  return null;
}                                          // i32?

export i32 main() {
  null n = nothing();
  i32? m = maybe(true);
  return n is null && m is not null ? 1 : 0;
}
```

`[§wac-null-never-opt-zvbx6ds]` The type of `null` is `never?`, and `null` may be written in a type
position to mean it.

## `?.` reads through an absence

```wac
// expect: answers main = 2
struct Addr   { string city; }
struct Person { Addr here; Addr? home; Addr?? prev; }

export i32 main() {
  Person? p = Person(Addr("Oslo"), null, null);

  auto a = p?.here;                        // Addr?: p might be absent
  auto b = p?.home;                        // Addr?, not Addr??
  auto c = p?.prev;                        // Addr??, not Addr???

  Person? nobody = null;
  i32 k = 0;
  if (a is not null) { k += 1; }
  if (nobody?.here is null) { k += 1; }    // short-circuits: here is never read
  return k;
}
```

`[§wac-safe-member-merges-f7qhnij]` `p?.m` answers `null` when `p` is absent and `p!.m` otherwise. Its type
is the member's type made nullable if it is not already: `?.` merges its own absence into the
member's, so a chain never manufactures a `T??`.

A `T??` result comes only from a `T??` member. Two absences in a chain both produce `null`, and the
member is read only when every link is present:

```wac
// expect: answers main = 1
struct Addr   { string city; }
struct Person { Addr? home; }

string? cityOf(Person? p) {
  return p?.home?.city;                    // no person, or no address: null
}

export i32 main() {
  string? a = cityOf(Person(Addr("Oslo")));
  string? b = cityOf(Person(null));
  return a is not null && b is null ? 1 : 0;
}
```

`?.` stops at a `T??`, because stripping one `?` leaves a `T?`, which has no members:

```wac
// expect: emits
struct Addr   { string city; }
struct Person { Addr?? prev; }

export i32 main() {
  Person? p = null;

  // ERROR: Addr? has no member 'city'
  // string? bad = p?.prev?.city;

  string? city = (p?.prev ?? null)?.city;  // collapse first, then read
  return 0;
}
```

`[§wac-safe-member-stops-yyhgvjr]` `?.` on a `T??` is refused when the member is looked up on `T?`. The two
absences must be collapsed explicitly first.

## `??` supplies what is absent

```wac
// expect: answers main = 5000
struct Config { i32 timeoutMs; }

i32 timeoutMs(Config? cfg) {
  return cfg?.timeoutMs ?? 5000;           // an i32
}

export i32 main() { return timeoutMs(null); }
```

`[§wac-coalesce-type-uqe5ae9]` `a ?? b` answers `a!` when `a` is present and `b` otherwise. Its type is the
non-null form of `a`'s type joined with `b`'s type.

So `?? null` collapses a `T??` to `T?`, and does nothing to a `T?`:

```wac
// fragment — with Addr?? two and Addr? one in scope
two ?? null;                 // Addr?: absent and present-holding-null both arrive as null
one ?? null;                 // Addr?: a tautology — this is one
```

## `?.` and `??` need an operand that can be absent

```wac
// expect: emits
struct Addr   { string city; }
struct Person { Addr? home; }

export i32 main() {
  Person p = Person(null);
  Person? q = p;

  // ERROR: `p` cannot be absent
  // Addr? a = p?.home;

  // ERROR: `p` cannot be absent
  // Person r = p ?? Person(null);

  Addr x = p.home ?? Addr("Oslo");         // p.home can be absent
  Addr? y = q?.home;
  return 0;
}
```

`[§wac-absence-op-needs-nullable-gp8hxz5]` `?.` and `??` with a left operand whose type is not nullable
are refused.

A `?.` or `??` on a non-nullable operand has no case to handle: the short circuit and the default are
both unreachable. Refusing it means a reader who finds one knows the operand can be absent.

## `?.` is not an assignment target

```wac
// expect: emits
struct Addr   { string city; }
struct Person { Addr? home; }

export i32 main() {
  Person? p = Person(null);

  // ERROR: `?.` is not an assignment target
  // p?.home = Addr("Oslo");

  if (p is not null) { p!.home = Addr("Oslo"); }
  return 0;
}
```

`[§wac-safe-member-no-assign-6htacsn]` A `?.` expression may not be assigned to.

A read has somewhere to put the absent case, because its result is nullable. A write has nowhere: the
right side would be evaluated and dropped, and the statement would succeed having done nothing.
