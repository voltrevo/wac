## Arrays

WasmGC arrays are heap-allocated, garbage-collected, bounds-checked. Length is
set at creation and fixed after — it is not part of the type. Two arrays of
different lengths have the same type.

### Construction

```wac
i32[] a = i32[5]();                      // array.new_default, length 5, all zeros
i32[] b = i32[](1, 2, 3);               // array.new_fixed, length 3
```

`[§wac-arr-default-uwpc1ls]` `a.len()` is `5`, `a[0]` is `0`.
`[§wac-arr-fixed-v6p97qy]` `b.len()` is `3`, `b[0]` is `1`, `b[2]` is `3`.

### Access

```wac
a[0] = 10;                               // array.set
i32 x = a[0];                            // array.get
i32 n = a.len();                            // array.len
```

Out-of-bounds access traps (enforced by the wasm runtime).

```wac
export i32 oob() {
  i32[] a = i32[3]();
  return a[5];
}
```

`[§wac-arr-oob-7jby7f8]` `oob()` traps: index out of bounds.

### Struct arrays

```wac
Point?[] points = Point?[10]();          // ok: nullable refs default to null
i32[] nums = i32[10]();                  // ok: i32 defaults to 0
Point[] ps = Point[10]();               // ok: Point has only numeric fields
```

`[§wac-arr-nullable-tbpzqk1]` `points[0]` is `null`.
`[§wac-arr-struct-xo3j05c]` `ps[0].x` is `0` — each element is a distinct
`Point()` with default values.

`T[N]()` requires that T has a default value. See
[structs.md](structs.md) for default value rules.

### Array aliasing

Arrays are references. Assigning an array copies the reference, not the data.

```wac
export i32 arrAlias() {
  i32[] a = i32[](1, 2, 3);
  i32[] b = a;
  b[0] = 99;
  return a[0];
}
```

`[§wac-arr-alias-co33gnn]` `arrAlias()` returns `99`.

### Iteration

```wac
export i32 sum(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}
```

`[§wac-arr-sum-5r0hbqg]` `sum` on `{ 10, 20, 30 }` returns `60`.

### Nested arrays

Arrays of arrays are supported:

```wac
i32[][] grid = i32[][3]();
grid[0] = i32[](1, 2, 3);
grid[1] = i32[](4, 5, 6);
grid[2] = i32[](7, 8, 9);
```

`[§wac-arr-nested-l8rdntl]` `grid[1][2]` is `6`.

Each inner array can have a different length — this is an array of references
to arrays, not a rectangular matrix.

### Packed arrays

`i8[]` and `i16[]` are packed array types backed by WasmGC's packed element
types. Elements are stored compactly (1 or 2 bytes each) but read/write as
`i32` — the runtime zero-extends on read and truncates on write.

```wac
i8[] bytes = i8[4]();
bytes[0] = 0xFF;
i32 val = bytes[0];              // 255 (zero-extended to i32)

i16[] shorts = i16[4]();
shorts[0] = 1000;
i32 val2 = shorts[0];           // 1000
```

`[§wac-arr-i8-k3fn7wp]` `bytes[0]` returns `255` after setting `0xFF`.
`[§wac-arr-i16-m8qj4xf]` `shorts[0]` returns `1000`.

There are no `i8` or `i16` local variables, parameters, or struct fields —
packed types only exist as array elements. Indexing a packed array returns `i32`,
and assignment truncates from `i32`.

```wac
i8 x = 5;                       // error: i8 is not a variable type
```

`[§wac-arr-i8-nolocal-p7hd5wn]` `i8` as a variable type is a compile error.

```wac
i32 process(i8 val) { return val; }   // error: i8 is not a parameter type
i8 getByte() { return 0; }            // error: i8 is not a return type
```

`[§wac-arr-i8-noparam-w5hd3jk]` `i8` as a parameter type is a compile error.
`[§wac-arr-i8-noreturn-k7fn2qp]` `i8` as a return type is a compile error.

Overflow on write silently truncates:

```wac
export i32 testTrunc() {
  i8[] b = i8[1]();
  b[0] = 256;                   // truncates to 0
  return b[0];
}
```

`[§wac-arr-i8-trunc-r2km9jf]` `testTrunc()` returns `0`.
