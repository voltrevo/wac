# 24 — Casts

There are no implicit conversions between types. A reference may be used as a parent type, and a `T` where a
`T?` or a `const T` is wanted — neither is a conversion, since the value is unchanged.

Every other conversion is written, with one of four operators, and the operator says what the conversion
costs. Exactly one applies to each pair of types, so the spelling is never a choice:

| operator | meaning | can trap |
|---|---|---|
| `as` | lossless: always exact | no |
| `as!` | checked: the exact value, or a trap | yes |
| `as~` | nearest: round and clamp | no |
| `as@` | raw: keep the bits, truncate toward zero | no |

If it can trap, its spelling contains `!`.

## `as` — lossless

`as` is defined exactly where no value of the source can lose information in the destination:

```wac
// expect: answers toI64(-1) = -1
// expect: answers toF64(42) = 42.0
// expect: answers fromBool(true) = 1
// expect: answers fromBool(false) = 0
// expect: answers fromU8(200) = 200
export i64 toI64(i32 x) { return x as i64; }      // sign-extends
export f64 toF64(i32 x) { return x as f64; }      // every i32 fits in an f64
export i32 fromBool(bool b) { return b as i32; }  // false -> 0, true -> 1
export i32 fromU8(u8 b) { return b as i32; }      // every u8 fits
```

`[§wac-widen-8va4bye]` `i32 as i64` sign-extends, `i32 as f64` is exact, and `bool as i32` is `0` or `1`.

The complete lossless conversions:

```text
i8, i16          -> i32, i64, f32, f64        sign-extend / exact
u8, u16          -> i32, u32, i64, u64, f32, f64   zero-extend / exact
i8 -> i16        u8 -> u16, i16
i32              -> i64, f64
u32              -> i64, u64, f64
f32              -> f64
bool             -> every integer and float type    false -> 0, true -> 1
```

`[§wac-lossless-unsigned-4qmt8xv]` The table above is complete: these pairs, and no others, take `as`.

`i32 -> u64` is not lossless: an `i32` can be negative and a `u64` cannot, so it is checked. That is the whole
reason this is a table and not "a wider destination".

`[§wac-cast-packed-ordinary-65bdykv]` A packed type converts like any other number: widening out of one is `as`, and
narrowing into one is `as!`, `as~` or `as@`.

## `as!` — checked

`as!` answers the exact value or traps. It is defined for every numeric pair `as` is not:

```wac
// expect: answers safeNarrow(42) = 42
// expect: traps safeNarrow(1000000000000)
// expect: answers exact(3.0) = 3
// expect: traps exact(3.5)
// expect: traps exact(-2.3)
// expect: answers exactNarrow(0.5) = 0.5
// expect: traps exactNarrow(0.1)
export i32 safeNarrow(i64 big) { return big as! i32; }
export i32 exact(f64 x) { return x as! i32; }
export f32 exactNarrow(f64 x) { return x as! f32; }
```

`[§wac-narrow-ok-2ytx5qj]` `safeNarrow(42)` answers `42`.

`[§wac-narrow-trap-z7te84b]` `safeNarrow(1000000000000)` traps.

`[§wac-narrow-frac-t6kq2wp]` A fractional part is inexactness: `exact(3.0)` is `3`, and `exact(3.5)` and
`exact(-2.3)` trap.

`[§wac-narrow-f32-ok-h8fk3wq]` `exactNarrow(0.5)` answers `0.5`.

`[§wac-narrow-f32-trap-r5tn9wq]` `exactNarrow(0.1)` traps: 0.1's nearest `f64` and nearest `f32` differ.

For a float destination the source must round-trip through it unchanged. NaN is always considered exact and
never traps.

`[§wac-cast-bang-redundant-6qw3nkf]` `as!` where `as` would do is refused.

## `as~` — nearest

`as~` takes the nearest value and never traps: it rounds to nearest, ties to even, and clamps at the ends of
the destination's range:

