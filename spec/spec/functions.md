## Functions

### Declaration

```wac
i32 helper(i32 x) { return x * 2; }           // file-private
export i32 double(i32 x) { return helper(x); } // exported
```

All functions have explicit return types. `void` is allowed. Parameters require
explicit types. No overloading — each function name must be unique within its
scope (see [naming.md](naming.md)).

### Return types

Functions can return primitives, struct references, or array references:

```wac
export void greet() { ... }
export Point makePoint(f64 x, f64 y) { return Point(x, y); }
export i32[] makeArray(i32 n) { return i32[n](); }
```

`[§wac-ret-void-ezw2lqp]` A void function with no return statement compiles.
`[§wac-ret-struct-kpjs5dg]` `makePoint(1.0, 2.0)` returns a Point with x=1.0.
`[§wac-ret-array-mptjuer]` `makeArray(5)` returns an array with length 5.

### Recursion

Recursive and mutually recursive functions work without forward declarations
(two-pass compilation).

```wac
export i32 factorial(i32 n) {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}
```

`[§wac-factorial-lzkw61q]` `factorial(10)` returns `3628800`.

```wac
i32 isEven(i32 n) {
  if (n == 0) { return 1; }
  return isOdd(n - 1);
}

i32 isOdd(i32 n) {
  if (n == 0) { return 0; }
  return isEven(n - 1);
}

export i32 checkEven(i32 n) { return isEven(n); }
```

`[§wac-mutual-exg2t9c]` `checkEven(42)` returns `1`. `checkEven(17)` returns `0`.

### Return statement in void functions

`return;` is allowed in void functions for early exit:

```wac
export void earlyReturn(bool flag) {
  if (flag) { return; }
  // ... more code
}
```

`[§wac-void-return-h7qm4xf]` `return;` in a void function compiles.

### Missing return

All code paths in a non-void function must return a value:

```wac
i32 bad(bool x) {
  if (x) { return 1; }
  // error: not all code paths return a value
}
```

`[§wac-missing-return-k4fn8wp]` A non-void function where a code path falls off
the end without returning is a compile error.

```wac
i32 ok(bool x) {
  if (x) { return 1; }
  else { return 0; }
}
```

`[§wac-all-paths-return-m7qj3xf]` `ok(true)` returns `1`. All paths return.

### Parameter matching

Exact type match required. No implicit widening.

```wac
f64 sqrt(f64 x) { ... }

f32 approx = 3.14;
f64 r = sqrt(approx);          // error: f32 passed to f64
f64 r = sqrt(approx as f64);   // ok: explicit cast
```

`[§wac-paramatch-84zc2km]` `sqrt(approx)` is a compile error — f32 passed to f64.

`[§wac-method-argmatch-9tq4mz2]` The same rule applies to a **method's** arguments, and to a
method on a generic read in the instantiation's world: `set(this, T x)` on a `Box<i32>` takes an
`i32`.

```wac
struct A { i32 x; }
struct B { i32 y; }
struct P { i32 take(const this, A a) { return a.x; } }

P p = P(0);
i32 n = p.take(B(1));          // error: expected A, found B
```

Worth stating because two one-field structs share a wasm type, so nothing downstream necessarily
catches it: that module validates and reads `y` where `x` was written. Where the layouts differ the
engine refuses it instead, which is a diagnostic from three phases too late.

A **generic static** takes its type arguments from the slot the call lands in, so that is where its
parameter types come from too:

```wac
Box<i32> b = Box.of("no");     // error: expected i32, found string
```

A call with no slot binds nothing, and nothing is checked — the same silence the rest of inference
keeps. Name an intermediate if you want the check.


### const parameters

A parameter may be marked `const`, which forbids reassigning it and — because const is
deep — writing through it:

```wac
struct P { i32 v; }

i32 peek(const P p) { return p.v; }      // fine
void bad(const P p) { p.v = 1; }         // error: cannot write through const reference
void also(const P p) { p = P(2); }       // error: cannot assign to const variable 'p'
```

`[§wac-const-param-2vhk7dq]` The reads compile and each write is a compile error. It
applies to any parameter type — a struct, an array (element writes are refused too), or a
primitive — and is per-parameter, so a `const` one beside a mutable one leaves the mutable
one alone.

This is the same guarantee `const this` gives a method receiver (see structs.md), and the
two compose: `i32 m(const this, const P p)`.

Until this existed the guarantee was available to methods and to nothing else, so moving a
method to a free function silently lost it — and a function that plainly does not mutate
its argument had no way to say so.

### Export

`export` marks a function as visible to other wac files via `import`.
Non-exported functions are file-private.

Only the entry file's exported functions appear in the wasm module's export
section. Functions exported by imported files are available to wac code during
compilation but are not wasm exports — they are internal to the module.

This means exported names across different files never collide in the wasm
output:

```wac
// utils_a.wac
export i32 compute(i32 x) { return x + 1; }
```

```wac
// utils_b.wac
export i32 compute(i32 x) { return x * 2; }
```

```wac
// main.wac (entry)
import { compute as a } from "./utils_a.wac";
import { compute as b } from "./utils_b.wac";

export i32 test() { return a(5) + b(5); }
```

The wasm module exports only `test`. Neither `utils_a$compute` nor
`utils_b$compute` appears in the wasm export section.

`[§wac-export-entry-only-v3kp8wn]` Compiling with `main.wac` as entry produces
a wasm module whose only export is `test`. `test()` returns `16`.

`[§wac-export-no-collision-m4fn9rk]` Two imported files may export functions
with the same name without causing a wasm export collision — only the entry
file's exports become wasm exports.

Struct types referenced by exported functions are implicitly visible to
importers.

### A local or parameter shadows a function

```wac
i32 pump(fn[bool(u8[])] write) {
  write(bytes);        // the parameter, never a function named `write`
  return 1;
}
```

`[§wac-param-shadows-func-5nkq2wp]` A bare name in call position resolves to a
local or parameter of funcref type before any function.

This is the ordinary shadowing rule, and it is stated here because the compiler
did the opposite. Bare function names are resolved through a global, first-wins
map, and the funcref case sat *below* it — so `write(bytes)` above reached a
top-level `write` in a different module, one the calling file does not import
and cannot otherwise name. Where the arities differed the module failed to
validate; where they matched it validated and called the wrong function, never
invoking the callback at all.

Found when `box` grew an HTTP applet: that pulled `packages/http`'s
three-parameter `write` into the module graph, and `gzipStream`'s one-parameter
`write` parameter began emitting a call to it.
