## Types

### Primitive types

| wac type | Wasm type | Notes |
|----------|-----------|-------|
| i32      | i32       | 32-bit signed integer, -2147483648 to 2147483647 |
| i64      | i64       | 64-bit signed integer |
| u32      | i32       | 32-bit unsigned integer, 0 to 4294967295 |
| u64      | i64       | 64-bit unsigned integer, 0 to 18446744073709551615 |
| f32      | f32       | 32-bit IEEE 754 float, ~7 decimal digits |
| f64      | f64       | 64-bit IEEE 754 float, ~15 decimal digits |
| bool     | i32       | Type-checked: conditionals must be bool, not interchangeable with i32 |
| string   | ref $string | Immutable UTF-8 string, see [strings.md](strings.md) |
| i8       | i8 (packed) | Array element only — no locals, params, or struct fields |
| i16      | i16 (packed) | Array element only — no locals, params, or struct fields |

Integer arithmetic wraps on overflow. Float arithmetic follows IEEE 754.

### Signed and unsigned

Wasm has no signed types — an `i32` is 32 bits, and signedness lives in the
*instruction* (`div_s` vs `div_u`, `lt_s` vs `lt_u`, `shr_s` vs `shr_u`). wac
works the same way: `u32` and `i32` compile to the same wasm type and the same
storage, and the wac type decides which opcode is emitted. Nothing about the
representation is visible.

So the two differ only where the sign bit changes the answer:

| operation | i32 | u32 |
|---|---|---|
| `/` `%` | signed | unsigned |
| `<` `<=` `>` `>=` | signed | unsigned |
| `>>` | arithmetic (sign-extends) | logical (zero-fills) |
| `+` `-` `*` `&` `|` `^` `<<` `==` `!=` | identical — same bits either way |

`>>>` still means "logical shift" and is accepted on unsigned types, where it
is the same instruction as `>>`.

```wac
export u32 half(u32 x) { return x / (2 as@ u32); }
export i32 halfSigned(i32 x) { return x / 2; }
```

`[§wac-udiv-3kf9wqm]` `half(4294967295)` returns `2147483647`, where
`halfSigned(-1)` — the same 32 bits — returns `0`.

There are no implicit conversions between signed and unsigned, in either
direction. See [casts.md](casts.md) for how to move between them.

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

### Integer literals

Decimal and hex literals are typed by different rules, because they are used to
mean different things.

A literal first takes whatever integer type is **expected** of it, provided the
value has a reading there. That is what lets unsigned code be written without a
cast on every constant:

```wac
export u32 twice(u32 x) { return x * 2; }        // 2 is a u32 here
export i64 five()       { return 5; }            // 5 is an i64 here
export u64 max()        { return 18446744073709551615; }
```

`[§wac-litctx-w7kn2mf]` `twice(2147483648)` returns `0` — the `2` is a `u32`,
so the multiply wraps at 32 bits rather than promoting.

Adoption is only ever a *reinterpretation of the same written value*, never a
conversion: a literal that does not fit is an error, and a **variable** never
coerces.

```wac
u32 a = -1;             // error: -1 has no u32 reading
i32 b = 5000000000;     // error: does not fit i32
u32 c(i32 x) { return x; }   // error: variables never coerce
```

`[§wac-litctx-nofit-k3mq8wl]` Each of these is a compile error.

With no expected type, a literal falls back to its own notation.

A **decimal** literal is a magnitude. It takes the narrowest integer type that
holds it: `42` is `i32`, `1000000000000` is `i64`. A decimal past `i64`'s range
is only writable where a `u64` is expected.

Negation is folded into this, so a signed type's most negative value is
spellable in decimal even though its magnitude is one past the positive range:

```wac
export i32 min() { return -2147483648; }
```

`[§wac-litctx-minint-p9fk4wq]` `min()` returns `-2147483648`.

A **hex** literal is a bit pattern. Its width comes from the digit count — up
to 8 digits is `i32`, 9 to 16 digits is `i64` — and the digits are read as
two's complement at that width. So an 8-digit hex literal with the high bit set
is negative, which lets masks and polynomials be written as the constants they
are rather than as their signed decimal equivalents.

```wac
export i32 poly()     { return 0xEDB88320; }
export i32 allOnes()  { return 0xFFFFFFFF; }
export i32 signBit()  { return 0x80000000; }
export i64 wide()     { return 0x0EDB88320; }
```

`[§wac-hexlit-i32-47spr0b]` `poly()` returns `-306674912`.
`[§wac-hexlit-ones-9bg3jtx]` `allOnes()` returns `-1`.
`[§wac-hexlit-sign-8wckct3]` `signBit()` returns `-2147483648`.
`[§wac-hexlit-pad-9qw60ul]` `wide()` returns `3988292384` — padding to 9 digits selects `i64`, giving the positive value.

More than 16 hex digits is an error, as is a decimal literal past the `i64`
range.

A literal's width comes from the literal itself, not from where it appears, so an
`i64` literal is `i64` even as an operand where no type is being pushed down.

```wac
i64 big() { return 1000000000000; }
export bool bigMatches() { return big() == 1000000000000; }
export bool bigCompare(i64 x) { return x < 1000000000000; }
```

`[§wac-i64lit-operand-4k1n3ev]` `bigMatches()` returns `true`.
`[§wac-i64lit-cmp-hnbz7ev]` `bigCompare(5)` returns `true`.

Underscores may be used as separators anywhere after the first digit, in either
notation, and carry no meaning. They are removed before the digits are counted,
so they cannot change a literal's width.

```wac
export i32 grouped()  { return 0xEDB8_8320; }
export i32 million()  { return 1_000_000; }
```

`[§wac-numsep-qpeegkw]` `grouped()` returns `-306674912` and `million()` returns `1000000`.

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