```wac
// expect: answers roundIt(3.7) = 4
// expect: answers roundIt(-2.3) = -2
// expect: answers roundIt(2.5) = 2
// expect: answers roundIt(3.5) = 4
// expect: answers saturate(1000000000000) = 2147483647
// expect: answers saturate(-1000000000000) = -2147483648
// expect: answers truthy(0) = false
// expect: answers truthy(42) = true
// expect: answers roundBig(3.7) = 4
// expect: answers roundBig(1.0e300) = 9223372036854775807
export i32 roundIt(f64 x) { return x as~ i32; }
export i32 saturate(i64 big) { return big as~ i32; }
export bool truthy(i32 x) { return x as~ bool; }
export i64 roundBig(f64 x) { return x as~ i64; }
```

`[§wac-round-f2k8mxp]` A float rounds to the nearest integer, ties to even: `3.7` is `4`, `-2.3` is `-2`, `2.5`
is `2`.

`[§wac-saturate-n7qw3jl]` An integer out of range clamps: `1000000000000 as~ i32` is `2147483647`.

`[§wac-truthy-cagp47u]` `as~ bool` is "nonzero is true".

`[§wac-round-i64-h3fm2wq]` Rounding into `i64` clamps as well: `1.0e300 as~ i64` is `9223372036854775807`.

`[§wac-cast-matrix-6hkq4wz]` Every numeric type converts to `bool` with `as~` — nonzero, and NaN, are true —
and with `as!`, which accepts exactly `0` or `1`. Signed and unsigned clamp into the destination's range
whatever the pair: `i64 -1 as~ u64` is `0`.

`[§wac-cast-tilde-redundant-2xk9mrp]` `as~` where `as` would do is refused.

## `as@` — raw

`as@` exists only where a raw operation differs from rounding: integer narrowing keeps the low bits, a float
to an integer truncates toward zero, and a same-width signedness change reads the same bits the other way.
It never traps:

```wac
// expect: answers truncBits(1000000000000) = -727379968
// expect: answers truncFloat(3.7) = 3
// expect: answers truncFloat(-2.3) = -2
// expect: answers truncNaN = 0
// expect: answers truncFloat(1.0e300) = 2147483647
// expect: answers toUnsigned(-1) = 4294967295
// expect: answers toSigned(4294967295) = -1
export i32 truncBits(i64 big) { return big as@ i32; }
export i32 truncFloat(f64 x) { return x as@ i32; }

export i32 truncNaN() {
  f64 zero = 0.0;
  return truncFloat(zero / zero);
}

export u32 toUnsigned(i32 x) { return x as@ u32; }        // the same bits; emits nothing
export i32 toSigned(u32 x) { return x as@ i32; }
```

`[§wac-raw-trunc64-p4jn2wq]` Integer narrowing with `as@` keeps the low bits: `1000000000000 as@ i32` is
`-727379968`.

`[§wac-raw-truncf-r8kf4mb]` A float to an integer truncates toward zero: `3.7` is `3`, `-2.3` is `-2`.

`[§wac-raw-truncf-nan-w9fk2xq]` NaN gives `0`, and out-of-range values saturate.

`[§wac-usign-raw-m2kf7wq]` A same-width signedness change keeps every bit: `-1 as@ u32` is `4294967295`, and
back is `-1`.

Every other narrowing — `f64 -> f32`, an integer to a float, anything to `bool` — has no raw form distinct from
rounding, so `as@` is refused there:

```wac
// expect: answers narrowed(3.5, -1) = 3.5
export f32 narrowed(f64 x, i32 i) {
  // ERROR: no raw conversion for f64 -> f32, use as~
  // f32 y = x as@ f32;

  // ERROR: i32 -> u64 has no raw form: sign- and zero-extension disagree
  // u64 z = i as@ u64;

  return x as~ f32;
}
```

`[§wac-raw-noalt-k3jf7wq]` `as@` where there is no raw form distinct from `as~` is refused.

## Signed and unsigned

```wac
// expect: answers bits(-1) = 4294967295
// expect: answers check(5) = 5
// expect: traps check(-1)
// expect: answers clamp(-5) = 0
export u32 bits(i32 x)  { return x as@ u32; }
export u32 check(i32 x) { return x as! u32; }
export u32 clamp(i32 x) { return x as~ u32; }
```

`[§wac-usign-chk-p8jn3wl]` `as!` between signednesses traps when the value has no reading in the destination.

