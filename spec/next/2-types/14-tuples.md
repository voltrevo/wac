# 14 — Tuples

A tuple is a fixed-length sequence of values whose types may differ. Its type is the ordered list of
its member types, written in parentheses.

## A tuple is a fixed-length heterogeneous type

```wac
// expect: answers secondMember = 1
export i32 secondMember() {
  (string, i32) pair = ("a", 1);
  string first = pair.0;                   // "a"
  i32 second = pair.1;                     // 1
  return second;
}
```

`[§wac-tuple-members-mef8e82]` A tuple value is written `(a, b, …)`, and its type `(A, B, …)`. `t.0`, `t.1`, …
read its members by position, each at its own type.

Identity is the ordered list of member types, so a tuple type written in two places is one type:

```wac
// expect: answers totalOfMade = 3
(i32, i32) make() { return (1, 2); }
i32 total((i32, i32) t) { return t.0 + t.1; }

export i32 totalOfMade() { return total(make()); }   // two spellings, one type
```

`[§wac-tuple-structural-wq9swfa]` Two tuple types are the same type exactly when they have the same member
types in the same order.

That makes the tuple the only structural type in the language, and the smallest one it could have — an
anonymous struct would add names, and with them width and order.

## Tuples of zero and one

```wac
// expect: answers oneTupleMember = 1
export i32 oneTupleMember() {
  ()         unit = ();
  (i32,)     one  = (1,);
  string     s    = ("a");                 // grouping, not a 1-tuple
  (i32, i32) two  = (1, 2,);               // the trailing comma means nothing here
  return one.0;
}
```

`[§wac-tuple-zero-one-fhcjtvh]` `()` is the empty tuple and `(x,)` a tuple of one. `(x)` is `x` in
parentheses, not a tuple.

`()` is a value of a type with no members, the way `null` is a value rather than the absence of a type
— `void` is the one that means *no value* ([11](11-never-and-uninhabited.md)). A trailing comma is
accepted wherever a list is, and carries meaning only at length one.

## A member index must be known statically

```wac
// expect: answers staticSelect = 7
export i32 staticSelect() {
  (string, i32) t = ("hello", 7);
  static i32 i = 1;

  string a = t.0;                          // string
  i32 b = t.[i];                           // i32: the selector is static

  i32 runtimeIndex = 1;

  // ERROR: a tuple selector must be known statically
  // i32 c = t.[runtimeIndex];

  return b;
}
```

`[§wac-tuple-static-index-axfrq5b]` `t.[e]` selects a member by an integer that must be known statically —
a literal or a static declaration. A runtime selector is refused.

The member's type depends on the index, so the index has to be known when the program is checked. A
`static_for` loop makes an index static in each iteration it unrolls
([31](../4-static/31-static-control.md)):

```wac
// expect: answers sameAsLiteral = true
// expect: answers sameAsOther = false
bool same<Ts>(Ts a, Ts b) {
  static_for (i32 i = 0; i < typeref(Ts).members().len(); i++) {
    if (a.[i] != b.[i]) { return false; }  // a string at 0, an i32 at 1
  }
  return true;
}

export bool sameAsLiteral() {
  (string, i32) p = ("a", 1);
  return same(p, ("a", 1));                // Ts is (string, i32), from p
}

export bool sameAsOther() {
  (string, i32) p = ("a", 1);
  (string, i32) q = ("a", 2);
  return same(p, q);
}
```

`.[]` is the same selection a symbol-named member uses ([21](21-symbols.md)): an integer selects a tuple
member, a symbol selects a symbol-named member.

## A tuple is a reference

```wac
// expect: answers sharedTuple = 5
export i32 sharedTuple() {
  (i32, i32) a = (1, 2);
  (i32, i32) b = a;
  b.0 = 5;
  return a.0;                              // 5: one object, two names
}
```

`[§wac-tuple-reference-qvgasjf]` A tuple is a reference: assigning one shares it, and its members can be
written.

`==` compares members; `is` compares objects:

```wac
// expect: answers membersEqual = true
// expect: answers sameObject = false
export bool membersEqual() {
  (i32, i32) a = (1, 2);
  (i32, i32) b = (1, 2);
  return a == b;                           // the members are equal
}

export bool sameObject() {
  (i32, i32) a = (1, 2);
  (i32, i32) b = (1, 2);
  return a is b;                           // two objects
}
```

