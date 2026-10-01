# 19 — Generics

A struct, an enum, a function or a method may take type parameters. A generic declaration is a
**template**; each distinct set of type arguments makes an **instantiation**, which is an ordinary type or
function. Nothing is asked of a type parameter: there are no constraints, and a template is checked once
with its parameters opaque and again at each instantiation.

## Generic structs

```wac
// expect: answers main = 30
struct Vec<T> {
  T[] data;
  i32 n;

  void push(this, T v) {
    T[] grown = T[].filled(this.n + 1, v);
    grown.copyFrom(this.data, 0, 0, this.n);
    this.data = grown;
    this.n++;
  }

  T get(const this, i32 i) { return this.data[i]; }
}

struct P { i32 v; }

export i32 main() {
  Vec<i32> v = Vec([], 0);
  v.push(10);
  v.push(20);
  Vec<P> ps = Vec([], 0);
  ps.push(P(0));
  return v.get(0) + v.get(1) + ps.get(0).v;
}
```

`[§wac-generic-struct-9tkq4wm]` A generic struct is instantiated for each set of type arguments it is used
with — a primitive, a struct, an enum or any other type — and each instantiation is a separate type. Two
instantiations are unrelated unless their arguments are identical.

Each instantiation has its own concrete representation, which is why a type parameter may be a primitive:
`Vec<i32>`'s array is a real `i32[]`, not an array of boxed references. And two instantiations are
**invariant** — `Vec<Rect>` is not a `Vec<Shape>`, since a mutable container cannot be covariant soundly:

```wac
// expect: emits
struct Box<T> { T v; }
struct Shape { i32 x; }
struct Square : Shape { i32 side; }

export i32 main() {
  Box<Square> b = Box(Square(1, 2));

  // ERROR: Box<Square> is not a Box<Shape>
  // Box<Shape> s = b;

  return 0;
}
```

### Type arguments come from the slot

A construction of a generic struct takes its type arguments from where its value goes:

```wac
// expect: answers main = 0
struct Vec<T> { T[] data; i32 n; i32 len(const this) { return this.n; } }
struct Holder { Vec<i32> v; }

void take(Vec<i32> v) {}

export i32 main() {
  Vec<i32> v = Vec([], 0);                 // a declaration
  v = Vec([], 0);                          // an assignment
  Holder h = Holder(Vec([], 0));           // a construction's argument
  h.v = Vec([], 0);                        // a field
  take(Vec([], 0));                        // a call's argument
  Vec<i32>[] all = [Vec([], 0)];           // an array's elements
  bool c = true;
  Vec<i32> t = c ? Vec([], 0) : Vec([], 0);   // both branches of a ternary

  // ERROR: nothing says what T is
  // i32 n = Vec([], 0).len();

  return v.len();
}
```

`[§wac-generic-expected-position-3qmz8vk]` A generic construction takes its type arguments from the type
expected where it is written: a declaration, an assignment, a field, an argument, an array element, a
ternary branch.

A construction whose value goes nowhere in particular — a discarded expression, or the receiver of a call —
has no expected type, and the fix is the two statements idiomatic wac already writes. Receiver position is the
one place that cannot be rewritten that way, so there an instantiation may be written out:

```wac
// expect: answers main = 34
struct Cell<T> {
  T v;
  Cell<T> of(T v) { return Cell(v); }
  T get(const this) { return this.v; }
}

enum Maybe<T> {
  Just(T v), Absent

  T orElse(const this, T d) {
    return match (this) {
      Just(v): v,
      Absent:  d,
    };
  }
}

export i32 main() {
  i32 a = Maybe<i32>.Just(4).orElse(0);
  i32 b = Maybe<i32>.Absent.orElse(7);
  i32 c = Cell<i32>.of(23).get();
  return a + b + c;
}
```

`[§wacc-written-instantiation]` `Ty<Args>` may be written as the object of a `.` — to construct a variant or
call a method that takes no receiver. It is an expression only there, so it is always followed by a member
name.

