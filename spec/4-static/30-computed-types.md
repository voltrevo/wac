# 30 — Computed types

Type logic is ordinary wac. `typeref` is a type whose values stand for types; a function over one is a function
like any other, run by static evaluation. `typeref(T)` turns a type into a value, and `type(…)` turns a value
back into a type.

## `typeref` and `type(…)`

```wac
// fragment
typeref slot(typeref t) {
  return t.isRef() && !t.isNullable() ? t.pushNull() : t;
}

type Slot<T> = type(slot(typeref(T)));
```

`typeref` is a type and `slot` a function; neither is a second language. `typeref(T)` names a type, `type(…)`
binds the type a `typeref` names, and `pushNull` adds one level of nullability rather than ensuring it — `?` does
not flatten, so neither does the method standing for it.

```wac
// expect: nodeSlotHoldsNull() = true
// expect: i32Slot() = 5
struct Node { i32 v; }

typeref slot(typeref t) {
  return t.isRef() && !t.isNullable() ? t.pushNull() : t;
}

type Slot<T> = type(slot(typeref(T)));

export bool nodeSlotHoldsNull() {
  Slot<Node> a = null;                     // Node?
  return a is null;
}

export i32 i32Slot() {
  Slot<i32> b = 5;                         // i32: not a reference, left alone
  return b;
}
```

`[§wac-typeref-value-eirzxbw]` `typeref(T)` is a value of type `typeref` standing for the type `T`, and `type(e)` is the
type that the `typeref` value `e` stands for. `e` is evaluated statically.

`type(…)` is the only expression a type position takes:

```wac
// expect: holderLength() = 2
typeref slot(typeref t) { return t.pushNull(); }

struct Holder<T> {
  // ERROR: expected a type — write type(slot(typeref(T)))
  // slot(typeref(T))[] wrong;

  type(slot(typeref(T)))[] data;
}

export i32 holderLength() {
  Holder<i32> h = Holder(i32?[].defaulted(2));   // data is i32?[]
  return h.data.len();
}
```

`[§wac-type-expr-only-vsprvyh]` In a type position, an expression must be written inside `type(…)`. A bare call there
is refused.

## Operations on a `typeref`

A `typeref` supports the operations the language's own rules are written in:

```wac
// expect: typerefOps() = true
struct Node { i32 v; }

bool check() {
  typeref a = typeref(i32);
  typeref b = typeref(Node);

  bool refs = !a.isRef() && b.isRef();
  bool nulls = b.pushNull().isNullable() && !b.isNullable();
  bool roundTrip = b.pushNull().popNull() == b;
  bool members = typeref((i32, string)).tupleMembers().len() == 2;
  bool same = typeref(Node) == b && typeref(Node?) == b.pushNull();
  bool built = typeref.tuple([a, b]) == typeref((i32, Node));
  return refs && nulls && roundTrip && members && same && built;
}

static bool OK = check();                  // evaluated by the compiler

export bool typerefOps() { return OK; }
```

