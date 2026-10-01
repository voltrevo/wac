# 25 — Control flow

Conditions are `bool`, and every body is a braced block. There are four loop heads, a `switch` on integers, a
ternary, `match`, and `matches`, which tests a pattern and binds a name in one expression.

## `if`

```wac
// expect: answers abs(-42) = 42
// expect: answers abs(7) = 7
export i32 abs(i32 n) {
  if (n < 0) { return -n; }
  else { return n; }
}
```

`[§wac-abs-djo90kx]` `if` runs its block when its `bool` condition holds, and its `else` block otherwise:
`abs(-42)` is `42` and `abs(7)` is `7`.

Braces are required: there is no statement form without them.

## Loops

```wac
// expect: answers collatz(27) = 111
// expect: answers fib(20) = 6765
// expect: answers digitCount(0) = 1
// expect: answers digitCount(9999) = 4
export i32 collatz(i32 n) {
  i32 steps = 0;
  while (n != 1) {
    if (n % 2 == 0) { n = n / 2; }
    else { n = n * 3 + 1; }
    steps++;
  }
  return steps;
}

export i32 fib(i32 n) {
  if (n < 2) { return n; }
  i32 a = 0;
  i32 b = 1;
  for (i32 i = 2; i <= n; i++) {
    i32 t = a + b;
    a = b;
    b = t;
  }
  return b;
}

export i32 digitCount(i32 n) {
  if (n < 0) { n = -n; }
  i32 count = 0;
  do {
    count++;
    n = n / 10;
  } while (n > 0);
  return count;
}
```

`[§wac-collatz-k1chom8]` `while` repeats its block while its condition holds: `collatz(27)` is `111`.

`[§wac-fib-kko47vy]` `for (init; cond; update)` runs `init` once, then the block and `update` while `cond` holds:
`fib(20)` is `6765`.

`[§wac-dowhile-d6kgle1]` `do { } while (cond);` runs its block at least once: `digitCount(0)` is `1` and
`digitCount(9999)` is `4`.

### Iterating over a thing

`for (T x in xs)` walks the elements of an array, a `Vec`, or any generator, without an index that exists
only to be a cursor:

```wac
// expect: answers lengthOfNonEmpty(["ab", "", "cdef", "gh"]) = 8
import { Vec } from "core";

Vec<string> nonEmpty(string[] lines) {
  Vec<string> out;
  for (string line in lines) {
    if (line.len() > 0) { out.push(line); }
  }
  return out;
}

i32 totalLength(Vec<string> lines) {
  i32 n = 0;
  for (auto line in lines) { n += line.len(); }
  return n;
}

export i32 lengthOfNonEmpty(string[] lines) { return totalLength(nonEmpty(lines)); }
```

`[§wac-for-in-qkcbmxf]` `for (T x in e)` binds each element of `e` in turn and runs the block. `e` may be an array,
or anything that produces a generator ([36](../6-concurrency/36-coroutines-and-generators.md)); `auto` takes the
element type.

The head keeps its parentheses and declares its variable the way any local is declared. `for await` walks an
async generator ([36](../6-concurrency/36-coroutines-and-generators.md)).

### A loop with no exit

A loop whose condition is literally `true`, or a `for` with no condition, finishes only by a `break` that can
leave it. If none can, control never reaches the end of the loop, and nothing need follow it:

```wac
// expect: answers firstMultiple(4, 10) = 12
// expect: answers countTo(7) = 7
// expect: answers nestedBreak(3) = 3
// expect: answers nestedBreak(0) = 1
export i32 firstMultiple(i32 step, i32 floor) {
  i32 n = 0;
  while (true) {
    n += step;
    if (n > floor) { return n; }
  }
}

export i32 countTo(i32 target) {
  for (i32 i = 0; ; i++) {
    if (i == target) { return i; }
  }
}

export i32 nestedBreak(i32 n) {
  while (true) {
    switch (n) {
      case 1: { break; }                   // leaves the switch, not the loop
      default: { break; }
    }
    if (n > 0) { return n; }
    n++;
  }
}
```

`[§wac-infloop-while-zvvoovg]` A `while (true)` with no `break` that leaves it needs no `return` after it.

`[§wac-infloop-for-q1ga6km]` Nor does a `for` with no condition.

`[§wac-infloop-nested-m2ydt52]` A `break` that leaves an inner loop or `switch` does not make the outer loop
finite.

