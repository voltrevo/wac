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

### switch

```wac
switch (expr) {
  case val1: { ... }
  case val2: { ... }
  default: { ... }
}
```

No fallthrough — each case is its own block. The switch expression and case
values must be `i32`. Maps to wasm's `br_table`.

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

### Hex literals

```wac
i32 mask = 0xFF;
i32 color = 0xFF00FF;
```

`[§wac-hex-cs4i9ht]` `mask` is `255`. `color` is `16711935`.
