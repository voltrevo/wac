# 29 — Static dependencies

Static evaluation is demand-driven. A computation runs when something needs its result, and the computations a
program demands must form a directed acyclic graph. Dependencies concern computations, not all references
between types: a type may refer to itself, and a value may not be computed from itself.

## Opaque identities may precede definitions

```wac
// fragment
struct Node {
  i32 value;
  Optional<Node> next;
}

type Optional<T> {
  return typeref(T).pushNull();
}
```

Constructing `Node?` needs the opaque identity of `Node`, not its completed fields. Recursive types are allowed;
circular computations are not.

Types are lazily evaluated. Using a type opaquely does not compute it; an operation that needs to know what it
is demands its completion. Demanding completion already in progress is an error. Embedding an opaque reference is
not such a demand.

Completion is shallow: a type can contain references to incomplete types. Completion happens on demand, including
during other type computations; it does not recursively complete every referenced type.

```wac
// expect: answers secondValue = 2
type Optional<T> {
  return typeref(T).pushNull();
}

struct Node {
  i32 value;
  Optional<Node> next;                     // Node? — needs only Node's identity
}

export i32 secondValue() {
  Node n = Node(1, Node(2, null));
  return n.next!.value;
}
```

`[§wac-static-dep-opaque-d5e7nj4]` A type may refer to a type whose definition is still being computed, as long as
nothing demands that type's completed structure. Embedding a reference to it is not a demand.

## Unwrapping does not complete the inner type

```wac
// fragment
type X = (i32, Y, Z?);

type Y {
  return typeref(X).pushNull();
}

type Z {
  return typeref(Y).popNull();
}
```

`pushNull()` wraps opaque `X`. `popNull()` demands `Y`'s result to discover its nullable wrapper, then returns
opaque `X` without completing it. `X`'s tuple can also hold opaque element types. The resulting type graph is
`(i32, X?, X?)`; the computation dependencies are acyclic.

`[§wac-static-dep-popnull-5b47456]` `popNull` demands the computation of the type it is given, to find its outer
nullable layer, and answers the inner type without completing it.

## Recursion must pass through an aggregate

Following aliases and nullable wrappers must not lead back to the same type. A tuple, struct, enum, or
non-collapsed union aggregate ends this traversal; its member types are checked separately. Singleton unions do
not guard recursion ([18](../2-types/18-unions.md)).

```wac
// fragment
type X = X?; // ERROR
```

```wac
// fragment
type X = X??; // ERROR
```

```wac
// fragment
type Y = Z;
type Z = Y?; // ERROR: cycle through aliases and nullability
```

```wac
// fragment
type W = (W?,); // Allowed: recursion through a tuple.
enum X { A(X?), } // Allowed: recursion through an enum.
```

```wac
// expect: emits
export type W = (W?,);                     // through a tuple
export enum E { A(E? next) }               // through an enum

// ERROR: X is its own nullable — a cycle through nullability alone
// export type X = X?;

// ERROR: a cycle through nullability alone
// export type X2 = X2??;
```

A cycle may run through more than one alias:

```wac
// expect: refused
export type Y = Z;                         // a cycle through an alias and nullability
export type Z = Y?;
```

`[§wac-static-dep-recursion-guard-va5yec4]` A type declaration whose definition reaches itself through aliases and
nullable layers alone is refused. Recursion through a tuple, struct, enum or multi-alternative union is allowed.

`type X = X?` would denote a type that is its own nullable, which no finite type is: a nullable layer is a flag on
a value, and there is nothing in the cycle for it to be a flag on.

Uninhabitable types are valid ([11](../2-types/11-never-and-uninhabited.md)). Recursive types can become
uninhabitable in non-obvious ways, but they can still participate in type computations or be used in nullable
forms that can only hold `null`.

## Structural reflection demands completion

Reflection on a declaration requires its completed structure, even for a query that only asks for field names.
There are no partial-reflection exceptions.

```wac
// fragment — an illustrative reflection API, not an established spelling
struct Node {
  type(pickBasedOnFields(typeref(Node))) value;
}
```

If `pickBasedOnFields` requires `Node`'s completed structure, completing `value` requires itself: reject. Asking
only for field names does not avoid that demand.