```wac
// expect: emits
export i32 returnsAfter(i32 n) {
  while (true) {
    if (n > 0) { break; }
    n++;
  }
  return n;
}

// ERROR: not every path returns a value
// export i32 needsReturn(i32 n) {
//   while (true) {
//     if (n > 0) { break; }
//     n++;
//   }
// }
```

`[§wac-infloop-break-hiomizo]` When a `break` can leave the loop, a non-`void` function must still return after
it.

### `break` and `continue`

```wac
// expect: answers findFirst([10, 20, 30], 20) = 1
// expect: answers sumOdd([1, 2, 3, 4, 5]) = 9
// expect: answers oddsToTen = 25
export i32 findFirst(i32[] arr, i32 target) {
  i32 result = -1;
  for (i32 i = 0; i < arr.len(); i++) {
    if (arr[i] == target) {
      result = i;
      break;
    }
  }
  return result;
}

export i32 sumOdd(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    if (arr[i] % 2 == 0) { continue; }
    total += arr[i];
  }
  return total;
}

export i32 oddsToTen() {
  i32 i = 0;
  i32 sum = 0;
  do {
    i++;
    if (i % 2 == 0) { continue; }          // goes to the condition, not the top
    sum = sum + i;
  } while (i < 10);
  return sum;                              // 1 + 3 + 5 + 7 + 9
}
```

`[§wac-break-x7y68xx]` `break` leaves the innermost loop.

`[§wac-continue-apojox2]` `continue` goes to what the loop does between iterations: a `for`'s update runs, and a
`do-while`'s condition is tested.

```wac
// expect: emits
export i32 outsideLoops() {
  // ERROR: break outside a loop
  // break;

  // ERROR: continue outside a loop
  // continue;

  i32 n = 1;
  switch (n) {
    case 1: { break; }                     // leaves the switch

    // ERROR: continue inside a switch that is not inside a loop
    // case 2: { continue; }

    default: { }
  }
  return 0;
}
```

`[§wac-break-noloop-p3kn7wp]` `break` outside a loop or `switch` is refused.

`[§wac-continue-noloop-r8jm4xf]` `continue` outside a loop is refused.

`[§wac-continue-not-switch-8kd3pq7]` A `switch` counts for `break` and not for `continue`: `continue` in a
`switch` that is not inside a loop is refused.

A `match` arm counts for neither: `break` and `continue` in an arm act on the enclosing loop
([13](../2-types/13-enums.md)).

## `switch`

`switch` dispatches on a 32-bit integer — `i32` or `u32`. Each `case` is its own block; there is no
fallthrough:

```wac
// expect: answers dayType(0) = 0
// expect: answers dayType(6) = 0
// expect: answers dayType(3) = 1
// expect: answers noFallthrough = 21
export i32 dayType(i32 day) {
  switch (day) {
    case 0:  { return 0; }                 // Sunday
    case 6:  { return 0; }                 // Saturday
    default: { return 1; }                 // a weekday
  }
}

export i32 noFallthrough() {
  i32 x = 0;
  i32 one = 1;
  switch (one) {
    case 0: { x = 10; }
    case 1: { x = 20; }                    // only this runs
    case 2: { x = 30; }
  }
  u32 big = 4294967295;
  switch (big) {
    case 4294967295: { x += 1; }
    default: { }
  }
  return x;                                // 20 + 1
}
```

`[§wac-switch-4s87owc]` `switch` runs the block of the case equal to its subject, or `default`'s.

`[§wac-no-fallthru-r5kw2n8]` Only the matching case runs: there is no fallthrough.

`[§wac-switch-u32-r5nk8wf]` A `u32` subject works, including a case value above `i32`'s range.

```wac
// expect: emits
export i32 cases() {
  i32 n = 1;
  switch (n) {
    case 1: { }

    // ERROR: duplicate case value 1
    // case 1: { }

    // ERROR: duplicate case value 1 — 0x1 is 1
    // case 0x1: { }

    default: { }
  }
  return 0;
}
```

`[§wac-switch-dupcase-7hq2nkv]` Two constant case values that are equal as 32-bit values are refused, reported at
the second. A `switch` may have at most one `default`.

A character literal is a natural case value: `case 'x':` reads better than `case 0x78:`.

## The ternary

`c ? a : b` answers `a` when `c` holds and `b` otherwise. Its type combines both branches: the greater nullable
depth, over the nearest common ancestor of the non-nullable forms. `anyref` is never reached, since a rule
allowed to reach it could refuse nothing:

