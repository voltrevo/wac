# 08 — Primitives

The primitive types are the numbers and `bool`. Everything else — strings, structs, enums, tuples,
arrays, functions — is a reference to something on the heap.

There are no implicit conversions between any two types. A conversion is always written, and which
operator writes it depends on what it can lose ([24](../3-expressions/24-casts.md)).

## The primitive types

| Type | Values | Wasm representation |
|---|---|---|
| `i8`, `u8` | 8-bit signed / unsigned integer | `i32`; packed as `i8` in arrays and fields |
| `i16`, `u16` | 16-bit signed / unsigned integer | `i32`; packed as `i16` in arrays and fields |
| `i32`, `u32` | 32-bit signed / unsigned integer | `i32` |
| `i64`, `u64` | 64-bit signed / unsigned integer | `i64` |
| `f32` | IEEE 754 binary32 | `f32` |
| `f64` | IEEE 754 binary64 | `f64` |
| `bool` | `true`, `false` | `i32` |

The representation column is not part of the language: nothing a program can observe depends on
it, except where a chapter says so.

`void` and `never` are types without values, and are [11](11-never-and-uninhabited.md)'s subject.
`string` is a reference type ([16](16-strings.md)).

## Signed and unsigned

A signed and an unsigned type of one width hold the same bits; the type decides what an operation
does with them. They differ only where the sign bit changes the answer:

| operation | `i32` | `u32` |
|---|---|---|
| `/` `%` | signed | unsigned |
| `<` `<=` `>` `>=` | signed | unsigned |
| `>>` | arithmetic (sign-extends) | logical (zero-fills) |
| `+` `-` `*` `&` `\|` `^` `<<` `==` `!=` | identical — the same bits either way |

```wac
// expect: answers main = 2147483647
u32 half(u32 x) { return x / 2; }
i32 halfSigned(i32 x) { return x / 2; }

export i32 main() {
  i32 same = halfSigned(-1);               // 0: the same 32 bits, divided signed
  return half(4294967295) as! i32 + same;
}
```

`[§wac-udiv-3kf9wqm]` `half(4294967295)` answers `2147483647`, where `halfSigned(-1)` — the same 32
bits — answers `0`.

There are no implicit conversions between signed and unsigned, in either direction.

## Integer arithmetic wraps

```wac
// expect: answers main = -2147483648
export i32 main() { return 2147483647 + 1; }
```

`[§wac-wrap-uy41uqt]` Integer arithmetic wraps on overflow: `2147483647 + 1` in `i32` is
`-2147483648`.

Every width wraps at its own width, and nothing promotes — not a `u8` to an `i32`, and not an `i32`
to an `i64`:

```wac
// expect: answers main = 300
export i32 main() {
  u8 a = 200;
  u8 b = 100;
  u8 c = a + b;                            // 44: wraps at 8 bits
  return a as i32 + b as i32;              // 300: widened first, then added
}
```

`[§wac-packed-arith-ctd4aqd]` Arithmetic on two values of one type answers that type, at its width.
`u8 + u8` is a `u8`, wrapped at 8 bits.

Wrapping is the only integer arithmetic there is, and that is deliberate: it is what wasm does, and
codecs and hashes depend on it — Poly1305's borrow trick and ChaCha20's adds wrap by design, and a
trapping `+` would make them wrong.

### Detecting overflow

There is no checked arithmetic operator. Two idioms detect overflow instead.

**Widen, then narrow with `as!`.** For a type narrower than 64 bits, compute in the wider type and let
the checked cast catch it:

```wac
// expect: traps main
i32 sum(i32 a, i32 b) { return (a as i64 + b as i64) as! i32; }   // traps if it would not fit
u32 mul(u32 a, u32 b) { return (a as u64 * b as u64) as! u32; }

export i32 main() {
  i32 fine = sum(2000000000, 100);         // 2000000100
  return sum(2147483647, 1);               // traps
}
```

