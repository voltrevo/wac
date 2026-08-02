## Control flow

### if / else

```wac
if (cond) { ... }
if (cond) { ... } else { ... }
```

Condition must be `bool`. Braces required.

```wac
export i32 abs(i32 n) {
  if (n < 0) { return -n; }
  else { return n; }
}
```

`[§wac-abs-djo90kx]` `abs(-42)` returns `42`. `abs(7)` returns `7`.

### while

```wac
while (cond) { ... }
```

```wac
export i32 collatz(i32 n) {
  i32 steps = 0;
  while (n != 1) {
    if (n % 2 == 0) { n = n / 2; }
    else { n = n * 3 + 1; }
    steps++;
  }
  return steps;
}
```

`[§wac-collatz-k1chom8]` `collatz(27)` returns `111`.

### for

```wac
for (i32 i = 0; i < n; i++) { ... }
```

The init clause is a declaration or assignment. The update clause is an
assignment or increment.

```wac
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
```

`[§wac-fib-kko47vy]` `fib(20)` returns `6765`.

### do-while

```wac
do { ... } while (cond);
```

Body executes at least once.

```wac
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

`[§wac-dowhile-d6kgle1]` `digitCount(0)` returns `1`. `digitCount(9999)` returns `4`.

### Infinite loops

A loop whose condition is literally `true` — or a `for` with no condition at all
— never finishes on its own. If no `break` can reach it, control never gets past
the loop, so a non-void function needs no `return` after it. This applies to
`while`, `for` and `do`-`while` alike.

```wac
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
```

`[§wac-infloop-while-zvvoovg]` `firstMultiple(4, 10)` returns `12` — the function compiles with no `return` after the loop.
`[§wac-infloop-for-q1ga6km]` `countTo(7)` returns `7`; `for (i32 i = 0; ; i++)` needs no trailing return either.

Only a `break` that would exit *that* loop counts. A `break` inside a nested
loop or `switch` binds to the inner construct, so it leaves the outer loop
infinite.

```wac
export i32 nestedBreak(i32 n) {
  while (true) {
    switch (n) {
      case 1: break;
      default: break;
    }
    if (n > 0) { return n; }
    n++;
  }
}
```

`[§wac-infloop-nested-m2ydt52]` `nestedBreak(3)` returns `3` — the `switch` breaks do not make the `while` finite.

When a `break` *can* exit the loop, the loop may complete, and a non-void
function still has to return afterwards.

```wac
export i32 needsReturn(i32 n) {
  while (true) {
    if (n > 0) { break; }
    n++;
  }
}                                  // error: not all code paths return a value
```

`[§wac-infloop-break-hiomizo]` This is a compile error; adding `return n;` after the loop fixes it.

### break and continue

```wac
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
```

`[§wac-break-x7y68xx]` `findFirst` on `{ 10, 20, 30 }` with target `20` returns `1`.

```wac
export i32 sumOdd(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    if (arr[i] % 2 == 0) { continue; }
    total += arr[i];
  }
  return total;
}
```

`[§wac-continue-apojox2]` `sumOdd` on `{ 1, 2, 3, 4, 5 }` returns `9`.

`continue` goes to **whatever the loop does between iterations**, not to the top of the body: a
`for`'s update runs, and a `do-while`'s condition is tested. The do-while case is the one worth
stating, because it is the only loop whose test is at the bottom:

```wac
i32 i = 0; i32 sum = 0;
do { i++; if (i % 2 == 0) { continue; } sum = sum + i; } while (i < 10);
```

`[§wac-continue-apojox2]` `sum` is `25`. It was `36` — `continue` restarted the body with the
condition untested, so the loop ran an eleventh iteration.

`break` and `continue` outside a loop are compile errors:

```wac
export void badBreak() {
  break;                      // error: break outside loop
}