### Angle brackets

`IDENT <` is ambiguous with less-than. The parse tries the type reading, and commits to it if it succeeds,
whatever follows:

```wac
// expect: answers main = 0
i32 g(bool a, bool b) { return 0; }

export i32 main() {
  i32 a = 1; i32 b = 2; i32 c = 3; i32 e = 4;

  // ERROR: type arguments, and a value cannot follow them
  // i32 r = g(a < b, c > e);

  return g((a < b), c > e);                // two comparisons, as written
}
```

`[§wacc-type-args-commit]` `IDENT < … >` that parses as a type argument list is one. A program that means
the comparison parenthesises the first comparison.

What decides whether it parses is whether the span between the angles can be a type: names, `fn<…>`, `[]`,
`?`, nested angle brackets and commas, and nothing else. A literal, an operator or a keyword means the `<`
was a comparison all along — and an angle inside parentheses or brackets closes nothing:

```wac
// expect: answers main = 1
i32 inRange(i32 n, i32 cap) {
  if (n < 0 || n > (cap + 1)) { return 1; }   // `0 || n` is not a type
  return 0;
}

export i32 main() {
  i32 a = 8;
  i32 shifted = a < (a >> 1) ? 0 : 1;      // the >> is in parentheses: a shift
  return inRange(5, 9) + inRange(-1, 9) * shifted;
}
```

`[§wac-generic-lt-ambiguity-k8fm3wq]` A `<` whose span to a matching `>` cannot be a type list is a
comparison: `inRange(5, 9)` answers `0` and `inRange(-1, 9)` answers `1`.

## Generic enums

```wac
// expect: answers main = 13
enum Option<T> {
  Some(T v), None

  T orElse(const this, T d) {
    return match (this) {
      Some(v): v,
      None:    d,
    };
  }
}

export i32 main() {
  Option<i32> a = Option.Some(4);
  Option<i32> b = Option.None;
  return a.orElse(0) + b.orElse(9);
}
```

`[§wac-generic-enum-7dkq2mv]` An enum may take type parameters. A variant construction takes the enum's
arguments from the expected type, as a struct construction does, or from a written instantiation.

A generic enum's variants have no bare name. `Option<i32>` and `Option<f64>` would both claim `Some`, and
neither has a better claim:

```wac
// expect: answers main = 1
enum Option<T> { Some(T v), None }

export i32 main() {
  Option<i32> a = Option.Some(1);

  // ERROR: Some is a variant of the generic Option, and has no name of its own
  // Some s = a;

  return match (a) {                       // match resolves it through the subject
    Some(v): v,
    None:    0,
  };
}
```

`[§wac-generic-enum-no-bare-variant-x357xsq]` A variant of a generic enum is not a top-level name: it cannot be
written as a type or tested with a bare `is`. `match` reaches it through the subject's type.

## Generic functions

```wac
// expect: answers main = 10
T max<T>(T a, T b) { return a > b ? a : b; }

export i32 main() {
  i32 x = 3;
  i32 y = 7;
  f64 p = 1.5;
  f64 q = 3.0;
  return max(x, y) + max(p, q) as~ i32;    // T is i32, then f64
}
```

`[§wac-generic-fn-5hvq3mt]` A function may take type parameters, inferred from its arguments and its expected
result, and each distinct set of arguments is a separate function.

A type parameter is inferred from the arguments structurally — the parameter's type is the pattern and the
argument's type is matched against it — and from the type expected of the result:

```wac
// expect: answers main = 6
struct Box<T> { T v; }
struct Vec<T> { T[] data; }

i32 count<T>(T[] xs) { return xs.len(); }           // T from the element type
T unbox<T>(Box<T> b) { return b.v; }                // T from inside an instantiation
T orElse<T>(T? a, T d) { return a ?? d; }           // T from inside a nullable
T applyTo<T>(fn<T(T)> f, T x) { return f(x); }      // T from a function type
T zero<T>() { return 0; }                           // T only in the result
Vec<T> empty<T>() { return Vec([]); }

i32 keep(i32 x) { return x * 0; }

export i32 main() {
  i32 z = zero();                          // T = i32, from the declaration
  Vec<i32> e = empty();                    // T = i32, likewise
  i32[] xs = [1, 2];
  Box<i32> b = Box(3);
  i32? none = null;
  return count(xs) + unbox(b) + orElse(none, 1) + z + e.data.len() + applyTo(keep, 5);
}
```

`[§wac-generic-infer-expected-endugbi]` A type parameter may be inferred from the type expected of the call's
result, as well as from its arguments: `i32 z = zero();` instantiates `zero<i32>`.

Constraints flow both ways within an expression ([09](09-numeric-literals.md)). Two sources that imply
different types for one parameter are an error:

```wac
// expect: emits
T max<T>(T a, T b) { return a > b ? a : b; }

export i32 main() {
  i32 x = 1;
  f64 y = 2.0;

  // ERROR: x and y imply different types for T
  // max(x, y);

  return 0;
}
```

The types are compared by identity, not spelling ([01](../1-programs/01-names-and-identity.md)).

### Type arguments may be written

```wac
// expect: answers main = 9
T identity<T>(T x) { return x; }

export i32 main() {
  i32 a = identity<i32>(4);
  i32 b = identity(5);                     // the same instantiation as identity<i32>
  fn<i32(i32)> g = identity<i32>;          // a generic function as a value

  // ERROR: identity takes 1 type argument, and 2 were written
  // i32 c = identity<i32, f64>(1);

  // ERROR: unknown type 'Typoo'
  // i32 d = identity<Typoo>(1);

  return a + b;
}
```

`[§wacc-written-type-args]` A call may write its type arguments. They must match the declaration in number,
and each must name a type. A written argument and an inferred one that agree are one instantiation.

A generic function's bare name has no type — its signature is written in letters — so as a value it is
always written with its arguments.

### A method may take type parameters of its own

```wac
// expect: answers main = 6
struct Vec<T> {
  T[] items;

  U fold<U>(const this, U seed, fn<U(U, T)> f) {
    U acc = seed;
    for (T x in this.items) { acc = f(acc, x); }
    return acc;
  }
}

export i32 main() {
  Vec<i32> v = Vec([1, 2, 3]);
  i32 total = v.fold(0, (i32 acc, i32 x) => acc + x);        // U = i32, from the seed
  i64 wide = v.fold<i64>(0, (i64 a, i32 x) => a + x as i64);
  return total;
}
```

`[§wacc-method-type-args]` A method may declare type parameters its owner does not have. They are inferred
from the call's arguments or written, and each owner instantiation and method argument set is a separate
function.

A lambda has no type of its own to contribute, but saying nothing is not a refusal: the seed beside it is
enough.

## Default type arguments

A type parameter may have a default, used when the argument is omitted:

```wac
// expect: answers main = 1
enum Result<T, E = union> {
  Ok(T v), Err(E e)
}

Result<i32> parse(string s) {              // Result<i32, union>: E is a fresh placeholder here
  if (s == "") { return Result.Err("empty"); }
  return Result.Ok(1);
}

export i32 main() {
  return match (parse("x")) {
    Ok(v):   v,
    Err(e):  0,
  };
}
```

`[§wac-generic-default-arg-p6xzn68]` A type parameter declared `= D` takes `D` where the argument is omitted.

When the default is a placeholder, each use that omits it creates a fresh one at that use — `Result<i32>`
in `parse`'s signature collects what `parse` returns ([33](../5-inference/33-placeholders.md)). `Result` has
no special inference rule: this is what makes it an ordinary generic rather than a blessed form.

## Templates are checked twice

There are no constraints and no traits. A template is checked at its definition with its type parameters
opaque, and again at each instantiation with them substituted:

