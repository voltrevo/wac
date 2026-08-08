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

The constness travels with the reference however it was obtained — through a field, through a
method's return value, or by copying it into a fresh binding — so laundering it through a local or
a field is refused too. `[§wac-const-deep-j6b1nyg]`

**One hole, currently.** Passing a const reference to a function whose parameter is not `const`
is accepted, and that function may write through it:

```wac
void mutate(S s) { s.v = 1; }
void bad(const S s) { mutate(s); }     // accepted today
```

Declaring the parameter `const` is the fix at the call site, and there is nothing to write for a
funcref, whose type has no place for it. Closing this properly means const-ness in the type rather
than on the variable — see issue 0052, which records what each attempted enforcement broke.

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
operators over them, casts, other constants, and construction of a struct, an enum
variant or an array out of those. Not a call — a call would have to run.

```wac
i32 f() { return 1; }
const i32 A = f();       // error: needs a compile-time value
const i32 B = B + 1;     // error: defined in terms of itself
const i32 C = 1; C = 2;  // error: cannot assign to constant
```

`[§wac-modconst-notconst-r4jn9kq]` A call in an initialiser is a compile error,
as is a cycle between constants, and assigning to one.

Note that the parser treats every `name(...)` as a construction, so a plain call reaches
the same check; it is rejected because the name does not resolve to a struct, not because
it looks different.

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
T[0] = 9;      // error: cannot write through const reference
i32 x = T[1];  // reading is fine
```

`[§wac-modconst-array-const-w2mk9fj]` Element writes, compound assignment and
`++` through a constant array are all rejected.

The sized forms work too, provided the **length** is constant — the elements do not have to
be written down, because `array.new_default` and `array.new` are constant instructions like
`array.new_fixed`:

```wac
const i32   N     = 5;
const i32[] ZEROS = i32[8]();          // eight zeros, built once
const i32[] ONES  = i32[4](fill: -1);
const i32[] BYN   = i32[N * 2]();      // a length over other constants
```

`[§wac-modconst-sized-5wnq8kt]` All of these work. A length that must be computed does not:
`i32[n()]()` is a compile error. And an element type with no default still needs `fill:`,
exactly as outside a constant, with a diagnostic that says so.
`[§wac-modconst-sized-5wnq8kt]`

#### Constant structs and enums

A struct, an enum variant, or anything built out of them may be a constant, and like a
constant array it is **one value built once** at instantiation:

```wac
enum E { A(i32 v), B }
struct P { i32 x; i32 y; }

const E    X      = E.A(7);
const E    PLAIN  = E.B;
const E[]  TABLE  = E[](E.A(1), E.B, E.A(3));    // a dispatch table, built once
const P    ORIGIN = P(3, 4);
const P    BRACED = P { x: 1, y: 2 };            // named construction too
```

`[§wac-modconst-ref-9jvq2mt]` All of these work, including a struct holding a struct, a
string, or a null, and an array of structs. `struct.new` is a constant instruction in the
GC proposal, so nothing needs to run.

`[§wac-modconst-ref-9jvq2mt]` There is exactly one of each, so two mentions of one
constant are the same value — observable through a mutable field. Writing through the
constant's own name is refused, as it is for arrays.

The arguments still have to be constant, so a construction is only as constant as what
goes into it:

```wac
i32 f() { return 1; }
const P BAD = P(f());     // error: needs a compile-time value
```

`[§wac-modconst-notconst-r4jn9kq]` This is a compile error, as is a plain function call
that merely looks like a construction.

A **string** constant is still substituted at each use rather than shared. A string is
immutable, so only its identity would differ and nothing can observe that.

### Type inference

Variable types are always explicit. No `var` or `auto` — the type is part of
the declaration.
