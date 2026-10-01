# 22 — Operators

The built-in operators work on the primitive types, and on `string` for `+`, comparison and equality. Every
other type gets an operator only by implementing it: `a + b` on a struct calls a method named by core's
`operators.add` symbol, chosen by the left operand's type.

## Arithmetic

`+ - * / %` take two operands of one numeric type and answer that type. They are not defined on `bool`, and
there is no mixing of types:

```wac
// expect: answers main = 300
export i32 main() {
  i64 a = 100;
  i64 b = 200;
  f64 m = 2.5 * 4.0;                       // 10.0

  i32 x = 5;
  f64 y = 1.0;

  // ERROR: i32 + f64: the operands' types differ
  // f64 z = x + y;

  bool flag = true;

  // ERROR: arithmetic is not defined on bool
  // i32 w = flag + 1;

  return (a + b) as! i32;
}
```

`[§wac-add64-h42kvhc]` `i64 + i64` is an `i64`: `100 + 200` is `300`.

`[§wac-mulf-02srz8x]` `f64 * f64` is an `f64`: `2.5 * 4.0` is `10.0`.

`[§wac-mixadd-f4dga8g]` Arithmetic on two different numeric types is refused.

`[§wac-bool-arith-f2nx8k3]` Arithmetic on `bool` is refused.

Integer arithmetic wraps; float arithmetic follows IEEE 754 ([08](../2-types/08-primitives.md)). Integer `/`
and `%` trap on a zero divisor, and on the signed minimum divided by `-1`.

`%` is the remainder after truncating division, for floats as well as integers. Its sign is the left
operand's, and it satisfies `a % b == a - trunc(a/b) * b` computed exactly — C's `fmod`, JavaScript's `%`:

```wac
// expect: answers main = 1
f64 m(f64 a, f64 b) { return a % b; }

export i32 main() {
  bool a = m(7.0, 2.0) == 1.0;
  bool b = m(1.0, 0.1) == 0.09999999999999995;  // exact, not -2.220446049250313e-16
  bool c = m(-7.0, 2.0) == -1.0 && m(7.0, -2.0) == 1.0;
  bool d = m(1e300, 3.0) == 0.0;
  f64 nan = m(7.0, 0.0);
  bool e = nan != nan && m(7.0, 1.0 / 0.0) == 7.0;
  f32 g = 5.5;
  bool f = g % 1.5 == 1.0;
  return a && b && c && d && e && f ? 1 : 0;
}
```

`[§wac-fmod-ox2ga90]` `7.0 % 2.0` is `1.0`.

`[§wac-fmod-round-lji73wg]` `1.0 % 0.1` is `0.09999999999999995`: the remainder is exact, so it is not
`a - trunc(a/b) * b` computed in floating point.

`[§wac-fmod-sign-l3ief80]` The sign follows the left operand: `-7.0 % 2.0` is `-1.0` and `7.0 % -2.0` is
`1.0`.

`[§wac-fmod-large-wfr4moy]` `1e300 % 3.0` is `0.0`, exactly.

`[§wac-fmod-zero-f9hnqhr]` `7.0 % 0.0` is NaN, and `7.0 % infinity` is `7.0`.

`[§wac-fmod-f32-t52576z]` `f32 % f32` follows the same rule: `5.5 % 1.5` is `1.0`.

Unary `-` wants a type with a negation, so it is refused on an unsigned integer:

```wac
// expect: emits
export i32 main() {
  u32 u = 3;

  // ERROR: unary minus is not defined on u32
  // u32 n = -u;

  return 0;
}
```

`[§wac-neg-unsigned-mjgwgv9]` Unary `-` on an unsigned integer is refused.

## Comparison and equality

`== != < <= > >=` take two operands of one type and answer `bool`. They are defined on every primitive type,
and on `string`, which compares and orders by its bytes:

```wac
// expect: answers main = 1
struct Point { i32 x; i32 y; }

export i32 main() {
  f64 one = 1.0;
  bool a = one == 1.0;
  Point p = Point(1, 2);
  Point q = Point(1, 2);

  // ERROR: Point has no implementation of operators.equal
  // bool same = p == q;

  string? s = "x";

  // ERROR: string? has no ==; test for null first
  // bool t = s == "x";

  return a && p is not q ? 1 : 0;
}
```

`[§wac-cmpfloat-68s8unj]` An `f64` holding `1.0` compares equal to `1.0`.

`[§wac-struct-eq-k4rm7xq]` `==` on a struct that does not implement `operators.equal` is refused. `is` tests
identity.

The same holds for any reference type without the operator — arrays, enums, and the nullable form of
anything, `string?` included, which would have to answer for `null` before comparing anything. A function
value compares and orders. Tuples compare member by member ([14](../2-types/14-tuples.md)).

## Bitwise and shifts

`& | ^ ~` take integers of one type. `<< >> >>>` shift an integer by an amount that may be of any integer
type, and the left operand's type decides the result:

```wac
// expect: answers main = 1
u64 rotl(u64 v, i32 n) { return (v << n) | (v >> (64 - n)); }

export i32 main() {
  i64 one = 1;
  bool a = one << 32 == 4294967296;
  i32 m16 = -16;
  bool b = m16 >> 1 == -8;                 // arithmetic: copies the sign bit
  bool c = m16 >>> 1 == 2147483640;        // logical: fills with zeros
  i32 m1 = -1;
  bool d = m1 >>> 28 == 15;
  i64 w = -16;
  bool e = w >>> 4 == 1152921504606846975;
  bool f = rotl(1, 1) == 2;
  return a && b && c && d && e && f ? 1 : 0;
}
```

`[§wac-shift64-rhgzpth]` An `i64` may be shifted by an `i32` amount: `1 << 32` is `4294967296`.

`[§wac-shift-amount-3wkq7np]` A shift amount may be any integer type. The left operand's type decides the
result, and the amount is taken modulo its width.

`[§wac-shr-s-z073930]` `>>` on a signed integer is arithmetic: `-16 >> 1` is `-8`.

`[§wac-shr-u-ft3yabj]` `>>>` is logical: `-16 >>> 1` is `2147483640`.

`[§wac-shr-u-neg1-d3b1hey]` `-1 >>> 28` is `15`.

`[§wac-shr-u64-2jujzws]` `>>>` on an `i64`: `-16 >>> 4` is `1152921504606846975`.

```wac
// expect: emits
export i32 main() {
  u32 x = 8;
  u32 good = x >> 1;                       // logical, because x is unsigned

  // ERROR: '>>>' is redundant on u32 — '>>' is already logical
  // u32 bad = x >>> 1;

  f64 f = 1.0;

  // ERROR: '>>>' requires an integer type, got f64
  // f64 g = f >>> 1;

  return 0;
}
```

`[§wac-shr-u-redundant-m3kq7wn]` `>>>` on an unsigned type is refused; `>>` there is already logical.

`[§wac-shr-u-float-s95dlzw]` `>>>` on a float is refused.

There is no `<<<`: a left shift discards high bits either way.

### An integer's bit methods

Every integer has five methods, each one instruction that no operator reaches:

```wac
// expect: answers main = 1
export i32 main() {
  u32 x = 0x00F0;
  u32 zero = 0;
  bool a = x.leadingZeros() == 24 && zero.leadingZeros() == 32;
  bool b = x.trailingZeros() == 4 && zero.trailingZeros() == 32;
  bool c = x.onesCount() == 4;
  bool d = x.rotateLeft(28) == 0x0F && x.rotateRight(4) == 0x0F && x.rotateLeft(32) == x;
  return a && b && c && d ? 1 : 0;
}
```

`[§wacc-int-bit-methods]` Every integer type has `leadingZeros`, `trailingZeros`, `onesCount`, `rotateLeft` and
`rotateRight`, answering the receiver's own type. Zero has the full width of leading and trailing zeros, and a
rotation's count is taken modulo the width.

## Logical operators

`&& || !` take and answer `bool`. `&&` and `||` evaluate their right operand only when it can change the
answer:

```wac
// expect: answers main = 1
struct Box { i32 val; }

bool incr(Box b) {
  b.val = b.val + 1;
  return true;
}

export i32 main() {
  Box b = Box(0);
  bool r1 = false && incr(b);              // incr is not called
  bool r2 = true || incr(b);               // nor here
  i32 x = 3;
  i32 y = -1;
  bool both = x > 0 && y > 0;              // false
  return b.val == 0 && !both ? 1 : 0;
}
```

`[§wac-logic-45at1jf]` `x > 0 && y > 0` is true when both are.

`[§wac-logicf-bi4nyl4]` …and false when either is not.

`[§wac-shortcirc-and-j7pm4w9]` `false && e` does not evaluate `e`.

`[§wac-shortcirc-or-n3kx5wp]` `true || e` does not evaluate `e`.

`&&` and `||` cannot be implemented by a type; their short-circuit behaviour is the language's.

## Assignment operators and increment

Compound assignment `+= -= *= /= %= <<= >>= >>>= &= |= ^=` follows its operator's type rules, and is a
statement, not an expression. `++` and `--` work on any integer, prefix or postfix, as statements or
expressions — postfix answering the old value, prefix the new:

```wac
// expect: answers main = 162
struct Bits { i64 v; }

export i32 main() {
  i32 x = 10;
  x += 5;
  x -= 2;
  x *= 3;
  x++;                                     // 40

  i32 a = 5;
  i32 post = a++;                          // 5, and a is 6
  i32 b = 5;
  i32 pre = ++b;                           // 6, and b is 6

  i64 local = -16;
  local >>>= 4;
  Bits bits = Bits(1);
  bits.v <<= 4;                            // 16
  i64[] arr = [1];
  arr[0] <<= 4;                            // 16

  return x + post * 10 + a + pre * 10 + b + (bits.v + arr[0]) as! i32 - 32;   // 40 + 56 + 66
}
```

`[§wac-compound-pw7qq7v]` Compound assignment applies its operator and assigns: the sequence above leaves `x`
at `40`.

`[§wac-postincr-expr-n4kx8wq]` Postfix `x++` answers the value before the change: `y = x++` from 5 leaves `y` 5
and `x` 6.

`[§wac-preincr-expr-t8jm3wq]` Prefix `++x` answers the value after it.

`[§wac-cshift-local-e85g9us]` `i64 >>>= i32` works on a local: `-16 >>>= 4` gives `1152921504606846975`.

`[§wac-cshift-field-abx403z]` …on a field: `1 <<= 4` gives `16`.

`[§wac-cshift-elem-emvdry9]` …and on an array element.

`++` on a float, a `bool` or a reference is refused.

## Precedence

| Level | Operators | Associativity |
|---|---|---|
| 1 | postfix `!`, `++`, `--`, call, index, `.`, `?.` | left |
| 2 | prefix `-` `!` `~` `++` `--` | right |
| 3 | `as` `as!` `as~` `as@` | left |
| 4 | `*` `/` `%` | left |
| 5 | `+` `-` | left |
| 6 | `<<` `>>` `>>>` | left |
| 7 | `<` `<=` `>` `>=` | left |
| 8 | `==` `!=` | left |
| 9 | `&` | left |
| 10 | `^` | left |
| 11 | `\|` | left |
| 12 | `&&` | left |
| 13 | `\|\|` | left |
| 14 | `??` | right |
| 15 | `is` `is not` `matches` | left |
| 16 | `?:` | right |

`is` binds looser than `&&`, so a test combined with another condition is parenthesised: `(s is Circle) &&
s.r > 0.0`.

```wac
// expect: answers main = 1
export i32 main() {
  i32? a = null;
  i32 one = 1;
  i32 eight = 8;
  bool b = one + 2 * 3 == 7 && eight >> 1 + 1 == 2;   // * before +, + before >>
  i32 c = a ?? 4 + 1;                            // ?? binds looser than +: 5
  return b && c == 5 ? 1 : 0;
}
```

