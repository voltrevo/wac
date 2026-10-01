# 09 — Numeric literals

A numeric literal denotes an exact value and has no type of its own. It waits for one: the type its
context expects, or the type of the operands it is combined with. A literal nothing gives a type to
is an error.

## A literal waits for a target type

```wac
// fragment — inside a function
u64 y = 3;
auto z = 2 * y;              // 2 is u64; z is u64
f32 f = 5;                   // integer spelling may denote a float
u8 x = 2 * 3 * 4;            // all operations use u8; result 24

// auto unknown = 7;         // ERROR: unresolved numeric type
// auto unknown = 2 * 3;     // ERROR: unresolved numeric type
// u8 tooLarge = 256;        // ERROR: literal outside u8 range
```

```wac
// expect: answers twice(2147483648) = 0
export u32 twice(u32 x) {
  // ERROR: unresolved numeric type
  // auto unknown = 7;

  // ERROR: literal outside u8 range
  // u8 tooLarge = 256;

  return x * 2;                              // 2 is a u32 here, and the multiply wraps at 32 bits
}
```

`[§wac-litctx-w7kn2mf]` A literal takes the type expected of it: in `twice`, `2` is a `u32`, so
`twice(2147483648)` wraps to `0` rather than promoting.

`[§wac-literal-no-fallback-9pffhd9]` A literal, or an expression made only of literals, has no default
type. With no expected type and no typed operand to take one from, it is refused — there is no `i32`
or `f64` fallback.

Typed primitive numeric operands constrain the unresolved operands of their built-in operators.
Already-typed operands never change type to meet a context.

```wac
// expect: answers aboveMin(7) = true
// expect: answers belowMin(7) = false
// expect: answers isBig = true
i64 big() { return 1000000000000; }

export bool aboveMin(i32 x) { return -2147483648 <= x; }   // the literal takes i32 from x
export bool belowMin(i32 x) { return x < -2147483648; }    // in either order
export bool isBig() { return big() == 1000000000000; }     // and i64 from big()
```

`[§wac-int-context-9wkq4mz]` A literal operand of a built-in operator takes its type from the other
operand, in either order and whether or not it is negated.

`[§wac-i64lit-operand-4k1n3ev]` `isBig()` is `true`: the literal is an `i64` because
`big()` is.

```wac
// expect: answers belowTrillion(5) = true
export bool belowTrillion(i64 x) { return x < 1000000000000; }
```

`[§wac-i64lit-cmp-hnbz7ev]` `x < 1000000000000` with `x` an `i64` is `true`.

Arithmetic takes place in the inferred type, including its ordinary overflow behaviour.
`u8 x = 200 * 2 / 2;` is `u8` multiplication followed by `u8` division, not exact arithmetic followed
by a single conversion:

```wac
// expect: answers halveDouble = 72
export u8 halveDouble() {
  u8 x = 200 * 2 / 2;                        // 400 wraps to 144, then 144 / 2
  return x;
}
```

`[§wac-literal-arith-in-type-n3wf26w]` An expression of literals is evaluated in the type it is given,
operation by operation, with that type's wrapping — not exactly and then converted.

## A literal's value must have a reading in its type

Adopting a type is only ever a reading of the same written value, never a conversion:

```wac
// expect: emits
export void readings(i32 x) {
  // ERROR: -1 has no u32 reading
  // u32 a = -1;

  // ERROR: 5000000000 does not fit i32
  // i32 b = 5000000000;

  // ERROR: expected u32, got i32 — a variable is not a literal
  // u32 c = x;
}
```

`[§wac-litctx-nofit-k3mq8wl]` A literal with no reading in its type is refused, and a variable never
takes on another type the way a literal does.

```wac
// expect: answers int32 = 42
// expect: answers int64 = 1000000000000
// expect: answers float32 = 3.14
// expect: answers float64 = 2.718281828459045
export i32 int32() { return 42; }
export i64 int64() { return 1000000000000; }
export f32 float32() { return 3.14; }
export f64 float64() { return 2.718281828459045; }
```

`[§wac-int32-dfkqg8u]` `42` read as an `i32` is `42`.