```wac
// expect: emits
struct Vec<T> {
  T[] data;

  void oops(this) {
    // ERROR: expected i32, got string — reported at the definition, whatever T is
    // i32 x = "hello";

    this.data.len();
  }
}

i32 lengthOf<T>(T x) { return x.len(); }   // nothing asks T for a len…

export i32 main() {
  i32 a = lengthOf("abc");                 // …and string has one

  // ERROR: no method 'len' on i32 — reported at this instantiation
  // i32 b = lengthOf(5 as i32);

  return a;
}
```

`[§wac-generic-template-check-2wkq7nm]` A mistake that does not depend on the type parameters is reported at
the definition, even if nothing instantiates it, and is reported once. Anything that depends on them is
checked at each instantiation.

This holds for every kind of template — struct, enum, function and method alike:

```wac
// expect: emits
enum Box<T> {
  Full(T v), Empty

  i32 broken(const this) {
    // ERROR: expected i32, got string — reported at the definition
    // return "no";
    return 0;
  }
}

export i32 main() { return 0; }
```

`[§wac-generic-enum-checked-vqc8iab]` A generic enum's methods are checked at the definition with its parameters
opaque, as any template's are.

In a static branch, every branch receives the definition check, and only the selected one the
instantiation check:

```wac
// expect: refused
i32 example<T>() {
  static_if (typeref(T) == typeref(i32)) {
    return 1;
  } else {
    T x = 7;       // Validity depends on T; checked at instantiation.
    i32 y = "foo"; // ERROR at definition time, independent of T.
    return 0;
  }
}

export i32 main() { return example<i32>(); }
```

`[§wac-generic-static-branch-check-tp3uc4n]` Every branch of a `static_if` in a template receives the
definition-time check. Only the branches selected for an instantiation are checked against it
([31](../4-static/31-static-control.md)).

No diagnostic shows a name the author never wrote: an instantiation is reported as `Box<Base>`, never by an
internal name.

A template that instantiates itself with a larger argument never terminates. It is refused at a nesting depth
an implementation chooses:

```wac
// expect: refused
struct Box<T> { T v; }
struct Rec<T> { Rec<Box<T>>? next; }

i32 grow<T>(T a) { Box<T> b = Box(a); return grow(b); }

export i32 main() { return grow(1 as i32); }
```

`[§wac-generic-unbounded-aymiatd]` A template whose instantiations would require ever-larger type arguments is
refused.

## Across modules

An instantiation belongs to the template's module, and importing the template is enough. Two modules that
instantiate `Box<i32>` share one instantiation, and a type argument need not be exported:

```wac
// expect: answers main = 3
// ---- box.wac ----
export struct Box<T> { T v; T get(const this) { return this.v; } }
// ---- other.wac ----
import { Box } from "./box.wac";
export Box<i32> make() { return Box(2); }
// ---- main.wac ----
import { Box } from "./box.wac";
import { make } from "./other.wac";

struct Local { i32 v; }                    // not exported

export i32 main() {
  Box<i32> b = make();                     // the same Box<i32> as other.wac's
  Box<Local> l = Box(Local(1));
  return b.get() + l.get().v;
}
```

`[§wac-generic-instantiation-identity-6pnq4wj]` Two references name one instantiation exactly when they name
the same template with the same argument types — not the same text. An alias collapses onto its target, and
two same-named types give two instantiations.

A generic function's instantiations are not exports of a compiled program, since a host would have to call a
name the author never wrote. A program that wants to expose one writes a concrete wrapper
([07](../1-programs/07-programs.md)):

```wac
// expect: answers maxI32 = 7
T max<T>(T a, T b) { return a > b ? a : b; }

export i32 maxI32(i32 a, i32 b) { return max(a, b); }
```

Methods that declare no receiver of a generic struct, generic static declarations, and static locals are
evaluated once per instantiation ([27](../4-static/27-static-declarations.md)).
