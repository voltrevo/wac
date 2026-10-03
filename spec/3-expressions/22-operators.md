# 22 — Operators

The built-in operators work on the primitive types, and on `string` for `+`, comparison and equality. Every
other type gets an operator only by implementing it: `a + b` on a struct calls a method named by core's
`operators.add` symbol, chosen by the left operand's type.

## Arithmetic

`+ - * / %` take two operands of one numeric type and answer that type. They are not defined on `bool`, and
there is no mixing of types:

```wac
// expect: answers sum64(100, 200) = 300
// expect: answers product(2.5, 4.0) = 10.0
export i64 sum64(i64 a, i64 b) { return a + b; }

export f64 product(f64 a, f64 b) { return a * b; }

export void mixed(i32 x, f64 y, bool flag) {
  // ERROR: i32 + f64: the operands' types differ
  // f64 z = x + y;

  // ERROR: arithmetic is not defined on bool
  // i32 w = flag + 1;
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
// expect: answers rem(7.0, 2.0) = 1.0
// expect: answers rem(1.0, 0.1) = 0.09999999999999995
// expect: answers rem(-7.0, 2.0) = -1.0
// expect: answers rem(7.0, -2.0) = 1.0
// expect: answers rem(1e300, 3.0) = 0.0
// expect: answers remByZeroIsNaN(7.0) = true
// expect: answers remByInfinity(7.0) = 7.0
// expect: answers rem32(5.5, 1.5) = 1.0
export f64 rem(f64 a, f64 b) { return a % b; }

export bool remByZeroIsNaN(f64 a) {
  f64 nan = rem(a, 0.0);
  return nan != nan;
}

export f64 remByInfinity(f64 a) {
  f64 zero = 0.0;
  return rem(a, 1.0 / zero);
}

export f32 rem32(f32 a, f32 b) { return a % b; }
```

`[§wac-fmod-ox2ga90]` `7.0 % 2.0` is `1.0`.

`[§wac-fmod-round-lji73wg]` `1.0 % 0.1` is `0.09999999999999995`: the remainder is exact, so it is not
`a - trunc(a/b) * b` computed in floating point, which would give `-2.220446049250313e-16`.

`[§wac-fmod-sign-l3ief80]` The sign follows the left operand: `-7.0 % 2.0` is `-1.0` and `7.0 % -2.0` is
`1.0`.

`[§wac-fmod-large-wfr4moy]` `1e300 % 3.0` is `0.0`, exactly.

`[§wac-fmod-zero-f9hnqhr]` `7.0 % 0.0` is NaN, and `7.0 % infinity` is `7.0`.

`[§wac-fmod-f32-t52576z]` `f32 % f32` follows the same rule: `5.5 % 1.5` is `1.0`.

Unary `-` wants a type with a negation, so it is refused on an unsigned integer:

```wac
// expect: answers negate(3, 3) = -3
export i32 negate(i32 i, u32 u) {
  // ERROR: unary minus is not defined on u32
  // u32 n = -u;

  return -i;
}
```

`[§wac-neg-unsigned-mjgwgv9]` Unary `-` on an unsigned integer is refused.

## Comparison and equality

`== != < <= > >=` take two operands of one type and answer `bool`. They are defined on every primitive type,
and on `string`, which compares and orders by its bytes:

```wac
// expect: answers equal(1.0, 1.0) = true
// expect: answers distinctObjects = true
struct Point { i32 x; i32 y; }

export bool equal(f64 a, f64 b) { return a == b; }

export bool distinctObjects() {
  Point p = Point(1, 2);
  Point q = Point(1, 2);

  // ERROR: Point has no implementation of operators.equal
  // bool same = p == q;

  string? s = "x";

  // ERROR: string? has no ==; test for null first
  // bool t = s == "x";

  return p is not q;                       // equal fields, two objects
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
// expect: answers shl64(1, 32) = 4294967296
// expect: answers shlByU8(1, 3) = 8
// expect: answers shlByU8(1, 35) = 8
// expect: answers shr(-16, 1) = -8
// expect: answers ushr(-16, 1) = 2147483640
// expect: answers ushr(-1, 28) = 15
// expect: answers ushr64(-16, 4) = 1152921504606846975
// expect: answers rotl(1, 1) = 2
export i64 shl64(i64 v, i32 n) { return v << n; }
export i32 shlByU8(i32 v, u8 n) { return v << n; }        // the amount's type is any integer
export i32 shr(i32 v, i32 n) { return v >> n; }           // arithmetic: copies the sign bit
export i32 ushr(i32 v, i32 n) { return v >>> n; }         // logical: fills with zeros
export i64 ushr64(i64 v, i32 n) { return v >>> n; }
export u64 rotl(u64 v, i32 n) { return (v << n) | (v >> (64 - n)); }
```