`[§wac-int64-81jz1o0]` `1000000000000` read as an `i64` is `1000000000000`.

`[§wac-float32-45okgg8]` `3.14` read as an `f32` is `3.14` at `f32` precision.

`[§wac-float64-suhtesz]` `2.718281828459045` read as an `f64` is `2.718281828459045`.

Integer targets reject fractional or out-of-range values. Floating targets accept integer-spelled
values and round to their supported precision; overflow is an error. Literal conversion does not
inherit wrapping arithmetic semantics. Unary minus on a numeric literal is included in its literal
value before range checking, so signed minima remain expressible:

```wac
// expect: answers minInt = -2147483648
export i32 minInt() { return -2147483648; }
```

`[§wac-litctx-minint-p9fk4wq]` `-2147483648` is a valid `i32` literal: the minus is part of the
literal's value.

```wac
// expect: answers floatContexts = 6.5
export f64 floatContexts() {
  f32 a = 1.5;                               // f32 by context
  f64 b = 1.5;
  f32 c = 3.14159;                           // rounded, as decimal notation always is
  f32 d = 2;                                 // an integer spelling, read as a float

  // ERROR: 1.0e40 overflows f32
  // f32 e = 1.0e40;

  return a as f64 + b + d as f64 + 1.5;
}
```

`[§wac-float-literal-ctx-8dqm2vw]` A float literal takes `f32` or `f64` from its context, rounding to
nearest; a value whose magnitude overflows the target is refused.

`[§wac-float-integer-spelled-ur9ttxq]` An integer-spelled literal may be read as a float when a float is
expected: `f32 d = 2;` is `2.0`.

## Spelling

A decimal literal may carry an exponent, and the point is then optional. Spelling does not decide
the type: an exponent is part of the value, and `i64 n = 1e9;` is a billion.

```wac
// expect: answers billion = 1000000000.0
// expect: answers tenBillion = 10000000000.0
// expect: answers twoThousandths = 0.002
// expect: answers fifteenBillion = 15000000000.0
export f64 billion() { return 1e9; }
export f64 tenBillion() { return 1E10; }
export f64 twoThousandths() { return 2e-3; }
export f64 fifteenBillion() { return 1.5e+10; }
```

`[§wac-float-exponent-7mkq3wv]` `1e9`, `1E10`, `2e-3`, `1.5e10` and `1.5e+10` are literals with
exponents, with or without a point. A bare `e` with no digits after it is not an exponent: `1e` is `1` followed by the name
`e`.

Underscores may separate digits anywhere after the first, and carry no meaning:

```wac
// expect: answers million = 1000000
export i32 million() { return 1_000_000; }
```

`[§wac-numsep-qpeegkw]` `1_000_000` is `1000000`. Underscores are removed before a literal is read.

A literal may be written in hex:

```wac
// expect: answers mask = 255
// expect: answers color = 16711935
export i32 mask() { return 0xFF; }
export i32 color() { return 0xFF00FF; }
```

`[§wac-hex-cs4i9ht]` `0xFF` is `255` and `0xFF00FF` is `16711935`.

What a hex literal denotes when its high bit is set at the target's width — a bit pattern, or its
mathematical value — is open; see the end of this chapter.

### Character literals

`'a'` is a numeric literal spelled as a character. Its value is the Unicode codepoint, and like any
numeric literal it takes its type from its context:

```wac
// expect: answers letterA = 97
// expect: answers newline = 10
// expect: answers quote = 39
// expect: answers emoji = 128512
// expect: answers emojiEscaped = 128512
export i32 letterA() {
  // ERROR: an empty character literal
  // i32 e = '';

  // ERROR: a character literal holds one character
  // i32 two = 'ab';

  return 'a';
}

export i32 newline()      { return '\n'; }
export i32 quote()        { return '\''; }
export i32 emoji()        { return '😀'; }
export i32 emojiEscaped() { return '\u{1F600}'; }
```

`[§wac-charlit-p4kn8wq]` `'a'` is `97`.

`[§wac-charlit-esc-h7mf2xj]` `'\n'` is `10` and `'\''` is `39`.

