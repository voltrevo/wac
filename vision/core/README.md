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

**`option.wac` is not here and will not be.** The real `core` has one; `T?` nests, so
`Option<Option<T>>` has nothing left to do that `T??` does not.

## What could not be written

**An abstract method has no spelling.** `TicketBase.settled` and `advance` are declared with no
body, and `Coroutine.step` and `Ticket.value` likewise. Every one of them must be overridden and
none has a meaningful default — a base that answered `false` would be a lie that compiles. Nothing
on the pages says a bodyless method is how you ask for that.

**`trap(…)` is used and undescribed.** `Result.orTrap` and `AnyOf.value` both call it. It has to be
an expression rather than a statement, since it appears as a match arm's value, and it has to be
typed `never` so the arms unify — which is a job for `never` that is not yet written down.

**Two match-arm spellings are both in use on the pages.** *Writing an iterator is writing a loop*
matches `Leaf(v):` and `Node(l, r):`; the `Continuation` entries matched `Ready { call }:` and
`Waiting { t, call }:`. Positional and named destructuring could both exist, but nothing says so and
nothing says which is preferred. This file uses positional throughout.

**`T[0]()` was wrong and the real `core` says why.** A *sized* array needs a default value for `T`,
which an enum or a struct has not got; the array *literal* with no elements needs nothing, which is
what makes an empty `Vec<Option<i32>>` possible at all. Six files here allocated with `T[0]()`
before that comment was read. Not a language finding — a reading one.

**A standalone `grow()` cannot be written**, which is a language fact rather than a taste. An array
needs a value to fill new room with, a `T` at a non-defaultable type has none, and the only `T`
guaranteed to be to hand is the one being pushed — so growth lives inside `push`. The real `core`
found the same thing and says so in its header. It is the same hole as *How should a `Vec` drop its
reference to a popped element?*, seen from the other end: no null to write in, no default to grow
with.

**`all([])` has no answer.** `AllOf.value` builds its output array with `fill: parts[0].value()`,
which needs a first part. An empty `all` should presumably settle immediately with an empty array,
and there is no way to write that array.
