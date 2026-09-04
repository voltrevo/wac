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

## The loop head over an async generator that can fail

Two questions that turned out to be one loop. `for … in` steps a `Generator<T, void>`, and every
stream in `vision/packages` is an `AsyncGenerator<T, Result<void, E>>` — so the head has to say two
more things than it does.

**That each step suspends has to be visible.** Four loops in this tree were written as plain
`for … in` over an async source, which reads as synchronous and is not. Letting the head await
implicitly is available and is the thing `README.md` refuses: `await` is a step boundary everywhere
else in the language and is always written. So the loops now say `await`.

**That the generator's failure propagates has to be visible too**, or it is dropped — the same
refusal.

Which leaves `try await for (Socket conn in l.accepted())`: three keywords on one head, each saying
something real, and heavy enough that it is worth asking whether one of them can be implied without
becoming the thing being refused. `try` on a loop also needs its meaning stated when the loop is
inside a generator — it propagates the source's `Err` as *this* generator's return rather than as a
yield.

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

## Matching in a `while` or `for` condition

`Sys.drain` writes `this.pending.pop()!` under a `len()` test, which is two operations and an unwrap
where `while (Continuation c = this.pending.pop())` would be one of each. Whether that is a
nullable-specific form, a `match` in a condition, or something in the `if let` family is open — as
is whether it reaches `for`, and whether it binds an enum variant as well as a non-null.

## How should a `Vec` drop its reference to a popped element?

`pop` decrements a length and leaves the reference in the slot, so the element stays reachable until
a later `push` overwrites it. Nothing the body can write clears it: a `T[]` at a non-nullable `T`
has no null to store, and `Point[10]()` builds ten distinct `Point()`s rather than ten absences. The
queue `Sys.drain` pops from has the same hole, which is where it turned up.

Holding `T?[]` instead is free for a reference `T`, since a `ref null` array is the same array, and
boxes every element of a `Vec<i32>` — the one case that cannot wear it. An array operation meaning
*put this slot back to nothing*, and doing nothing where the element type has no null to write,
would cost nothing anywhere; it needs the generic body to be able to say it without knowing which
case it is in.

The retention is bounded by the vec's high-water mark rather than growing, which sizes the problem
without excusing it: one popped root can hold a whole graph.

## Whether there is optional chaining

`?` nests, so `x?.field` on a nullable field would answer `T??` where every language that has the
operator answers `T?`. That is the one place flattening earns its keep, and wac has neither `?.` nor
`??` today — so the question is whether adding one means giving it an explicit flatten, or not
adding it.

## A generic method whose type parameter is only in the return type

`vision/packages/json`'s parser funnels every failure through
`Result<T, ParseError> fail<T>(const this, Reason why)`, so a position can never be forgotten. `T`
appears in no argument, and `return this.fail(Reason.Eof);` has to take it from the enclosing
function's return type. Whether inference reaches there is unsaid, and the alternative — writing
`Result.Err(ParseError(this.at, …))` at every site — is the thing `fail` exists to prevent.

## How an elided body is spelled, and how an abstract one is

`vision/core` writes a method with no body to mean *every subtype must override this, and there is
no sensible default* — `TicketBase.advance`, `Coroutine.step`. `vision/packages/json` writes
`{ … }` to mean *this is the same as the original and not repeated here*, following the SHOWCASE
entries. Both are wanted and neither is described, and the two look similar enough that reading one
as the other is easy.

## Naming a union, and whether a union may contain one

`vision/packages/http` is unwritable without both. It declares
`export union<BadMethod, BadTarget, …> RequestFault;` because the alternative is repeating ten
members at every signature, and then `export union<RequestFault, BadStatus> ResponseFault;` because
the whole point is that the response parser says what it *adds*. The second relies on the first's
members flattening into it, which set semantics imply and nothing states.

`union<…>` appears all over the pages as a type expression and never with a name. Whether the name
is a distinct type or an alias decides the related question about a union as a match arm — which
this package also wants, for the one place that turns a fault into a message.

## Whether `drain` can terminate while the accept loop is one of the things it is draining

`vision/packages/server`'s `main` accepts in a loop and calls `handle(sys, conn)` without awaiting,
then `await sys.drain()` before returning. `drain` loops until its queue is empty, so it stops only
once accepting has stopped — and the accept loop suspends on the listener, which puts *it* in the
queue too. A connection arriving during the drain is scheduled onto a queue being emptied. Whether
that is fine, or a program that never exits, is not decidable from anything written down.