`[§wac-charlit-cp-r3jw9kt]` `'😀'` is `128512`: the codepoint, not a UTF-8 byte. Only for ASCII does a
character literal equal one byte of the corresponding string — `'é'` is `233` while `"é".len()` is
`2`.

`[§wac-charlit-uesc-w3mk7qj]` `'\u{1F600}'` is `128512`, the same value as `'😀'`.

`[§wac-charlit-empty-m8qf5np]` `''` is refused.

`[§wac-charlit-multi-w2nk7dr]` `'ab'` is refused.

The escapes are a string's, with its own delimiter in place of the string's: `\n` `\t` `\r` `\\`
`\'` `\0`, and `\u{…}`. `'\"'` is refused, as `"\'"` is: each is a second spelling of a character
that needs no escaping where it sits ([16](16-strings.md)).

## Constraint scope

```wac
// fragment — with T echo<T>(T x) { return x; } and void consumeU8(u8 v) declared
u8 x = echo(200 * 2 / 2);    // result u8 -> T=u8 -> argument u8
u64 y = 3;
echo(2 * y);                 // T=u64

// u8 bad = echo(2 * y);     // ERROR: u64 conflicts with u8
// auto unresolved = echo(2 * 3); // ERROR

// auto later = 7;           // ERROR in this initializer
// consumeU8(later);         // later statements cannot supply its type
```

Constraints flow both ways within an expression, through known signatures and its expected type.
Generic call inference uses signatures, not searches through callee bodies. Explicit generic arguments
can also supply a type: `echo<u8>(7)`. Array elements, ternary branches, and inferred function returns
participate in the collection rules of [32](../5-inference/32-widening.md) to
[34](../5-inference/34-recursive-inference.md). An `auto` local must resolve at its own initializer;
its later uses cannot repair it.

```wac
// expect: answers echoes = 72
T echo<T>(T x) { return x; }

export i32 echoes() {
  u8 x = echo(200 * 2 / 2);                 // T = u8, from the result
  u64 y = 3;
  u64 w = echo(2 * y);                      // T = u64, from y

  // ERROR: u64 conflicts with u8
  // u8 bad = echo(2 * y);

  // ERROR: unresolved numeric type
  // auto unresolved = echo(2 * 3);

  // ERROR: unresolved numeric type — later statements cannot supply it
  // auto later = 7;

  return x as i32 + (w - 6) as! i32;        // 72 + 0
}
```

`[§wac-literal-constraint-scope-6anwagf]` A literal's type is resolved within its own expression — from
the expected type, from typed operands, and through the signatures of the calls it is an argument to.
A later statement cannot supply it.

## core.NumberLiteral and core.fromNumber

```wac
// fragment — a numeric type of the program's own
import { NumberLiteral, fromNumber } from "core";

struct Complex {
  f64 real;
  f64 imaginary;

  Result<Complex> [fromNumber](NumberLiteral value) {
    f64 real = try f64.[fromNumber](value);
    return Result.Ok(Complex(real, 0.0));
  }
}

void example(bool runtimeCond) {
  Complex x = 3;
  Complex y = runtimeCond ? 2 : 3;
  // Conceptually select between two statically converted Complex values.
}
```

`NumberLiteral` is a special core type representing the exact source numeric value before
machine-number rounding. `fromNumber` is a nominal symbol exported at core's root. The target type's
receiverless method accepts `NumberLiteral` and returns `Result<T>`, where T is that target type.
Intrinsic numeric types provide this same operation. No ordinary name is reserved and no external
implementations are introduced.

```wac
// expect: answers realParts = 5.0
import { NumberLiteral, fromNumber, Result } from "core";

struct Complex {
  f64 real;
  f64 imaginary;

  Result<Complex> [fromNumber](NumberLiteral value) {
    f64 real = try f64.[fromNumber](value);
    return Result.Ok(Complex(real, 0.0));
  }
}

export f64 realParts() {
  Complex x = 3;
  Complex y = 2;
  return x.real + y.real;
}
```

`[§wac-fromnumber-literal-jqssasj]` A numeric literal whose target type implements core's `fromNumber`
symbol is converted by calling it with the literal's exact value. `Ok(value)` supplies the converted
value.

