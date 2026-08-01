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

`>>>` is a compile error on an unsigned type: `>>` is already the logical shift
there, so `>>>` would be asking for what it already has. See
[operators.md](operators.md).

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
export f32 float32() { return 3.14; }   // f32 by context — see "Float literals" below
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

#### Detecting overflow

Wrapping is the only arithmetic wac has, and that is deliberate: it is what wasm does, and the
codecs and hashes built on wac depend on it — Poly1305's borrow trick and ChaCha20's adds are
wrapping by design, and a trapping `+` would make them wrong.

There is no checked operator. What exists instead are two idioms, which work today and are written
down here because they were not written down anywhere:

**Widen, then narrow with `as!`.** For any type narrower than 64 bits, compute in the wider type and
let the checked cast catch it:

```wac
i32 sum(i32 a, i32 b) { return (a as i64 + b as i64) as! i32; }   // traps if it would not fit
u32 mul(u32 a, u32 b) { return (a as u64 * b as u64) as! u32; }
```

`[§wac-overflow-detect-8jqm4wn]` `sum(2147483647, 1)` traps; `sum(2000000000, 100)` returns
`2000000100`.

**Compare against an operand.** For 64-bit types there is no wider one, so unsigned wrap is detected
by the result going backwards:

```wac
bool addWraps(u64 a, u64 b) { return a + b < a; }
```

`[§wac-overflow-detect-8jqm4wn]` True exactly when the addition wrapped. Signed 64-bit overflow needs
the sign test — the operands agree in sign and the result does not:

```wac
bool addOverflows(i64 a, i64 b) { i64 s = a + b; return (a < 0) == (b < 0) && (s < 0) != (a < 0); }
```

`[§wac-overflow-detect-8jqm4wn]` True exactly when the addition overflowed.

A checked operator — `+!`, reading like the casts, where `!` already means "or trap" — is the obvious
next step and is deliberately not taken yet. The idioms above cover the cases that have come up, and
a new token per operator is a large surface to add before something needs it. Tracked as issue 0033.

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

### Float literals

A float literal follows the same rule: it takes `f32` when `f32` is expected, and is
`f64` otherwise.

```wac
f32 a = 1.5;          // f32, by context
f64 b = 1.5;          // f64
f32 c = 3.14159;      // f32, rounded — as decimal notation always rounds
```

`[§wac-float-literal-ctx-8dqm2vw]` All three are accepted, in every position an
expected type exists: locals, returns, arguments, struct fields, array literals,
compound assignments and ternary branches.

Rounding to nearest is expected rather than an error. `0.1` is inexact in `f64` too, so
requiring exactness would reject `3.14159` and leave the rule useless. A literal whose
magnitude overflows `f32` is refused, because that is a value it does not denote:
`[§wac-float-literal-ctx-8dqm2vw]` `f32 x = 1.0e40;` is a compile error.

Until this rule existed, no float literal could be an `f32` at all and every one needed
`as~ f32` — the *truncating* cast, which reads as though the loss were the point.

An exponent alone makes a float — the decimal point is optional:
`[§wac-float-exponent-7mkq3wv]` `1e9`, `1E10` and `2e-3` are float literals, as are `1.5e10` and
`1.5e+10`.

It has to be a *real* exponent: `1e` and `1electron` are the integer `1` followed by an identifier,
and `0x1e5` is hex, where `e` is a digit. `[§wac-float-exponent-7mkq3wv]`

This used to require the point, and `1e9` lexed as `1` followed by the identifier `e9` — a rule the
grammar stated deliberately, but a poor one: `1e9` for a billion is common, every language in this
family accepts it, and an exponent marks a float as unambiguously as a point does. See issue 0018.

A **decimal** literal is a magnitude. It takes the narrowest integer type that
holds it: `42` is `i32`, `1000000000000` is `i64`. A decimal past `i64`'s range
is only writable where a `u64` is expected.

Negation is folded into this, so a signed type's most negative value is
spellable in decimal even though its magnitude is one past the positive range:

```wac
export i32 min() { return -2147483648; }
```

`[§wac-litctx-minint-p9fk4wq]` `min()` returns `-2147483648`.

A **hex** literal is a bit pattern, read as two's complement **at the width it
is being read into**. So an 8-digit hex literal with the high bit set is
negative in a 32-bit type — which lets masks and polynomials be written as the
constants they are rather than as their signed decimal equivalents — and the
same digits in a 64-bit type are the positive value those 32 bits denote.

```wac
export i32 mask32() { return 0xFFFFFFFF; }
export i64 mask64() { i64 v = 0xFFFFFFFF; return v; }
```

`[§wac-hex-width-3nkq7wm]` `mask32()` returns `-1` and `mask64()` returns
`4294967295`. Both are the same 32 bits; what differs is how many bits the
reader asked for. Reading at the digit width and *then* widening gave `-1` for
both, which made every 32-bit mask and every limb of a large prime wrong in
64-bit code (issue 0054).

Where nothing is expected of it, the width comes from the digit count — up to 8
digits is `i32`, 9 to 16 digits is `i64`.

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

More than 16 hex digits is an error, as is a decimal literal past `u64`'s
range.

Where nothing is expected of it, a literal keeps the width its own notation
gives it — including as an operand of an operator, so an `i64` literal stays
`i64` rather than narrowing to meet the other side.

The **other operand counts as an expectation**, in either order and whether or not the literal is
negated:

```wac
export bool f(i32 x) { return -2147483648 <= x; }   // the literal is an i32
export bool g(i32 x) { return x >= -2147483648; }   // and so is this one
```

