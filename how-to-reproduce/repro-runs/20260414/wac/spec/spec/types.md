## Types

### Primitive types

| wac type | Wasm type | Notes |
|----------|-----------|-------|
| i32      | i32       | 32-bit signed integer, -2147483648 to 2147483647 |
| i64      | i64       | 64-bit signed integer |
| f32      | f32       | 32-bit IEEE 754 float, ~7 decimal digits |
| f64      | f64       | 64-bit IEEE 754 float, ~15 decimal digits |
| bool     | i32       | Type-checked: conditionals must be bool, not interchangeable with i32 |
| string   | ref $string | Immutable UTF-8 string, see [strings.md](strings.md) |
| i8       | i8 (packed) | Array element only — no locals, params, or struct fields |
| i16      | i16 (packed) | Array element only — no locals, params, or struct fields |

Integer arithmetic wraps on overflow. Float arithmetic follows IEEE 754.

```wac
export i32 int32()  { return 42; }
export i64 int64()  { return 1000000000000; }
export f32 float32() { return 3.14; }
export f64 float64() { return 2.718281828459045; }
```

`[§wac-int32-dfkqg8u]` `int32()` returns `42`.
`[§wac-int64-81jz1o0]` `int64()` returns `1000000000000`.
`[§wac-float32-45okgg8]` `float32()` returns `3.14` (f32 precision).
`[§wac-float64-suhtesz]` `float64()` returns `2.718281828459045`.

```wac
export i32 wrap32() { return 2147483647 + 1; }
```

`[§wac-wrap-uy41uqt]` `wrap32()` returns `-2147483648`.

No implicit conversions between any types.

### bool

A distinct type. `true` is 1, `false` is 0, but `bool` is not interchangeable
with `i32`. Comparisons return `bool`. Logical operators (`&&`, `||`, `!`)
require `bool` operands and return `bool`.

```wac
export i32 strict() {
  bool flag = true;
  i32 x = 5;
  if (flag) { return x; }
  return 0;
}
```

`[§wac-strict-tr8nhbk]` `strict()` returns `5`.

```wac
export i32 rejected(i32 x) {
  if (x) { return 1; }           // error: i32 is not bool
  return 0;
}
```

`[§wac-boolreq-uj95exp]` This is a compile error. Use `if (x != 0)` instead.

### Reference types

All structs and arrays are GC-managed heap references. The garbage collector
handles lifetime — no manual free, no use-after-free.

| wac type  | Wasm type          | Notes |
|-----------|--------------------|-------|
| T         | ref $T             | Non-null reference to struct or array |
| T?        | ref null $T        | Nullable reference |
| anyref    | anyref             | Top reference type |
| i31ref    | i31ref             | Unboxed 31-bit integer reference |

References are non-null by default. `T?` is nullable. See
[structs.md](structs.md) for struct types and [arrays.md](arrays.md) for array
types.

### i31ref

An unboxed 31-bit integer packed into a reference. No heap allocation. Maps to
`ref.i31` (create) and `i31.get_s` / `i31.get_u` (extract).

```wac
i31ref small = 42 as! i31ref;     // ref.i31, no allocation
i32 n = small as i32;            // i31.get_s, signed extraction

anyref val = small;               // i31ref widens to anyref
if (val is i31ref) {
  i31ref x = val as! i31ref;
  i32 num = x as i32;
}
```

`[§wac-i31ref-0i4w6qt]` `small as i32` returns `42`.

Useful for mixing unboxed integers and heap references in the same container:

```wac
anyref[] items = anyref[3]();
items[0] = 42 as! i31ref;                 // no allocation
items[1] = Point(1, 2);           // heap allocated
```

### Nullability

References are non-null by default. `T?` is nullable.

```wac
Point p = Point(1, 2);     // non-null
Point? q = null;                    // nullable

q = p;                              // ok: T widens to T?
p = q;                              // error: q might be null
```

`[§wac-nullassign-b3xk8p5]` `p = q` is a compile error — cannot assign nullable to
non-null.

#### null

`null` is a keyword literal with no type of its own. It can be used anywhere a
nullable type (`T?`) is expected — the compiler infers the type from context.

```wac
Point? p = null;             // ok
p = null;                    // ok: reassign to null
Point q = null;              // error: Point is non-null
i32 x = null;                // error: i32 is not nullable
```

`[§wac-null-assign-k3fn8wp]` `Point? p = null` compiles.
`[§wac-null-nonnull-m8qj5xf]` `Point q = null` is a compile error.
`[§wac-null-primitive-p7hd6wn]` `i32 x = null` is a compile error.

#### Unwrap operator `!`

`!` on a nullable reference asserts non-null. Maps to `ref.as_non_null` —
traps if null.

```wac
Point? q = findPoint();
Point p = q!;                      // traps if q is null
i32 x = q!.x;                     // unwrap then access
```

`[§wac-unwrap-trap-y1iep2p]` Unwrapping `null` traps.

#### Null testing

Use `is` / `is not`:

```wac
if (q is null) { ... }
if (q is not null) {
  Point p = q!;                    // safe, but still need explicit unwrap
}
```

`[§wac-isnull-kxsqi4g]` `null is null` is `true`. A non-null ref `is null` is
`false`.

```wac
export bool testNonNullIsNull() {
  Point p = Point(1, 2);
  return p is null;
}
```

`[§wac-nonnull-isnull-k8fn3wp]` `testNonNullIsNull()` returns `false` — `is null` on a non-null type is allowed but always false.