export void badContinue() {
  continue;                   // error: continue outside loop
}
```

`[§wac-break-noloop-p3kn7wp]` `break` outside a loop is a compile error.
`[§wac-continue-noloop-r8jm4xf]` `continue` outside a loop is a compile error.

### ternary

```wac
i32 x = cond ? 1 : 2;
```

Both branches must have the same type. Condition must be `bool`.

```wac
export i32 max(i32 a, i32 b) {
  return a > b ? a : b;
}
```

`[§wac-ternary-bthswsh]` `max(3, 7)` returns `7`. `max(10, 2)` returns `10`.

If one branch is `null`, the ternary's type is the other branch's, made nullable:

```wac
struct S { i32 v; }
S? pick(bool y) { return y ? S(1) : null; }
```

`[§wac-ternary-null-3kx9ba2]` `pick(true)` is an `S`, `pick(false)` is null. Worth
stating because it did not work: `null` is assignable to no non-nullable type and no
type is assignable to `null`, so neither branch could win the usual widening and the
two were reported as incompatible — for every struct, array and funcref.

Both branches are then emitted at the result type, which is what lets the `null`
branch produce a typed null rather than a bare `anyref` one. `[§wac-ternary-null-3kx9ba2]`

A float literal in a ternary still types as `f64` regardless of context, so
`f32 x = cond ? 1.5 : 2.5;` is a type error and needs an explicit cast. That is a
separate gap in literal typing, not in the ternary.

If the branches are reference types, the ternary's type is their **closest
common ancestor** — found by walking each branch's chain of parent structs
(`struct X : Parent`) and taking the nearest struct that appears in both
chains. This covers the simple case where one branch's type is itself an
ancestor of the other's (the ternary's type is just that ancestor), as well
as sibling subtypes of a shared parent:

```wac
struct Shape { f64 x; f64 y; }
struct Circle : Shape { f64 radius; }
struct Rect : Shape { f64 w; f64 h; }

export f64 pickParent(bool flag, Circle c, Shape s) {
  Shape result = flag ? c : s;   // Circle's ancestor chain includes Shape directly
  return result.x;
}

export f64 pickSiblings(bool flag, Circle c, Rect r) {
  Shape result = flag ? c : r;   // Circle and Rect share Shape as their closest common ancestor
  return result.x;
}
```

`[§wac-ternary-subtype-h4jm9wq]` `pickParent(true, Circle(1.0, 2.0, 5.0), Shape(3.0, 4.0))`
returns `1.0`. `pickParent(false, ...)` returns `3.0`.
`[§wac-ternary-lca-q7fk3wn]` `pickSiblings(true, Circle(1.0, 2.0, 5.0), Rect(3.0, 4.0, 10.0, 20.0))`
returns `1.0`. `pickSiblings(false, ...)` returns `3.0`.

Branches with no common ancestor — including a primitive paired with a
reference type, or two structs from entirely unrelated hierarchies — are a
compile error.

### switch

```wac
switch (expr) {
  case val1: { ... }
  case val2: { ... }
  default: { ... }
}
```

No fallthrough — each case is its own block. The switch expression and case
values must be a 32-bit integer, `i32` or `u32` — `br_table` dispatches on 32
bits, and signedness plays no part in an equality match.

`[§wac-switch-u32-r5nk8wf]` A `u32` scrutinee works, including a case value
above `i32`'s range such as `4294967295`.

```wac
export i32 dayType(i32 day) {
  switch (day) {
    case 0: { return 0; }  // Sunday
    case 6: { return 0; }  // Saturday
    default: { return 1; } // weekday
  }
}
```

`[§wac-switch-4s87owc]` `dayType(0)` returns `0`. `dayType(3)` returns `1`.
`dayType(6)` returns `0`.

```wac
export i32 testNoFallthrough() {
  i32 x = 0;
  switch (1) {
    case 0: { x = 10; }
    case 1: { x = 20; }
    case 2: { x = 30; }
  }
  return x;
}
```

`[§wac-no-fallthru-r5kw2n8]` `testNoFallthrough()` returns `20` — only matching
case executes, no fallthrough.

### trap

`trap;` immediately terminates execution. Maps to wasm's `unreachable`
instruction.

```wac
export i32 mustBePositive(i32 n) {
  if (n <= 0) { trap; }
  return n;
}
```

`[§wac-trap-stmt-v3kq8fn]` `mustBePositive(5)` returns `5`.
`[§wac-trap-fires-w2jm4pd]` `mustBePositive(-1)` traps.

**`trap` may carry a message**, which is what the host is told instead of the engine's
bare "unreachable":

```wac
export i32 half(i32 n) {
  if (n % 2 != 0) { trap "half needs an even number"; }
  return n / 2;
}
```

`[§wac-trap-message-4nqk8wm]` calling `half(7)` from JavaScript throws
`wac trap: half needs an even number`; `half(8)` returns `4`.

The message is any `string` expression, so it can be built at the point of failure. It is
left in a module global that survives the trap, and the generated wrappers read it — a
program with no `trap` message compiles to the same bytes as before the feature existed.

**A trap the engine raises carries no message**, and is reported as it comes. An
out-of-bounds index or a null dereference is not something the program chose to say
anything about, and attributing the last message to it would be worse than saying
nothing. The message is cleared when an exported function starts, so a stale one is never
read as belonging to a later failure.

**A trap does not poison the module.** The instance survives, its state is intact, and
the next call works — which is what lets a long-running program catch one and carry on
rather than exiting.

### Hex literals

```wac
i32 mask = 0xFF;
i32 color = 0xFF00FF;
```

`[§wac-hex-cs4i9ht]` `mask` is `255`. `color` is `16711935`.