```wac
// expect: answers max(3, 7) = 7
// expect: answers max(10, 2) = 10
// expect: answers combined = 9
struct Shape { i32 x; }
struct Circle : Shape { i32 r; }
struct Rect : Shape { i32 w; }

export i32 max(i32 a, i32 b) { return a > b ? a : b; }

Shape? pick(bool y) { return y ? Circle(1, 2) : null; }

export i32 combined() {
  bool c = true;
  Shape s = c ? Circle(3, 1) : Rect(4, 1);   // siblings meet at Shape
  Shape t = c ? Circle(5, 1) : Shape(6);     // a subtype and its parent
  Shape? u = pick(false);                    // null widens the other branch

  // ERROR: the two branches have unrelated types
  // auto e = c ? s : "red";

  return s.x + t.x + (u is null ? 1 : 0);   // 3 + 5 + 1
}
```

`[§wac-ternary-bthswsh]` The ternary answers the branch its condition selects: `max(3, 7)` is `7`.

`[§wac-ternary-null-3kx9ba2]` A `null` branch makes the result the other branch's type, nullable.

`[§wac-ternary-subtype-h4jm9wq]` A subtype and its parent combine to the parent.

`[§wac-ternary-lca-q7fk3wn]` Two siblings combine to their nearest common ancestor.

Branches that meet nowhere else are refused. The general rule for combining types — shared by ternaries, array
literals and inferred returns — is [32](../5-inference/32-widening.md)'s subject.

## `match`

`match` takes a value apart by its variants or member types. Its arms, patterns, exhaustiveness and narrowing are
[13](../2-types/13-enums.md)'s subject for enums and [18](../2-types/18-unions.md)'s for unions. Three things
belong to `match` as control flow.

### An arm can leave

In a `match` that gives a value, an arm that leaves — `return`, `break`, `continue`, a call of type `never` —
gives none, and is not asked to agree with the others:

```wac
// expect: answers skipsPoints = 13
enum Shape { Circle(f64 r), Rect(f64 w, f64 h), Point }

i32 total(Shape[] shapes) {
  i32 n = 0;
  for (Shape s in shapes) {
    f64 a = match (s) {
      Circle(r):  3.0 * r * r,
      Rect(w, h): w * h,
      Point:      continue,                // gives no value
    };
    n += a as~ i32;
  }
  return n;
}

export i32 skipsPoints() { return total([Shape.Circle(1.0), Shape.Point, Shape.Rect(2.0, 5.0)]); }   // 3 + 10
```

`[§wac-match-arm-leaves-y33uzzi]` An arm of a value-giving `match` may leave instead of giving a value; its type is
`never`, and it does not take part in combining the arms' types.

### A nullable subject takes a `null` arm

`match` takes a `T?`. The arms name `null` alongside the variants, or a `default` covers it; every other arm
sees a non-null subject:

```wac
// expect: answers area(null) = null
// expect: answers round(null) = null
// expect: answers squareArea = 4.0
enum Shape { Circle(f64 r), Square(f64 side) }

export f64? area(Shape? s) {
  return match (s) {
    Circle(r):  3.0 * r * r,
    Square(sd): sd * sd,
    null:       null,
  };
}

export f64? round(Shape? s) {
  return match (s) {
    Circle(r): 3.0 * r * r,
    default:   null,                       // Square, and null
  };
}

export f64? squareArea() {
  // ERROR: match does not cover null
  // f64 d = match (Shape.Square(1.0) as Shape?) { Circle(r): r, Square(sd): sd };

  return area(Shape.Square(2.0));
}
```

`[§wac-match-nullable-subject-zcnasbp]` A `match` on a nullable subject must cover `null`, with a `null` arm or a
`default`. The other arms see a non-null subject.

Requiring the subject to be unwrapped first would put one case outside the check: `match (s!)` traps unless a
null test ran above it, and exhaustiveness would then prove something about only part of the decision.

### `default` is arm syntax, not a pattern

```wac
// expect: emits
enum Shape { Circle(f64 r), Square(f64 side) }

export i32 defaultIsArm() {
  Shape s = Shape.Circle(1.0);

  // ERROR: default is an arm, not a pattern — expected an expression
  // bool any = default matches s;

  return 0;
}
```

`[§wac-default-not-pattern-yvjczct]` `default` is valid only as a `match` arm. It cannot stand where a pattern is
expected.