`[§wac-usign-clamp-r4mk9xf]` `as~` clamps: `-5 as~ u32` is `0`.

`i32 -> u64` has no `as@` form, because sign-extending and zero-extending are different answers and neither is
the raw one — go through `i64` or `u32` explicitly.

## The wrong operator is refused

```wac
// expect: answers widened(5, 7) = 5
export i64 widened(i32 x, i64 big) {
  // ERROR: i32 -> i64 is lossless, use as
  // i64 a = x as~ i64;

  // ERROR: i32 -> i64 is lossless, use as
  // i64 b = x as! i64;

  // ERROR: i32 -> i64 is lossless, use as
  // i64 c = x as@ i64;

  // ERROR: i64 -> i32 can lose information; use as!, as~ or as@
  // i32 d = big as i32;

  return x as i64;
}
```

`[§wac-castop-lossy-k3myl2r]` `as~` on a lossless pair is refused.

`[§wac-castop-check-r7zudy3]` `as!` on a lossless pair is refused.

`[§wac-castop-raw-w5hm9qf]` `as@` on a lossless pair is refused.

`[§wac-cast-lossy-as-8b4dqe7]` `as` on a pair that can lose information is refused, and the diagnostic names the
operators that apply.

## Reference casts

On references, `as` upcasts — always safe, no check — and `as!` downcasts, trapping if the object is not of the
target type:

```wac
// expect: answers upcast = 1.0
// expect: answers downcastToOwnType = 5.0
// expect: traps downcastToOtherType
struct Shape { f64 x; }
struct Rect : Shape { f64 w; }
struct Circle : Shape { f64 r; }

Shape circle() { return Circle(0.0, 5.0); }

export f64 upcast() {
  Rect r = Rect(1.0, 10.0);
  Shape s = r as Shape;                    // always succeeds
  return s.x;
}

export f64 downcastToOwnType() {
  Shape c = circle();

  // ERROR: a downcast may fail, use as!
  // Circle bad = c as Circle;

  Circle ok = c as! Circle;                // succeeds
  return ok.r;
}

export f64 downcastToOtherType() {
  Rect wrong = circle() as! Rect;          // traps
  return wrong.w;
}
```

`[§wac-ref-upcast-p3kx7wn]` `as` from a subtype to a parent succeeds.

`[§wac-ref-downcast-ok-r5tn4jk]` `as!` to the object's own type succeeds.

`[§wac-ref-downcast-q8fm2jd]` `as!` to a type the object does not have traps.

`[§wac-ref-downcast-err-v2hk8wp]` `as` for a downcast is refused.

A reference casts only to a reference. The one exception is a real conversion rather than a cast: `i31ref as
i32`.

```wac
// expect: answers roundTrip(42) = 42
// expect: answers roundTrip(-1073741824) = -1073741824
// expect: traps roundTrip(1073741824)
export i32 roundTrip(i32 n) {
  i31ref small = n as! i31ref;             // checked: an i32 may not fit in 31 bits
  anyref val = small;
  string s = "x";

  // ERROR: cannot cast reference type 'string' to 'i32'
  // i32 bad = s as! i32;

  i31ref back = val as! i31ref;            // a downcast from anyref
  return back as i32;                      // lossless: 31 bits fit in an i32
}
```

`[§wac-i31-cast-g1r2xmx]` `i32 as! i31ref` checks that the value fits in 31 bits — `-1073741824` through
`1073741823` — and traps otherwise; `i31ref as i32` gives it back.

Testing a reference's type without trapping is `is` ([12](../2-types/12-structs.md)), and unwrapping a nullable
is `!` ([10](../2-types/10-nullability.md)). An unwrap may also stand in an assignment target:

```wac
// expect: answers throughUnwraps = 10
struct Node { i32 val; Node? next; }

export i32 throughUnwraps() {
  Node a = Node(10, null);
  Node b = Node(20, null);
  Node? p = b;
  p!.next = a;                             // an unwrap in an assignment target
  return p!.next!.val;
}
```

`[§wac-unwrap-lvalue-k9fn2wp]` `x!.f = v` assigns through an unwrapped nullable, and `x!.f!.g` reads through a
chain of them.
