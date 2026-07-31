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

Any type a literal expression can have works, including `string` and the
unsigned types. Aggregates do not yet: `const P X = P(1)` and `const i32[] T =
i32[](1, 2)` are both rejected, because they would need storage rather than
substitution.

### Type inference

Variable types are always explicit. No `var` or `auto` — the type is part of
the declaration.
