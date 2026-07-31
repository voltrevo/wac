## Generics

A struct may take type parameters. `Vec<T>` is a **template**, not a type; `Vec<i32>` is a type.

```wac
struct Vec<T> {
  T[] data;
  i32 n;

  void push(this, T v) { /* ... */ }
  T get(const this, i32 i) { return this.data[i]; }
  i32 len(const this) { return this.n; }
}

export i32 sum() {
  Vec<i32> v = Vec(i32[0](), 0);
  v.push(10);
  v.push(20);
  return v.get(0) + v.get(1);
}
```

`[§wac-generic-struct-9tkq4wm]` This works, and so does `Vec<f64>`, `Vec<P>` for a struct `P`, and
`Vec<E>` for an enum `E`, all in one program.

### Monomorphisation

Each distinct set of type arguments produces a **separate concrete struct**. `Vec<i32>` and
`Vec<f64>` share no code and no type: the resolver substitutes and registers each as an ordinary
struct, so nothing after the resolver knows the feature exists — the same containment that keeps
`enum` out of the type checker and the emitter.

This is why a type parameter may be a **primitive**. `Vec<i32>`'s backing array is a real `i32[]`,
not an array of boxed references, which is the main reason monomorphisation was chosen over
erasure: the containers that hurt most are the numeric ones.

Two instantiations are **invariant** — unrelated unless their arguments are identical.
`[§wac-generic-struct-9tkq4wm]` `Vec<Sub>` is not a `Vec<Base>` even when `Sub : Base`. Java's
covariant arrays are a known mistake, and a mutable container cannot be covariant soundly.

### Angle brackets are type syntax only

Type arguments appear where a **type** is written, never in an expression: `IDENT <` is ambiguous
with less-than, and there is no way to tell them apart without unbounded lookahead.

wac can afford the restriction because every declaration is explicitly typed, so a construction
always has an expected type to take its arguments from:

```wac
Vec<i32> v = Vec(i32[0](), 0);        // from the declaration
Vec<i32> pick(bool c) { return Vec(i32[0](), 0); }   // from the return type
Vec<i32> t = c ? Vec(i32[0](), 0) : Vec(i32[0](), 0);  // through both ternary branches
```

`[§wac-generic-struct-9tkq4wm]` All three work. The one place arguments *are* written in something
resembling an expression is an array construction, where what follows is a construction bracket
rather than an operand and so cannot be confused with a comparison:

```wac
Box<i32>[] a = Box<i32>[2](fill: Box(4));
Vec<Vec<i32>> outer = Vec(Vec<i32>[0](), 0);
```

`[§wac-generic-struct-9tkq4wm]` Both work, including the `>>` that closes a nested argument list —
the lexer reads it as one shift token and the parser splits it.

**A construction in an argument position must name its type.** `take(Vec(...))` cannot infer,
because the callee's signature is not known when substitution runs. Declare it first:

```wac
Vec<i32> v = Vec(i32[0](), 0);
take(v);                               // fine
```

That is what idiomatic wac already does — containers mutate through `void` methods, so calls are
already two statements — and lifting it is future work rather than a gap in the design.

### Across modules

A materialised struct belongs to the **template's** file, so the ordinary export and import rules
apply to it unchanged. Importing the template is enough; the compiler rewrites the import to the
instantiations the file uses.

```wac
// box.wac
export struct Box<T> { T v; T get(const this) { return this.v; } }

// main.wac
import { Box } from "./box.wac";
export i32 f() { Box<i32> b = Box(2); return b.get(); }
```

`[§wac-generic-struct-9tkq4wm]` This works, an alias works, and two files instantiating `Box<i32>`
share one struct rather than getting a copy each.

### Instantiations are identified by identity, not by spelling

Two references name the same instantiation exactly when they name the same template with the same
argument *types* — not the same argument *text*. A name is only unique within its file, so an alias
collapses onto its target and two same-named types stay apart:

```wac
import { Point, Point as P } from "./p.wac";
Box<P> a = ...;        // one instantiation, not two
Box<Point> b = ...;
```

`[§wac-generic-instantiation-identity-6pnq4wj]` `Box<P>` and `Box<Point>` are one struct. An aliased
*template* is usable — `import { Box as B }` then `B<i32>`. And two different structs that happen to
share a name, which `§wac-samename-struct-4jhq7wn` permits, give two instantiations rather than one.

That last one was a type confusion rather than a diagnostic before it was fixed: both spellings
mangled alike, one struct served both, and it surfaced as an error only because the two layouts
happened to differ. See issue 0042.

### No constraints

There is no `T: Default` and there are no traits. Instead, a template is checked **twice**: once at
its definition with the type parameters treated as opaque, and again at each instantiation against
the substituted types.

The definition-time pass catches everything structurally wrong regardless of what `T` turns out to
be:

```wac
struct Vec<T> {
  T[] data;
  i32 n;

  void oops(this) {
    i32 x = "hello";              // error here, even if nothing instantiates Vec
    this.data.noSuchMethod();     // deferred — depends on what T is
  }
}
```

`[§wac-generic-template-check-2wkq7nm]` The first is reported at the definition. The second is not,
and cannot be: an opaque `T` has no known members, so nothing about it is decidable yet.

Anything naming a type parameter is deferred, and so is anything naming **another template** — a
`Box<T>` field is not a type until `T` is known, so its members are unknowable rather than absent.
`[§wac-generic-template-check-2wkq7nm]` The cost is that a genuine mistake involving another
template inside a template body is also deferred to instantiation.

