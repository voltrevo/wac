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

## Tuples, and the fact that they would be the first structural type

Heterogeneous `Ticket.all(a, b)` answers a tuple and `Ticket.any(a, b)` answers `(i32, union<A, B>)`.
Both need tuples and variadic arguments — an array literal has one element type, so `[a, b]` forces
the branches to agree.

Read against the implementation, and the obstacle is not the one it looks like.

**Not multi-value.** wac has none anywhere: `funcref_type` is `"fn" "[" type "(" … ")" "]"` — one
result — and `func_decl` declares one return type. The emitter's own signature strings are
`fn[U(S,U)]`. So a tuple would be a struct, one heap allocation per return, which against the cost
of the tickets it is grouping is nothing.

**It is that a tuple is structural and wac is nominal.** `spec/spec/imports.md` says so twice —
*"types are nominal, so two modules would be two `Read`s and nothing could convert between them"* —
and that is load-bearing enough that `core` is embedded in the compiler rather than copied, to stop
exactly that. A tuple cannot work that way: `(i32, string)` built in two files has to be one type or
it is useless, so it would be **the first structural type in a nominal language**.

That is not an argument against it. It is where the design work is, and `design/lang/0015` is the
neighbouring problem — what may cross into a module loaded at runtime — whose answer also turns on
nominal identity. Whatever rule gives two files the same `(i32, string)` is close to the rule that
would give them the same `Config`.
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

## What a sync `main` does with a `Result`

Not the exit code, which I had filed and which is not open: `export i32 main(Core core, Cli cli)` is
the shape today, so a posix-style small integer is already the language rather than something `std`
would be assuming. Vision changes the *parameters* — `Sys` in place of `(Core, Cli)`, which is the
shelf's *authority arrives as one thing* — and leaves the return alone.

What is open is narrower. A sync `main` that drives its own work holds a `Result` from `wait` and has
nowhere to put it, so it matches on it to pick an exit code or discards it. `Result<i32> main` would
answer that and is ugly. `vision/packages/server` writes the match, which works and means every
program that can fail to acquire a capability writes the same four lines.

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

## Re-export and package entry points — taken, in the barrels

`wac-mono 0072` is already open about the cost: `itoa64` and `utoa64` exist twice because unifying
them touches forty import lines, and *"wac has no re-export — importing a symbol from a file that
merely imports it is a compile error."*

**The mechanism does not half-exist, which I claimed once and had wrong.** `import { Read } from
"core";` works and the spec calls `core` *"the root of the tree"*, which reads as an aggregate. It is
not one: `Read` is the only name that crosses, and `Result`, `Option`, `Map` and `hashBytes` are each
refused from `"core"` with *"importing does not re-export"*. So `"core"` names one file and nothing
in the language aggregates anything.

The barrel is therefore the only proposal rather than the better of two, and its argument is its
own: `export` marks what leaves a *file*, and a package needs a second level. Without one a helper
two files share has to be public — `http`'s `findCrlf` is what that costs, duplicated between two
files rather than shared because *"neither wanted to export a helper the other would then depend
on."* A duplicate chosen over a leak.

So every package here has an explicit barrel instead, and imports name the package
(`@/packages/http`) rather than a file inside it. Two things follow that want review:

- **A directory resolves to an entry point.** `@/packages/http` finds `src/http.wac` by convention.
  Nothing says whether that is a convention or a manifest field.
- **The barrel is a judgement and records one.** `http`'s exports `eqFold` and does not export
  `isToken`: comparing a field value case-insensitively is something a caller does, recognising a
  tchar is not. Writing the list is what forces that decision to be made once rather than by
  whoever happens to import first — and it caught a real leak, since `server` was importing
  `eqFold` through a path that had never offered it.

## Widening `+`, and one wrong marker

`IDIOMS.md`'s *A number in a string* is marked **Not yet** and describes something that shipped.
`spec/spec/strings.md` has interpolation, in almost the entry's words: *"exactly sugar for `+` …
there is no formatting language — the expression is whatever `+` accepts on the right of a string"*,
with three tagged examples.

