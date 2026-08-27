# 0012 — synthesising a lambda's return type from its body

- **Status:** proposed — an **ergonomic** question, deliberately separated from
  [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) so that document did not have to
  wait on it. Nothing here is needed for a program to be writable
- **Date:** 2026-08-26
- **Author:** agent-b
- **Was:** option D of [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md), moved out
  when that document was decided in favour of option C

## What it would buy

With [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) settled as C and
[0011](0011-a-call-may-name-its-type-arguments.md) accepted, this is already writable:

```wac
Pending<Foo> made = p.then<Foo>((i64 at) => Foo.create());
```

This document is about dropping the `<Foo>`:

```wac
Pending<Foo> made = p.then((i64 at) => Foo.create());
```

**That is comfort, not capability**, and the distinction is why this is a separate document. Every
program stays writable without it.

## The premise, which is sound

`spec/spec/funcrefs.md` `[§wacc-lambda]`:

> Parameters carry their types; the return type comes from the `fn[…]` it is used as, **which the
> language always supplies because there is no `var`**.

A method with its own type parameter is exactly where the language cannot supply it — that is
[0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md)'s subject. But the *first* clause
still holds: parameters always carry their types, so a lambda body is typeable on its own, and
`Foo.create()` is *"a call to a function or method whose return type is declared"*, which
`spec/spec/generics.md` already lists among the types that are evident.

So `(i64 at) => Foo.create()` has the type `fn[Foo(i64)]` from its own syntax, and `U` could be read
off the argument by ordinary argument-directed inference.

## Where it is worth most

Not on short types. `p.then<Foo>(f)` is arguably clearer than `p.then(f)` — the reader learns what
comes back without following the lambda. It earns its keep when the type is unpleasant to write:

```wac
p.then<Map<string, Vec<i32>>>((Row r) => index(r))    // with C
p.then((Row r) => index(r))                           // with this
```

## Three things to settle first

### 1. It is an ordering rule, not "type the body"

Synthesis is simple when the letter appears once, as in `then<U>(this, fn[U(T)] f)`. It stops being
simple the moment a letter appears in a non-lambda parameter too:

```wac
U fold<U>(const this, U seed, fn[U(U, T)] f)
```

Here `seed` determines `U` by ordinary inference **and** `U` is the lambda's return type. The lambda
must be *checked* against what `seed` gave, not synthesised independently and reconciled afterwards.
So the rule is:

> infer from every non-lambda argument first; use the result as each lambda's target; synthesise only
> for letters still unknown.

That is the difference between a small change and a constraint solver, and it is the thing most
likely to be underestimated. **It cannot arise today** — `Pending.then` is the only method with its
own type parameter, and `core/vec.wac` has no `map`, `fold` or `filter` at all — but `fold` is the
obvious next thing anyone writes once method type parameters work.

**`fold` is also this document's acceptance test**, and it is the same example
[0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) leads with — deliberately, because
there it demonstrates that C is unobtrusive and here it demonstrates the one way D can go wrong.
Under 0010's option C it already works without a written type argument, since `seed` determines `U`:

```wac
i32 total = v.fold(0, (i32 acc, i32 x) => acc + x);
```

So D must leave that program **exactly as it is**. The sharp case is the one where synthesis and
checking would disagree:

```wac
i64 t = v.fold(0, (i64 acc, i32 x) => x);      // the body returns i32; U is i64
```

`seed` and the slot say `U` is `i64`, and the body returns an `i32`. Checked against `U`, that is an
ordinary type error pointing at the body. Synthesised first, `U` would come out `i32` and then
*conflict* with the seed — a worse error about a letter, in a place the author was not looking.

### 2. The join rule gets decided on taste, because nothing forces it

A block body with more than one value-returning `return`:

- two arms of different types — an error, or unified?
- one arm returning `null` — does the synthesised type become nullable?
- an arm that is itself `Option.None`, which needs a target and therefore cannot be synthesised — it
  has to fail, and the message has to say why rather than reporting something further downstream.

Measured across `packages/` and `std/`: **310 lambdas, 149 block-bodied, 20 returning a value, and 3
with more than one value-return** — and all three have targets today, so none of them would exercise
synthesis. Nothing in the tree forces any of these answers, which means they will be chosen on taste.
Choose them deliberately.