## A bound on a type parameter

`vision/packages/wactest` writes `wantErr<V, E, W>(this, Result<V, E> r, …) where W in E` — assert
that a call failed with a particular error — and it is only worth having if asking for an error the
callee cannot produce is a compile error rather than a test that can never pass. Membership in a
union is already the rule `try` uses; nothing says how a signature *states* it. Six packages in,
this is the first thing that wanted a constraint on a type parameter at all, which is either a sign
the language does not need them or a sign that testing is where they start.

## A block that ends in a value

`wactest`'s `okOr` records a failure and answers `null` from one match arm: `Err(e): { this.fail(…);
null }`. Nothing on the pages has a block in expression position. Without it every test of a
fallible call writes a check, a `fail`, and an early return — and the early return is the part that
gets forgotten, leaving the test running against a value that was never produced.

## Whether a wac program can ask a module what its exports look like

`wactest`'s runner tells a pure test from one wanting a `Sys` by **reading the export's type**
rather than its name, which replaces `test` as a string convention that nothing checks — and
`harness/testRegistrars.ts`, which exists to keep two lists of spellings in step and failed to once.
`bindgen` already reads signatures, so it is not a new capability; what is new is a wac program
doing it to a module it loaded. *The compiler is a library* is the neighbouring claim and it is
about compiling rather than reflecting.

## Re-export and package entry points — taken, in the barrels

`wac-mono 0072` is already open about the cost: `itoa64` and `utoa64` exist twice because unifying
them touches forty import lines, and *"wac has no re-export — importing a symbol from a file that
merely imports it is a compile error."*

**The mechanism half-exists and the existing half is the wrong one to generalise.**
`import { Read } from "core";` works today because `core` is a built-in whose root aggregates every
file's exports. Aggregation gives a package no internal level: `export` marks what leaves a *file*,
so a helper two files both need has to be exported, and exporting it makes it public. `http`'s
`findCrlf` is that exact trade — duplicated between two files in the original rather than shared,
because *"neither wanted to export a helper the other would then depend on."* A duplicate chosen
over a leak.

So every package here has an explicit barrel instead, and imports name the package
(`@/packages/http`) rather than a file inside it. Two things follow that want review:

- **A directory resolves to an entry point.** `@/packages/http` finds `src/http.wac` by convention.
  Nothing says whether that is a convention or a manifest field.
- **The barrel is a judgement and records one.** `http`'s exports `eqFold` and does not export
  `isToken`: comparing a field value case-insensitively is something a caller does, recognising a
  tchar is not. Writing the list is what forces that decision to be made once rather than by
  whoever happens to import first — and it caught a real leak, since `server` was importing
  `eqFold` through a path that had never offered it.

## Whether interpolation reverses a decision somebody made on purpose

`IDIOMS.md` says interpolation is sugar for `+` and `+` takes the scalars. `packages/fmt`'s header
says *"wac has no number-to-string conversion and `string + i32` is **deliberately** a compile
error."* Both cannot hold, the word is in the original, and the reason behind it is not recorded
anywhere I could find.

It also settles something the entry does not mention: `"\{0.1 + 0.2}"` becomes
`"0.30000000000000004"`, since that is the shortest decimal that reads back. Right for a log line
and not what someone writing `"total: \{amount}"` expects — and *no formatting language* means
there is no other spelling for them. That may be the intent; it has not been said.

## A slice type — invented, in `core/slice.wac`

Taken rather than left open, on the licence to invent. Two arguments that must travel together and
must not be swapped is a struct: `atofSpan(u8[] src, i32 start, i32 end)` in `fmt`,
`isValidTarget(s, lo, hi)` in `http`, `slice(query, at, eq)` in `server`, and `packages/bytes`'s
`slice` copies — so the alternative to the triple is an allocation per token.

What is decided in the file and wants review: a `T[]` widens to a `Slice<T>` implicitly, the same
widening as `T` to `T?`; indexing and narrowing both trap, since the bounds come from a scan the
caller just did; and `Slice.get` checks against the *view's* length rather than the array's, because
reading past the view into the array is precisely the bug a triple makes easy.

`url/query.wac` uses it and now allocates nothing to parse a query — a request with forty parameters
of which a handler reads two pays for two.