`[§wac-tuple-equality-9cjg4r6]` `a == b` on two tuples of one type compares their members in order with
`==`, and is defined when every member type has `==`. `a is b` compares identity.

## Taking a tuple apart

A declaration may bind a tuple's members directly. Four spellings declare the same two locals:

```wac
// fragment — four spellings of one declaration, which collide if written together
(u32 q, u32 r)    = divmod(n, d);
(u32, u32) (q, r) = divmod(n, d);
auto (q, r)       = divmod(n, d);
(auto q, auto r)  = divmod(n, d);
```

```wac
// expect: answers quotient = 3
(u32, u32) divmod(u32 n, u32 d) { return (n / d, n % d); }

export i32 quotient() {
  (u32 q, u32 r) = divmod(17, 5);          // q = 3, r = 2
  ((i32 a, i32 b), i32 c) = ((1, 2), 0);   // nested
  return q as! i32;
}
```

`[§wac-tuple-destructure-gn8i48y]` `(T a, U b) = e` declares one local per member of the tuple `e`, and the
pattern may nest.

Without types, the same shape assigns to locals that already exist — the form a round function wants:

```wac
// expect: answers swapped = 21
(u32, u32) swap(u32 a, u32 b) { return (b, a); }

export i32 swapped() {
  u32 a = 1;
  u32 b = 2;
  (a, b) = swap(a, b);                     // existing locals, not a declaration
  return (a * 10 + b) as! i32;
}
```

`[§wac-tuple-assign-vmhww2b]` `(a, b) = e` assigns the members of `e` to existing locals, in order.

## Building a tuple member by member

A tuple local may be declared without an initialiser and have each member assigned once, which is how a
tuple of computed type is filled:

```wac
// fragment — Unwrapped<Ts> is a computed type; see 30
Unwrapped<Ts> unwrapAll<Ts>(Ts t) {
  Unwrapped<Ts> out;                       // members unassigned
  static_for (i32 i = 0; i < typeref(Ts).members().len(); i++) {
    out.[i] = t.[i]!;
  }
  return out;
}
```

`[§wac-tuple-member-assign-once-cwgrkf2]` A tuple local declared without an initialiser has unassigned
members; each must be assigned before the tuple is used.

A tuple cannot be accumulated instead: an accumulator has one type, and a tuple built one member at a
time has a different one at every step. Computed tuple types are
[30](../4-static/30-computed-types.md)'s subject.

## A variadic parameter is a tuple the call site fills

```wac
// expect: answers countTwo = 2
// expect: answers countOne = 1
// expect: answers countZero = 0
i32 count<Ts>(Ts ...items) {
  return typeref(Ts).members().len();
}

export i32 countTwo() { return count(1 as i32, "a"); }    // Ts is (i32, string)
export i32 countOne() { return count(1 as i32); }         // Ts is (i32,)
export i32 countZero() { return count(); }                // Ts is ()
```

`[§wac-variadic-tuple-sfevn82]` A parameter written `Ts ...name` receives the remaining arguments as one
tuple, whose type `Ts` is inferred from them. There is at most one, and it is last.

The marker hugs the name because it is the binding that receives the packed arguments — the type is a
tuple either way. Zero and one need no special handling, since `()` and `(T,)` are ordinary tuples.

## A required optimisation

A function that returns a tuple may be compiled to return its members instead. When it is, a caller that
destructures the result immediately, or reads a single member of it, builds no tuple.

A function **must** be compiled this way when all of these hold:

1. It is synchronous (not `async`).
2. The returned tuple is created inside it.
3. Nothing is given a chance to hold a reference to that tuple after the call.
4. Some caller destructures the result or reads a single member of it.

Doing it under other conditions is permitted, not required.

Being an optimisation, it changes nothing a program can observe. Where the two forms would differ, the
optimised function is wrapped in one that returns a tuple, and the wrapper is what is used: an exported
function's signature comes from its declared types, and a function value refers to the wrapper, so two
values of one function stay equal. Requiring it lets performance-sensitive code rely on returning several
values without allocating.
