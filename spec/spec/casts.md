## Casts

No implicit conversions between any types, with one exception: a subtype
reference is implicitly assignable to a parent type (`Rect` to `Shape`). This isn't a conversion — the reference is unchanged, just viewed as the parent
type. Similarly, `T` is implicitly assignable to `T?` (non-null widens to
nullable).

Wac has two cast systems:
numeric cast variants and reference casts. The compiler distinguishes them
by operand type.

### Numeric casts

Four cast operators select the conversion behavior for primitive types.

#### `as` — lossless

Always preserves all information. Compile error if the conversion could lose
information.

```wac
i32 x = 42;
i64 big = x as i64;           // sign-extend: always exact
f64 precise = x as f64;       // all i32 values fit in f64
bool flag = true;
i32 n = flag as i32;           // false->0, true->1
```

`[§wac-widen-8va4bye]` `big` is `42`. `precise` is `42.0`. `n` is `1`.

Complete lossless conversions:

```
i32  -> i64       sign-extend
i32  -> f64       exact
f32  -> f64       exact
bool -> i32       false->0, true->1
```

#### `as!` — checked

Succeeds with the exact value or traps. No silent data loss. Using `as!` where
`as` would work is a compile error.

```wac
export i32 safeNarrow(i64 big) {
  return big as! i32;            // traps if outside i32 range
}

```

`[§wac-narrow-ok-2ytx5qj]` `safeNarrow(42 as i64)` returns `42`.
`[§wac-narrow-trap-z7te84b]` `safeNarrow(1000000000000)` traps.

`as!` is defined for **every** numeric pair not covered by `as` above — the
rule is always the same: succeed with the exact value, or trap. For
int-to-int and float-to-int this means a range/fractional-part check; for
int-to-float and float-to-float narrowing it means the source value must
round-trip through the destination type unchanged (NaN is always considered
exactly representable and never traps, regardless of payload bits):

```wac
export f32 exactNarrow(f64 x) {
  return x as! f32;               // traps unless x has an exact f32 value
}
```

`[§wac-narrow-f32-ok-h8fk3wq]` `exactNarrow(0.5)` returns `0.5` (0.5 is exact
in f32). `[§wac-narrow-f32-trap-r5tn9wq]` `exactNarrow(0.1)` traps — 0.1 has
no exact binary representation, so its nearest `f64` and nearest `f32` values
differ.

Complete checked conversions:

```
i64  -> i32       traps if outside i32 range
f64  -> i32       traps if fractional part or outside i32 range
f32  -> i32       traps if fractional part or outside i32 range
f64  -> i64       traps if fractional part or outside i64 range
f32  -> i64       traps if fractional part or outside i64 range
i32  -> f32       traps if the i32 value has no exact f32 representation
i64  -> f32       traps if the i64 value has no exact f32 representation
i64  -> f64       traps if the i64 value has no exact f64 representation
f64  -> f32       traps if the f64 value has no exact f32 representation
```

#### `as~` — nearest

Best approximation, never traps. Rounds to nearest, clamps/saturates on
overflow. Using `as~` where `as` would work is a compile error.

```wac
export i32 roundIt(f64 x) {
  return x as~ i32;              // round to nearest integer
}

export i32 saturate(i64 big) {
  return big as~ i32;            // clamp to i32 range
}

export bool truthy(i32 x) {
  return x as~ bool;             // 0->false, nonzero->true
}
```

`[§wac-round-f2k8mxp]` `roundIt(3.7)` returns `4`. `roundIt(-2.3)` returns
`-2`. `roundIt(2.5)` returns `2` (round half to even).
`[§wac-saturate-n7qw3jl]` `saturate(1000000000000)` returns `2147483647`
(clamped to i32 max). `saturate(-1000000000000)` returns `-2147483648`.
`[§wac-truthy-cagp47u]` `truthy(0)` returns `false`. `truthy(42)` returns `true`.