### 3. Synthesis must not replace checking

`() => 42` synthesises `fn[i32()]`. Against a target of `fn[i64()]` the literal must still be checked
as `i64`. So synthesis runs **only** where there is no target.

The point is not compatibility — this repository has no legacy to support and breaking code is an
acceptable price. It is that a lambda *with* a target has nothing to synthesise from that the target
does not already say better, so running synthesis there would be doing different work for the same
answer, and the two would eventually disagree.

## Acceptance criteria

1. `i32 total = v.fold(0, (i32 acc, i32 x) => acc + x);` compiles, unchanged, with no type argument.
2. `Pending<Foo> made = p.then((i64 at) => Foo.create());` compiles **without** `<Foo>` — the whole
   point of this document.
3. `i64 t = v.fold(0, (i64 acc, i32 x) => x);` fails with an error **naming the lambda's body against
   `i64`**, not one about `U` being ambiguous or conflicting. This is the ordering rule, tested.
4. The 310 lambdas in the tree compile identically, since each has a target and synthesis must not
   run where one exists. **A heuristic rather than a hard rule** — `CLAUDE.md` has no legacy to
   support, so breaking them would be allowed. It is a criterion because a change that disturbs a
   lambda *with* a target has misplaced the synthesis, which is a design error rather than a cost.
5. A body that cannot synthesise — `() => Option.None` with no target — fails saying *that*, rather
   than failing somewhere downstream.

## What was checked and dissolved

- **Capture.** A lambda body reading a local whose type is still being inferred would be a problem —
  but wac has no declaration type inference, so every local states its type. Safe.
- **Recursion.** A self-referential lambda would need its own type to type its body — but a lambda
  with no target has no name to recurse through, and one with a name has a target. Safe.

## What it costs

`[§wacc-lambda]`'s sentence changes from *the return type comes from the `fn[…]` it is used as* to
that plus *or is synthesised from the body when the body's type is evident*. A reader currently learns
one rule about where a lambda's type comes from and would afterwards learn two.

That is the second such widening in a day — [0011](0011-a-call-may-name-its-type-arguments.md) does
the same to *"type arguments are inferred, never written"*. Two is not a pattern, but a third would
be, and the value of "the language always supplies it" is that it is short enough to hold in the head.

**One compiler, at least.** The tag is `§wacc-lambda` rather than `§wac-`: the reference has no
lambdas, so this is wacc alone.

## State of play

| step | state |
|---|---|
| is it wanted | **open** — nothing depends on it |
| the ordering rule (§1) | **open**, and the answer decides how large this is |
| the join rule (§2) | **open**, and unforced by the tree |
| synthesis-only-without-a-target (§3) | settled by argument; needs writing into the spec |
| capture, recursion | checked, and not problems |

**Both preconditions are met as of 2026-08-27**: [0011](0011-a-call-may-name-its-type-arguments.md)
is implemented and [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) option C with it.
So this document is startable — and *worth less than it was*, which is the honest reading and the
reason the precondition was written.

Two of its three open questions are answered by what landed, and not in this document's favour:

- **§1's ordering rule is no longer hypothetical, and it already works the way this document says it
  must.** Method type arguments are inferred from the arguments now, and the rule is exactly *infer
  from every argument that has a type; an argument with none says nothing, which is not a failure*.
  `v.fold(0, (i32 acc, i32 x) => acc + x)` compiles today with nothing written, because the **seed**
  binds `U` and the lambda beside it is skipped rather than refused. That is §1's acceptance criterion
  1, met without synthesising anything.
- **So the case this document is left with is narrower than it looked.** What it would still buy is a
  letter that *only* a lambda's return could supply — `p.then((i64 at) => Foo.create())` where nothing
  else in the call mentions `U`. `core/vec.wac`'s `fold` is not that shape and neither is anything
  else in the tree.

§2's join rule and §3 are untouched by any of it.

**What would decide this is a written program, and there still is not one.** `core/vec.wac` was given
a `fold` for exactly that purpose and it had to come out again: `issues/lang/0276b`, where an uncalled
own-letter method on a widely used struct stops a large program compiling. Until that is fixed the
question this document asks cannot be answered by use, only by argument.