For literal syntax, `Ok(value)` supplies the converted value. `Err(error)` is a compile-time
conversion failure reported at the literal. Error formatting is unspecified; this imposes no
formatting interface on the error type. An explicit `T.[fromNumber](value)` call returns the ordinary
`Result`, allowing conversion implementations to handle or propagate errors using ordinary wac.

```wac
// expect: refused
import { NumberLiteral, fromNumber, Result } from "core";

struct Even {
  i64 value;

  Result<Even, string> [fromNumber](NumberLiteral literal) {
    i64 v = try i64.[fromNumber](literal);
    if (v % 2 != 0) { return Result.Err("odd"); }
    return Result.Ok(Even(v));
  }
}

export i64 three() {
  Even e = 3;                                // refused here: the conversion answered Err
  return e.value;
}
```

`[§wac-fromnumber-err-refused-e8w89yu]` A `fromNumber` conversion of a literal that answers `Err` is a
compile-time error, reported at the literal.

The target is selected before conversion. A conversion error does not retry inference, select another
union alternative, or try another implementation.

Conversion of a source literal is evaluated statically. It follows ordinary static evaluation
([28](../4-static/28-static-evaluation.md)), including diagnostics for failed evaluation and resource
limits. The conversion may allocate; materialisation preserves identity and aliasing under the
existing static-value rules ([27](../4-static/27-static-declarations.md)). It does not allocate afresh
on every runtime evaluation of that literal occurrence. Distinct occurrences are separate conversions,
per generic instantiation; cached evaluation must preserve observable identity. Existing const and
static-value access rules still apply.

`[§wac-fromnumber-static-ah2ihmk]` A literal's `fromNumber` conversion runs at compile time, once per
occurrence and generic instantiation, and its result is that occurrence's value at every run.

`NumberLiteral` carries no runtime-dependent numeric input. An unresolved expression is a
type-checking state, not a runtime `NumberLiteral` value:

```wac
// fragment
Complex x = runtimeCond ? 2 : 3;
// Convert 2 and 3 separately, statically; select at runtime.
// Do not pass the runtime conditional to fromNumber.
```

A conversion constructs a value only after inference identifies its target. Implementing `fromNumber`
does not make `auto x = 3` infer that implementing type. The operation also does not implicitly
convert already-typed numeric variables.

```wac
// expect: emits
import { NumberLiteral, fromNumber, Result } from "core";

struct Complex {
  f64 real;
  Result<Complex> [fromNumber](NumberLiteral value) {
    return Result.Ok(Complex(try f64.[fromNumber](value)));
  }
}

export f64 literalsOnly() {
  // ERROR: unresolved numeric type — fromNumber does not make 3 a Complex
  // auto x = 3;

  f64 r = 3.0;

  // ERROR: expected Complex, got f64 — a typed value is not a literal
  // Complex c = r;

  Complex one = 1;                           // a literal whose target is Complex
  return one.real + r;
}
```

`[§wac-fromnumber-not-inference-6yrczq3]` Implementing `fromNumber` neither gives an untyped literal a
type nor converts a typed value: it applies only to a literal whose target is already that type.

User-defined operators constrain literal operands through their signatures; that is
[22](../3-expressions/22-operators.md)'s subject. Which alternative of a union a literal enters is
[18](18-unions.md)'s.

## Open

- **`NumberLiteral`'s inspection API.** `NumberLiteral` is exact and available to static conversion
  code. Its public inspection API (digits, exponent, sign, or exact numerator/denominator access)
  needs a separate API pass; the examples above only forward it to a primitive conversion. No `f64`
  intermediate is permitted.
- **Hex literals.** Whether hexadecimal spelling carries bit-pattern semantics distinct from its
  mathematical value is open. Under bit-pattern semantics `i32 x = 0xFFFFFFFF;` is `-1` — read as two's
  complement at the target's width — and `i64 y = 0xFFFFFFFF;` is `4294967295`. Under value semantics
  the first is out of range and refused. Current wac uses bit-pattern semantics, and the masks and
  polynomials of its cryptography are written that way.