Like `as!`, `as~` is defined for every numeric pair not covered by `as` — never
a gap, always either round-and-clamp (narrowing to an integer type) or
round-to-nearest (narrowing to a smaller float, or widening an integer into a
float that can't represent every value exactly):

```wac
export i64 roundBig(f64 x) {
  return x as~ i64;
}
```

`[§wac-round-i64-h3fm2wq]` `roundBig(3.7)` returns `4` (as `i64`).
`roundBig(1.0e300)` returns `9223372036854775807` (clamped to `i64` max).

Complete nearest conversions:

```
i64  -> i32       clamp to i32 range
f64  -> i32       round to nearest, clamp on overflow
f32  -> i32       round to nearest, clamp on overflow
f64  -> i64       round to nearest, clamp on overflow
f32  -> i64       round to nearest, clamp on overflow
f64  -> f32       round to nearest f32
i64  -> f64       round to nearest f64
i64  -> f32       round to nearest f32
i32  -> f32       round to nearest f32
i32  -> bool      0->false, nonzero->true
```

#### `as@` — raw

Minimum-effort conversion, never traps — but only defined where a genuinely
distinct "raw" operation exists in the underlying instruction set. Using
`as@` where `as` would work, or where no raw form exists (see below), is a
compile error.

```wac
export i32 truncBits(i64 big) {
  return big as@ i32;            // keep low 32 bits
}

export i32 truncFloat(f64 x) {
  return x as@ i32;              // truncate toward zero, never traps
}
```

`[§wac-raw-trunc64-p4jn2wq]` `truncBits(1000000000000)` returns `-727379968`
(low 32 bits).
`[§wac-raw-truncf-r8kf4mb]` `truncFloat(3.7)` returns `3`.
`truncFloat(-2.3)` returns `-2`.
`[§wac-raw-truncf-nan-w9fk2xq]` `truncFloat(0.0 / 0.0)` returns `0` — NaN never
traps. `truncFloat(1.0e300)` returns `2147483647` — saturates to `i32` max,
never traps.

Complete raw conversions:

```
i64  -> i32       keep low 32 bits
f64  -> i32       truncate toward zero, saturate to i32 min/max on overflow, 0 on NaN
f32  -> i32       truncate toward zero, saturate to i32 min/max on overflow, 0 on NaN
```

These are the only pairs with a raw form distinct from `as~`: integer
narrowing keeps bits instead of clamping, and float-to-int truncates toward
zero instead of rounding to nearest. Every other narrowing pair — `f64 ->
f32`, `i64 -> f64`, `i32 -> f32`, and any conversion to `bool` — has no
operation distinct from `as~`'s rounding, so `as@` is a compile error for
those; use `as~` instead:

```wac
f64 x = 3.14;
f32 y = x as@ f32;    // error: no raw conversion for f64 -> f32, use as~
```

`[§wac-raw-noalt-k3jf7wq]` `x as@ f32` is a compile error.

#### Cast errors

Using the wrong cast variant is a compile error:

```wac
i32 x = 5;
i64 a = x as~ i64;    // error: i32->i64 is lossless, use `as`
i64 b = x as! i64;    // error: i32->i64 is lossless, use `as`
i64 c = x as@ i64;    // error: i32->i64 is lossless, use `as`
```

`[§wac-castop-lossy-k3myl2r]` `x as~ i64` is a compile error.
`[§wac-castop-check-r7zudy3]` `x as! i64` is a compile error.
`[§wac-castop-raw-w5hm9qf]` `x as@ i64` is a compile error.

### Reference casts

Reference upcasts (subtype to parent) use `as` — always safe, no runtime check:

```wac
Rect r = Rect(0.0, 0.0, 10.0, 20.0);
Shape s = r as Shape;           // safe upcast, always succeeds
```

Reference downcasts use `as!` — maps to `ref.cast`, traps if wrong type:

```wac
Shape s = getShape();
Circle c = s as! Circle;        // ref.cast: traps if s is not a Circle
```

`[§wac-ref-upcast-p3kx7wn]` Upcasting a Rect to Shape succeeds.
`[§wac-ref-downcast-q8fm2jd]` Downcasting a Circle `as! Rect` traps.
`[§wac-ref-downcast-ok-r5tn4jk]` Downcasting a Circle `as! Circle` succeeds.

Using `as` for a downcast is a compile error:

```wac
Circle c = s as Circle;         // error: downcast may fail, use as!
```

`[§wac-ref-downcast-err-v2hk8wp]` `s as Circle` (downcast) is a compile error.

`is` and `is not` perform `ref.test` — return `bool`:

```wac
if (s is Circle) { ... }
if (s is not Rect) { ... }
```

Null testing:

```wac
Point? q = getPoint();
if (q is null) { ... }
if (q is not null) { ... }
```

`!` unwraps a nullable reference — maps to `ref.as_non_null`, traps if null.

Unwrap works both as an rvalue and as part of an lvalue chain:

```wac
Point p = q!;          // rvalue: read through nullable
q!.x = 5;             // lvalue: assign through nullable
list.head!.next = n;   // lvalue: chained unwrap + field
```

`[§wac-unwrap-lvalue-k9fn2wp]` Given:

```wac
struct Node { i32 val; Node? next; }
export i32 test() {
  Node a = Node();
  a.val = 10;
  Node b = Node();
  b.val = 20;
  Node? p = b;
  p!.next = a;
  return p!.next!.val;
}
```

`test()` returns `10`.

### i31ref casts

```wac
i31ref small = 42 as! i31ref;   // ref.i31 — checked (i32 may not fit in 31 bits)
i32 n = small as i32;           // i31.get_s — lossless (31 bits always fit in i32)

anyref val = small;
if (val is i31ref) {
  i31ref x = val as! i31ref;    // ref.cast — downcast from anyref
}
```

`[§wac-i31-cast-g1r2xmx]` `42 as! i31ref as i32` returns `42`.

### Summary

The rule is simple: if it can trap, there's a `!`:

```
as    — lossless: always exact, compile error if could lose info
as!   — checked: exact or trap (numeric + reference downcast)
as~   — nearest: best approximation, never traps (round, clamp)
as@   — raw: minimum effort, never traps; only int narrowing and float->int
        truncation have a raw form — compile error elsewhere (use as~)
!     — null unwrap, traps on null
```
