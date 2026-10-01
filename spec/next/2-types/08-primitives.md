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
// expect: answers half(4294967295) = 2147483647
// expect: answers halfSigned(-1) = 0
export u32 half(u32 x) { return x / 2; }
export i32 halfSigned(i32 x) { return x / 2; }   // the same 32 bits, divided signed
```

`[§wac-udiv-3kf9wqm]` `half(4294967295)` answers `2147483647`, where `halfSigned(-1)` — the same 32
bits — answers `0`.

There are no implicit conversions between signed and unsigned, in either direction.

## Integer arithmetic wraps

```wac
// expect: answers next(2147483647) = -2147483648
export i32 next(i32 x) { return x + 1; }
```

`[§wac-wrap-uy41uqt]` Integer arithmetic wraps on overflow: `2147483647 + 1` in `i32` is
`-2147483648`.

Every width wraps at its own width, and nothing promotes — not a `u8` to an `i32`, and not an `i32`
to an `i64`:

```wac
// expect: answers addBytes(200, 100) = 44
// expect: answers addWidened(200, 100) = 300
export u8 addBytes(u8 a, u8 b) { return a + b; }                     // wraps at 8 bits
export i32 addWidened(u8 a, u8 b) { return a as i32 + b as i32; }    // widened first, then added
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
// expect: answers sum(2000000000, 100) = 2000000100
// expect: traps sum(2147483647, 1)
// expect: answers mul(65535, 65537) = 4294967295
// expect: traps mul(65536, 65536)
export i32 sum(i32 a, i32 b) { return (a as i64 + b as i64) as! i32; }   // traps if it would not fit
export u32 mul(u32 a, u32 b) { return (a as u64 * b as u64) as! u32; }
```

**Compare against an operand.** For 64-bit types there is no wider one. Unsigned wrap is detected by
the result going backwards, and signed overflow by the sign test — the operands agree in sign and the
result does not:

```wac
// expect: answers addWraps(18446744073709551615, 1) = true
// expect: answers addWraps(1, 2) = false
// expect: answers addOverflows(9223372036854775807, 1) = true
// expect: answers addOverflows(-1, 1) = false
export bool addWraps(u64 a, u64 b) { return a + b < a; }