**Compare against an operand.** For 64-bit types there is no wider one. Unsigned wrap is detected by
the result going backwards, and signed overflow by the sign test — the operands agree in sign and the
result does not:

```wac
// expect: answers main = 2
bool addWraps(u64 a, u64 b) { return a + b < a; }

bool addOverflows(i64 a, i64 b) {
  i64 s = a + b;
  return (a < 0) == (b < 0) && (s < 0) != (a < 0);
}

export i32 main() {
  i32 n = 0;
  if (addWraps(18446744073709551615, 1)) { n += 1; }
  if (addOverflows(9223372036854775807, 1)) { n += 1; }
  if (addWraps(1, 2)) { n += 10; }
  return n;
}
```

`[§wac-overflow-detect-8jqm4wn]` Each idiom detects exactly the overflow it is written for:
`sum(2147483647, 1)` traps and `sum(2000000000, 100)` answers `2000000100`; `addWraps` is true
exactly when the unsigned addition wrapped, and `addOverflows` exactly when the signed one
overflowed.

## Floating point

`f32` and `f64` follow IEEE 754: rounding to nearest, signed zeros, infinities and NaN. Division by
zero answers an infinity or NaN; it does not trap.

```wac
// expect: answers main = 3
export i32 main() {
  f64 inf = 1.0 / 0.0;
  f64 nan = 0.0 / 0.0;
  i32 n = 0;
  if (inf > 1.0e308) { n += 1; }
  if (nan != nan) { n += 1; }              // NaN is unequal to everything, itself included
  f64 negZero = -0.0;
  if (negZero == 0.0) { n += 1; }          // the two zeros compare equal
  return n;
}
```

`[§wac-float-ieee-sr8rjq6]` Float arithmetic follows IEEE 754, and float division by zero answers an
infinity or NaN rather than trapping.

### A float's bits

`f64.toBits(x)` is the IEEE 754 bit pattern of `x` as a `u64`, and `f64.fromBits(b)` is the reverse.
`f32` has the same pair against `u32`. All four are reinterpretations — nothing is rounded, checked
or trapped. Each float pairs only with the unsigned integer of its own width.

```wac
// expect: answers main = 1
export i32 main() {
  u64 one = f64.toBits(1.0);               // 0x3FF0000000000000
  f64 back = f64.fromBits(0x3FF0000000000000);   // 1.0
  return one == 0x3FF0000000000000 && back == 1.0 ? 1 : 0;
}
```

`[§wac-f64bits-h3kq9wn]` `f64.toBits(1.0)` answers `0x3FF0000000000000`, and
`f64.fromBits(0x3FF0000000000000)` answers `1.0`.

`[§wac-f64bits-round-r7mf4jp]` `f64.fromBits(f64.toBits(x)) == x` for any non-NaN `x`, and the two
round-trip a NaN's payload bits unchanged.

`[§wac-f64bits-zero-w2nk6dq]` `f64.toBits(-0.0) != f64.toBits(0.0)`: the sign bit is visible even
though `-0.0 == 0.0`.

```wac
// expect: answers main = 1065353216
export u32 main() { return f32.toBits(1.0); }   // 0x3F800000
```

`[§wac-f32bits-m4kq2wp]` `f32.toBits(1.0)` answers `0x3F800000`, and `f32.fromBits(f32.toBits(x)) ==
x` for any non-NaN `f32`.

This is the only way to see a float's representation, and without it nothing that needs one —
shortest round-trip formatting, classification, hashing a float by value — could be written.

## `bool`

`bool` is its own type, not an integer. Comparisons answer `bool`; `&&`, `||` and `!` take and
answer `bool`; a condition must be one.

```wac
// expect: answers main = 5
export i32 main() {
  bool flag = true;
  i32 x = 5;
  if (flag) { return x; }
  return 0;
}
```

`[§wac-strict-tr8nhbk]` A `bool` is a condition: `main()` answers `5`.

