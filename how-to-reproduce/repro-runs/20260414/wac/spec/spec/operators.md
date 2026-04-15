## Operators

### Type rules

Arithmetic (`+`, `-`, `*`, `/`, `%`) requires matching numeric types.
Not allowed on `bool`.

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

Shift (`<<`, `>>`) allow `i64 << i32` and `i64 >> i32` in addition to matching
types. The compiler internally widens the i32 shift amount to i64 for the wasm
instruction.

```wac
export i64 shiftMixed(i64 x, i32 n) { return x << n; }
```

`[§wac-shift64-rhgzpth]` `shiftMixed(1, 32)` returns `4294967296`.

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

`++` and `--` are statements only, not expressions:

```wac
i32 x = 5;
i32 y = x++;    // error: ++ is a statement, not an expression
```

`[§wac-increxpr-cabck67]` `i32 y = x++` is a compile error.

Compound operators: `+=`, `-=`, `*=`, `/=`, `%=`, `<<=`, `>>=`, `&=`, `|=`,
`^=`. Same type rules as the underlying operator.

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
Shift (<<, >>):                    T*T->T for i32, i64
                                    Also: i64*i32->i64
                                    Not allowed on floats or bool
Compound (+=, -=, etc):            Same rules as base operator
++, --:                            i32 and i64 only, statement only
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
| 5     | `<< >>`                | left          |
| 6     | `< <= > >=`            | left          |
| 7     | `== !=`                | left          |
| 8     | `&`                    | left          |
| 9     | `^`                    | left          |
| 10    | `|`                    | left          |
| 11    | `&&`                   | left          |
| 12    | `||`                   | left          |
| 13    | `is` `is not`          | left          |
| 14    | `?:` (ternary)         | right         |
