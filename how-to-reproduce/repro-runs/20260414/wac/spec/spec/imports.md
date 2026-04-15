## Imports and exports

### Syntax

```wac
import { distance, midpoint } from "./geometry.wac";
import { Point as Point2d } from "./flat.wac";
import { distance as dist3d } from "./spatial.wac";
```

Named imports from relative file paths. Imports can be renamed with `as` to
resolve naming collisions.

### Rules

- Only `export`-marked functions and types can be imported
- Import paths are relative, using `./` or `../` prefixes
- Circular imports are allowed — wac files contain only declarations (no
  module-level init), so there is no ordering problem
- All name collisions at the same scope are compile errors (see
  [naming.md](naming.md))

### Import resolution

The compiler resolves the import graph depth-first, visiting each file at most
once (cycle-safe). It builds a flat symbol table assigning a stable wasm
function index to every function.

### Name mangling

Two files can each define `max` without conflict — imports are always explicit.
The compiled wasm module has a flat function index space. The compiler mangles
every function name to `<stem>$<name>` (stem = filename without extension):

```
geometry$distance  geometry$midpoint  main$perimeter
```

Mangling is purely internal. Wasm export entries use the original unqualified
name and only include functions exported by the entry file (see
[functions.md](functions.md)). Struct method mangling:
`Counter$getCount`, `Counter$create`.

### Diamond imports

```wac
// shared.wac
export i32 base() { return 100; }
```

```wac
// left.wac
import { base } from "./shared.wac";
export i32 left() { return base() + 10; }
```

```wac
// right.wac
import { base } from "./shared.wac";
export i32 right() { return base() + 20; }
```

```wac
// top.wac
import { left } from "./left.wac";
import { right } from "./right.wac";
export i32 combined() { return left() + right(); }
```

`[§wac-diamond-79emza1]` `combined()` returns `230`.

### Importing types

Struct types can be imported by name:

```wac
import { Point, midpoint } from "./geometry.wac";

export f64 run() {
  Point a = Point.create(0.0, 0.0);
  return a.distanceSq(Point.create(3.0, 4.0));
}
```

`[§wac-import-type-ev21tgx]` Importing a struct makes its constructors, methods, and
fields accessible.

### Circular imports

```wac
// ping.wac
import { pong } from "./pong.wac";
export i32 ping(i32 n) {
  if (n == 0) { return 0; }
  return pong(n - 1) + 1;
}
```

```wac
// pong.wac
import { ping } from "./ping.wac";
export i32 pong(i32 n) {
  if (n == 0) { return 0; }
  return ping(n - 1) + 1;
}
```

`[§wac-circular-m7jx3p4]` `ping(5)` returns `5` — circular imports resolve
correctly.

### Same-name functions in different files

```wac
// utils_a.wac
export i32 compute(i32 x) { return x + 1; }
```

```wac
// utils_b.wac
export i32 compute(i32 x) { return x * 2; }
```

```wac
// main.wac
import { compute as computeA } from "./utils_a.wac";
import { compute as computeB } from "./utils_b.wac";

export i32 test() {
  return computeA(5) + computeB(5);
}
```

`[§wac-rename-imp-w4fn9k2]` `test()` returns `16` (6 + 10) — same-name functions
in different files don't collide, mangled names are distinct.

```wac
// caller.wac
import { compute } from "./utils_a.wac";
i32 compute2(i32 x) { return x * 3; }

export i32 test() {
  return compute(5) + compute2(5);
}
```

`[§wac-imp-coexist-p8km2v6]` `test()` returns `21` (6 + 15) — imported `compute`
and local `compute2` coexist; imported names don't collide with same names in
other (non-imported) files.
