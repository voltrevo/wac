# 11 — Never and uninhabited types

Two types have no values. `void` is the type of a function that answers nothing; `never` is the type
of an expression that does not complete normally. Beyond those two, a type that no finite value can
inhabit is still a valid type.

## `void` answers nothing

```wac
// expect: emits
void greet() { }

export void caller() {
  greet();

  // ERROR: void has no values to store
  // auto nothing = greet();

  // ERROR: void cannot be nullable
  // void? maybe = null;
}
```

`[§wac-void-no-values-uieaw93]` `void` has no values: it cannot be the type of a local, a field, a
parameter or an element, and it cannot be made nullable.

What a `void` function may write in its body — `return;`, or nothing — is
[20](20-functions-and-funcrefs.md)'s subject.

## `never` does not complete normally

A call whose type is `never` does not return to its caller. Since no value ever arrives, a `never`
expression may stand where any type is expected:

```wac
// expect: answers pick(true) = 1
export i32 pick(bool b) {
  if (b) { return 1; }
  return spin();                           // never satisfies i32
}

never spin() {
  while (true) { }
}
```

`[§wac-never-satisfies-any-pp3fvr6]` A `never` expression is accepted wherever a value of any type is
expected.

```wac
// expect: emits
export never spin() {
  while (true) { }
}

// ERROR: a never function cannot return
// export never early(bool once) {
//   if (once) { return; }
//   while (true) { }
// }
```

`[§wac-never-cannot-return-eaffw52]` A `never` function may not return, and control may not reach its end.

A return type constrains normal completion; it does not promise termination. A trap is not normal
completion, so a function that always traps or loops forever is a valid `never` function:

```wac
// expect: emits
export never fail(string why) { trap why; }

export never forever() { return forever(); }   // a normally returning call needs its inner call
                                               // to have returned first, indefinitely
```

Code after a call that cannot return is unreachable, and an implementation may warn about it:

```wac
// expect: emits
never spin() {
  while (true) { }
}

void more() { }

export void example() {
  spin();
  more();                                  // may warn: unreachable — spin() does not return
}
```

`[§wac-never-unreachable-may-warn-5cnwyt5]` An implementation may warn that code following a `never`
expression is unreachable. Unreachable code is still checked, and an explicit `return` there is still
checked against the function's type ([34](../5-inference/34-recursive-inference.md)).

`null` is `never?`: absent, and with nothing it could hold if it were present
([10](10-nullability.md)).

## Uninhabited types are valid

A recursive type can be such that no finite value inhabits it. That does not make it invalid:

```wac
// expect: answers emptyIsNull = true
struct X { Y y; }
struct Y { X x; }

static X? EMPTY = null;                    // allowed, though X has no value

export bool emptyIsNull() { return EMPTY is null; }
```

```wac
// expect: answers none = null
struct Node { Node next; }                 // a mandatory field of its own type

export Node? none() { return null; }
```

`[§wac-uninhabited-valid-2f9cxmt]` A type that no finite value can inhabit — such as a struct with a
non-null field that reaches the struct again — is a valid type. It may appear in nullable forms, in
type computations and in signatures. An implementation may warn about it.

Recursive types can become uninhabitable in non-obvious ways, but they can still participate in type
computations or be used in nullable forms that can only hold `null`.

Nothing manufactures a value of an uninhabited type. In particular there is no default to construct
one from:

```wac
// expect: answers emptyNodes = 0
struct Node { Node next; }

export i32 emptyNodes() {
  // ERROR: Node has no default value
  // Node[] some = Node[].defaulted(1);

  Node[] none = Node[]();                  // an empty array needs no element
  return none.len();
}
```

`[§wac-uninhabited-no-default-kp853d4]` A struct whose fields cannot all be defaulted has no default value,
so an uninhabited struct cannot be default-constructed — by an array factory, or by any other path
that fills in missing values. A local of such a type can be declared, and stays unassigned
([08](08-primitives.md)).

A type is only finitely constructible if some path to building it ends. An optional field, an empty
collection, or another variant is such an end; a mandatory field of the type itself is not.
Recursion through a nullable field, a tuple or an enum is allowed precisely because it provides one:

```wac
// expect: answers secondHead = 2
struct List { i32 head; List? tail; }      // ends at null

export i32 secondHead() {
  List l = List(1, List(2, null));
  return l.tail!.head;
}
```

## A variant with a `never` payload is uninhabited

```wac
// fragment — from core
enum Step<W, Y, R> {
  Waiting(W ticket),
  Yielded(Y value),
  Done(R result)
}
```

A variant with a required `never` payload is uninhabited. This is a general enum rule, not a coroutine
exception, and an exhaustive `match` need not cover such a variant:

```wac
// expect: answers yieldedFour = 4
import { Step } from "core";

i32 value(Step<never, i32, never> s) {
  match (s) {
    Yielded(v): { return v; }
  }                                        // exhaustive: Waiting and Done are impossible
}

export i32 yieldedFour() { return value(Step.Yielded(4)); }
```

`[§wac-never-payload-uninhabited-c4j35nq]` A variant with a payload of type `never` has no values, and a
`match` that omits it is still exhaustive.

`[§wac-never-variant-not-constructible-u5dxnv8]` Constructing a variant whose payload has no values is
refused in every spelling — with an argument, or with none.

```wac
// expect: emits
import { Step } from "core";

export void constructible() {
  // ERROR: Step.Waiting carries a never payload, which has no value
  // Step<never, i32, i32> a = Step.Waiting;

  Step<never, i32, i32> b = Step.Done(1);
}
```

`R = never` is valid for an infinite generator. `R = void` permits completion and gives a payload-free
`Done` ([36](../6-concurrency/36-coroutines-and-generators.md)).
