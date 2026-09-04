# wacc — an enum's payload is a struct and is not treated as one

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/wacc`: the compiler, ported to wac. One file is stressed —
`src/ast.wac`, 468 lines — because it is the most matched-on type in the repository and it is where
one language asymmetry costs the most. [`src/ast.wac`](src/ast.wac) is the expression tree rewritten;
[`src/walk.wac`](src/walk.wac) is a walk over it, and the first consumer the **brace pattern** has
ever had.

---

## The asymmetry, which vision did not invent

```wac
Point q = Point { x: 3, y: 4 };     // a struct: by name, order-independent, a nullable omitted
Shape b = Shape.Circle(2.0);        // a variant: by position, and only by position
case Circle(r): …                   // and read back by position too
```

`spec/spec/structs.md` `[§wac-struct-named-4y8pg2j]` gives a struct's fields names on the way in,
makes the order irrelevant, and `[§wacc-struct-nullable-optional]` lets a nullable one be left out.
An enum's payload fields **have** names — `Binary(i32 op, Expr left, Expr right)` — and no code can
use them, in either direction.

## What it costs, counted over the tree

Excluding `spec/cases`, whose `Rect(f64, f64)` appears in twenty-two toy programs:

    812  match arms binding two or more payload fields
    291  of those on a variant where two fields share a type
     23  such variants, 13 of them in `packages/wacc/src/ast.wac`

A **shared type** is what makes a swap silent. The list is not abstract:

| variant | arms | what a swap does |
|---|---:|---|
| `Ternary(Expr cond, Expr then, Expr els)` | 17 | inverts every conditional in the program |
| `Binary(i32 op, Expr left, Expr right)` | 26 | turns `a - b` into `b - a` |
| `Index(Expr arr, Expr index)` | 17 | turns `a[i]` into `i[a]` |
| `If(Expr cond, Stmt[] then, Stmt[] els)` | 19 | inverts every `if` |
| `StructDecl(…7 fields…)` | 54 | four of the seven are positional wildcards at most sites |
| `Func(…, bool exported, …, bool isAsync)` | 43 | two adjacent booleans meaning opposite things |

## The brace pattern is half a fix, and this is its first user

`../../GRAMMAR.ebnf` proposes `Ok { v }:`. It had no user anywhere, and its production was one of the
eight whose removal changed nothing. It is load-bearing now: delete `field_pattern` and `walk.wac`
refuses at `23:14`.

Two things fall out that the proposal does not say.

**It borrows the struct-literal syntax and nobody wrote down that it is the same idea.** `Point { x:
3, y: 4 }` is construction by name; `Ternary { cond, then, els }` is destructuring by name. Same
braces, same field names. Presented as a new *pattern form* it looks like a convenience; presented as
*the enum payload finally reaching the struct rule* it is one rule applying in one more place.

**The subset is the value, and the proposal leads with the other half.** It writes `Ok { v }` — every
field named — with `{ .. }` as an afterthought. Of the thirteen arms in `walk.wac`, **six** bind a
subset. `StructDecl { nameTok, fields, methods, .. }` against
`StructDecl(nameTok, _, fields, methods, _, _, _)` is the real comparison, in a variant that has
gained a field twice and has fifty-four arms.

And `{ .. }` on its own is weaker than it looks: `[§wac-arm-partial]` already lets an arm ignore one
field at a time positionally, so naming a subset is the same capability without an index rather than
a new one.

## And the other half is construction, which nothing proposes

    Decl(DeclKind.Func(t, ty, ps, body, true, tps, false), at)

Two bare booleans, four fields apart, meaning `exported` and `isAsync`. Swap them and the compiler is
silent, every diagnostic still points at the right line, and an unexported function becomes an
exported synchronous one. A brace pattern does nothing about this line — and it is the same fields
the pattern is for.

**The syntax exists twice over already.** `Point { x: 3, y: 4 }` is a struct literal. `i32[n](fill:
-1)` is a named argument in call position, with the spec's own reason: *"Named argument syntax cannot
collide, since a call rejects it outright."* So the language has `name: value` in a construction, has
it order-independent, has it optional for a nullable, and an enum variant gets none of it.

`Func { nameTok: t, exported: true, isAsync: false, … }` needs **no new notation**. It needs the rule
that already applies to `Point` to apply to a payload.

So the promotion is not *add a brace pattern*. It is **an enum's payload is a struct and is not
treated as one**, of which the pattern is one direction — worth having, fixing 291 arms, and leaving
every construction site as it was.

## What could not be written

**A binding that renames.** `Binary { left: lhs }` is not in the grammar: `field_pattern` takes bare
names, so a payload field's name becomes a local's name whether the local wants it or not, and two
nested arms binding `left` from different subjects cannot both exist. The struct literal it borrows
from has the colon; the pattern declines it. Not obviously wrong — a renaming pattern is a second
thing to learn — but it is the difference between destructuring and naming, and nothing says which
was meant.

**A nested pattern.** `Binary { left: Ident { tok } }` is recorded in `GRAMMAR.md` as considered and
withdrawn, because *"a field access that already exists"* says the same thing. That is true for
*reading* a field and not for *matching* one: the nested form is what makes an arm apply only when
the inner variant does. Withdrawn on the reading argument; the matching argument was never made.

**A `const` payload field, and an omitted nullable one.** A struct field can be `const`; a payload
field cannot. A struct literal may leave a nullable out; `ArrNew(Ty elem, Expr? size, Expr? fill,
Expr[] elements)` has two nullables and every construction passes `null` for at least one,
positionally. Both are rows in the same table of *what a struct has and a payload does not*, and both
would follow from the promotion above rather than needing an argument of their own.

**The tree is still a tree of indices.** `Tok` is a name for an `i32` and stops `Binary(op, …)` being
swappable with `Jsx(tagTok, closeTok, …)`, but `Jsx`'s two `Tok`s are still two `Tok`s — a name is the
only thing that separates two fields of one type, which is the argument. Whether the AST should be an
arena, a handle type or references is a wasm GC question and much larger than this.