`[§wac-shift64-rhgzpth]` An `i64` may be shifted by an `i32` amount: `1 << 32` is `4294967296`.

`[§wac-shift-amount-3wkq7np]` A shift amount may be any integer type. The left operand's type decides the
result, and the amount is taken modulo its width: `shlByU8(1, 35)` shifts by `3`.

`[§wac-shr-s-z073930]` `>>` on a signed integer is arithmetic: `-16 >> 1` is `-8`.

`[§wac-shr-u-ft3yabj]` `>>>` is logical: `-16 >>> 1` is `2147483640`.

`[§wac-shr-u-neg1-d3b1hey]` `-1 >>> 28` is `15`.

`[§wac-shr-u64-2jujzws]` `>>>` on an `i64`: `-16 >>> 4` is `1152921504606846975`.

```wac
// expect: answers halve(8, 1.0) = 4
export u32 halve(u32 x, f64 f) {
  // ERROR: '>>>' is redundant on u32 — '>>' is already logical
  // u32 bad = x >>> 1;

  // ERROR: '>>>' requires an integer type, got f64
  // f64 g = f >>> 1;

  return x >> 1;                           // logical, because x is unsigned
}
```

`[§wac-shr-u-redundant-m3kq7wn]` `>>>` on an unsigned type is refused; `>>` there is already logical.

`[§wac-shr-u-float-s95dlzw]` `>>>` on a float is refused.

There is no `<<<`: a left shift discards high bits either way.

### An integer's bit methods

Every integer has five methods, each one instruction that no operator reaches:

```wac
// expect: answers leading(0x00F0) = 24
// expect: answers leading(0) = 32
// expect: answers trailing(0x00F0) = 4
// expect: answers trailing(0) = 32
// expect: answers ones(0x00F0) = 4
// expect: answers rotateLeft(0x00F0, 28) = 0x0F
// expect: answers rotateLeft(0x00F0, 32) = 0x00F0
// expect: answers rotateRight(0x00F0, 4) = 0x0F
export u32 leading(u32 x) { return x.leadingZeros(); }
export u32 trailing(u32 x) { return x.trailingZeros(); }
export u32 ones(u32 x) { return x.onesCount(); }
export u32 rotateLeft(u32 x, i32 n) { return x.rotateLeft(n); }
export u32 rotateRight(u32 x, i32 n) { return x.rotateRight(n); }
```

`[§wacc-int-bit-methods]` Every integer type has `leadingZeros`, `trailingZeros`, `onesCount`, `rotateLeft` and
`rotateRight`, answering the receiver's own type. Zero has the full width of leading and trailing zeros, and a
rotation's count is taken modulo the width.

## Logical operators

`&& || !` take and answer `bool`. `&&` and `||` evaluate their right operand only when it can change the
answer:

```wac
// expect: answers bothPositive(3, 5) = true
// expect: answers bothPositive(3, -1) = false
// expect: answers callsMade = 0
struct Box { i32 val; }

bool incr(Box b) {
  b.val = b.val + 1;
  return true;
}

export bool bothPositive(i32 x, i32 y) { return x > 0 && y > 0; }

export i32 callsMade() {
  Box b = Box(0);
  bool r1 = false && incr(b);              // incr is not called
  bool r2 = true || incr(b);               // nor here
  return b.val;
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
// expect: answers compound = 40
// expect: answers postfix = 56
// expect: answers prefix = 66
// expect: answers shiftedLocal = 1152921504606846975
// expect: answers shiftedField = 16
// expect: answers shiftedElement = 16
struct Bits { i64 v; }

export i32 compound() {
  i32 x = 10;
  x += 5;
  x -= 2;
  x *= 3;
  x++;
  return x;                                // ((10 + 5 - 2) * 3) + 1
}

export i32 postfix() {
  i32 a = 5;
  i32 post = a++;                          // 5, and a is 6
  return post * 10 + a;
}

export i32 prefix() {
  i32 b = 5;
  i32 pre = ++b;                           // 6, and b is 6
  return pre * 10 + b;
}

export i64 shiftedLocal() {
  i64 local = -16;
  local >>>= 4;
  return local;
}

export i64 shiftedField() {
  Bits bits = Bits(1);
  bits.v <<= 4;
  return bits.v;
}

export i64 shiftedElement() {
  i64[] arr = [1];
  arr[0] <<= 4;
  return arr[0];
}
```

`[§wac-compound-pw7qq7v]` Compound assignment applies its operator and assigns: the sequence in `compound` leaves
`x` at `40`.

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
| 7 | `<` `<=` `>` `>=` `is` `is not` `matches` | left |
| 8 | `==` `!=` | left |
| 9 | `&` | left |
| 10 | `^` | left |
| 11 | `\|` | left |
| 12 | `&&` | left |
| 13 | `\|\|` | left |
| 14 | `??` | right |
| 15 | `?:` | right |

`is` and `matches` bind as comparisons do, so a test combines with another condition unparenthesised:
`s is null || n == 0`, and `Circle c matches s && c.r > 0.0` binds `c` for the right operand.

```wac
// expect: answers arithmeticFirst(1, 8) = true
// expect: answers coalesceLast = 5
export bool arithmeticFirst(i32 one, i32 eight) {
  return one + 2 * 3 == 7 && eight >> 1 + 1 == 2;   // * before +, + before >>
}

export i32 coalesceLast() {
  i32? a = null;
  return a ?? 4 + 1;                        // ?? binds looser than +: a ?? 5
}
```

`[§wac-precedence-tests-78cupm3]` Operators bind as the table above says; `is`, `is not` and `matches` bind as tightly as `<`.

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
// expect: answers addedY = 6.0
import { operators } from "core";

struct Vec2 {
  f64 x;
  f64 y;

  Vec2 [operators.add](const this, const Vec2 rhs) {
    return Vec2(this.x + rhs.x, this.y + rhs.y);
  }
}

export f64 addedY() {
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
// expect: answers maskOfComparison = true
import { operators } from "core";

struct EqualityMask { bool x; bool y; }

struct Pair {
  i32 x;
  i32 y;

  EqualityMask [operators.equal](const this, const Pair rhs) {
    return EqualityMask(this.x == rhs.x, this.y == rhs.y);
  }
}

export bool maskOfComparison() {
  Pair a = Pair(1, 2);
  Pair b = Pair(1, 3);
  EqualityMask m = a == b;

  // ERROR: Pair has no implementation of operators.notEqual
  // EqualityMask n = a != b;

  // ERROR: a condition requires bool, not EqualityMask
  // if (a == b) { }

  return m.x && !m.y;                      // x equal, y not
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
// expect: answers mutatedInPlace = 3
import { operators } from "core";

struct Counter {
  i32 value;

  void [operators.addAssign](this, i32 amount) {
    this.value += amount;
  }
}

export i32 mutatedInPlace() {
  Counter a = Counter(1);
  Counter alias = a;
  a += 2;                     // a.[operators.addAssign](2)
  return a is alias ? alias.value : -1;    // a still names the same object, now 3
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
// expect: answers constrained = 16.0
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

export f64 constrained() {
  Vec3 v = Vec3(1.0, 1.0, 1.0);
  Vec3 a = v * 5;                          // multiply's parameter constrains 5 to f32
  Vec3 b = 5 * v;                          // multiplyFromLeft constrains 5 to f32
  Vec3 c = (2 * 3) * v;                    // the left expression receives f32
  return (a.x + b.y + c.z) as f64;         // 5 + 5 + 6
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