```wac
// expect: answers main = 1
export i32 main() {
  i32 x = 5;

  // ERROR: a condition must be bool, not i32
  // if (x) { return 1; }

  if (x != 0) { return 1; }
  return 0;
}
```

`[§wac-boolreq-uj95exp]` An integer is not a condition. `if (x)` is refused; `if (x != 0)` is the
spelling.

## Packed types are ordinary types

`i8`, `u8`, `i16` and `u16` are ordinary types wherever a value can be: a local, a parameter, a field,
a return, a nullable, and the answer of indexing an array of them. The width is a fact about storage,
not a restriction on use.

```wac
// expect: answers main = 200
struct Pixel { u8 r; u8 g; u8 b; }

u8 brightest(Pixel p) {
  u8 best = p.r;
  if (p.g > best) { best = p.g; }
  if (p.b > best) { best = p.b; }
  return best;
}

export i32 main() {
  u8? maybe = null;
  u8[] bytes = [7, 200, 9];
  u8 second = bytes[1];                    // indexing a u8[] answers a u8
  return brightest(Pixel(10, second, 30)) as i32;
}
```

`[§wac-packed-ordinary-kawnzqm]` A packed type may be the type of a local, a parameter, a field, a
return value or a nullable, and indexing an array of it answers it.

A packed type converts like any other number — widening with `as`, narrowing with a cast that says
what to do with what does not fit ([24](../3-expressions/24-casts.md)):

```wac
// expect: answers main = 255
export i32 main() {
  i32 n = 511;
  u8[] xs = [0];

  // ERROR: expected u8, got i32
  // u8 a = n;

  // ERROR: expected i32, got u8
  // i32 c = xs[0];

  u8 b = n as@ u8;                         // 255: the low 8 bits
  xs[0] = b;
  return xs[0] as i32;                     // widens; every u8 fits
}
```

`[§wac-packed-no-coercion-udspvhv]` A packed value and a wider integer do not convert implicitly in
either direction, including when one of them is an array element.

## Reference types

Structs, enums, tuples, arrays, strings and function values are references to values the garbage
collector manages. There is no manual freeing, and no use after free.

A reference is non-null unless its type says otherwise: `T` is never null, `T?` may be
([10](10-nullability.md)). Two further reference types name no declaration:

- `anyref` is the top of the reference types: any reference converts to it.
- `i31ref` is a 31-bit integer held as a reference, with no allocation.

```wac
// expect: answers main = 42
struct Point { i32 x; i32 y; }

export i32 main() {
  i32 n = 42;
  i31ref small = n as! i31ref;             // checked: n must fit in 31 bits; no allocation
  anyref[] items = [small, Point(1, 2)];   // an i31ref and a struct, one array

  if (i31ref x matches items[0]) {
    return x as i32;                       // signed extraction
  }
  return 0;
}
```

`[§wac-i31ref-0i4w6qt]` An `i31ref` holds a 31-bit integer without allocating, converts to `anyref`,
and gives its value back with `as i32`.

## A default is an absence

A type has a default value only if there is a value that means "nothing yet". `T?` has one — `null`
— and so does `T[]`, the empty array. A number does not: zero is a number somebody might have meant.

```wac
// expect: answers main = 1
struct Rgb { u8 r; u8 g; u8 b; }

export i32 main() {
  i32 n;                                   // no default: unassigned until written
  Rgb? p;                                  // null
  Rgb[] xs;                                // empty

  // ERROR: 'n' is read before it is assigned
  // i32 early = n;

  n = 1;
  if (p is null && xs.len() == 0) { return n; }
  return 0;
}
```

`[§wac-default-absence-8mxpz7y]` A nullable type's default is `null` and an array type's is the empty
array. A numeric type and `bool` have none.

`[§wac-local-unassigned-txsix97]` A local declared without an initialiser, whose type has no default, is
unassigned until it is written. Reading it before that is refused.

A struct has a default exactly when every field has one ([12](12-structs.md)), and an array of a type
with no default cannot be created by defaulting its elements ([15](15-arrays.md)).