export bool addOverflows(i64 a, i64 b) {
  i64 s = a + b;
  return (a < 0) == (b < 0) && (s < 0) != (a < 0);
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
// expect: answers infinite = true
// expect: answers nanUnequal = true
// expect: answers zerosEqual = true
export bool infinite() {
  f64 inf = 1.0 / 0.0;
  return inf > 1.0e308;
}

export bool nanUnequal() {
  f64 nan = 0.0 / 0.0;
  return nan != nan;                       // NaN is unequal to everything, itself included
}

export bool zerosEqual() {
  f64 negZero = -0.0;
  return negZero == 0.0;                   // the two zeros compare equal
}
```

`[§wac-float-ieee-sr8rjq6]` Float arithmetic follows IEEE 754, and float division by zero answers an
infinity or NaN rather than trapping.

### A float's bits

`f64.toBits(x)` is the IEEE 754 bit pattern of `x` as a `u64`, and `f64.fromBits(b)` is the reverse.
`f32` has the same pair against `u32`. All four are reinterpretations — nothing is rounded, checked
or trapped. Each float pairs only with the unsigned integer of its own width.

```wac
// expect: answers bitsOf(1.0) = 0x3FF0000000000000
// expect: answers floatOf(0x3FF0000000000000) = 1.0
export u64 bitsOf(f64 x) { return f64.toBits(x); }
export f64 floatOf(u64 b) { return f64.fromBits(b); }
```

`[§wac-f64bits-h3kq9wn]` `f64.toBits(1.0)` answers `0x3FF0000000000000`, and
`f64.fromBits(0x3FF0000000000000)` answers `1.0`.

`[§wac-f64bits-round-r7mf4jp]` `f64.fromBits(f64.toBits(x)) == x` for any non-NaN `x`, and the two
round-trip a NaN's payload bits unchanged.

`[§wac-f64bits-zero-w2nk6dq]` `f64.toBits(-0.0) != f64.toBits(0.0)`: the sign bit is visible even
though `-0.0 == 0.0`.

```wac
// expect: answers bitsOf32(1.0) = 1065353216
export u32 bitsOf32(f32 x) { return f32.toBits(x); }   // 0x3F800000 for 1.0
```

`[§wac-f32bits-m4kq2wp]` `f32.toBits(1.0)` answers `0x3F800000`, and `f32.fromBits(f32.toBits(x)) ==
x` for any non-NaN `f32`.

This is the only way to see a float's representation, and without it nothing that needs one —
shortest round-trip formatting, classification, hashing a float by value — could be written.

## `bool`

`bool` is its own type, not an integer. Comparisons answer `bool`; `&&`, `||` and `!` take and
answer `bool`; a condition must be one.

```wac
// expect: answers whenFlag(true) = 5
// expect: answers whenFlag(false) = 0
export i32 whenFlag(bool flag) {
  i32 x = 5;
  if (flag) { return x; }
  return 0;
}
```

`[§wac-strict-tr8nhbk]` A `bool` is a condition: `whenFlag(true)` answers `5`.

```wac
// expect: answers nonZero(5) = 1
// expect: answers nonZero(0) = 0
export i32 nonZero(i32 x) {
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
// expect: answers brightestOfThree = 200
struct Pixel { u8 r; u8 g; u8 b; }

u8 brightest(Pixel p) {
  u8 best = p.r;
  if (p.g > best) { best = p.g; }
  if (p.b > best) { best = p.b; }
  return best;
}

export i32 brightestOfThree() {
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
// expect: answers lowByte(511) = 255
export i32 lowByte(i32 n) {
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
// expect: answers throughAnyref = 42
struct Point { i32 x; i32 y; }

export i32 throughAnyref() {
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
— and so do `T[]` and `string`, which are empty. A number does not: zero is a number somebody might have
meant.

```wac
// expect: answers assignedLater = 1
struct Rgb { u8 r; u8 g; u8 b; }

export i32 assignedLater() {
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

`[§wac-default-absence-8mxpz7y]` A nullable type's default is `null`, an array type's is the empty
array, and `string`'s is the empty string. A numeric type and `bool` have none.

`[§wac-local-unassigned-txsix97]` A local declared without an initialiser, whose type has no default, is
unassigned until it is written. Reading it before that is refused.

## Definite assignment

Whether a local is assigned is decided by the paths that reach each use of it. A local is **definitely
assigned** at a point when every path from its declaration to that point assigns it:

```wac
// expect: answers sign(-5) = -1
// expect: answers sign(0) = 0
// expect: answers sign(3) = 1
export i32 sign(i32 n) {
  i32 s;
  if (n < 0) { s = -1; } else if (n == 0) { s = 0; } else { s = 1; }
  return s;                                // every path assigned s
}

export i32 onlySometimes(i32 n) {
  i32 s;
  if (n < 0) { s = -1; }

  // ERROR: 's' may be read before it is assigned — not every path assigns it
  // return s;

  return 0;
}
```

`[§wac-assign-every-path-r2q2iti]` A local is definitely assigned at a point when every path from its declaration to
that point assigns it. Where paths join — after an `if`, a `switch`, a `match` or a ternary — it is assigned only if
it is on every one of them.

Conditions are not evaluated to prune paths, with the one exception [25](../3-expressions/25-control-flow.md)
already makes: `while (true)` and a `for` with no condition leave only by `break`. A path that does not continue —
it ends in `return`, `trap`, `break` or `continue`, or in an expression of type `never`
([11](11-never-and-uninhabited.md)) — reaches nothing after it, and so constrains nothing:

```wac
// expect: answers checked(4) = 4
// expect: traps checked(-1)
// expect: answers firstOver([1, 5, 9], 4) = 5
export i32 checked(i32 n) {
  i32 v;
  if (n >= 0) { v = n; } else { trap "negative"; }
  return v;                                // the trapping path never gets here
}

export i32 firstOver(i32[] xs, i32 limit) {
  i32 found;
  i32 i = 0;
  while (true) {
    if (xs[i] > limit) { found = xs[i]; break; }   // the only way out assigns found
    i++;
  }
  return found;
}

export i32 maybeOver(i32[] xs, i32 limit) {
  i32 found;
  for (i32 x in xs) {
    if (x > limit) { found = x; break; }
  }

  // ERROR: 'found' may be read before it is assigned — the loop can end without assigning it
  // return found;

  return -1;
}
```

`[§wac-assign-exits-4tnnmsb]` A path ending in `return`, `trap`, `break`, `continue` or a `never` expression does not
reach the code after it. After a loop, a local is assigned if every path leaving the loop assigned it — each
`break`, and the condition failing, which a loop with a condition can do before its body runs.

### A default fills in only where it is needed

A local whose type has a default need not be assigned before it is read. Where a read can reach it unassigned, it
holds the default:

```wac
// expect: answers retries(true) = 7
// expect: answers retries(false) = 3
struct Conn {
  i32 retries = 3;
  i32[] log;
}

export i32 retries(bool configured) {
  Conn c;
  if (configured) { c = Conn { retries: 7 }; }
  return c.retries;                        // assigned on one path; Conn's default on the other
}
```

`[§wac-assign-default-on-demand-t2bh3qh]` A local of a type with a default that a read can reach unassigned holds the
default there. A local of a type with none is refused at that read (`wac-local-unassigned`).

The default is built as if at the declaration, once each time the declaration runs, and only when some read can
reach the local unassigned. A local assigned on every path before it is read never has a default built — which is
how `Point p;` stays legal for a `Point` with no default, as long as nothing reads it first.

### A lambda captures only what is assigned

A lambda captures by reference ([20](20-functions-and-funcrefs.md)), and the analysis cannot see when it will
run. So a lambda may capture a local only where the local is definitely assigned:

```wac
// expect: answers capturedLater(5) = 5
export i32 capturedLater(i32 n) {
  i32 k;

  // ERROR: 'k' is captured before it is assigned
  // fn<i32()> early = () => k;

  k = n;
  fn<i32()> late = () => k;
  return late();
}
```

`[§wac-assign-capture-6tpr5ix]` A lambda that uses a local, to read or to write it, is refused where that local is not
definitely assigned.

### Struct and tuple locals are assigned part by part

A struct or tuple local declared without an initialiser may have its fields or members assigned one at a time
([12](12-structs.md), [14](14-tuples.md)). Until the local is first used as a whole — read, passed, returned, a
method called on it, a field read from it, or captured — each part is tracked as a local of its own. At that first
use every part must be definitely assigned, or have a default, which fills it there.

`[§wac-assign-parts-usxj6ha]` Until its first use, a struct or tuple local's fields or members are tracked separately.
At the first use, each must be definitely assigned or have a default; one with neither is refused.

A struct has a default exactly when every field has one ([12](12-structs.md)), and an array of a type
with no default cannot be created by defaulting its elements ([15](15-arrays.md)).