`[§wac-static-dep-reflection-completes-49awhfs]` A computation that inspects a declaration's structure demands its
completion. A declaration whose completion demands an inspection of itself is refused.

## Checking a reference is not reading its value

```wac
// fragment
static i32 COPY = getAnswer();  // 42

i32 getAnswer() { return ANSWER; }

static i32 ANSWER = 42;
```

The declared type of `ANSWER` suffices to check the return expression. Executing `getAnswer` then requests its
value. Source order does not impose evaluation order. The idiom is main declarations first, supporting
declarations afterward. This is a reading order, not an evaluation order.

```wac
// fragment — module scope
static i32 TWO = ONE + ONE; // 2
static i32 ONE = 1;
```

Forward references are valid. This demonstrates legality, not a preferred ordering for a sequence of constants.
Static locals have the same ordering freedom within their scope; ordinary locals retain statement ordering.

```wac
// fragment
i32 example() {
  static i32 TWO = ONE + ONE;
  static i32 ONE = 1;
  return TWO;
}
```

```wac
// expect: answers copy = 42
// expect: answers two = 2
static i32 COPY = getAnswer();             // 42, though ANSWER is declared below

i32 getAnswer() { return ANSWER; }

static i32 ANSWER = 42;

static i32 TWO = ONE + ONE;
static i32 ONE = 1;

export i32 copy() { return COPY; }
export i32 two() { return TWO; }
```

`[§wac-static-dep-order-free-au43dhv]` Source order does not decide evaluation order: a static may read one declared
after it, directly or through a function, and is evaluated after what it reads.

```wac
// fragment
static i32 ANSWER = getAnswer();

i32 getAnswer() { return ANSWER; }
// ERROR: ANSWER's value -> getAnswer() -> ANSWER's value
```

```wac
// expect: refused
static i32 ANSWER = getAnswer();

i32 getAnswer() { return ANSWER; }

export i32 answer() { return ANSWER; }
```

`[§wac-static-dep-cycle-ucebvke]` A static whose value is demanded, however indirectly, by its own evaluation is
refused, and the diagnostic gives the chain of demands.

## A signature cannot require execution that requires that signature

```wac
// fragment
type(resultType()) make() { return 1; }

typeref resultType() {
  make();
  return typeref(i32);
}
// ERROR: computing make's return type requires checking/executing a call to make
```

Do not execute unchecked code to guess a way out of the cycle.

`[§wac-static-dep-signature-cycle-ektxy8g]` A signature whose computation requires checking or executing a call to the
function it describes is refused.

## An unexecuted path need not be a value dependency

```wac
// fragment
static i32 A = choose(true);
static i32 B = A + 1;

i32 choose(bool first) {
  if (first) { return 7; }
  return B;
}
// A == 7; B == 8. Both compile.
```

Checking `choose` needs `B`'s type; this invocation never reads `B`'s value.

```wac
// expect: answers a = 7
// expect: answers b = 8
static i32 A = choose(true);
static i32 B = A + 1;

i32 choose(bool first) {
  if (first) { return 7; }
  return B;
}

export i32 a() { return A; }
export i32 b() { return B; }
```

`[§wac-static-dep-demand-erw7x5a]` A dependency is a value actually read during evaluation, not a name merely
mentioned on a path that does not run.

```wac
// fragment
static i32 A = choose(true);
static i32 B = B;

i32 choose(bool first) {
  if (first) { return 7; }
  return B;
}

export i32 a() { return A; }
// Computing A succeeds with 7.
// Overall compilation fails: B survives reachability and its value is cyclic.
```

```wac
// expect: refused
static i32 A = choose(true);
static i32 B = B;

i32 choose(bool first) {
  if (first) { return 7; }
  return B;
}

export i32 a() { return A; }
```

Demand determines dependency order, not whether a retained declaration must compile. `B` is retained — `choose`
mentions it — so it must evaluate, and it cannot ([05](../1-programs/05-reachability.md)).

## Generic checking

All branches of a static conditional in a template receive the ordinary opaque-parameter definition check; only
selected static branches receive instantiation-time checking ([19](../2-types/19-generics.md),
[31](31-static-control.md)).