`[§wac-precedence-x7mj5mk]` Operators bind as the table above says.

## The left operand selects the implementation

```wac
// fragment
import { operators } from "core";

struct Vec2 {
  f64 x;
  f64 y;

  Vec2 [operators.add](const this, const Vec2 rhs) {
    return Vec2(this.x + rhs.x, this.y + rhs.y);
  }
}

void example() {
  Vec2 a = Vec2(1.0, 2.0);
  Vec2 b = Vec2(3.0, 4.0);
  a + b;                      // Vec2(4.0, 6.0)
}
```

`a + b` dispatches to `a.[operators.add](b)`. The method signature determines the accepted operand and result
types. There is no fallback search. An unresolved numeric left operand has a separate reverse-dispatch rule
below.

```wac
// expect: answers main = 6.0
import { operators } from "core";

struct Vec2 {
  f64 x;
  f64 y;

  Vec2 [operators.add](const this, const Vec2 rhs) {
    return Vec2(this.x + rhs.x, this.y + rhs.y);
  }
}

export f64 main() {
  Vec2 c = Vec2(1.0, 2.0) + Vec2(3.0, 4.0);
  return c.y;
}
```

`[§wac-operator-dispatch-left-txsqbyi]` A binary operator whose left operand's type is not built in calls that
type's method named by the operator's symbol, with the right operand as its argument.

### Delegation is ordinary code

```wac
// fragment
import { operators } from "core";

struct MyScalar {
  f64 value;

  auto [operators.multiply]<V>(const this, const V rhs) {
    return rhs.[operators.multiplyFromLeft](this);
  }
}

struct Vec2 {
  f64 x;
  f64 y;

  Vec2 [operators.multiplyFromLeft](const this, const MyScalar lhs) {
    return Vec2(lhs.value * this.x, lhs.value * this.y);
  }
}

void example() {
  MyScalar a = MyScalar(2.0);
  Vec2 b = Vec2(3.0, 4.0);
  a * b;                      // Vec2(6.0, 8.0)
}
```

`lhs * rhs` delegates as `rhs.[operators.multiplyFromLeft](lhs)`: operand order is preserved; commutativity is
not assumed. Primitive scalars use this convention for supported nonnumeric right operands; ordinary numeric
combinations retain their existing type rules. Delegation does not introduce implicit numeric widening.

`auto` here infers the delegated call's result for each instantiation; it does not require that result to be
`V` ([34](../5-inference/34-recursive-inference.md)).

### Independent dispatch and unrestricted operator results

Each operator has its own implementation. There are no derived overloads: implementing `equal` does not supply
`notEqual`, and implementing `add` does not supply `addAssign`. Unary negation and binary subtraction are
distinct too.

```wac
// fragment
import { operators } from "core";

struct EqualityMask {
  bool x;
  bool y;
}

struct Pair {
  i32 x;
  i32 y;

  EqualityMask [operators.equal](const this, const Pair rhs) {
    return EqualityMask(this.x == rhs.x, this.y == rhs.y);
  }
}

void example() {
  Pair a = Pair(1, 2);
  Pair b = Pair(1, 3);
  a == b;                     // EqualityMask(true, false)

  // ERROR: Pair has no notEqual implementation
  // a != b;

  // ERROR: a condition requires bool, not EqualityMask
  // if (a == b) {}
}
```

```wac
// expect: answers main = 1
import { operators } from "core";

struct EqualityMask { bool x; bool y; }

struct Pair {
  i32 x;
  i32 y;

  EqualityMask [operators.equal](const this, const Pair rhs) {
    return EqualityMask(this.x == rhs.x, this.y == rhs.y);
  }
}

export i32 main() {
  Pair a = Pair(1, 2);
  Pair b = Pair(1, 3);
  EqualityMask m = a == b;

  // ERROR: Pair has no implementation of operators.notEqual
  // EqualityMask n = a != b;

  // ERROR: a condition requires bool, not EqualityMask
  // if (a == b) { }

  return m.x && !m.y ? 1 : 0;
}
```