A `T`-independent mistake is reported **once**, not once per instantiation.
`[§wac-generic-template-check-2wkq7nm]` Diagnostics are deduplicated by position and message, which
is more honest than suppressing the instantiation-time pass: two instantiations can fail
differently, and those messages differ.

What remains of the C++ bargain is the part about *where* an error points, and what keeps it
tolerable is that **no diagnostic ever shows a mangled name** — `Box$Base` is rendered `Box<Base>`.
`[§wac-generic-struct-9tkq4wm]` An error about a name the author never typed is the whole
difference between this feature and a C++ template error.

### Errors

`[§wac-generic-struct-9tkq4wm]` Each of these is a compile error:

| written | why |
|---|---|
| `Vec v = ...` | generic, and nothing supplies the arguments |
| `Vec<i32, f64> v` | `Vec` takes one type argument |
| `P<i32> p` | `P` is not generic |
| `struct Rec<T> { Rec<Box<T>>? next; }` | instantiates itself with a larger argument, so it never terminates |

The last is capped at 24 levels of nesting and reported. Rust has the same limit for the same
reason: there is no way to tell an infinite family from a merely deep one.

## Generic functions

A function may take type parameters, written after its name as on a struct:

```wac
T max<T>(T a, T b) { return a > b ? a : b; }

export i32 f() {
  i32 x = 3;
  i32 y = 7;
  return max(x, y);          // T is i32, from the arguments
}
```

`[§wac-generic-fn-5hvq3mt]` This works, and so does `max` on `f64` in the same program: each
distinct set of type arguments produces a separate concrete function, exactly as for a struct.

### Type arguments are inferred, never written

There is no `max<i32>(x, y)`. Angle brackets are type syntax only — the same ambiguity with
less-than — and a call is an expression, so **inference is the whole interface**. It is tractable
because wac has no declaration type inference: every local and every parameter states its type, so
an argument's type is available from the syntax alone.

An argument's type is evident when it is a literal, a variable, a field, an array element, a cast,
an unwrap, a struct construction, or a call to a function or method whose return type is declared:

```wac
Vec<i32> v = ...;
i32 a = max(v.get(0), v.get(1));    // a method's declared return type
i32 b = max(p.x, 0);                // a field, and a literal
i32 c = max(max(a, b), c);          // a call to an instantiation, resolved innermost first
```

`[§wac-generic-fn-5hvq3mt]` All of these infer. What does not is a `null` argument and a call
through a funcref, neither of which states a type where the call is written:

```wac
i32 d = id(null);                   // error: argument 1's type is not evident here
```

`[§wac-generic-fn-5hvq3mt]` The diagnostic says to assign the value to a declared variable first,
which is the fix.

Because inference is argument-directed, **a type parameter that no parameter's type mentions is
unusable**:

```wac
T zero<T>() { return 0; }           // error at every call: nothing determines T
```

`[§wac-generic-fn-5hvq3mt]` Reported at the call, and terminal — a call cannot name its type
arguments, so there is no way to supply what inference could not find. A return type alone does not
determine `T`; that is a deliberate limit rather than an oversight, and lifting it would mean
propagating an expected type into a call, which is the same restriction the struct case documents
above.

Two arguments must agree:

```wac
i32 x = 1;
f64 y = 2.0;
max(x, y);                          // error: they imply different types for the same parameter
```

`[§wac-generic-fn-5hvq3mt]` The types are compared by *identity*, not by spelling, on the same terms
as instantiation identity above.

### What a type parameter may stand for

`[§wac-generic-fn-5hvq3mt]` Anything a struct's type argument may be: a primitive, a string, a
struct, an enum, an array, a nullable, a funcref, or an instantiation of a generic struct. A
parameter may also be a *structure* containing the type parameter rather than the parameter itself:

```wac
i32 count<T>(T[] xs) { return xs.len(); }            // T from the element type
T unbox<T>(Box<T> b) { return b.v; }                 // T from inside an instantiation
T orElse<T>(T? a, T d) { ... }                       // T from inside a nullable
T applyTo<T>(fn[T(T)] f, T x) { return f(x); }       // T from a funcref signature
```

`[§wac-generic-fn-5hvq3mt]` Each of these infers structurally, one direction only: the parameter's
type is the pattern and the argument's type is matched against it.

### Recursion, and calls between generics

`[§wac-generic-fn-5hvq3mt]` A generic function may call itself, call another generic function, and
be called from a generic struct's method — where the struct's own type parameter supplies the
argument type. As for structs, a generic that instantiates itself with a *larger* argument never
terminates and is capped at 24 levels and reported:

```wac
i32 grow<T>(T a) { Box<T> b = Box(a); return grow(b); }   // error, at the cap
```

### Across modules, and exports

`[§wac-generic-fn-5hvq3mt]` A materialised function belongs to the **template's** file, like a
materialised struct, and importing the template is enough — the import is rewritten to the
instantiations the file uses. Any type the substitution carried in from a third file is imported
too.

An `export`ed generic function is importable by other wac files, but its instantiations are **not
wasm exports**: the name a host would have to call is a mangled one the author never wrote, and it
changes with the file the template lives in. `[§wac-generic-fn-5hvq3mt]` To export a generic to the
host, write a concrete wrapper:

```wac
export i32 maxI32(i32 a, i32 b) { return max(a, b); }
```

### Checking

A generic function is checked on the same terms as a generic struct: once at its definition with its
type parameters opaque, and again per instantiation against the substituted types.
`[§wac-generic-fn-5hvq3mt]` A mistake independent of `T` is reported at the definition even if
nothing calls the function; anything depending on what `T` is — including arithmetic and comparison
on a `T` — is deferred to instantiation.
