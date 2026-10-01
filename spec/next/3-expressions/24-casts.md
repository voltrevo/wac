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
// expect: answers main = 1
export i32 main() {
  i32 x = 42;
  i64 big = x as i64;                      // sign-extends
  f64 precise = x as f64;                  // every i32 fits in an f64
  bool flag = true;
  i32 n = flag as i32;                     // false -> 0, true -> 1
  u8 b = 200;
  i32 wide = b as i32;                     // every u8 fits
  return big == 42 && precise == 42.0 && n == 1 && wide == 200 ? 1 : 0;
}
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
// expect: traps main
i32 safeNarrow(i64 big) { return big as! i32; }
i32 exact(f64 x) { return x as! i32; }
f32 exactNarrow(f64 x) { return x as! f32; }

export i32 main() {
  i32 a = safeNarrow(42);                  // 42
  i32 b = exact(3.0);                      // 3
  f32 c = exactNarrow(0.5);                // 0.5: exact in f32
  return safeNarrow(1000000000000);        // traps
}
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
// expect: answers main = 1
i32 roundIt(f64 x) { return x as~ i32; }
i32 saturate(i64 big) { return big as~ i32; }
bool truthy(i32 x) { return x as~ bool; }
i64 roundBig(f64 x) { return x as~ i64; }

export i32 main() {
  bool a = roundIt(3.7) == 4 && roundIt(-2.3) == -2 && roundIt(2.5) == 2 && roundIt(3.5) == 4;
  bool b = saturate(1000000000000) == 2147483647 && saturate(-1000000000000) == -2147483648;
  bool c = !truthy(0) && truthy(42);
  bool d = roundBig(3.7) == 4 && roundBig(1.0e300) == 9223372036854775807;
  return a && b && c && d ? 1 : 0;
}
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
// expect: answers main = 1
i32 truncBits(i64 big) { return big as@ i32; }
i32 truncFloat(f64 x) { return x as@ i32; }

export i32 main() {
  bool a = truncBits(1000000000000) == -727379968;
  bool b = truncFloat(3.7) == 3 && truncFloat(-2.3) == -2;
  bool c = truncFloat(0.0 / 0.0) == 0 && truncFloat(1.0e300) == 2147483647;
  i32 neg = -1;
  u32 bits = neg as@ u32;                  // 4294967295, emits nothing
  return a && b && c && bits == 4294967295 && bits as@ i32 == -1 ? 1 : 0;
}
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
// expect: emits
export i32 main() {
  f64 x = 3.14;

  // ERROR: no raw conversion for f64 -> f32, use as~
  // f32 y = x as@ f32;

  i32 i = -1;

  // ERROR: i32 -> u64 has no raw form: sign- and zero-extension disagree
  // u64 z = i as@ u64;

  return 0;
}
```

`[§wac-raw-noalt-k3jf7wq]` `as@` where there is no raw form distinct from `as~` is refused.

## Signed and unsigned

```wac
// expect: traps main
u32 bits(i32 x)  { return x as@ u32; }
u32 check(i32 x) { return x as! u32; }
u32 clamp(i32 x) { return x as~ u32; }

export i32 main() {
  u32 a = bits(-1);                        // 4294967295
  u32 b = check(5);                        // 5
  u32 c = clamp(-5);                       // 0
  u32 d = check(-1);                       // traps
  return 0;
}
```

`[§wac-usign-chk-p8jn3wl]` `as!` between signednesses traps when the value has no reading in the destination.

`[§wac-usign-clamp-r4mk9xf]` `as~` clamps: `-5 as~ u32` is `0`.

`i32 -> u64` has no `as@` form, because sign-extending and zero-extending are different answers and neither is
the raw one — go through `i64` or `u32` explicitly.

## The wrong operator is refused

```wac
// expect: emits
export i32 main() {
  i32 x = 5;

  // ERROR: i32 -> i64 is lossless, use as
  // i64 a = x as~ i64;

  // ERROR: i32 -> i64 is lossless, use as
  // i64 b = x as! i64;

  // ERROR: i32 -> i64 is lossless, use as
  // i64 c = x as@ i64;

  i64 big = 7;

  // ERROR: i64 -> i32 can lose information; use as!, as~ or as@
  // i32 d = big as i32;

  return 0;
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
// expect: traps main
struct Shape { f64 x; }
struct Rect : Shape { f64 w; }
struct Circle : Shape { f64 r; }

export i32 main() {
  Rect r = Rect(0.0, 10.0);
  Shape s = r as Shape;                    // always succeeds
  Shape c = Circle(0.0, 5.0);
  Circle ok = c as! Circle;                // succeeds

  // ERROR: a downcast may fail, use as!
  // Circle bad = c as Circle;

  Rect wrong = c as! Rect;                 // traps
  return 0;
}
```

`[§wac-ref-upcast-p3kx7wn]` `as` from a subtype to a parent succeeds.

`[§wac-ref-downcast-ok-r5tn4jk]` `as!` to the object's own type succeeds.

`[§wac-ref-downcast-q8fm2jd]` `as!` to a type the object does not have traps.

`[§wac-ref-downcast-err-v2hk8wp]` `as` for a downcast is refused.

A reference casts only to a reference. The one exception is a real conversion rather than a cast: `i31ref as
i32`.

```wac
// expect: answers main = 42
export i32 main() {
  i32 n = 42;
  i31ref small = n as! i31ref;             // checked: an i32 may not fit in 31 bits
  anyref val = small;
  string s = "x";

  // ERROR: cannot cast reference type 'string' to 'i32'
  // i32 bad = s as! i32;

  i31ref back = val as! i31ref;            // a downcast from anyref
  return back as i32;                      // lossless: 31 bits fit in an i32
}
```

`[§wac-i31-cast-g1r2xmx]` `i32 as! i31ref` checks that the value fits in 31 bits; `i31ref as i32` gives it back.

Testing a reference's type without trapping is `is` ([12](../2-types/12-structs.md)), and unwrapping a nullable
is `!` ([10](../2-types/10-nullability.md)). An unwrap may also stand in an assignment target:

```wac
// expect: answers main = 10
struct Node { i32 val; Node? next; }

export i32 main() {
  Node a = Node(10, null);
  Node b = Node(20, null);
  Node? p = b;
  p!.next = a;                             // an unwrap in an assignment target
  return p!.next!.val;
}
```

`[§wac-unwrap-lvalue-k9fn2wp]` `x!.f = v` assigns through an unwrapped nullable, and `x!.f!.g` reads through a
chain of them.