`[§wac-operator-independent-4ssj2cv]` Each operator is implemented separately: implementing one never supplies
another.

`[§wac-operator-result-free-vs7gcer]` An operator method may return any type; the expression around it checks that
type as usual.

This freedom does not relax the required result types of interpolation and markup conversion
([23](23-interpolation-and-markup.md)).

An author who wants inequality to negate equality writes it explicitly:

```wac
// fragment — inside a type Foo whose equal implementation returns bool
bool [operators.notEqual](const this, const Foo rhs) {
  return !this.[operators.equal](rhs);
}
```

### Compound assignment is its own operation

```wac
// expect: answers main = 1
import { operators } from "core";

struct Counter {
  i32 value;

  void [operators.addAssign](this, i32 amount) {
    this.value += amount;
  }
}

export i32 main() {
  Counter a = Counter(1);
  Counter alias = a;
  a += 2;                     // a.[operators.addAssign](2)
  return alias.value == 3 && a is alias ? 1 : 0;   // the same object was mutated
}
```

For overloaded `a += b`, the method receives the existing receiver. Its return value does not replace the
binding `a`; the operation is not lowered to `a = a + b`. The receiver expression and right operand are each
evaluated once. Built-in numeric compound assignment retains its ordinary update behaviour.

`[§wac-operator-compound-own-u7m6y7c]` `a op= b` on a type that is not built in calls the type's `opAssign` method
on `a` itself. It does not rebind `a`, and each operand is evaluated once.

### Complete operator mapping

All symbols below are exported under `core.operators`:

```wac
// fragment
import { operators } from "core";
import { operators.add } from "core";
// operators.add and add are the same symbol.
```

| Syntax | Symbol |
| --- | --- |
| `a + b` | `add` |
| `a - b` | `subtract` |
| `a * b` | `multiply` |
| `a / b` | `divide` |
| `a % b` | `remainder` |
| `-a` | `negate` |
| `a == b` | `equal` |
| `a != b` | `notEqual` |
| `a < b` | `lessThan` |
| `a <= b` | `lessThanOrEqual` |
| `a > b` | `greaterThan` |
| `a >= b` | `greaterThanOrEqual` |
| `!a` | `not` |
| `~a` | `bitwiseNot` |
| `a & b` | `bitwiseAnd` |
| `a \| b` | `bitwiseOr` |
| `a ^ b` | `bitwiseXor` |
| `a << b` | `shiftLeft` |
| `a >> b` | `shiftRight` |
| `a >>> b` | `unsignedShiftRight` |
| `a += b` | `addAssign` |
| `a -= b` | `subtractAssign` |
| `a *= b` | `multiplyAssign` |
| `a /= b` | `divideAssign` |
| `a %= b` | `remainderAssign` |
| `a &= b` | `bitwiseAndAssign` |
| `a \|= b` | `bitwiseOrAssign` |
| `a ^= b` | `bitwiseXorAssign` |
| `a <<= b` | `shiftLeftAssign` |
| `a >>= b` | `shiftRightAssign` |
| `a >>>= b` | `unsignedShiftRightAssign` |
| `++a` | `preIncrement` |
| `a++` | `postIncrement` |
| `--a` | `preDecrement` |
| `a--` | `postDecrement` |

Prefix and postfix increment/decrement have distinct symbols; the mapping does not by itself introduce a
syntactic form absent from the language. Prefix `!a` is logical negation; postfix `a!` remains nullable
unwrapping.

## Reverse symbols and unresolved numeric operands

For each binary symbol below, core exports the corresponding reverse symbol:

| Ordinary symbol | Reverse symbol |
| --- | --- |
| `add` | `addFromLeft` |
| `subtract` | `subtractFromLeft` |
| `multiply` | `multiplyFromLeft` |
| `divide` | `divideFromLeft` |
| `remainder` | `remainderFromLeft` |
| `equal` | `equalFromLeft` |
| `notEqual` | `notEqualFromLeft` |
| `lessThan` | `lessThanFromLeft` |
| `lessThanOrEqual` | `lessThanOrEqualFromLeft` |
| `greaterThan` | `greaterThanFromLeft` |
| `greaterThanOrEqual` | `greaterThanOrEqualFromLeft` |
| `bitwiseAnd` | `bitwiseAndFromLeft` |
| `bitwiseOr` | `bitwiseOrFromLeft` |
| `bitwiseXor` | `bitwiseXorFromLeft` |
| `shiftLeft` | `shiftLeftFromLeft` |
| `shiftRight` | `shiftRightFromLeft` |
| `unsignedShiftRight` | `unsignedShiftRightFromLeft` |

A known left receiver uses ordinary dispatch and may explicitly delegate to one of these symbols. If the left
operand remains an unresolved numeric expression and the right type is known, syntax instead selects the right
receiver's reverse symbol. Its parameter constrains the left operand.

```wac
// fragment — given Vec3.multiplyFromLeft with an f32 parameter
5 * vector;                  // vector.[operators.multiplyFromLeft](5)
```

These are independent implementations, with unrestricted result types. Reverse comparison preserves the
original operand order just as reverse subtraction does. No reverse symbols are used for compound assignment or
unary operations. Neither direction retries after a missing implementation or type error; receiver selection
does not change operand evaluation order or duplicate evaluation.

### User-defined operators constrain arguments through their signatures

```wac
// expect: answers main = 30.0
import { operators } from "core";

struct Vec3 {
  f32 x;
  f32 y;
  f32 z;

  Vec3 [operators.multiply](const this, f32 rhs) {
    return Vec3(this.x * rhs, this.y * rhs, this.z * rhs);
  }

  Vec3 [operators.multiplyFromLeft](const this, f32 lhs) {
    return this.[operators.multiply](lhs);
  }
}

export f64 main() {
  Vec3 v = Vec3(1.0, 1.0, 1.0);
  Vec3 a = v * 5;                          // multiply's parameter constrains 5 to f32
  Vec3 b = 5 * v;                          // multiplyFromLeft constrains 5 to f32
  Vec3 c = (2 * 3) * v;                    // the left expression receives f32
  return (a.x + b.y + c.z) as f64 + 14.0;  // 5 + 5 + 6 + 14
}
```

`[§wac-operator-reverse-sw6qk57]` When the left operand is an unresolved numeric expression and the right operand's
type implements the operator's `FromLeft` symbol, `a op b` calls `b.[opFromLeft](a)`, and that method's parameter
gives `a` its type.

Resolve operand types using available constraints before selecting dispatch. If the left type is known, use its
ordinary operator symbol. If the left remains an unresolved numeric expression and the right type is known, use
the right's corresponding `FromLeft` symbol. Its parameter then constrains the left expression. A missing method
or type error is final: never retry the other direction. Do not search candidate receiver types or assume the
left type equals a user-defined right type. If neither receiver type can be established, report unresolved
inference. Cyclic inference/dispatch dependencies require an annotation.

A generic operator parameter alone is not a concrete numeric constraint:

```wac
// fragment — given a multiply<V>(..., V rhs) with no other constraint on V
// v * 5;                    // ERROR: V remains unresolved
```

For binary arithmetic, comparisons, bitwise operations, and shifts, the table above lists the reverse symbols.
Operand order is preserved; reverse subtraction means `lhs - rhs`, not `rhs - lhs`. Compound assignment and
unary operators do not use reverse dispatch. Evaluation order remains the ordinary operator evaluation order,
and each operand is evaluated once.

## Not overloadable

`&&` and `||` keep their built-in short-circuit behaviour. `??`, `?.`, postfix `!`, `is`, `matches`, casts and
plain assignment are not overloadable. Indexing and call overloading are not part of this mechanism.

## Open

- **Derivation shorthand.** `[operators.equal] = default;` and similar shorthand for deriving an implementation
  is deferred; every operator implementation is written explicitly.
- **Overloading `&&` and `||`.** Deferred; the built-in short-circuit behaviour is unchanged.
