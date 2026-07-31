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

The element type may be a named type in either form, including a nested array or a
nullable one:

```wac
S[]   c = S[](S(1), S(2));
S[][] d = S[][](S[](S(7)));
S?[]  e = S?[](S(1), null);
```

`[§wac-array-literal-named-9mzq4rt]` All three work. The literal form with a named
element type did not parse at all until recently: the construction lookahead recognised
only the sized `S[n]()` shape for a named type, so `S[](...)` fell through to being read
as an identifier followed by junk. A primitive element type took a different path, which
is why `i32[](1, 2)` always worked.

### Giving every element a value

A third form supplies the element value explicitly:

```wac
i32[] a = i32[n](fill: -1);
E[]   b = E[n](fill: E.B);
```

`[§wac-arr-fill-7kqm3xz]` Every element is `fill`'s value. The size may be any `i32`
expression, so this is the only way to build a *dynamically* sized array of an element
type with no default — which since enums have none (see enums.md) is any type reachable
from one. The literal form needs a compile-time element count, so it cannot serve.

For a reference element type the value is **shared**, not copied: all n slots hold the
same reference. `[§wac-arr-fill-7kqm3xz]` That is what supplying one value must mean, and
it is the difference from `T[n]()`, which constructs a separate element for each slot.
A packed element truncates, exactly as an indexed write does. `[§wac-arr-fill-7kqm3xz]`

The value is written as `fill:` rather than as a bare `T[n](v)` because the bare form is
genuinely ambiguous: `arr[i](5)` already means index an array of funcrefs and call the
result, and nothing at parse time distinguishes a type name from a variable. Named
argument syntax cannot collide, since a call rejects it outright.
`[§wac-arr-fill-7kqm3xz]` `i32[2](7)` is an error naming `fill:`.

The sized form without `fill:` needs the element type to have a default value; the
literal form and the `fill:` form do not.

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

The size may be any `i32` expression, not only a literal, and the distinctness
holds either way — writing through one element never shows up in another.

```wac
export i32 distinct(i32 n) {
  Point[] ps = Point[n]();
  ps[0].x = 99.0;
  return ps[1].x as~ i32;
}
```

`[§wac-arr-struct-runtime-w4kf2nq]` `distinct(3)` returns `0`.

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

`u8[]`, `i8[]`, `u16[]` and `i16[]` are packed array types backed by WasmGC's
packed element types. Elements are stored compactly — one or two bytes each —
but read and write as `i32`, since wasm has no narrower value to compute with.

Storage is identical for both signednesses; the element type decides only how a
read extends the stored bits. `u8`/`u16` zero-extend (`array.get_u`), `i8`/`i16`
sign-extend (`array.get_s`). Writes truncate either way.

```wac
u8[] bytes = u8[4]();
bytes[0] = 0xFF;
i32 val = bytes[0];              // 255 — zero-extended

i8[] signed = i8[4]();
signed[0] = 0xFF;
i32 val2 = signed[0];            // -1 — the same byte, sign-extended

u16[] shorts = u16[4]();
shorts[0] = 1000;
i32 val3 = shorts[0];           // 1000
```

`[§wac-arr-i8-k3fn7wp]` A `u8[]` element reads back `255` after setting `0xFF`;
an `i8[]` element holding the same byte reads back `-1`.
`[§wac-arr-i16-m8qj4xf]` `shorts[0]` returns `1000`.

Use `u8[]` for byte data — buffers, text, file contents — which is nearly
always what is wanted. `i8[]` is for genuinely signed samples.

The fixed-element form takes `i32` values too, and truncates them the same way
a write does — so a byte array can be written as a literal list.

```wac
export i32 byteLit(i32 i) {
  i8[] bytes = i8[](104, 101, 108, 108, 111);   // "hello"
  return bytes[i];
}

export i32 byteLitTrunc() {
  i8[] bytes = i8[](300);
  return bytes[0];
}
```

`[§wac-arr-i8-lit-3fqjy2m]` `byteLit(0)` returns `104`.
`[§wac-arr-i8-lit-trunc-i9g6kol]` `byteLitTrunc()` returns `44` — `300` truncates to 8 bits.
`[§wac-arr-i16-lit-kyrurqi]` `i16[](70000)` element 0 reads back `4464`.

Element expressions must still be `i32` — no other type is accepted.

```wac
i8[] bad = i8[](1.5);            // error: expected i32, got f64
```

`[§wac-arr-i8-lit-badtype-3w7g6aa]` A non-`i32` element in a packed array literal is a compile error.

There are no packed local variables, parameters, return types or struct fields —
packed types only exist as array elements. Indexing a packed array returns `i32`,
and assignment truncates from `i32`.

`[§wac-packed-nullable-2knq6wv]` **A packed type cannot be nullable at all.** `u8? b` is refused
everywhere `u8 b` is, and so is `u8?[]` — even though that one is a nullable-*reference* array whose
storage is perfectly real. The reason is what you could do with an element: unwrapping it gives a
`u8`, and a `u8` cannot be a local, a parameter, a field or a return type, so the value has nowhere
to go. A type whose values cannot be held is not a type.

Write `i32?` for a maybe-absent small integer, or a packed array with a separate `bool[]` of presence
flags — which is also what a large, mostly-absent one should be for the sake of the allocation.

A packed element reads as `i32`, so it can be cast onward like any other `i32`.

```wac
export i64 wideByte(u8[] bytes) { return bytes[0] as i64; }
```

`[§wac-arr-packed-cast-nfe1ha9]` `wideByte` on a byte of `200` returns `200` as an `i64`.

Compound assignment and `++`/`--` work on packed elements. The element is read
zero-extended, the operation runs at `i32` width, and the result truncates back
to the element width on store.

```wac
export i32 packedOr(i32 a, i32 b) {
  u8[] bytes = u8[1]();
  bytes[0] = a;
  bytes[0] |= b;
  return bytes[0];
}

export i32 packedWrap(i32 a, i32 b) {
  u8[] bytes = u8[1]();
  bytes[0] = a;
  bytes[0] += b;
  return bytes[0];
}
```

`[§wac-arr-i8-compound-t7btdiv]` `packedOr(0xF0, 0x0F)` returns `255`.
`[§wac-arr-i8-cwrap-8qsspoh]` `packedWrap(250, 10)` returns `4` — the store truncates to 8 bits.
`[§wac-arr-i16-compound-6i4h16a]` The same holds for `u16[]`: `0x00FF |= 0xFF00` gives `65535`.
`[§wac-arr-i8-incr-tlkmjp0]` `bytes[0]++` on a packed element increments in place.

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
