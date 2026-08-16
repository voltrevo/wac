## Naming collisions

All name collisions at the same scope level are compile errors. Block-scope
shadowing is allowed. Naming convention: PascalCase for structs, camelCase for
functions, methods, and variables.

### Duplicate function names

```wac
i32 foo() { return 1; }
i32 foo() { return 2; }       // error: duplicate function 'foo'
```

`[§wac-dup-func-ohfg5bi]` Duplicate function name is a compile error.

### Duplicate struct names

```wac
struct Point { i32 x; }
struct Point { i32 y; }       // error: duplicate struct 'Point'
```

`[§wac-dup-struct-spu3kml]` Duplicate struct name is a compile error.

### Function and struct with same name

```wac
struct Foo { i32 x; }
i32 Foo() { return 1; }       // error: 'Foo' already declared as struct
```

`[§wac-dup-kind-9h0mrly]` A function and struct sharing a name is a compile error.

### Duplicate fields in a struct

```wac
struct Bad {
  i32 x;
  i32 x;                      // error: duplicate field 'x'
}
```

`[§wac-dup-field-oa60dpa]` Duplicate field name is a compile error.

### Duplicate methods in a struct

```wac
struct Bad {
  i32 get(const this) { return 0; }
  i32 get(const this) { return 1; }   // error: duplicate method 'get'
}
```

`[§wac-dup-method-4jv9jst]` Duplicate method name is a compile error.

### Method and field with same name

```wac
struct Bad {
  i32 len;
  i32 len(const this) { return 0; }   // error: 'len' already declared as field
}
```

`[§wac-dup-field-method-dnwlmiz]` A method and field sharing a name is a compile
error.

### Import collides with local name

```wac
import { distance } from "./geometry.wac";

f64 distance(f64 x, f64 y) { return x - y; }   // error: 'distance' already imported
```

`[§wac-dup-import-local-4fadlvg]` An import colliding with a local name is a
compile error.

### Two imports collide

```wac
import { foo } from "./a.wac";
import { foo } from "./b.wac";   // error: 'foo' already imported
```

`[§wac-dup-import-vqn4100]` Two imports with the same name is a compile error.

### Import rename resolves collision

```wac
import { foo } from "./a.wac";
import { foo as fooB } from "./b.wac";   // ok: renamed to 'fooB'
```

`[§wac-rename-pohglv4]` Renaming an import resolves the collision.

### Import rename for types

```wac
import { Point as Point2d } from "./flat.wac";
import { Point as Point3d } from "./spatial.wac";   // ok: both renamed
```

`[§wac-rename-type-h0a08xz]` Renaming struct imports resolves the collision.

### Block-scope shadowing is allowed

```wac
export i32 shadow() {
  i32 x = 1;
  {
    i32 x = 2;       // ok: shadows outer x
    x = 3;           // modifies inner x
  }
  return x;           // returns 1
}
```

`[§wac-shadow-8u8qh2j]` `shadow()` returns `1`.

The other half of that rule has never been written down here, so it is written down now: **a name
declared inside a block is not in scope after the block ends.** Shadowing is only meaningful because
the shadow expires — `{ i32 q = 1; } i32 r = q;` is an error, and so is a `for`'s counter used after
the loop, because the initialiser is scoped to the statement rather than to the enclosing body.

Deliberately untagged. A tag needs a case, a case is a program both compilers must agree on, and
they do not: the reference refuses all three of those spellings and wacc accepts them, because its
checker has one name table per function rather than one per scope. That is `issues/lang/0122`, and
it is worth knowing that the gap is not a disagreement about the rule — both *emitters* scope
locals correctly, and `§wac-shadow-8u8qh2j` above passes on both because it exercises the emitter's
half. Tag this and add the cases when the checker enforces it.

A local may shadow a parameter, and the parameter is unaffected once the shadowing
block ends:

```wac
export i32 shadowParam(i32 x) {
  {
    i32 x = 99;
  }
  return x;
}
```

`[§wac-shadow-param-7apc0wt]` `shadowParam(7)` returns `7` — the shadow is a separate
binding, not a write to the parameter.

Two parameters of one function may not share a name.
`[§wac-dup-param-4tnq8vx]` `i32 f(i32 a, i32 a)` is a compile error, for functions and
for methods alike. It used to compile, with the second parameter winning and the first
unreachable — silently, and unlike a duplicate struct field, which was already an error.

### For-loop variable shadowing

```wac
export i32 loopShadow() {
  i32 i = 99;
  for (i32 i = 0; i < 10; i++) {
    // inner i
  }
  return i;           // returns 99
}
```

`[§wac-shadow-loop-vwe8gfz]` `loopShadow()` returns `99`.

### Keywords are not names

```wac
export i32 go(i32 match) { ... }   // error: 'match' is a keyword and cannot be
                                   // used as a parameter name
i32 match = 1;                     // ...as a variable name
struct match { i32 x; }            // ...as a struct name
```

`[§wac-keyword-name-8wnq4kp]` A keyword in a name position is an error that
names the keyword and points at it.

The wording is part of the rule rather than a courtesy. `from` used to be
reserved, and a parameter named `from` — in `slice(a, from, to)`, where that
name naturally goes — reported a missing semicolon at the *next* declaration, a
hundred lines further on, with the braces balanced and the function compiling in
isolation. `from` was made contextual, which fixed that one word and nothing
else; there are twenty-seven others, and `match` is the one most likely to be
reached for next.

Note the consequence for the declaration lookahead: `i32 match = 1;` is claimed
as a declaration even though `match` is not an identifier, so that the error can
be about the name. The guard is that an `=` must follow — without it, `x as i32;`
would be read as a declaration of something called `as`.
