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
[functions.md](functions.md)).

Struct type identifiers and their method names are mangled the same way —
prefixed with the file stem — so that two files can each declare a struct
with the same name without colliding:

```
geometry$Point            (struct type identifier)
geometry$Point$distanceSq  (method)
main$Point                 (a distinct, unrelated Point declared in main.wac)
```

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

#### A written type name must be in scope

**Every type name a file writes has to be in that file's scope.** An enum, a variant, a struct —
naming one you did not import is `undefined type 'X'`, reported where you wrote it:

```wac
import { mk } from "./k.wac";      // K itself is not imported
export i32 f() {
  K k = mk();                      // error: undefined type 'K'
  A a = mk() as! A;                // error: undefined type 'A'
  return mk() is A ? 1 : 0;        // error: undefined type 'A'
}
```

`[§wac-type-name-scope-8vqk3mn]` The fix is the import — and a variant imports like any other
name, `import { K, A } from "./k.wac"`.

This is worth stating because it did not hold, and what it cost was a **wrong answer**. A name
that resolved nowhere had no type index, and every consumer then fell back to a global map keyed
by name: two files may each declare a `Circle` variant (`§enum-name-identity`), so `x is Circle`
in a third file picked one of them and answered `false` about a value that was the other. No
diagnostic. `[§wac-type-name-scope-8vqk3mn]` It is refused now.

Two things that look like a type name are not, and are unaffected: `f(x)` where `f` is a funcref
local or a function, and `x is Other` where `Other` is a variable, which is an identity test.
`[§wac-type-name-scope-8vqk3mn]`

What needs **no** import is `match`. An arm resolves its variants through the enum the subject
*is*, so matching a value you got from an imported function needs neither the enum's name nor its
variants' — see `§enum-cross-file`.

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

### Same-name structs in different files

Struct names follow the same rule as function names: duplicate struct names
are only a compile error within the same file (see [naming.md](naming.md)).
Two files that never import each other can each declare a struct with the
same name — the mangled type identifiers and method names are kept distinct
by the file-stem qualifier described above, so each keeps its own field
layout and its own methods.

`[§wac-samename-struct-4jhq7wn]` This holds however the two are reached, including when the
importing file names only *one* of them and the other arrives transitively — which is the case
that matters in practice, because then neither file you are reading mentions the other's type.
It also holds when the name is a struct in one module and an enum in another.

This paragraph described the intent before it described the behaviour. The emitter resolved a
written struct name through a global bare-name map, last-wins, so both names reached whichever
struct was registered last: the program typechecked and then failed to instantiate with a type
mismatch inside a function that mentioned neither file. The example below happened to work
because it imports both under aliases and uses each immediately; the transitive case did not.
See issue 0041, which cost the reporter an hour, in a diagnostic naming a function in neither
file.

```wac
// a.wac
struct Box { i32 x; i32 y; }
```

```wac
// b.wac
struct Box { i32 y; i32 x; }   // same name, different field order
```

```wac
// main.wac
import { Box as BoxA } from "./a.wac";
import { Box as BoxB } from "./b.wac";

export i32 test() {
  BoxA a = BoxA(1, 2);   // a.x = 1, a.y = 2
  BoxB b = BoxB(3, 4);   // b.y = 3, b.x = 4
  return a.x * 100 + b.y;
}
```

`[§wac-samename-struct-k7fn3wq]` `test()` returns `103` — same-name structs in
different files don't collide; each keeps its own field layout and methods,
mangled names are distinct.

### Aliases preserve type identity

The converse also holds: an alias introduced by `import { X as Y }` is a new
*name*, not a new *type*. Two type names are the same type if and only if they
resolve to the same struct declaration, regardless of what they are spelled as
at the point of use. In particular, a funcref annotation written with an alias
matches a method of the original struct.

```wac
// lib.wac
export struct Box {
  i32 v;
  i32 get(const this) { return this.v; }
}
```

```wac
// main.wac
import { Box as BoxA } from "./lib.wac";

export i32 test() {
  BoxA b = BoxA(7);
  fn[i32(BoxA)] f = BoxA.get;   // BoxA IS lib's Box — signature matches
  return f(b);
}
```

`[§wac-alias-same-type-j3wq8kf]` `test()` returns `7` — aliased and declared
names for the same struct are interchangeable in every type position.

### No implicit re-export

Importing a symbol makes it usable inside the importing file only. It does
not re-export it: another file can import a symbol only from the file that
declares (and exports) it.

```wac
// a.wac
export i32 foo() { return 42; }
```

```wac
// b.wac
import { foo } from "./a.wac";   // b may use foo...
```

```wac
// main.wac
import { foo } from "./b.wac";   // error: b.wac does not export 'foo'
```

`[§wac-no-reexport-f7kn4wq]` Importing a symbol from a file that merely
imports it (rather than declaring and exporting it) is a compile error.