## `matches`

`p matches e` tests the pattern `p` against `e`, binding the pattern's names when it succeeds, and answers a
`bool`. A pattern is a match arm's: a variant with its payload, a type with a name, `is` inside a payload:

```wac
// expect: answers missingNotFound = true
// expect: answers missingDenied = false
// expect: answers configuredThree = true
// expect: answers bindingRed = 1
// expect: answers binding(null) = 0
struct Rgb { i32 r; i32 g; i32 b; }
enum Fault { NotFound, Denied }
enum Outcome { Ok(i32 v), Err(Fault e) }

bool missing(Outcome res) { return Err(is NotFound) matches res; }

bool configured(Outcome res) { return Ok(v) matches res && v > 0; }

export i32 binding(Rgb? maybe) {
  if (Rgb p matches maybe) { return p.r; }

  // ERROR: undefined name 'p' — it is scoped to the if statement
  // return p.r;

  return 0;
}

export bool missingNotFound() { return missing(Outcome.Err(Fault.NotFound)); }
export bool missingDenied() { return missing(Outcome.Err(Fault.Denied)); }
export bool configuredThree() { return configured(Outcome.Ok(3)); }
export i32 bindingRed() { return binding(Rgb(1, 2, 3)); }
```

`[§wac-matches-pattern-q76z7yq]` `p matches e` is `true` when `e` matches the match-arm pattern `p`, and binds `p`'s
names to the matched parts.

The names a `matches` binds are scoped to its statement, and readable only where the match is what let control
reach them: the right operand of `&&`, the then-arm of `?:`, the block of an `if` or `while`, and the body and
update of a `for`. They do not outlive the statement, whether or not the match plainly succeeded:

```wac
// expect: answers circlesOverTwo = 1
// expect: answers radius(null) = null
// expect: answers drained = 10
import { Vec } from "core";

struct Circle { f64 r; }

i32 circles(Circle?[] shapes, f64 min) {
  i32 n = 0;
  for (Circle? s in shapes) {
    if (Circle c matches s && c.r > min) { n += 1; }
  }
  return n;
}

export f64? radius(Circle? s) {
  return Circle c matches s ? c.r : null;
}

i32 drain(Vec<i32> q) {
  i32 n = 0;
  while (i32 v matches q.pop()) { n += v; }   // one test, one binding
  return n;
}

export i32 circlesOverTwo() { return circles([Circle(1.0), null, Circle(3.0)], 2.0); }

export i32 drained() {
  Vec<i32> q;
  q.push(4);
  q.push(6);
  return drain(q);                         // 4 + 6
}
```

`[§wac-matches-scope-i52ba3w]` A name bound by `matches` is in scope only in the parts of its statement that run
because the match succeeded — the right of `&&`, the then-arm of `?:`, the block of an `if` or `while`, the body
and update of a `for` — and nowhere after the statement.

A pattern whose answer is already known is still a question, so it is not refused:

```wac
// expect: answers certainBlue = 3
struct Rgb { i32 r; i32 g; i32 b; }

i32 alwaysTrue(Rgb certain) {
  if (Rgb p matches certain) { return p.b; }   // always matches; allowed
  return 0;
}

export i32 certainBlue() { return alwaysTrue(Rgb(1, 2, 3)); }
```

`matches` cannot be overloaded, and binds looser than `&&` ([22](22-operators.md)).

## `defer`

`defer s;` runs `s` when the enclosing block exits, however it exits:

```wac
// expect: answers releasesAfterTwoCalls = 2
struct Log { i32 releases; }

i32 cleanup(Log log, i32 n) {
  defer log.releases++;

  if (n < 0) { return -1; }                // the deferred statement runs here
  return n;                                // and here
}

export i32 releasesAfterTwoCalls() {
  Log log = Log(0);
  cleanup(log, -5);
  cleanup(log, 5);
  return log.releases;
}
```

`[§wac-defer-7tf59c7]` A `defer`red statement runs when control leaves the block it is written in — by falling off its
end, by `return`, by `break` or `continue` — after the value of any `return` has been computed.

## Open

- **Several `defer`s in one block.** The order in which several deferred statements run — the reverse of their
  order, as is usual — is not yet written down, and neither is whether a deferred statement runs when the block
  is left by a trap.
- **`sys.atEnd`.** Whether cleanup tied to a domain rather than a block wants its own construct beside `defer`.
