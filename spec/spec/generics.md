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

### Not yet

Generic **functions** — `T max<T>(T a, T b)` — are not implemented. Types alone cover the
containers that motivated the feature; functions would buy `sort`, `map` and `max`, with the type
arguments inferred from the argument types. Tracked as part of issue 0034.
