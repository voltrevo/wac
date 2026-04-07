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

### Export

`export` marks a function as visible outside the file and exported in the wasm
module. Non-exported functions are file-private.

Struct types referenced by exported functions are implicitly visible to
importers.
