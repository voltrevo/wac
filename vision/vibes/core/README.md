# core — rewritten

Written 2026-09-04. Read [../packages/README.md](../packages/README.md) first: nothing here is
vetted, nothing compiles, and all of it is disposable.

Only what a rewritten package has actually reached for. It grows when something needs it and gets
deleted when nothing does.

| file | what changed |
|---|---|
| `result.wac` | a default type argument and an inferred `union` make it ordinary library code |
| `ticket.wac` | `TicketBase`, `Ticket<T>`, `Continuation`, and `wait` written out |
| `coroutine.wac` | one machine, three spellings; `never` removes an arm rather than deadening it |
| `vec.wac` | `pop` answers `T?` |
| `queue.wac` | new — `Sys.drain` wanted one |
| `slice.wac` | new, and invented — a view of part of an array, so a parser can stop copying |
| `cursor.wac` | new — a position in a byte slice, from a sweep that found `Reader` in five shipped packages |
| `order.wac` | new — `Ordering`, `SortSpec<T>`, `bytesCmp`; the fifteen three-way comparators in the tree all answer `i32` |

**`option.wac` is not here and will not be.** The real `core` has one; `T?` nests, so
`Option<Option<T>>` has nothing left to do that `T??` does not.

**The tree has already voted, and by a lot.** Counted across `packages/` and `core/`: **811 nullable
declarations against 86 mentions of `Option<…>`**, in 19 files. Removing `Option` is finishing a
migration rather than starting one.

What it costs is narrower than the ratio suggests and is worth naming, because it runs the other
way. `Option` **narrows** — `case Some(v)` binds the payload, so the arm has a `T` — and `T?` does
not: `is not null` leaves the value nullable, measured, so every use needs a `!`. There are **21**
`case Some(v)` arms in the tree, and those are the sites that would go from a bound name to an
unwrap. The other 790 nullables already pay it.

## The two new files were written from sweeps of the shipped tree, not from a rewrite

Every other file here came out of rewriting a package and finding what it needed. These two came out
of counting, which is a different method with a different failure:

- **`cursor.wac`** — four shipped packages declare a byte cursor called `Reader` and `core` has none.
  Written, then adopted by `@/packages/rlp/src/decode.wac`, which **declined its best operation**:
  `sub(n)` bounds a nested field by construction and would make rlp's `ListOverrun` unreachable. One
  adoption disproved one of the file's own four claims, and a second candidate — `@/packages/abi` —
  declined the whole type, because ABI is random-access and there is no position that advances.
- **`order.wac`** — fifteen three-way comparators in the shipped tree, all answering `i32`; three of
  them are the same eight lines; `core/hash.wac` has `bytesEq` and no `bytesCmp`. Filed as
  `issues/system/0345a`, because the shipped decision — is `core`'s sort stable? — is not this
  directory's to make.

> **A sweep says a type is missing and an adoption says which parts of it are.** The cursor's count
> of shipped `Reader`s said eleven members were wanted; its one real consumer uses six, declines two
> for reasons that are the format's, and never reaches for three.

## What could not be written

**An abstract method has no spelling, and the substitute is weaker than it looks.**
`TicketBase.settled` and `advance` are declared with no body, and `Coroutine.step` and
`Ticket.value` likewise. Every one must be overridden and none has a meaningful default — a base
answering `false` would be a lie that compiles.

The available idiom is a body that traps, and it compiles. What it does not do is *check*: measured,
`struct K : B { }` that never overrides `B`'s trapping method has no diagnostic at all, and traps
only if something calls it. There is no abstract notion in the checker. So a bodyless method is not
moving a check from compile time to run time — it is adding one where there is none, which is a
better case for it than `../GRAMMAR.md` first made.

**`trap` as an expression.** The *statement* exists and carries a message —
`trap_stmt = "trap" , [ expr ] , ";"`, and `trap "out of range";` compiles today, which this file
had wrong as `trap("…")`. What is missing is the expression form: `Result.orTrap` wants one as a
match arm's value, which needs it typed `never` so the arms unify.

**Two match-arm spellings are both in use on the pages.** *Writing an iterator is writing a loop*
matches `Leaf(v):` and `Node(l, r):`; the `Continuation` entries matched `Ready { call }:` and
`Waiting { t, call }:`. Positional and named destructuring could both exist, but nothing says so and
nothing says which is preferred. This file uses positional throughout.

**`T[0]()` was wrong and the real `core` says why.** A *sized* array needs a default value for `T`,
which an enum or a struct has not got; the array *literal* with no elements needs nothing, which is
what makes an empty `Vec<Option<i32>>` possible at all. Six files here allocated with `T[0]()`
before that comment was read. Not a language finding — a reading one.

**The popped-slot retention is `core`'s, not this rewrite's.** `core/vec.wac`'s `pop` carries the
same comment — *"the slot keeps its reference: there is no value to overwrite it with"* — so the
question in `../QUESTIONS.md` is about shipped code and the rewrite only inherited it.

**A standalone `grow()` cannot be written**, which is a language fact rather than a taste. An array
needs a value to fill new room with, a `T` at a non-defaultable type has none, and the only `T`
guaranteed to be to hand is the one being pushed — so growth lives inside `push`. The real `core`
found the same thing and says so in its header. It is the same hole as *How should a `Vec` drop its
reference to a popped element?*, seen from the other end: no null to write in, no default to grow
with.

**`all([])` has no answer.** `AllOf.value` builds its output array with `fill: parts[0].value()`,
which needs a first part. An empty `all` should presumably settle immediately with an empty array,
and there is no way to write that array.
