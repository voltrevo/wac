# 0011 — a call may name its type arguments, so a generic free function is usable

- **Status:** **accepted** with the operator, 2026-08-26 — the target, the spelling and the trigger
  are settled below. What is left is work, not decisions
- **Date:** 2026-08-26
- **Author:** agent-b
- **Gathers:** `issues/lang/0088` (an enum variant cannot name its arguments), `issues/lang/0235a`
  (written type arguments parse as a comparison)
- **Distinct from:** [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md), which is
  about a letter the *argument* fails to state. This is about a letter **no argument mentions at
  all** — inference cannot reach it by construction rather than by weakness
- **Unblocks:** [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md)'s option C, which
  had been ruled out on the `<` ambiguity this document resolves. 0010 was decided in favour of C on
  the strength of it, and its option D became
  [0012](0012-synthesising-a-lambdas-return-type.md)

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

## The spelling is not a choice — it is what wac already does

Measured 2026-08-26, and this is the finding the rest of the document turns on.

`a < b > (d)` **does not parse as a comparison today**. It reports `expected bool, found a<b>`, so the
parser already reads `name < types > (` as an instantiated type and commits to it. Three consequences:

- **The precedence decision is already made and shipped.** Nothing here proposes a new rule for it.
- **Its cost is already being paid.** `(a < b) > (d)` compiles and the unparenthesised form does not,
  so parentheses are already the escape and they already work.
- **`Cell<Cell<i32>>()` compiles**, so wac has no `>>` problem — the one C++ needed a special rule for
  until C++11.

What is missing is smaller than a spelling debate:

| | today | what is missing |
|---|---|---|
| `Cell<i32>()` | works | — |
| `zero<i32>()` | `undefined type` | **name resolution only** — it parsed, then looked for a *type* called `zero` |
| `b.map<i32>(x)` | parses as a comparison | the rule is not on the postfix-after-dot path |
| `fn[i32(i32)] g = id<i32>;` | `expected an expression` | the trigger is too narrow — see below |

So a turbofish or square brackets would be introducing a **second** spelling for instantiation beside
the `Cell<i32>()` that already works, which is the "second copy of anything is a copy that drifts"
`CLAUDE.md` warns about. Rust chose `::<>` because its grammar must parse without semantic feedback
and it has tuples; wac's position is different and already committed.

## The rule: if it parses as a type list, it is one

**In expression position, `name < … >` is an instantiation when what lies between the brackets parses
as a type list. Otherwise the `<` is less-than.** That is the whole rule.

It needs no follow set and no special case. The type parse does the discriminating on its own:

| written | between the brackets | reads as |
|---|---|---|
| `Cell<i32>()` | a type | instantiation |
| `zero<i32>()` | a type | instantiation |
| `id<i32>` | a type | instantiation — **a value**, assignable and passable |
| `a < 3 > b` | `3` is not a type | comparison |
| `count < list.len() > 0` | a call is not a type | comparison |
| `a < b > c` | `b` is a type name | instantiation, then a syntax error |

Only the last row costs anything, and it is the chained comparison `a < b > c`, which needs
parentheses under this rule. **Measured 2026-08-26: that shape does not occur in the repository.** A
search across `packages/`, `std/`, `core/` and `spec/` returns 41 hits and every one is inside a
comment or a usage string — `<n>`, `<entry.wac>`, `<port>` — rather than code.

The earlier draft of this document proposed a *follow set* instead: instantiation when the token
after `>` cannot continue a comparison, plus `(` as a deliberate exception. It is recorded here only
to say why it was dropped. It admits exactly the same programs as the rule above, and pays for that
with a table of tokens in the spec and one member that has to be argued for separately. A simple rule
that needs parentheses in a shape nobody writes is worth more than a flexible one that needs a table.

**This widens what wac does today**, which fires only when `>` is immediately followed by `(`. The
gain is that a generic function becomes referable as a value at all: `fn[i32(i32)] g = id<i32>;` is
`expected an expression` today, with no workaround but a lambda wrapper — which itself needs the
inference this document is about.

## Why committing in the parser is affordable

**A misfire is always a compile error and never a silent wrong answer.** For `a<b>(c)` to type-check
as an instantiation, `a` must resolve to a generic type or function, and a type name cannot be
compared with `<`. So the failure mode is a confusing *message*, not a program that runs and does
something else. That is what makes a syntactic commit tolerable here when it would not be in a
language where both readings can type-check.

The shape that surprises is comparisons as comma-separated arguments: `g(a < b, c > e)` reads as one
instantiation — `b, c` is a type list — rather than as two comparisons. This is the C# ambiguity, and
under the rule above it is *wider* than what wac does today, which fires only on the parenthesised
form `g(a < b, c > (e))`. The escape is the same as everywhere: `g((a < b), c > e)`.

**Both surprising shapes were searched for and neither occurs.** Across `packages/`, `std/`, `core/`
and `spec/`: chained comparisons `a < b > c` return 41 matches, all inside comments or usage strings
(`<n>`, `<entry.wac>`, `<port>`); comma-separated comparison arguments return two, both of them
genuine `Map<string, i32>` parameter types. So the rule costs nothing measurable in 135k lines.

