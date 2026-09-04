# wacc — an enum's payload is a struct and is not treated as one

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/wacc`: the compiler, ported to wac. One file is stressed —
`src/ast.wac`, 468 lines — because it is the most matched-on type in the repository and it is where
one language asymmetry costs the most. [`src/ast.wac`](src/ast.wac) is the expression tree rewritten;
[`src/walk.wac`](src/walk.wac) is a walk over it, and the first consumer the **brace pattern** has
ever had.

[`src/stmt.wac`](src/stmt.wac) and [`src/desugar.wac`](src/desugar.wac) are the second subject: the
`try` lowering written as the pass `../../TECHNICAL.md` concluded it had to be, and the 21 uses in
this directory that no page had lowered.

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

## The `try` lowering as a pass, and the case the worked example did not have

[`src/desugar.wac`](src/desugar.wac) is the second thing in this package, and it is here because
`../../TECHNICAL.md` finished the `try` entry by concluding *"the transform belongs in a compiler
pass over an AST"* and nobody had written one. [`src/stmt.wac`](src/stmt.wac) is the statement tree
it needed, plus the three nodes a parser for vision has to produce: `Try`, `TryFor` and `Defer`.

**Counted over every `.wac` in `vision/`, with comments and string literals blanked — 84 `try`s:**

| shape | count | lowered by |
|---|---|---|
| `T x = try e;` | 34 | the entry: a two-arm `match`, the rest of the block inside `Ok` |
| inside a larger expression | **21** | nothing, anywhere |
| `try e;` | 16 | the easy case |
| `try for` / `try await for` | 13 | the entry |
| `x = try e;` — a name already in scope | **0** | — |

The zero is worth as much as the twenty-one. **The easy version of the declaration case never
occurs**: every value-producing `try` here either introduces the name it binds or is buried in an
expression, and both need the enclosing statement.

### The twenty-one need a temporary, and a temporary needs an order

Six files, and these are verbatim:

```wac
Ok(Str(try this.take(try this.longLength(tag - 0xB7), false)))   // rlp/src/decode.wac:70
Proved answer = try w.step(try w.node(root));                    // mpt/src/proof.wac:61
members.push(key, try this.value());                             // json/src/parse.wac:108
(try await br.bits(32)) as@ u32                                  // gzip/src/inflate.wac:144
```

A `match` is a statement and those positions want a value, so the `try` is hoisted into a fresh local
before the statement. Ordinary — and **not order-preserving unless everything to its left is hoisted
too**. `f(a(), try b())` with an `a()` that writes anything is where getting it wrong is silent. So
the rule is *lift the prefix, not the `try`*, which costs temporaries for subexpressions that did not
need one, and which cannot be decided without the whole expression.

And the hoist emits `T t = try e;`, so it lands back on the declaration case — with the statement it
came out of, and everything after it, as the remainder. One recursion, terminating because each pass
strictly reduces `Try` depth.

### Two positions that cannot be hoisted at all

`while (try more())` computes the temporary once and spins on it; the lowering has to change the loop
rather than the expression. `a && try b()` and `c ? try d() : e` evaluate `b()` when they should not;
the lowering has to become an `if`. Neither occurs here, which is why neither was noticed. The first
is named once in `TECHNICAL.md` — as the thing `asyncplan.wac` declines for `await`, and `try`
inherits the limit for the same reason. **The short-circuit case is named nowhere**, and it is the one
a person writes without thinking.

## What could not be written — the pass

**`try` is the only expression in vision whose meaning depends on the signature it is written in.**
`return Err(x);` needs the enclosing function's error type, so `propagate` takes it as a parameter
because there is nowhere else to get it. A pass running before types are known cannot lower `try`,
which is an ordering constraint no other desugaring has — and `TECHNICAL.md`'s rule that the error
must be *in* the set rather than equal to it is the type rule for exactly that dependency.

**A synthetic node has no token.** `Tok` is an index into the source's token array — `src/ast.wac`
calls the tree *"a tree of indices"* — and everything a pass builds was never written. The shipped
compiler's answer is in `packages/wacc/src/asyncsynth.wac`: append the spellings to the source and
point synthetic tokens into them, *"honest about what they are"*, with 23 zero-argument functions
holding the fixed indices and `synthSlot(k) = synthFixedCount() + 3 * k` for the unbounded ones. It
works, and it means **the source text is an output of the compiler as well as an input.** Nothing
argues for that anywhere; a second pass wanting fresh names inherits it by finding out.

**A declaration-form `try` loses its written type.** The `Ok` arm binds the name and the type comes
from the payload, so `Big x = try step(a);` has an annotation that no lowered code and no later check
ever reads. Small, and the kind of small thing only writing the pass finds.

**`Defer` has a node and no lowering**, because what it means is open — four uses already depend on
the answer and `@/packages/box`'s pager depends on it for three of its four exits.

## What could not be written — the payload

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
