## Operators

### Type rules

Arithmetic (`+`, `-`, `*`, `/`, `%`) requires matching numeric types.
Not allowed on `bool`.

`%` is the remainder after truncating division, for floats as well as integers:
the result has the sign of the left operand and satisfies
`a % b == a - trunc(a/b) * b` computed exactly. This matches C's `fmod` and
JavaScript's `%`.

Unlike every other arithmetic operator, float `%` is not a single wasm
instruction — wasm has no `f32.rem`/`f64.rem`, so the compiler emits a call to a
builtin helper. The result is exact, not an approximation: writing
`a - trunc(a/b) * b` in source would *not* be equivalent, because the quotient
rounds before `trunc` sees it.

```wac
export f64 modF(f64 a, f64 b) { return a % b; }
export f32 modF32(f32 a, f32 b) { return a % b; }
```

`[§wac-fmod-ox2ga90]` `modF(7.0, 2.0)` returns `1.0`.
`[§wac-fmod-round-lji73wg]` `modF(1.0, 0.1)` returns `0.09999999999999995`, not `-2.220446049250313e-16`.
`[§wac-fmod-sign-l3ief80]` `modF(-7.0, 2.0)` returns `-1.0` and `modF(7.0, -2.0)` returns `1.0` — the sign follows the left operand.
`[§wac-fmod-large-wfr4moy]` `modF(1e300, 3.0)` returns `0.0`, exactly.
`[§wac-fmod-zero-f9hnqhr]` `modF(7.0, 0.0)` is NaN, and `modF(7.0, 1.0/0.0)` returns `7.0`.
`[§wac-fmod-f32-t52576z]` `modF32(5.5, 1.5)` returns `1.0`.

```wac
export i64 add64(i64 a, i64 b) { return a + b; }
export f64 mulF(f64 a, f64 b) { return a * b; }
```

`[§wac-add64-h42kvhc]` `add64(100 as i64, 200 as i64)` returns `300`.
`[§wac-mulf-02srz8x]` `mulF(2.5, 4.0)` returns `10.0`.

```wac
i32 x = 5;
f64 y = 1.0;
f64 z = x + y;         // error: i32 + f64 type mismatch
```

`[§wac-mixadd-f4dga8g]` `x + y` is a compile error — i32 + f64 type mismatch.

Comparison (`==`, `!=`, `<`, `<=`, `>`, `>=`) requires matching types on both
sides, returns `bool`. Allowed on all primitive types. Not allowed on reference
types (use `is` for type testing).

```wac
export bool cmpFloat() { return 1.0 == 1.0; }
```

`[§wac-cmpfloat-68s8unj]` `cmpFloat()` returns `true`.

```wac
Point a = Point(1, 2);
Point b = Point(1, 2);
bool eq = a == b;            // error: == not allowed on struct types
```

`[§wac-struct-eq-k4rm7xq]` `a == b` on structs is a compile error. Use `is` for identity or compare fields manually.

Bitwise (`&`, `|`, `^`, `~`) require matching types — `i32` or `i64` only.

Shift (`<<`, `>>`, `>>>`) allow `i64 << i32` and `i64 >> i32` in addition to
matching types. The compiler internally widens the i32 shift amount to i64 for
the wasm instruction.

```wac
export i64 shiftMixed(i64 x, i32 n) { return x << n; }
```

`[§wac-shift64-rhgzpth]` `shiftMixed(1, 32)` returns `4294967296`.

`>>` is an arithmetic shift — it copies the sign bit. `>>>` is a logical shift —
it fills with zeros, so the result of `>>>` on a negative value is positive.
There is no `<<<`: left shift discards high bits either way.

```wac
export i32 shiftArith(i32 x, i32 n) { return x >> n; }
export i32 shiftLogic(i32 x, i32 n) { return x >>> n; }
```

`[§wac-shr-s-z073930]` `shiftArith(-16, 1)` returns `-8`.
`[§wac-shr-u-ft3yabj]` `shiftLogic(-16, 1)` returns `2147483640`.
`[§wac-shr-u-neg1-d3b1hey]` `shiftLogic(-1, 28)` returns `15`.

```wac
export i64 shiftLogic64(i64 x, i32 n) { return x >>> n; }
```

`[§wac-shr-u64-2jujzws]` `shiftLogic64(-16, 4)` returns `1152921504606846975`.

`>>>` requires `i32` or `i64`, like the other shifts.

```wac
export f64 badShift(f64 x) { return x >>> 1; }   // error: f64 not allowed
```

`[§wac-shr-u-float-s95dlzw]` This is a compile error: `'>>>' requires i32 or i64, got f64`.

Logical (`&&`, `||`, `!`) require `bool` operands, return `bool`. Short-circuit
evaluation.

```wac
export bool bothPositive(i32 a, i32 b) {
  return a > 0 && b > 0;
}
```

`[§wac-logic-45at1jf]` `bothPositive(3, 5)` returns `true`.
`[§wac-logicf-bi4nyl4]` `bothPositive(3, -1)` returns `false`.