`[§wac-typeref-ops-u2h77nf]` A `typeref` supports `pushNull()` (one more nullable layer), `popNull()` (one fewer),
`isNullable()`, `isRef()`, `tupleMembers()` (a tuple's member types, as a `typeref[]`) and `==` (the same type).

`[§wac-typeref-tuple-68c06fi]` `typeref.tuple(ts)` is the tuple type whose members are the types in `ts`, in order:
the inverse of `tupleMembers()`.

`tupleMembers` names its subject because a struct's fields are members too, and asking a type for those is not
decided (Open, below). `typeref.tuple` is called on `typeref` itself, as `string.fromBytes` is called on `string`, so
building a tuple type takes no keyword ([14](../2-types/14-tuples.md)).

`pushNull` and `popNull` respect opaque identity and laziness ([29](29-static-dependencies.md)): `pushNull` need
not inspect its operand at all, and `popNull` demands only enough to find the outer layer.

## `typeof` names the type of an expression

`typeof(e)` is the static type of `e`, in a type position. `e` is checked and never evaluated, so it may call
anything — a function that traps, one that needs a capability — and nothing happens.

```wac
// expect: answerIsI32() = true
// expect: notRun() = 0
import { Ticket, hypothetical } from "core";

type Later<A> = Ticket<A>;
type Answer<T> = typeof(hypothetical<T>().value());

bool check() {
  bool direct = typeref(Answer<Ticket<i32>>) == typeref(i32);
  bool aliased = typeref(Answer<Later<i32>>) == typeref(i32);   // the type, not its spelling
  return direct && aliased;
}

static bool OK = check();

export bool answerIsI32() { return OK; }

struct Count { i32 n = 0; }
i32 bump(Count c) { c.n++; return c.n; }

export i32 notRun() {
  Count c;
  typeof(bump(c)) n = 5;                   // i32; bump is not called
  return c.n + n - 5;
}
```

`[§wac-typeof-cxgjqjz]` `typeof(e)` is a type: the static type of the expression `e`. It is allowed wherever a type is.

`[§wac-typeof-unevaluated-driz39r]` The operand of `typeof` is checked but not evaluated, and nothing it calls is run.

A type known through an expression is known whatever spelling reached it: `Later<i32>` and `Ticket<i32>` are one
type, so `Answer` agrees on them. A question asked of the spelling — "what are this generic's arguments" — would
not, which is why there is no such operation.

`hypothetical<T>()`, from `core` ([37](../7-library/37-core.md)), is how to have an expression of a type with no
value in hand. It traps if called, and inside `typeof` it never is.

A computed type can map a tuple's members through it. `core`'s `Values` is the tuple of what each of a tuple of
tickets answers, which `Ticket.all` returns ([35](../6-concurrency/35-tickets-and-await.md)):

```wac
// fragment — from core
type Values<Ts> {
  Vec<typeref> out;
  for (typeref t in typeref(Ts).tupleMembers()) {
    out.push(typeref(typeof(hypothetical<type(t)>().value())));
  }
  return typeref.tuple(out.toArray());
}
```

A type body is all static evaluation, so an ordinary `for` over the members is enough, and `type(t)` reads a value
that is static there.

## Computed type declaration bodies

A named type declaration may contain a computation returning `typeref`.

```wac
// fragment
type Foo<T> {
  auto t = typeref(T);
  return t.pushNull();
}

Foo<i32> value = null; // Foo<i32> is i32?
```

The body executes ordinary wac with the generic parameters in scope. `return` supplies the `typeref` whose
represented type is the declared type. No separately named helper is needed.

The existing expression form remains available:

```wac
// fragment
type Foo<T> = type(typeref(T).pushNull());
```

Both forms use the same static evaluation ([28](28-static-evaluation.md)), dependency rules and two-pass generic
checking ([29](29-static-dependencies.md), [19](../2-types/19-generics.md)).

```wac
// expect: sameType() = true
type Foo<T> {
  auto t = typeref(T);
  return t.pushNull();
}

type Bar<T> = type(typeref(T).pushNull());

export bool sameType() {
  Foo<i32> a = null;                       // i32?
  Bar<i32> b = a;                          // the same type
  return b is null;
}
```

`[§wac-type-body-vqjqgvr]` `type Name<…> { … }` declares a type whose body runs statically with the type parameters in
scope; the `typeref` it returns is the type. `type Name<…> = type(e);` is the same with an expression.

This syntax belongs to named type declarations. It introduces neither anonymous `type { ... }` expressions nor
general block expressions or implicit invocation of ordinary blocks.

## A plain alias

A type declaration may simply name another type:

```wac
// expect: sumOfOneAndTwo() = 3
type Pair = (i32, i32);

i32 sum(Pair p) { return p.0 + p.1; }

export i32 sumOfOneAndTwo() { return sum((1, 2)); }
```

`[§wac-type-alias-e4gvipb]` `type Name = T;` makes `Name` another spelling of `T`: the same type, not a new one.

An alias may not reach itself through other aliases and nullable layers alone
([29](29-static-dependencies.md)).

## Open

- **`typeref` at run time.** Every use above is in static evaluation. Whether a `typeref` value may exist at run
  time — be stored in an ordinary local of a function that runs, or returned from one — is not decided.
- **Fine-grained type reflection.** Beyond the operations listed above — which the language's own rules are
  written in — the reflection API (field names and types, method lists, and so on) is not decided. Any such
  query demands the reflected declaration's completion ([29](29-static-dependencies.md)), and reports private fields
  by name and type without giving access to their values ([12](../2-types/12-structs.md), `wac-private-reflection`).
