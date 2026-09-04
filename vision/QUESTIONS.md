# Questions

Open questions about the language. Not bugs and not work: nothing here is wrong, and nothing here is
buildable yet.

Deliberately loose. No numbering, no fixed shape, no index, nothing for a guard to walk. A number
invites a cross-reference, and a reference to a question that has been answered and deleted is worse
than no reference at all.

**A question is deleted once it is answered** — and the answer has to land somewhere first, as an
example, a decisions entry, or a spelling changed across the pages. Deleting a question whose answer
went nowhere deletes the reasoning with it.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## Tuples and variadic arguments

Heterogeneous `Ticket.all(a, b)` answers a tuple, and `Ticket.any(a, b)` answers
`(i32, union<A, B>)`. Both need tuples, which have never been explored, and variadic arguments —
an array literal has one element type, so `[a, b]` forces the branches to agree.

## Dynamic dispatch

The ticket design assumes it. `advance` and `settled` are overridden per kind of ticket, which is
what lets a fake `Sys` add a kind without editing `core`; a closed enum of kinds would not.
`issues/lang/0144` suggests the intent already exists and today's behaviour is the accident.

## The name for the erased ticket

`Ticket<T>` inherits an empty base: the value type is rubbed out and what remains is `advance` and
`settled`. `TicketBase` is accurate and dull. `Stub` points the wrong way — a stub is the half you
keep, not the whole thing with a field removed. `Waitable` is worse than it looks, since `wait`
answers `T` and the erased type is the one thing you cannot wait on. What the erasure preserves is
*driving*, and no candidate naming that is a word worth adding.

## Whether a ticket can become undeliverable

A `Dropped` state would let *awaiting something nobody will ever settle* be diagnosed rather than
hang. Every case found so far dissolves: a ticket holds its own coroutine, so whoever holds the
ticket can always drive it, and a capability that gives up should settle with an error rather than
vanish. Left open because the better error is worth having if a case turns up.

## `for … in` over an async generator

Stepping one can answer `Waiting`, which a synchronous loop has no way to handle. So either that
loop is legal only inside an async function, or iterating an async generator is a different
construct.

## Whether `Continuation.Ready` survives

Every async suspension is on a ticket now, so an async machine only ever hands over `Waiting`, and
`Ready` is left describing a generator that has yielded. It could collapse into `Waiting` on a
settled ticket — one fewer variant, one code path in every scheduler — at the cost of saying
plainly what a settled `Waiting` only implies.

## Whether `wait` caches what it is waiting on

`advance(false)` steps a blocked machine to learn it is still blocked, and `advance(true)` steps it
again. Both are no-ops, so it is correct and wasteful. Caching the awaited ticket fixes it and adds
state that something has to invalidate when the machine moves on.

## What examples should capture `wait`

Nothing on the page mentions it. Candidates: driving a coroutine to completion from sync code, the
`Err` when this host cannot be waited on, that it drains the dependency set rather than descending
depth-first, and the circular case. Four is probably too many for one feature.

## What example should capture `defer`

And whether `sys.atEnd` wants one beside it, since the pair is the whole cleanup story — `defer`
runs when the block exits, `atEnd` when the domain does, and cleanup that must happen belongs to a
system rather than to a block.

## What example should capture the keyword rule

`await` is illegal in a generator, `yield` is illegal in an async function, and an async generator
has both. Probably a refusal, since the legal cases already appear on the page.

## What example should capture stepping a finished machine

It has to be a no-op. A scheduler can be holding a continuation for a machine somebody else waited
to completion, and there is no way to withdraw the registration.

## What example should capture `auto` refusing to widen

`auto` takes the type an expression already has, and `union` is the widening marker. An array whose
elements disagree is the case that separates them.

## What example should capture a default type argument

`enum Result<T, E = union>` is what makes `Result<T>` an ordinary generic rather than a special
form, and it is the thing that lets `Result`'s current blessing expire.

## The shape of `main`

`i32 main(Sys sys)` and `async i32 main(Sys sys)` both appear, and a posix-style small integer exit
code is assumed throughout. Whether `std` should assume it is open. A sync `main` that drives its
own work holds a `Result` and has nowhere to put it, so it either matches on it to pick an exit code
or discards it. `Result<i32> main` would answer that and is ugly; nothing else has been proposed.