```wac
bool incr(Box b) {
  b.val = b.val + 1;
  return true;
}

struct Box { i32 val; }

export i32 testShortCircuitAnd() {
  Box b = Box(0);
  bool result = false && incr(b);
  return b.val;
}

export i32 testShortCircuitOr() {
  Box b = Box(0);
  bool result = true || incr(b);
  return b.val;
}
```

`[§wac-shortcirc-and-j7pm4w9]` `testShortCircuitAnd()` returns `0` — `incr`
not called, `&&` short-circuits on `false`.
`[§wac-shortcirc-or-n3kx5wp]` `testShortCircuitOr()` returns `0` — `incr`
not called, `||` short-circuits on `true`.

```wac
bool a = true;
i32 x = a + 1;           // error: arithmetic not allowed on bool
```

`[§wac-bool-arith-f2nx8k3]` `a + 1` where a is bool is a compile error.

### Compound assignment and increment

```wac
export i32 compound() {
  i32 x = 10;
  x += 5;
  x -= 2;
  x *= 3;
  x++;
  return x;
}
```

`[§wac-compound-pw7qq7v]` `compound()` returns `40`.

`++` and `--` come in both prefix and postfix forms, and both are usable as
expressions as well as standalone statements. The operand must be an lvalue
(a variable, field, or array element) of type `i32` or `i64`. As in C:
postfix evaluates to the value *before* the change, prefix evaluates to the
value *after*:

```wac
export i32 postIncr() {
  i32 x = 5;
  i32 y = x++;    // y = 5 (old value), x becomes 6
  return y * 10 + x;
}

export i32 preIncr() {
  i32 x = 5;
  i32 z = ++x;    // x becomes 6, z = 6 (new value)
  return z * 10 + x;
}
```

`[§wac-postincr-expr-n4kx8wq]` `postIncr()` returns `56` (`y=5`, `x=6`).
`[§wac-preincr-expr-t8jm3wq]` `preIncr()` returns `66` (`z=6`, `x=6`).

Used alone as a statement (`x++;` or `++x;`), the result value is simply
discarded — this is the common case, e.g. in a `for` loop's update clause.

Compound operators: `+=`, `-=`, `*=`, `/=`, `%=`, `<<=`, `>>=`, `>>>=`, `&=`,
`|=`, `^=`. Same type rules as the underlying operator. Compound assignment
remains a statement only, not an expression.

Because the type rules match the underlying operator, `i64 <<= i32` is allowed
wherever `i64 << i32` is, and applies to every assignable target — locals,
struct fields, and array elements.

```wac
struct Bits { i64 v; }

export i64 compoundShiftLocal(i64 x, i32 n) { x >>>= n; return x; }
export i64 compoundShiftField(i64 x, i32 n) { Bits b = Bits(x); b.v <<= n; return b.v; }
export i64 compoundShiftElem(i64 x, i32 n) {
  i64[] a = i64[1]();
  a[0] = x;
  a[0] <<= n;
  return a[0];
}
```

`[§wac-cshift-local-e85g9us]` `compoundShiftLocal(-16, 4)` returns `1152921504606846975`.
`[§wac-cshift-field-abx403z]` `compoundShiftField(1, 4)` returns `16`.
`[§wac-cshift-elem-emvdry9]` `compoundShiftElem(1, 4)` returns `16`.

### Full type summary

```
Arithmetic (+, -, *, /, %):        T*T->T for i32, i64, f32, f64
                                    Not allowed on bool
Comparison (==, !=, <, <=, >, >=): T*T->bool for any primitive T
                                    Both sides must be same type
                                    Not allowed on reference types
Logical (&&, ||):                  bool*bool->bool
Logical (!):                       bool->bool
Bitwise (&, |, ^, ~):             i32*i32->i32, i64*i64->i64
Shift (<<, >>, >>>):               T*T->T for i32, i64
                                    Also: i64*i32->i64
                                    Not allowed on floats or bool
                                    >> is arithmetic (sign-extends),
                                    >>> is logical (zero-fills)
Compound (+=, -=, etc):            Same rules as base operator
++, --:                            i32 and i64 only, expression or statement
                                    (postfix: old value, prefix: new value)
Reference (is, is not):            type test, null test, or identity (ref -> bool)
Cast (as):                         lossless numeric, safe ref upcast
Cast (as!):                        checked numeric (traps), ref downcast (traps)
Cast (as~):                        nearest approximation (round, clamp, never traps)
Cast (as@):                        raw conversion (truncate, keep low bits, never traps)
Null (!):                          T? -> T (traps on null)
```

### Precedence (highest to lowest)

| Level | Operators              | Associativity |
|-------|------------------------|---------------|
| 1     | `- ! ~` (unary)        | right         |
| 2     | `as` `as!` `as~` `as@` | left          |
| 3     | `* / %`                | left          |
| 4     | `+ -`                  | left          |
| 5     | `<< >> >>>`            | left          |
| 6     | `< <= > >=`            | left          |
| 7     | `== !=`                | left          |
| 8     | `&`                    | left          |
| 9     | `^`                    | left          |
| 10    | `|`                    | left          |
| 11    | `&&`                   | left          |
| 12    | `||`                   | left          |
| 13    | `is` `is not`          | left          |
| 14    | `?:` (ternary)         | right         |
