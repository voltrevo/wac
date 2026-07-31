## Variables

All variables must be initialized at declaration.

```wac
i32 x = 5;               // mutable by default
const i32 y = 10;        // immutable
y = 11;                   // error: y is const
i32 z;                    // error: must be initialized
```

`[§wac-const-var-7b4swc8]` `y = 11` is a compile error — y is const.
`[§wac-uninit-nypziz8]` `i32 z;` is a compile error — must be initialized.

### const

`const` makes a variable immutable. For references, `const` means deep
immutability — no writes through that reference at any depth.

```wac
const Point p = Point(1, 2);
p.x = 3;                 // error: p is const
```

`[§wac-const-ref-617go61]` `p.x = 3` is a compile error — p is const.

```wac
struct Tree {
  i32 val;
  Tree? left;
  Tree? right;
}

const Tree t = getTree();
t.val = 5;               // error: const is deep
t.left!.val = 5;         // error: const is deep
```

`[§wac-const-deep-j6b1nyg]` Writing through any depth of a `const` reference is a
compile error.

### Module-level constants

A `const` at the top level names a compile-time value. It has no storage: the
initialiser is substituted at each use, so there is nothing to initialise and no
ordering between declarations.

```wac
const i32 BLOCK = 64;
const i32 TWO_BLOCKS = BLOCK * 2;      // constants may build on constants
export const u32 POLY = 0xEDB88320;    // and may be imported
```

`[§wac-modconst-h3kq8wn]` `BLOCK` reads as `64` and `TWO_BLOCKS` as `128`.
`[§wac-modconst-import-p7fm2wj]` An exported constant can be imported by name;
one that is not exported cannot.

The initialiser must be a **compile-time constant expression**: literals, the
operators over them, casts, and other constants. Not a call, not a construction
— which is what keeps the substitution honest, since there is nothing to
evaluate at run time and no allocation to order.

```wac
i32 f() { return 1; }
const i32 A = f();       // error: needs a compile-time value
const i32 B = B + 1;     // error: defined in terms of itself
const i32 C = 1; C = 2;  // error: cannot assign to constant
```

`[§wac-modconst-notconst-r4jn9kq]` A call in an initialiser is a compile error,
as is a cycle between constants, and assigning to one.

#### Constant arrays

A constant array is written with the literal form, and becomes **one shared
table built once** when the module is instantiated — not rebuilt at each use.
That is the whole reason to reach for it: a lookup table written as a function
returning a fresh array pays for the array on every call.

```wac
const u32[] K = u32[](0x428a2f98, 0x71374491, 0xb5c0fbcf);
const i32   N = 3;
const i32[] DERIVED = i32[](N, N * 2);     // elements may be constant expressions
```

`[§wac-modconst-array-t8kn4wq]` Every constant array is built in the module's
global section and none inside a function body.

Because there is exactly one of it, writing through a constant array is a
compile error — a write would otherwise be visible from every use.

```wac
const i32[] T = i32[](1, 2);
T[0] = 9;      // error: cannot assign to constant
i32 x = T[1];  // reading is fine
```

`[§wac-modconst-array-const-w2mk9fj]` Element writes, compound assignment and
`++` through a constant array are all rejected.

The sized form `T[n]()` is not allowed: it has no elements written down to
evaluate, and would have to be built at run time.

Struct constants are not supported — `const P X = P(1)` is rejected. Scalars,
strings and arrays are what a compile-time value can be today.

### Type inference

Variable types are always explicit. No `var` or `auto` — the type is part of
the declaration.
