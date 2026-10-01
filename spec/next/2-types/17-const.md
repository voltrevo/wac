# 17 — Const

`const` on a binding means the name cannot be rebound. On a reference it means more: nothing may be written
through it, at any depth, and that travels with the reference wherever it goes.

`const` says nothing about when a value is computed. A `const` local is initialised when its declaration
runs, like any other. A value computed at compile time is `static`
([27](../4-static/27-static-declarations.md)) — which is `const` as well, but not because of the word.

## A const binding cannot be rebound

```wac
// expect: answers rebinding = 12
export i32 rebinding() {
  i32 x = 1;
  x = 2;
  const i32 y = 10;

  // ERROR: 'y' is const
  // y = 11;

  return x + y;
}
```

`[§wac-const-var-7b4swc8]` Assigning to a `const` local is refused.

## Const on a reference is deep

```wac
// expect: answers rootVal = 1
struct Tree {
  i32 val;
  Tree? left;
  Tree? right;
}

export i32 rootVal() {
  const Tree t = Tree(1, Tree(2, null, null), null);
  const i32[] xs = [1, 2, 3];

  // ERROR: cannot write through a const reference
  // t.val = 5;

  // ERROR: cannot write through a const reference, however deep
  // t.left!.val = 5;

  // ERROR: it reaches the elements
  // xs[0] = 9;

  return t.val;
}
```

`[§wac-const-ref-617go61]` Writing a field through a `const` reference is refused.

`[§wac-const-deep-j6b1nyg]` Writing through a `const` reference at any depth — a field of a field, an element
of an array — is refused.

In JavaScript `const` binds the name and leaves the contents open. Here it reaches the contents.

## Const travels with the reference

A reference obtained through a `const` one is `const` itself — read from a field, returned by a method, or
copied into a new binding:

```wac
// expect: emits
struct Inner {
  i32 val;
  void mutate(this) { this.val = 1; }
}

struct Outer {
  Inner inner;

  Inner getInner(const this) { return this.inner; }

  void tryMutate(const this) {
    // ERROR: const is deep — this.inner is reached through a const receiver
    // this.inner.mutate();

    // ERROR: the result of a call through a const receiver keeps its constness
    // this.getInner().mutate();

    Inner copy = this.inner;               // the binding may be reassigned...

    // ERROR: ...but the object it refers to is const
    // copy.mutate();
  }
}

export void inspect(const Outer o) { o.tryMutate(); }
```

`[§wac-deep-const-j4fn2xq]` Calling a method that takes `this` through a `const` reference is refused.

`[§wac-deep-const-accessor-w3kf8nq]` A method that returns a reference reached through its `const` receiver
returns it `const`: writing through the result is refused.

`[§wac-deep-const-alias-p6mk2wf]` Assigning a `const` reference to a plain local is allowed — read-only
cursors depend on it — but the constness comes with it: writes and `this`-taking calls through the new
binding are refused, and it may not be stored where it would be reachable as mutable.

```wac
// expect: answers twoNodes = 2
struct Node { i32 v; Node? next; }

i32 length(const Node head) {
  i32 n = 0;
  Node? cur = head;                        // a cursor over const data
  while (cur is not null) {
    n++;
    cur = cur!.next;
  }
  return n;
}

export i32 twoNodes() { return length(Node(1, Node(2, null))); }
```

A method that hands back what it holds hands back the real thing, not a copy, so its constness comes too.
Reading it is allowed; writing is where it is caught:

```wac
// expect: answers twoRoutes = 2
struct Route { string path; }

struct Server {
  Route[] routes;
  Route[] table(const this) { return this.routes; }
}

i32 count(const Server s) {
  return s.table().len();                  // reading through it is fine
}

export void add(const Server s) {
  // ERROR: s.table() is const, and writing an element writes through it
  // s.table()[0] = Route("/");
}

export i32 twoRoutes() { return count(Server([Route("/a"), Route("/b")])); }
```

## A fresh allocation is not const

`const this` gives const access to the receiver's fields. It does not make every result of the method
const: an object the method allocates is new, and the caller may write to it:

```wac
// expect: answers freshResults = 8
struct Point { i32 x; }

struct Holder {
  Point point;

  Point fresh(const this) {
    return Point(this.point.x);            // a fresh, mutable object copying a number
  }

  Point named(const this) {
    Point r = Point(this.point.x + 1);     // fresh as well; naming it changes nothing
    return r;
  }
}

export i32 freshResults() {
  const Holder h = Holder(Point(3));
  Point p = h.fresh();                     // accepted: the result is not reached through h
  p.x = 7;

  // ERROR: access through h is const
  // h.point.x = 7;

  return p.x + (h.named().x - 3);          // 7 + 1
}
```

`[§wac-const-fresh-not-const-z47khm7]` A value a function allocates is not `const` because the function took a
`const` receiver or parameter. Only a reference reached through a `const` one is.

Returning an existing reference reached through a const field must preserve its constness. Allocating a new
container does not make the references it contains mutable: a fresh array holding `this.point` still holds a
`const` reference.

## Const is part of a reference's type

`const T` is the type of a `const` reference to a `T`. A `T` widens to a `const T`; a `const T` never
becomes a `T`:

```wac
// expect: answers widening = 1
struct S { i32 v; }

void mutate(S s) { s.v = 1; }
i32 peek(const S s) { return s.v; }

export i32 widening() {
  S s = S(0);
  const S c = s;                           // S widens to const S
  i32 a = peek(s);                         // a mutable reference is accepted where const is wanted

  // ERROR: a const S cannot be passed where an S is expected
  // mutate(c);

  // ERROR: a const S cannot be assigned to an S
  // S back = c;

  mutate(s);                               // s itself is still mutable: c now reads 1
  fn<i32(const S)> reader = peek;
  return reader(c) + a;                    // 1 + 0
}
```

`[§wac-const-widen-f6ivrbe]` A reference of type `T` converts to `const T`.

`[§wac-const-no-launder-t584c4n]` A `const T` does not convert to `T` — not by assignment, not by passing it to a
parameter, and not through a function value — so no path writes through a `const` reference.

`const` appears in function types as it does in parameter lists, so a function value carries the same
promise as the function. How it interacts with arrays and unions — outer `const` restricts access without
making arrays covariant, and a union records the permission each value arrived with — is
[18](18-unions.md)'s subject and [32](../5-inference/32-widening.md)'s.

## Const parameters

A parameter may be `const`, which forbids reassigning it and, for a reference, writing through it:

```wac
// expect: answers twoParams = 2
struct P { i32 v; }

i32 peek(const P p) { return p.v; }

export void bad(const P p) {
  // ERROR: cannot write through a const reference
  // p.v = 1;

  // ERROR: cannot assign to const parameter 'p'
  // p = P(2);
}

i32 mixed(const P a, P b) {
  b.v = a.v;                               // the mutable one is unaffected
  return b.v;
}

export i32 twoParams() { return peek(P(1)) + mixed(P(1), P(0)); }
```

`[§wac-const-param-2vhk7dq]` Reads through a `const` parameter compile, and writing through it or
reassigning it is refused, for any parameter type. It applies per parameter.

This is the guarantee `const this` gives a receiver ([12](12-structs.md)), and the two compose:
`i32 m(const this, const P p)`.

## A const struct

A `const struct` has only `const` fields, so no reference to one was ever writable — `const` or not
([12](12-structs.md)).
