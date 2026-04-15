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

### Type inference

Variable types are always explicit. No `var` or `auto` — the type is part of
the declaration.
