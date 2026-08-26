# 0011 — a call may name its type arguments, so a generic free function is usable

- **Status:** proposed — the target is settled with the operator (2026-08-26, "want generic free
  functions"); the spelling and the scope are the open decisions
- **Date:** 2026-08-26
- **Author:** agent-b
- **Gathers:** `issues/lang/0088` (an enum variant cannot name its arguments), `issues/lang/0235a`
  (written type arguments parse as a comparison)
- **Distinct from:** [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md), which is
  about a letter the *argument* fails to state. This is about a letter **no argument mentions at
  all** — inference cannot reach it by construction rather than by weakness

## What is wanted

```wac
Vec<i32> v = empty();        // or empty<i32>()
i32 z = zero<i32>();
```

A type parameter that appears only in the return type. Today the language accepts the declaration
and refuses every call:

    T zero<T>() { return 0; }        // compiles
    i32 z = zero();                  // error: cannot tell what a type parameter is here

**Measured 2026-08-26:** the declaration builds and the call does not, so the person who writes an
unusable generic function never learns; only a caller does. That is a small defect in its own right
and it disappears if this document is implemented, which is why it is recorded here rather than
filed.

## The evidence that this matters is an absence

`packages/`, `std/` and `core/` contain **zero generic free functions**. All twelve in the tree are
in `spec/cases/`, written to exercise the rules. Generic *structs and enums* are used heavily —
`Vec<T>`, `Map<K,V>`, `Option<T>`, `Result<T,E>`, `Pending<T>` — because a static or a method on a
generic owner takes its letters from the owner or from the slot, and a free function has neither.

So the feature exists and nothing uses it. `CLAUDE.md` is direct about that shape — *"when nothing
needs a thing, delete it"* — which makes this a fork rather than a wish: **make generic free
functions usable, or take them out of the language.** Leaving them declarable and uncallable is the
one option the repository's own rules argue against.

## What the spec says, and the distinction that is easy to miss

`spec/spec/generics.md` has a section headed **"Type arguments are inferred, never written"**:

> There is no `max<i32>(x, y)`. Angle brackets are type syntax only — the same ambiguity with
> less-than — and a call is an expression, so **inference is the whole interface**.

and it names the consequence:

> Because inference is argument-directed, **a type parameter that no parameter's type mentions is
> unusable** … `[§wac-generic-fn-5hvq3mt]` Reported at the call, and terminal — a call cannot name
> its type arguments, so there is no way to supply what inference could not find.

**`Cell<i32>()` nevertheless compiles, and that is not a contradiction.** `Cell<i32>` is a *type*,
and writing a type is what the spec permits; constructing one is ordinary. `max<i32>(x, y)` writes
type arguments *to a call*, which is the thing forbidden. Worth stating plainly because the first
reading of "the grammar already does this" is wrong, and it changes what this document is asking
for: not a parser change that already half-exists, but a change to a stated rule.

Four positions, and only the first works:

| position | today | which |
|---|---|---|
| `Cell<i32>()` — construct a written type | **works**, receiver position included | type syntax |
| `Maybe<i32>.Just(4)` — a variant of a written type | `expected expression, found '.'` | type syntax; `issues/lang/0088` calls this an inconsistency with the row above, and it is |
| `zero<i32>()` — a free call | `cannot tell what a type parameter is here` | **this document** |
| `p.then<Foo>(f)` — a method call | parses as a comparison chain; `issues/lang/0235a` | this document, and [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) option C |

The second row is arguably already a bug rather than a missing feature: it writes a type, like the
first, and is refused. It can be fixed without deciding anything here.

## Two mechanisms, and they are not exclusive

**(i) Take the letters from the slot.** `Vec<i32> v = empty();`. This is not new machinery: generic
statics already do it — `issues/lang/0141` — so `Vec.create()` in a declared slot works today. The
same rule applied to free functions costs no syntax and no spec section beyond widening one.

*Its limit is the one [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) measured:* a
call with no slot cannot infer, and receiver position never has one. `empty().push(3)` stays refused.

**(ii) Let a call name its type arguments.** `zero<i32>()`. Works in every position including the
ones with no slot, and is the only thing that makes `Option.None.orElse(3)` and `empty().push(3)`
writable at all.

(i) is cheaper and covers most positions; (ii) covers all of them and is the escape hatch when
inference cannot reach. Choosing (ii) does not require dropping (i), and probably should not: the
common case reads better without the arguments written.

## The spelling, and the ambiguity measured rather than assumed

The spec's objection is real. `spec/spec/operators.md` gives comparison as `T*T->bool for any
primitive T`, and **`bool` is one** — `bool a = true; bool b = false; return a < b;` compiles, tested
2026-08-26. So `a.b < T > (c)` is a well-typed comparison chain whenever `c` is a bool, and the
ambiguity cannot be resolved by typing alone. `issues/lang/0235a` is what a caller sees today:
`expected Box<i32>, found bool`, a message naming neither the rule nor the intent.

Two ways out, and the choice is a taste question with one technical difference:

**S1 — `f<T>(x)`, with a stated precedence rule.** In call position a `<` that parses as a type list
and is closed by `>` immediately followed by `(` is type arguments. The comparison chain above then
needs parentheses. Keeps the syntax everyone expects; costs one subtle sentence in the spec and a
program shape — comparing a bool with `>` — becoming unwritable without parens.

**S2 — a distinct token**, `f::<T>(x)`. Nothing to state, nothing becomes unwritable, and it is
ugly. Rust chose it for exactly this reason.

S1's cost is bounded and the shape it forbids is pathological; S2's cost is permanent and visual. I
would take S1 and write the rule down, but this is the decision the document is for.

## Decisions wanted

- **D1 — the spelling.** S1 or S2.
- **D2 — scope.** Both mechanisms, or (ii) alone? Both, on the argument above, is my recommendation.
- **D3 — partial arguments.** With `<T, U>`, may a call name one and infer the other? All-or-nothing
  is simpler and is what I would start with; Rust's `_` placeholder is the escape if it bites.
- **D4 — always, or only where inference fails?** **Always.** "Only where needed" makes acceptance
  depend on how clever the checker is, so improving inference would break programs — the failure
  mode a language should never have.
- **D5 — does `Maybe<i32>.Just(4)` come with it,** or land first as the bug `issues/lang/0088`
  already calls it? It needs no decision here, so it can go first.

## What it costs

`spec/spec/generics.md`'s *"inference is the whole interface"* stops being true, and its section
heading — *"Type arguments are inferred, never written"* — stops being the rule. That is the real
price: a reader currently learns one thing about where a type parameter comes from, and afterwards
learns two. [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) option A would have
spent that already; option D does not, so this is the first crack in it.

Against that, the sentence is already not quite true — `Cell<i32>()` names an instantiation — and
the rule it protects has produced a feature nobody can use.

## Order of work

1. `issues/lang/0088` — a variant of a written type, which needs none of the decisions above;
2. D1 settled, then the parse, with `issues/lang/0235a`'s diagnostic replaced rather than merely
   moved;
3. free calls: bind the letters from the written arguments, and check the call in that world;
4. the emitter monomorphises per written instantiation — the same table a generic struct's methods
   already use, per [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md)'s third piece;
5. the spec section rewritten, and `[§wac-generic-fn-5hvq3mt]` re-tagged: it currently states the
   terminal refusal this document removes.

## State of play

| step | state |
|---|---|
| the target | **settled** with the operator, 2026-08-26 |
| D1–D5 | **open** — nothing is implemented and nothing should be until D1 is chosen |
| `issues/lang/0088` | open, and separable |
| `issues/lang/0235a` | open, and is the diagnostic step 2 replaces |