What has not shipped is the other clause. `+` does not accept a scalar, so `"n=\{n}"` for an `i32`
is `operands have mismatched types` today — and `packages/fmt`'s header says that is **deliberate**.
The word is in the original and the reason is recorded nowhere I could find.

So two things: the entry needs its marker fixed and probably splitting, since one half is done and
the other is a real proposal against a stated decision. And widening `+` settles something unsaid —
`"\{0.1 + 0.2}"` becomes `"0.30000000000000004"`, right for a log line and not what
`"total: \{amount}"` expects, with no other spelling available by design.

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

## A `secret` qualifier, and the hole it would inherit

`const` is a taint that propagates through a value's whole reachable graph and forbids **writing**.
`secret` would be the same machinery forbidding **branching and indexing** — which are exactly the
two events `docs/constant-time.md`'s tracer records, so the rule is that instrument's finding
written as a type, checked on every build rather than on the runs somebody remembered to trace.

Two things make it a question rather than a proposal to take.

It would refuse AES: the S-box lookups the published table flags at `aes.wac:129`–`132` are what AES
*is*, so the rule needs a declared exemption at the site or it gets turned off. And it inherits
`issues/lang/open/0315a`, where const taint is laundered through an argument, an array element, a
field, a type argument and a `const`-declared return. A laundered `const` is a wrong answer; a
laundered `secret` is a key in a log line. **So it is worth having and not worth having before
0315a is fixed** — a taint that leaks is worse than no taint, because it is believed.

## What a capability looks like when it has to be sent

Within one instance, authority being a value does real work: a function handed a narrower `Sys`
cannot reach past it, and the type says so. **Across a spawn it cannot be a value at all** —
`std/platform.wac` is explicit that *"a spawned child is a separate instance with its own memory"*,
and a reference does not cross an instance boundary.

So `std`'s grant bitfield is not a compromise. It is the serialised form of a capability, and a model
where authority is a value needs a second thing that is the wire format of that value.
`SHOWCASE.md` already writes both and does not distinguish them:

```wac
auto child = try await sys.spawn(wasm, [], [Grant.Read]);
```

`sys` is a capability, `[Grant.Read]` is a description of one, they sit two words apart, and only the
second can be sent.

Open: whether the grant list is serialised by the compiler, by `bindgen`, or by hand; whether a host
that meets an unknown member refuses or drops it; and what happens when parent and child were built
against different versions of it. A bitfield answers all three by being a number. **Dropping an
unknown member** is the tempting answer and is the one that silently narrows without reporting it.

Same boundary as `design/lang/0015` from the other side — that asks what a *type* may cross into a
module loaded at runtime, this asks what an *authority* may. Both answers are "not a reference".

## Where per-function authority stops

Two packages met the same fact from opposite sides and neither page says it.

`sh`: a capability cannot cross **into** a spawned child, because a child is a separate instance and
a reference does not cross an instance boundary.

`box`: authority cannot be subdivided **within** a module. Its 63 applets all take
`(Core, Cli, Fs, Args)` — measured, not one varying — and 10 of them never mention `fs` outside that
signature. `box.wac` says why and does not hide it: *"A multicall binary weakens the permission
story … `box`'s grants are the union of what its applets need, so running `box echo` carries the
filesystem and network access `box cp` and `box get` would want."*

So: **authority is per-instance, and per-function authority stops at the module edge.** Inside, a
signature is a real constraint; outside, it is a request to a host. Both `SHOWCASE.md` entries about
authority are about the inside, and a reader has no way to learn where the inside ends.

The in-language half that *is* available: a dispatch table of closures rather than function
pointers, so `echo`'s entry captures no `Fs` and the applet cannot reach one. It does not narrow the
grant — `bin/` is the build-time answer to that, and already exists — but it stops 10 of 63 reaching
what they were handed.