`[§wac-int-context-9wkq4mz]` Both compile. `-2147483648` is a unary minus over a magnitude that
needs 64 bits, so with genuinely nothing expected of it — `i64 n = -2147483648 + 1;` — it is an
i64 and the arithmetic around it is too. That is the same rule, not an exception to it.

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

### Float representation

`f64.toBits(x)` is the IEEE 754 bit pattern of `x` as a `u64`, and
`f64.fromBits(b)` is the reverse. `f32` has the same pair against `u32`. All four
are reinterpretations — the bits are unchanged and nothing is rounded, checked or
trapped. Each float pairs only with the unsigned integer of its own width; there is
no conversion between widths hiding in them.

```wac
export u64 one()  { return f64.toBits(1.0); }
export f64 back() { return f64.fromBits(0x3FF0000000000000); }
```

`[§wac-f64bits-h3kq9wn]` `one()` returns `0x3FF0000000000000` and `back()` returns
`1.0`.
`[§wac-f64bits-round-r7mf4jp]` `f64.fromBits(f64.toBits(x)) == x` for any non-NaN
`x`, and the two round-trip NaN's payload bits unchanged.
`[§wac-f64bits-zero-w2nk6dq]` `f64.toBits(-0.0) != f64.toBits(0.0)` — the sign bit
is visible even though `-0.0 == 0.0`.

```wac
export u32 oneF32() { return f32.toBits(1.0 as~ f32); }
```

`[§wac-f32bits-m4kq2wp]` `oneF32()` returns `0x3F800000`, and
`f32.fromBits(f32.toBits(x)) == x` for any non-NaN `f32`.

This is the only way to see a float's representation. Without it a program cannot
decompose a float into sign, exponent and mantissa, so nothing that needs the
representation — shortest-round-trip formatting, classification, hashing a float
by value — can be written at all.

### Character literals

`'a'` is an integer literal spelled as a character. Its value is the Unicode
codepoint and its type follows the decimal rule above, so every character
literal is an `i32`. There is no distinct character type.

```wac
export i32 letterA() { return 'a'; }
export i32 newline() { return '\n'; }
export i32 quote()   { return '\''; }
export i32 emoji()   { return '😀'; }
```

`[§wac-charlit-p4kn8wq]` `letterA()` returns `97`.
`[§wac-charlit-esc-h7mf2xj]` `newline()` returns `10` and `quote()` returns `39`.
`[§wac-charlit-cp-r3jw9kt]` `emoji()` returns `128512` — the codepoint, not a
UTF-8 byte. Only for ASCII does a character literal equal one byte of the
corresponding string, so `'é'` is `233` while `"é".len()` is `2`.

Escapes are those of string literals plus `\'`: `\n` `\t` `\r` `\\` `\'` `\"`
`\0`.

`[§wac-charlit-empty-m8qf5np]` `''` is a compile error.
`[§wac-charlit-multi-w2nk7dr]` `'ab'` is a compile error.

Because a character literal is an integer, it can be a `switch` case, which is
its main use — scanning bytes reads as `case 'x':` rather than `case 0x78:`.

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
i32 x = null;                // error: i32 is non-null — `i32?` is the nullable form
i32? y = null;               // ok
```

`[§wac-null-assign-k3fn8wp]` `Point? p = null` compiles.
`[§wac-null-nonnull-m8qj5xf]` `Point q = null` is a compile error.
`[§wac-null-primitive-p7hd6wn]` `i32 x = null` is a compile error — because `i32` is non-null,
not because a primitive cannot be nullable. See *A nullable primitive* below.

#### A nullable primitive

`i32?`, `f64?`, `bool?` — every primitive but `void` may be nullable, and behaves like any
other nullable value:

```wac
i32? a = 2000000000;
i32? b = null;
i32 got = a is null ? 0 : a!;       // 2000000000
i32? c = cond ? 1 : null;           // both branches, as for a reference
```

`[§wac-nullable-primitive-4mzq7vp]` All of these work, at the full range of the type — the
declaration, an assignment, a field, an array element, a call argument, a return, a ternary
branch, a match arm and an enum payload.

**It is boxed.** No wasm numeric type has a null, so a nullable primitive is stored as a
reference to a one-field struct the compiler synthesises, and `!` reads the field back. So `i32?`
costs an allocation per non-null value, where `Point?` costs nothing beyond the reference that
was there anyway. Where that matters — a large array of mostly-absent numbers — a parallel
`bool[]` of presence flags is cheaper and says the same thing.

`ref.i31` would have been free, and is what this used to do. It holds 31 bits, so
`i32? a = 2000000000` silently came back as `-147483648`: a wrong answer with no diagnostic, at
exactly the values a program is most careful about. The allocation is the price of that not
happening [issue 0045].

**At the host boundary it is a reference like any other.** A JS caller receives an opaque
reference from `i32? f()`, not a number, exactly as it does for a struct — so reading one needs an
accessor written in wac:

```wac
export i32 read(i32? x) { return x is null ? -1 : x!; }
```

`bindgen` omits an export whose signature mentions a nullable type rather than guessing at a
representation for it.

#### Unwrap operator `!`

`!` on a nullable reference asserts non-null. Maps to `ref.as_non_null` —
traps if null.

```wac
Point? q = findPoint();
Point p = q!;                      // traps if q is null
i32 x = q!.x;                     // unwrap then access
```

`[§wac-unwrap-trap-y1iep2p]` Unwrapping `null` traps. For a boxed primitive the trap comes from
the cast that reads the box rather than from `ref.as_non_null`, which is the same trap by another
name.

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