One caveat on that evidence, worth keeping: this code was written under a *narrower* rule, so its
authors were never pushed away from these shapes — but they never reached for them either, which is
the useful half of the observation.

**Shadowing stays an error rather than falling back.** `i32 Cell = 1; Cell < q > (d)` fails today and
will continue to, because the parser does not consult name resolution. The diagnostic carries the
fix. If that proves irritating in use, parsing to an ambiguous node and letting the checker choose is
available later **without changing the syntax** — which is the reason to commit now rather than
build the more forgiving thing first.

## Decisions, settled 2026-08-26

- **The spelling** is `f<T>(x)`, because it is what the language already does.
- **The trigger** is "it parses as a type list", not the `>` immediately followed by `(` that
  wac uses today, and not a follow set. Chained comparisons take parentheses.
- **Both mechanisms** stay: slot inference for the common case, written arguments where no slot
  exists.
- **Partial arguments** are not supported to begin with — all the letters or none.
- **Written arguments are allowed always**, not only where inference fails. "Only where needed" makes
  acceptance depend on how clever the checker is, so improving inference would break programs.
- **`issues/lang/0088`** needs none of this and can land first.

## What it costs

`spec/spec/generics.md`'s *"inference is the whole interface"* stops being true, and its section
heading — *"Type arguments are inferred, never written"* — stops being the rule. That is the real
price: a reader currently learns one thing about where a type parameter comes from, and afterwards
learns two. [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md) option A would have
spent that already; option D does not, so this is the first crack in it.

Against that, the sentence is already not quite true — `Cell<i32>()` names an instantiation — and
the rule it protects has produced a feature nobody can use.

## Order of work

1. **`issues/lang/0088`** — a variant of a written type, `Maybe<i32>.Just(4)`. Needs none of the
   decisions above and is arguably a bug rather than a feature, since the struct form already works.
2. **Widen the trigger** from "`>` immediately followed by `(`" to "it parses as a type list".
   This is the piece that makes `id<i32>` a value, and it is separable from everything below it.
3. **The postfix path**: `recv.m<T>(x)` parses as `Cell<i32>(…)` does. Closes the grammar half of
   `issues/lang/0235a` and is what makes [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md)
   option C writable at all.
4. **Name resolution**: a generic *function or method* before `<` means call type arguments — bind
   the letters, then check the call in that world. **This is the generic-free-function feature.**
5. **The diagnostic**, which is the other half of `issues/lang/0235a`: when the instantiation reading
   fails, name the rule and the escape rather than reporting a type mismatch on a parse the author
   did not intend.
6. **The emitter** monomorphises per written instantiation — the table a generic struct's methods
   already use, per [0010](0010-a-method-type-parameter-has-to-come-from-the-slot.md)'s third piece.
   The only large step.
7. **The spec**: `generics.md`'s section *"Type arguments are inferred, never written"* becomes
   *inferred by default, and may be written*; the trigger is stated as the follow set; and
   `[§wac-generic-fn-5hvq3mt]` is re-tagged, since it currently states the terminal refusal this
   removes.

Steps 1 and 2 are independently useful and land without the rest.

## What this hands to tuples

`issues/lang/0074` is where tuples are being designed, and the operator's stated preference is for
them with `(u32, u32)` syntax. Committing to the rule above makes three of its choices load-bearing
rather than stylistic, so they are recorded there and repeated here:

1. **`(x)` must stay pure grouping**, with a one-element tuple spelled `(x,)`. The whole escape hatch
   is `((a < b), c > (d))`; if `(x)` became a 1-tuple, that would change the first element's type and
   the escape would break. Python and Rust both spell it this way, so the constraint costs nothing —
   but it stops being a matter of taste.
2. **A tuple of two comparisons needs parentheses on the element containing the `<`** —
   `((a < b), c > d)` rather than `(a < b, c > d)`, since the second reads as one instantiation. This
   is the same escape as everywhere else, but it is worth stating because a tuple of comparisons is
   a natural thing to write and the argument-list version of it is the one shape that has surprised
   people in other languages.
3. **A tuple type in type-argument position carries its own parentheses**: `f<(A, B)>(x)`. Natural,
   and worth stating so nobody reaches for a bare `f<A, B>` meaning one tuple.

## State of play

| step | state |
|---|---|
| the target, the spelling, the trigger | **accepted** with the operator, 2026-08-26 |
| 1 — `issues/lang/0088` | open, separable, and the cheapest thing here |
| 2 — the trigger becomes "parses as a type list" | **not started** — buys `id<i32>` as a value |
| 3 — the postfix path | **not started** |
| 4 — name resolution | **not started** — this is the feature |
| 5 — the diagnostic | **not started**; `issues/lang/0235a` is open and is this |
| 6 — the emitter | **not started**, and the only large one |
| 7 — the spec | **not started** |
| the tuple constraints | recorded in `issues/lang/0074` |

**Nothing is implemented.** Two things are worth watching rather than assuming: whether committing in
the parser — rather than falling back — is tolerable for the shadowing case in daily use, and whether
the comma-separated-arguments surprise shows up once people start writing generic calls.
