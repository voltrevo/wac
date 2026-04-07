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
