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

**And the third option was never on the list, so the ticket half does not need it either.** This
entry offers subclassing against *"a closed enum of kinds"*, and there is a third: **funcref fields**,
open to any kind, needing no dispatch, and already what `std/platform.wac`'s `Pending<T>` is —
`fn[T(i32)] resolve`, `fn[bool(i32)] settled`, `fn[void(i32)] drop`. The design `vision/core/ticket.wac`
is a rewrite of had answered the question the rewrite asks.

`Ticket<T>` is funcrefs now and `AllOf`/`AnyOf` are gone, replaced by four helpers over a
`Ticket<T>[]` with `all`/`any` building an ordinary `Ticket` from lambdas. **So nothing in `vision/`
depends on dynamic dispatch any more**, and this entry is a question about the language rather than a
blocker for the proposal.

It also removes two of the five uses of *a generic parent* — and that is less than it looks, which is
worth saying because I nearly claimed more. The other three are
`Generator<Y, R> : Coroutine<never, Y, R>` and `AsyncGenerator`, and those are not inheritance: they
are **names for a partial instantiation**, written as inheritance because `typedef` takes no type
parameters. One construct doing two jobs, and the half that is really a parameterised type alias
should be asked for as one — see below.

**The capability design assumes it too, and that was not written down.** `vision/std/platform.wac`
has **fourteen** bodyless methods — every method of every projection — and
`vision/packages/wactest/src/test.wac` subclasses them: `struct FakeFiles : Files` with
`override async … read(…)`, `struct FakeClock : Clock` with `override i64 nowMillis(…)`. Dispatch is
static, measured on 2026-09-04: a `Circle` in a `Shape` variable answers `Shape.name()`. So a
`FakeFiles` handed to a function taking `Files` runs **`Files`'s** `read`, which has no body. The
fake never runs.

That is not a footnote on `wactest`; it is `wactest`'s headline. Its README argues *"a fake is an
ordinary value … no seam, no injection point, no mode flag in the real one — the seam is the
parameter"*, and the whole of that rests on an open question two files away.

**And unlike the ticket design, this half has an alternative that needs nothing.** The shipped
capability world is structs of **funcref fields** — `fn[Pending<u8[]>()] readStdin` and forty-nine
more — so a fake is the same struct type holding different funcrefs, with no subtyping and no
dispatch. `packages/fs`'s header calls that *"the language's own idiom for varying behaviour"*, and
`spec/cases/0193` is named *a capability can be faked with lambdas*.

`vision/packages/fs` arrived at the same shape from the other end: `Mount` is a struct of closures
because a tag makes every operation know about every backing. **That is not a filesystem idea. It is
what every capability in this proposal has to be if the fakes are to work without a language
change** — and it would leave the dynamic-dispatch dependency where it was already known to be, in
the tickets alone.

The cost is the one `fs` already priced: a funcref field per operation per instance against one
method table for all of them, and a call that is not inlined. Microseconds of I/O against nanoseconds
of indirection. It also removes a reason for *a method with no body*, which is one of the three
constructs the grammar has and no vetted page mentions — the abstract-class shape is the only thing
that wants it.

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

## The wire format has two dimensions and the value has arbitrarily many

`vision/packages/sh/src/exec.wac` says the important half already: within one instance authority is a
value, across a spawn it is not and cannot be, and *"the bitfield is not a design compromise, it is
the serialised form of a capability."* What it does not say is that **the two are diverging, and
vision's own other proposals are what widens the gap.**

The shipped wire format is a category and a root: `cli.spawn(src, args, GRANT_READ | GRANT_NET, dir,
…)`, and `std/platform.wac` puts it well — *"A shell served over a socket can be given one directory
and no network."* Two dimensions, and both of them are things a host can enforce.

The in-language value now has more than two. `vision/packages/fs`'s `Mount` is a struct of closures,
so a `Files` can be a memory tree, a host subtree, a read-only wrapper, an overlay of one over
another, or a fake a test built. `Mount.overlay(base, top)` is three lines there — and there is no
`GRANT_` for *reads fall through to this and writes land in that*. It is not that the flag set is
short by one; it is that the value's expressiveness is open-ended and the wire's is closed.

So the rule that comes out of it, which nothing states:

> A capability narrowed **structurally** survives a call and dies at a spawn. A capability narrowed
> **categorically** survives both.

That is a real thing for a program to know and it is not written anywhere. It also cuts against how
the projections are argued: `box`'s ten applets that never touch a filesystem are handed `Out` and
the narrowing is real *because they are called*, not spawned — and `sh`'s whole subject is the case
where they would be spawned.

Three ways it could go, and none is free:

- **Say it and stop.** Document that structural narrowing is intra-instance, and let a program that
  needs a narrowed child pass a description rather than a value. Honest, and it means the two halves
  of "authority is a value" are answering different questions.
- **Make the wire format extensible** — a child receives a capability *description* it must ask a
  parent to service, which is a proxy and a round trip per call, and turns the parent into the
  child's kernel.
- **Refuse to spawn from a narrowed capability**, so the loss cannot happen silently. Which needs
  the value to know it has been narrowed, and a `Mount` built from closures does not.

The third is the one worth thinking about hardest, because the failure this is all about is silent:
a parent hands a child `GRANT_READ`, believes it handed over its own narrowed view, and the child
gets the process's.

## `drain` names a queue where it should name the current target

`schedule` had one consumer — `Sys.drain` — until `vision/packages/wactest/src/isolate.wac` gave it a
second, and the first one breaks the second.

```wac
async void drain(this) {
  schedule this.pending.push;
  while (this.pending.len() > 0) { … }
}
```

Inside a scope that has already said `schedule mine.push`, a call to `sys.drain()` retargets to
`sys.pending`, drains `sys.pending`, finds it empty, and answers zero — while the caller's work sits
in `mine`, undrained and unreported. The same code works against the shipped design, where there is
one queue.

**`drain` should drain wherever `schedule` currently points**, which makes `Sys.pending` an
implementation detail of the default target rather than something `drain` knows the name of. That is
a change to a design worked out directly, so it is a question rather than an edit — but the current
shape means the only two consumers of `schedule` cannot be used together, which is a strong hint.

## What a trap does to a scope, which `schedule` and `defer` both need

Two entries here ask a version of this and it is one question.

`defer { this.inWait = false; }` in `core/ticket.wac` is permanently wrong after one trap if a trap
skips the defer. `schedule mine.push` in `isolate.wac` sends every later test's work into a dead
queue if a trap does not restore the target. Both are **scope-scoped side effects**, and what
unwinding does to them is unstated for both.

Answering it once answers both, and answering it differently for the two would need a reason — the
only candidate being that `defer` is a thing the program wrote and `schedule` is a thing the runtime
tracks, which is a distinction about implementation rather than about meaning.

Related and also unstated: **whether the target nests.** The pages say *"the scope resumes"*, which
reads like a stack and does not say so. An implementation with a single current target that restores
to the default would satisfy that sentence and break every nested use.

## `secret` has no return position, no field position and no release

`vision/packages/tls` is the first consumer the proposal has ever had — its two uses are both inside
the file that proposes it — and the TLS 1.3 key schedule is ten arrows of *secret in, secret out*.
It does not survive them, and the parser found the first one before I did: every signature was
written `export secret u8[] deriveSecret(…)` and `specparse` answered
`no rule reaches '['`, because `GRAMMAR.ebnf` has `param = [ "const" ] , [ "secret" ] , type , IDENT`
and a return type is not a parameter. The grammar came from the proposal, so that refusal is the
proposal answering.

**Propagation needs a return position, and a return position makes it a type.** `secret` is cheap
precisely because it is a flag on a name in the scope table, like `const` — which is why
`issues/lang/open/0315a`'s five leaks are one fact. A value that carries its own taint is a property
of the *type*, and then the argument that the machinery already exists is gone. The proposal cannot
have both its cost and its purpose.

**It has no field position either.** `trafficKeyIv` returns a key and an IV; a key is secret and an
IV goes in a record header. Splitting them into a struct is the obvious fix and the struct cannot say
which field is which. A qualifier that cannot describe part of a value pushes back on the data
layout — the shipped code concatenates them because wac has no tuples, and would now have to split
them because of taint.

**And there is no declassification.** `finishedVerify` takes a secret and produces bytes that go on
the wire, which is what a Finished message *is*. `crypto/src/secret.wac` calls laundering the failure
mode — *"a laundered `secret` is a key in a log line"* — and here it is the feature. With no release
form the choice is between not tainting the most security-critical function in the handshake and
putting an escape hatch on it.

The reason all three are missing is visible in the two examples the proposal was written from:
`chachaBlock` and `aesEncrypt` take a key and write bytes, and are the two functions in cryptography
that never return a secret, never mix one with a public value, and never declassify. **A proposal
tested only on its motivating example is untested**, and this is the cleanest instance of that in the
directory.

## Twice now, a page wrote a method and the code wrote a free function

Checking every `Type.method(…)` call in the vetted fences against what `vision/core` and `vision/std`
declare — 22 types, 70 members — turned up exactly two mismatches, and both are the same shape:

    Ticket.all   IDIOMS.md      declared as a free function `all<T>(parts)`
    Ticket.any   TECHNICAL.md   declared as a free function `any<T>(parts)`

The other was `Proc.spawn`, found the same way. In wac a `this`-less method *is* a static, so the
page's spelling needs the function inside the type — and in both cases the code put it outside,
which turns the receiver into a token the function happens to take.

**And in `Ticket`'s case the reason was an assumption, not a constraint.** A static on a *generic*
struct called without naming the instantiation looked uncertain, so the file wrote free functions.
Measured: `B.of(3)`, `B<i32>.of(3)` and a free `mk(3)` all compile today, and inference is
argument-directed exactly as `generics.md` says. Both are statics now.

**Two out of seventy is a good result and worth saying so**, because it is the opposite of what the
same check found for `Sys`: `vision/core` was written alongside the pages and tracks them; `vision/std`
was invented in the packages exercise and contradicts them in seventeen places. The difference is not
care, it is whether the two halves were ever in the same conversation.

## Three projections examined, three wrong in a different way, and the count is why

The seven were derived from counting the host's fifty capabilities and finding five groups. That
argument is about *how many* groups there are. It says nothing about what belongs in one, and each
projection that has since been given a consumer has been wrong differently:

| | | |
|---|---|---|
| `Files` | short by two methods | `rename` and `linkStat`, in the shipped `Fs` and not here — six of fourteen, chosen by what the packages written before `fs` happened to need |
| `Net` | short by a **shape** | two of nine and both streams, so a datagram endpoint — one socket, many peers, peers that move — has nowhere to go |
| `Proc` | short by its **purpose** | one method of seven, and the one is `exitCode`. The projection named for starting things could not start anything |

**`Proc` is the one to read twice.** `spawn` was a *free function* taking a `Proc`, so the value was a
token proving authority rather than the interface exercising it — the only one of the seven used that
way. And `exec.wac`'s own paragraph, *"it takes a `Proc` rather than a `Sys` because starting
something is all it does"*, was arguing for the narrowing while writing the shape that gives it up: a
`Proc` that only *proves* you may spawn is a `Proc` any holder can spawn with, through any function
that asks for one.

`exitCode` is not authority over processes either. It is a fact about *this* process, in the same
family as `Env`'s `arg` and `cwd`, and it is on `Proc` because the host groups it there.

The other four, checked against the host rather than waiting for a consumer: `Env` is complete, four
of four. `Clock` and `Random` are single capabilities raised to types. And **standard input has no
projection at all** — `readStdin` is a host capability that `packages/ssh` and four `platform` files
use, and none of the seven had it.

**That last one names the root cause, which is why all four defects are different.** The seven do not
group by the same thing:

    Files, Net, Proc    by resource
    Env                 by facts about how this program started
    Out                 by direction
    Clock, Random       single capabilities raised to types

Standard input falls exactly where *direction* meets *resource*, and that is why it fell through
rather than merely being forgotten. A grouping with more than one principle has a gap wherever the
principles disagree, and each of the three consumer-found defects is one of those gaps seen from
inside: `Net` short by a shape is *resource* failing to say which transport, `Proc` short by its
purpose is *resource* naming a noun where the authority is a verb.

So the question is not whether to have projections — `fs` showed one paying for itself in a line, and
the grant boundaries are real. It is **what the grouping principle is**, and the concrete form of
that question is small enough to answer: `In` beside `Out`, or rename `Out` to `Io` and put all three
there? The host counts `write`, `writeErr` and `readStdin` as one group of three, which argues for
`Io`. `box`'s ten applets that only write are the argument for the narrowest useful projection, which
argues against. `vision/std` has `In` for now, and that is a placeholder rather than an answer.

## Nothing here has a build story, and the ladder is the reason it needs one

No page in `vision/` mentions the ladder, a rung, or the bootstrap. `GRAMMAR.md` says *seed* three
times and all three are about a stale one. So the proposal has never asked how any of it gets built.

`bootstrap/README.md` states the constraint in one sentence: **"the ladder exists to reach
`packages/wacc/src`, and every feature beyond what those 37,873 lines use is a feature the rung below
has to pay for too."** Five rungs, the lowest hand-written wasm assembly text, each compiled by the
one under it.

Two things follow that no entry here has weighed.

**Every construct arrives at the compiler last.** wac-L5 is described as *"the minimum that compiles
wacc, and not a wac compiler"* — pointed at the wider corpus, 81 of 296 entry points compile. So a
construct is usable by every package before it is usable by `packages/wacc`, and the gap is a
bootstrap generation wide. `packages/wacc/src/wvec.wac` is what that costs today, for a single
feature in a single library: it is `WVec<T>`, a second growable list, because `core/vec.wac`'s `fold`
takes a lambda *"and the rung below has no lambdas"*. One lambda, one duplicated container, and its
header says it goes *"when the reference stops being the bootstrap"* — which happened on 2026-08-28,
and it is still there.

**And vision's core is exactly what a compiler wants.** `wacc` hand-rolls its error handling — the
flat parallel arrays this exercise already looked at — and cannot import a `Vec`. `Result`, `try`,
`Ticket` and a growable container are the four things its source would use first, and they are four
of the things this proposal adds. Landing them does not give them to the compiler.

**Measured, because the cost of being last is countable.** In `packages/wacc/src`, with comments and
string literals stripped:

    15   hand-rolled container declarations
         ArmList CaseList DeclList ExprList FieldList I32List ImportItemList JsxAttrList
         MethodList NamedArgList ParamList StmtList TyList VariantList — and WVec
    57   `return -1` as an absence
    31   uses of WVec<T>

**Fourteen containers of one shape, and a generic one sitting beside them.** `wvec.wac` is
`WVec<T>`, in that directory, written for the wapy frontend — so the compiler both has a generic
growable list and has fourteen hand-specialised ones, because they predate it and because
`core/vec.wac` is still unimportable. And 57 sentinel returns is the `indexOf` question from earlier
in this file, at the one call site that cannot adopt the answer.

The circularity is worth naming plainly: **the rung that must learn a feature first is defined as
whatever the compiler needs, and the compiler is the last thing allowed to want it.** So the ladder
cannot lead. Every construct here is either something `wacc` will never use, or something with a
bootstrap-shaped cost nobody has priced.

Three shapes of answer, and the exercise has no view on which:

- **The compiler is exempt.** `packages/wacc` stays in a subset forever, `wvec.wac` is permanent
  rather than temporary, and the language grows for everything except the thing that implements it.
- **The ladder grows with the language**, which means every construct here has a cost measured in
  rungs — and the lowest rung is hand-written wasm assembly text.
- **The ladder stops being the bootstrap**, which is what `wvec.wac`'s header is waiting for and
  what `design/lang/0003` did to the reference. Then the question is what replaces it, and *that* is
  a decision this proposal touches directly.

## Every example on every page is written against a `Sys` that `vision/std` does not define

The projections — `Sys` split into `Files`, `Net`, `Proc`, `Env`, `Out`, `Clock`, `Random` — were
invented during the packages exercise, argued from a count of the host's fifty capabilities and from
`box`'s applets, and written into `vision/std/platform.wac`. That struct has **seven fields and no
flat methods**: no `readFile`, no `log`, no `listen`.

Every vetted page still writes the flat form. Counted over the ```wac fences:

    SHOWCASE.md    7   sys.listen(8080), sys.readFile("a.txt"), sys.log(…), sys.spawn(…)
    TECHNICAL.md   6   sys.readFile, sys.log, sys.warn
    IDIOMS.md      3   sys.readFile, sys.log
    QUESTIONS.md   1   sys.spawn
    ─────────────────
                  17   flat call sites on the agreed pages

    vision/packages/server/src/main.wac   3   sys.net.listen, sys.out.log

**So `sys.readFile("a.txt")` on the front page does not typecheck against the `Sys` in
`vision/std`.** Seventeen examples against one file, and the one file is the one that claims to
define the type.

Nothing noticed because the two halves are never read together: the pages are agreed one entry at a
time with the operator, `vision/std` was written alone in bulk, and `packages/README.md`'s own rule
says the traffic is one-way — *"an entry on the pages may be cited here; nothing here is evidence for
anything there."* That rule was written to stop unvetted spellings leaking upward. It also means an
invention downstream can contradict the pages indefinitely and the direction of the rule is exactly
why nobody looked.

The decision is not which is right. It is:

- **Adopt the projections on the pages** — 17 examples get one more word each, and the front page's
  first line becomes `sys.net.listen(8080)`. The cost is that every example advertising *authority is
  a value* gets longer at exactly the point it is making that argument.
- **Keep `Sys` flat and make the projections optional views** — `sys.files` exists and `sys.readFile`
  still works, which is a wider `Sys` rather than a narrower one, and gives up the structural
  guarantee that a function handed `Out` cannot open a socket.
- **Withdraw them.** They have one real consumer, `vision/packages/fs`, which found them worth
  exactly one line — `Mount.onHost(Files)` where the shipped equivalent takes a `Cli` that can open a
  socket.

The second is the one that reads as a compromise and is not: the whole argument for the split is that
`echo(sys.out, args)` **cannot** open a socket, and a `Sys` that still has `listen` on it hands the
guarantee back the moment anyone passes `sys`.

## Ten constructs the vetted pages have and the grammar did not

The entry below found three additions in `GRAMMAR.ebnf` that no agreed page mentions, and said the
grammar was *"a closed list of what vision adds — that is what made it worth writing"*. **That was
wrong in the other direction and I did not check it.** The grammar was derived from
`vision/packages/**`, the disposable rewrites, so it was a closed list of what *those* use.

Extracting the 64 ```wac fences from `SHOWCASE.md`, `IDIOMS.md`, `TECHNICAL.md` and `QUESTIONS.md`
and parsing them found ten constructs on the agreed pages that no rewrite had ever written —
`vision/GRAMMAR.md` has the table. Two are worth naming here:

**`auto`** is on three of the vetted tiers, and this file already had an entry about *"`auto`
refusing to widen"*. Its semantics were under discussion while its syntax was in no list of the
syntax.

**A bare `await`** appears five times, and the operator asked for it directly while `Sys.drain` was
being worked out — *"I think the ready case needs a bare await."*

Both directions are the same failure and it is not about either list being careless. **A construct
travels with whoever needed it**: one that arrived by being wanted while writing an example stays on
the page, one that arrived by a tool refusing something stays in the generated file, and nothing
carries either across. The grammar and the pages had been describing two different languages for a
week and everything looked consistent, because nothing had ever compared them.

## A declaration with no initialiser — five uses, refused today, and not obviously proposed

`Ticket<i32> t;`, `Slot s;`, `Vec<Continuation> outer;` in `TECHNICAL.md`, and `i32 n;` is
`found ';'` in today's compiler. wac has default values and not defaulted declarations.

Left out of `GRAMMAR.ebnf` on purpose, because it is either an eleventh addition nobody wrote down or
five examples that elided an initialiser for brevity. `Ticket<i32> t;  // nothing will ever resolve
it` reads as literal. **The pages cannot tell you which**, and only a reader that runs them can even
ask.

## `coroutine f()` and `f()` disagree about when the body starts

`vision/core/coroutine.wac` says the operator *"lowers any of the three spellings to one of these"* —
one machine, three ways to write the function. `TECHNICAL.md`'s example pins what `coroutine` does,
and it does it well:

```wac
Slot s;
Coroutine<TicketBase, never, void> c = coroutine s.tick();

s.n;               // 0      ← nothing has run
c.step();          // Waiting
s.n;               // 1
```

**Nothing runs at creation.** Now the shipped behaviour of the other spelling, measured:

```wac
async void bump(Core core, Cell c) { c.n = c.n + 1; await core.monotonicNanos(); c.n = c.n + 10; }
…
Pending<void> p = bump(core, c);
// after the call, before any drain: n = 1
// after drain:                      n = 11
```

**Calling an `async` function runs the body eagerly to the first `await`.** So the two ways of
obtaining the machine differ observably at the moment you obtain it, and the sentence claiming they
are one lowering is the thing that has to give.

It may well be that they *should* differ — a machine you intend to step by hand is exactly the case
where you want to choose when it starts, and a `Ticket` you intend to `await` is the case where you
want the work begun. That is a good answer and it is not the one written down; what is written down
is that there is one machine and three spellings.

Two things follow if they do differ:

- **Converting between them changes behaviour.** `await f()` has already run the body's prefix;
  `coroutine f()` then stepping has not. A refactor from one to the other is not neutral, and nothing
  warns.
- **Argument evaluation needs its own sentence.** `coroutine f(g())` — is `g()` called at creation or
  at the first step? Every language with this shape answers *eagerly*, including the `s` in
  `coroutine s.tick()`, and the example is consistent with that without testing it.

**And `TECHNICAL.md`'s examples are doing the work of a specification here**, for the third time —
`never`, the bare `await`, and now this. That is an argument for reading them as one, which is what
parsing the fences turned them into.

## `never` is a type with non-trivial semantics, asserted in one doc comment

`vision/core/coroutine.wac` line 12:

> A slot typed `never` removes its arm: `Step<never, i32, void>` is `Yielded | Done`, and a match
> over it is exhaustive with two arms rather than three-with-a-dead-one.

That is the whole of what anything says about `never`. It is used four times in `TECHNICAL.md`'s
examples and twice in `core`, it is **declared nowhere**, it is not in `GRAMMAR.ebnf`'s type rule —
it parses only because an unknown word is an `IDENT` and `IDENT , [ type_args ]` is a type — and no
page argues for it. The coroutine design rests on it: `Generator<Y, R>` *is* `Coroutine<never, Y, R>`.

**It is not a name, it is a feature.** Three parts, none of them written down:

**An uninhabited type.** wac has nothing like it. `void` is the near neighbour and `0014` D5 makes
`void` usable as a type argument, which is a different thing: a `Ticket<void>` settles and carries
nothing, where a `Waiting(never)` can never be constructed at all.

**Exhaustiveness that consults the instantiation.** `spec/spec/enums.md` grounds exhaustiveness in
the declaration — *"the compiler knows the complete variant set from the declaration, so a missing
arm is a static fact"* — and this makes it depend on the type arguments. There is a natural home for
it, and it is worth saying so rather than treating this as fatal: `generics.md` already checks a
template **twice**, once with the parameters opaque and once per instantiation, so the
per-instantiation pass is where an arm becomes dead.

But the two passes then disagree about the same `match`. With `W` opaque the body needs three arms;
at `Step<never, …>` two suffice. That is coherent only if a dead arm stays *legal* — which the
sentence above implies and does not say. If three arms are refused at the instantiation, a generic
body cannot be written at all.

**A ninth contextual word.** `never` was missing from the keyword-cost table in this file. Measured:
**1,882 grep hits and 12 in code**, in 8 files, two of them genuine variable names —
`Pending<i64> never = core.sleepMillis(10000);` in `platform`'s wacland example and `i32 never` in a
raster test. So it is cheap to take, and the 99.4% prose rate is the most extreme in the table by a
distance, which is what happens when a reserved word is also an ordinary English one.

## One capability says *end* with a sum and another with a sentinel

`vision/std` has both shapes, twelve lines apart:

    Socket.recv   fn<Ticket<Read>()>       Read = Data(u8[]) | End | Failed(string)
    In.read       fn<Ticket<u8[]>()>       end is an empty array

`@/packages/box/src/cat.wac` is the first code written against `In` and is where it bites: a read of
zero bytes is *end* for a file and *not yet* for a pipe, and its pump cannot tell them apart. The
shipped `readStdin` is `fn[Pending<u8[]>()]` and has the same hole, so `In` copied a shape rather
than inventing a bad one — but the better answer was already in the file, which is the part worth
recording. `Socket` was written from a design and `In` was added to fill a gap the projections audit
found.

**What stops it being a one-line fix** is `Read.Failed(string why)`. Every other failure in
`vision/std` is a `NotGranted`, and `Read` carries a string — so making `In.read` answer a `Read`
imports a second convention for what a failure says. That is the same question as *where a fault's
message lives*, which `http`'s README raised and nothing has settled: a member with a `string` payload
is a fault that has given up on being matched.

So: does `Read` become `Data(Bytes) | End | Failed(NotGranted)`, and does `Socket.recv` change with
it? That is one decision covering both capabilities, and it is smaller than it looks because `Read`
has exactly two users.

## Three type names are declared twice, and `union` is the reason it matters

107 type names across `vision/`, three declared in more than one file:

    BadMethod    gzip/src/fault.wac  (i32 cm — a DEFLATE compression method)
                 http/src/fault.wac  (empty — an HTTP verb)
    Truncated    gzip/src/fault.wac  (string field)
                 unicode/src/utf8.wac  (empty)
    Fault        fs/src/fault.wac    union<NotGranted, NotFound, Denied, …>
                 gzip/src/fault.wac  union<SourceFailed, Corrupt>

Nominal typing makes these distinct types, and imports are per-file, so nothing is *broken*. What is
awkward is that the whole point of `union` here is composition — `http`'s `ResponseFault` is
`union<RequestFault, BadStatus>`, an error set built over another module's.

**A program that reads a gzipped file over HTTP has three `Fault`s and two `BadMethod`s in scope**,
and measured rather than reasoned, there is no spelling for it today:

    import { Truncated as ATrunc }  then  case ATrunc:      "no variant of that name"
    case A.Truncated:                                        expected ':', found '.'
    building a file with two same-named variants in scope    "cannot emit — the name Truncated,
                                                              which more than one file declares"

So an alias does not reach a match arm — an arm resolves by the variant's *own* name — and `case`
does not take the qualified form that `is` does. The program is refused at emit rather than
mis-compiled, which is the right outcome and leaves the composition unwritable.

That measurement also turned up a diagnostic bug worth more than this entry:
`issues/lang/open/0328a`. Adding an unrelated import makes `x is A.Truncated` warn *"these types
share no ancestor, so the test is always false"* — the qualification is dropped, the checker resolves
`Truncated` from file scope, and the message tells you to delete a correct test. `emit` names the
ambiguity properly one stage later.

So the convention this exercise fell into — **each package names its union `Fault`** — is exactly
wrong for the feature the unions exist for, and it took nineteen packages to notice because no two of
them have ever been imported together.

Three ways out, and the middle one is what most languages do without saying so:

- **Name unions after their subject**: `FsFault`, `InflateFault`, `RequestFault`. `http` already does
  this and is the only one that does, which is suggestive.
- **Let a match arm be qualified** — `case A.Truncated:` — which is the one that scales, which
  nothing in `vision/` has asked for, and which `is` already accepts. The asymmetry between the two
  constructs is measured in `0328a` and is nobody's stated decision.
- **Say error member types are global by convention** and make packages pick distinct names, which is
  a rule nobody can enforce and which fails the first time two packages both have a `NotFound`.

The second is the only one that survives a tree this size, and it is not on any page.

## Which byte type a capability speaks, now that the widening is one-directional

The funcref rewrite made every capability's signature explicit, and the first thing that showed is
that `vision/std` and `vision/packages/fs` disagreed at their seam. `Files.read` answered
`Ticket<Result<u8[], NotGranted>>`; `Mount.read` is `Ticket<Result<Bytes, Fault>>`; and
`Mount.onHost` assigns one into the other. Under methods nobody compared the declared types.

**`u8[]` → `Bytes` is free and the other direction is not.** `core/slice.wac`: *"A `T[]` widens to a
`Slice<T>` implicitly … safe, unchecked, and one direction only."* So `Mount.write(Bytes)` could not
take `Files.write(u8[])` without `toArray()`, which is the copy the slice type exists to avoid. Two
byte types and a one-way conversion means **every interface picks a side, and two that pick
differently cannot be composed without paying.**

`Files` speaks `Bytes` now. The rest of `vision/std` still says `u8[]` — `Out.write`, `In.read`,
`Random.fill`, `Socket.send`, `Read.Data` — and that is a decision rather than a sweep:

- **`Bytes` everywhere** is consistent and costs a view per call at a boundary that is often
  per-line. `../bench/slicecost.wac` puts that at 2.6 ns, which is nothing against I/O and not
  nothing against `Out.write` in a loop.
- **`u8[]` everywhere** makes the capability surface the *owning* type and pushes the view to the
  parsers, which is where `slice.wac`'s argument for it actually lives.
- **Mixed, deliberately**, with a stated rule — for instance, *a capability that hands bytes over
  answers `Bytes`, one that is handed bytes takes `u8[]`* — which is the direction the widening
  already permits and would have made this seam typecheck by construction.

The third is the only one that treats the one-directional rule as information rather than as an
obstacle, which is a point in its favour.

## Two constructs the grammar has and no vetted page mentions (it was three)

`GRAMMAR.ebnf` is a list of what vision adds — see the entry above for how incomplete it was in the
other direction — so it can be checked against the pages that are *agreed* rather than generated. Every addition was looked for
in `README.md`, `SHOWCASE.md`, `IDIOMS.md`, `TECHNICAL.md` and `DECISIONS.md`. Three appear in none
of them:

**A generic parent.** `struct AllOf<T> : Ticket<T[]>`, which today's parser refuses with
`expected '{', found '<'`. `GRAMMAR.md` calls it load-bearing and means it: `AllOf`, `AnyOf`,
`Generator`, `AsyncGenerator` and `SysTicket` all need it, so the whole ticket and coroutine design
does not parse without it. It is the largest thing in the proposal that has never been written down
anywhere a reader would look — found by desugaring, banked, and never argued.

**A method with no body — withdrawn 2026-09-04.** It had seventeen uses and now has none. Every one
was an abstract method with subclasses overriding it, and dispatch in wac is static, so none of the
overrides ran; the projections, tickets, coroutines, `Socket`, `Listener` and `Child` are structs of
funcrefs now. The argument for it was real — an abstract method catches a subclass that never
overrides, where a trapping body only traps if the path is taken — and it is an argument about a
design vision no longer uses. Removing it from `GRAMMAR.ebnf` took the delta from 628 BNF
productions to 564, and all fifty vision files still parse.

**`trap` as an expression.** `core/result.wac`'s `orTrap` writes `Err(_): trap why,` — a match arm is
an expression and that arm produces nothing, which is what a bottom type is for. Small, and the
smallest of the three is still a change to what an expression is.

**The pattern is the finding, not the three.** All three were discovered by *tooling* —
`visiongrammar.sh` reporting a refusal, or the desugarer, or writing the grammar down — and a
construct that arrives that way lands in `GRAMMAR.md`, which is generated and which `README.md`
describes as the odd one out. Nothing carries it from there to a page the operator reviews. Every
construct that arrived by being *wanted* while writing an example is on a page; every construct that
arrived by being *refused* is not.

That is a gap in the process rather than in the language, and it is why this list is here rather than
three separate entries: the question to answer first is whether a generated file is allowed to hold
an argument nobody has agreed to.

**The same check the other way round comes back clean, which is worth saying.** Every construct in
`GRAMMAR.ebnf` is used by at least one vision file — nothing has been proposed and then not written
with. Three are used exactly once: `schedule`, in `Sys.drain`; `trap` as an expression, in
`Result.orTrap`; and `secret`, whose two uses are both inside the file that proposes it. A single
consumer is not an argument against a primitive — `schedule` is one, and `TECHNICAL.md` argues it at
length — but it does mean the generality is unevidenced, and `secret` is the one where that matters,
since its whole case is that the taint *propagates* and nothing outside `crypto` has ever received a
propagated one.

(The first pass of that count said `secret` had **none**, because the pattern it matched wanted
`secret <word> <word>` and the real spelling is `secret u8[] key`. Checked before it was believed,
which is the only reason it is not in the paragraph above as a fourth finding.)

## What `defer` means, which no page says and four uses already depend on

This entry asked which *example* should capture `defer`. Reading the four places the rewrites use it,
the prior question is what it does: the only statement anywhere is the clause below — *"`defer` runs
when the block exits"* — and every one of the four turns on something that clause does not settle.

**Does it run when the block is left by a trap?** `core/ticket.wac`:

```wac
if (this.inWait) { return Result.Err(Circular()); }
this.inWait = true;
defer { this.inWait = false; }
```

`wait` can trap — `0014` D7 makes a chain that cannot advance an error — and if a trap skips the
`defer` then `inWait` stays true forever and every later `wait` on that ticket answers `Circular`.
The flag would be *permanently* wrong, in `core`, from one trap. Written as it is, this code assumes
`defer` runs on the way out however the way out happens; nothing says it does.

**Does it run when a generator is abandoned?** `vision/packages/gzip`'s README says a caller that
stops iterating stops the machine, and `server`'s `handle` is
`defer { conn.close(); }` around a loop that four paths leave. If a coroutine can be dropped while
suspended — which is the whole of *a consumer that stops iterating* — then either its `defer`s run
at the drop, or a `server` that stops reading leaks the socket the `defer` exists to close. This is
the hardest of the four and the one with a security-shaped answer.

**When does the body read its captures?** `json/parse.wac` writes `defer { this.depth -= 1; }` at the
top of a function that mutates `this.depth` below it. Obvious that it reads at exit; worth stating,
because the alternative — capturing at the `defer` — is what a value-capturing closure would do and
`spec/cases/0191` says lambdas capture by reference.

**And order, for two in one block.** Reverse, presumably, and nothing in the tree has two yet, which
is exactly when to write it down.

**Then the original question.** `sys.atEnd` wants an example beside it, since the pair is the whole
cleanup story — `defer` when the block exits, `atEnd` when the domain does, and cleanup that must
happen belongs to a system rather than to a block. That pairing is only meaningful once the first
four are answered: an `atEnd` that runs on a trap and a `defer` that does not is a distinction; two
that behave the same way is one mechanism with two names.

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

## Whether `indexOf` answers `i32?`, which is where *absence is a type* actually lands

The principle's largest concrete consequence in this repository, measured rather than argued.

`vision/packages/http/src/bytes.wac` already made the choice for one function — `findCrlf` answers
`i32?` instead of `-1` — and doing it for `string.indexOf` is the same change at a different scale:

- **734** `indexOf` call sites across `packages/`, `core/`, `std/` and `tools/`
- **355** of them compare the result against `-1` or `0`, so they are testing the sentinel explicitly
- and the miss is a **tagged** spec claim: `[§wac-str-indexof-miss-k4mf8js]`,
  *"`\"hello\".indexOf(\"xyz\")` returns `-1`"*

It is also the dominant shape of the sentinel idiom generally: **515 negative-sentinel returns in 166
files**, and eight of eight sampled were an index or a position with `-1` for *absent*, not one a
comparator.

**And it allocates, which this entry did not say and the spec already had.**
`[§wac-nullable-primitive-4mzq7vp]`: *"It is boxed. No wasm numeric type has a null, so a nullable
primitive is stored as a reference to a one-field struct the compiler synthesises … So `i32?` costs
an allocation per non-null value."* Measured in [`bench/nullablecost.wac`](bench/nullablecost.wac):

    calls 4194304, best of 3, milliseconds
                 hit     miss
    sentinel      77      145
    nullable      83      146
    again         78

**1.4 ns a box, and 0 ns when the answer is `null`.** The asymmetry is the part worth having,
because it is the opposite way round from the intuition: a search that *finds* something pays, a
search that misses does not. So the change puts one allocation on the common path of the most-called
function in the string API. Eight percent of a short hit is small — but it is a per-call allocation
across 734 sites, and *absence is a type* is exactly the principle that would have argued the
opposite, that a sentinel is the thing with a hidden cost.

The entry was written from the call-site count alone and the representation was a tagged claim in
`spec/spec/types.md` the whole time, which is the failure mode `packages/README.md` names: a design
written beside a tested specification and not against it.

**And it compounds with the narrowing gap above.** Without narrowing, each of those 355 sites goes
from `if (p < 0)` to a null test *and* an unwrap at every use. With narrowing it is a test and a
name. So the two decisions are one decision taken twice, and taking *absence is a type* first is the
expensive order.

## Narrowing a nullable — filed as `issues/lang/0321a`

Filed as *matching in a `while` or `for` condition*, on the strength of
`while (Continuation c = q.pop())`. The loop was never the problem: `for_init` may declare, so
`for (N? c = next(0); c is not null; c = next(c!.v + 1)) { … }` compiles today.

What does not exist is narrowing a nullable — after `c is not null`, `c` is still `N?`, in a loop and
in an `if` alike. **And `issues/lang/closed/0029` already says why**, in its resolution: narrowing
works by *"a `const` shadowing binding"* of the type that was named, and *"what does not narrow, all
documented: `is not`, a field or index on the left, and any other condition shape."*

So it is not type-versus-null and not an oversight. `if (s is Circle)` narrows by **substituting**
the type that was named; `if (c is not null)` names the type being **excluded**, and the mechanism
has no subtraction. For nullables the subtraction is trivial — `T?` minus null is `T` — which makes
this a small special case rather than the flow analysis a since-deleted paragraph in `enums.md`
claimed it needed.

**The cost of adding it is a migration, and `0029` is the precedent for exactly that.** Its own
resolution names the shape: *"a feature that removes the need for a workaround will break code using
the workaround, and the docs are code too."* Unwrapping a non-nullable is an error — measured — so
every `if (c is not null) { … c! … }` becomes a redundant unwrap the day narrowing lands. The tree
has **1,445 null tests and 1,730 unwraps**. `0029` got away with it because `rg` found no uses of
the idiom it broke; this one would not.

That is the decision: a small special case in the checker, against a sweep of the same order as the
tree's entire unwrap count. And it gates removing `Option` cleanly, since `Option` narrows and `T?`
does not.

**Filed as `issues/lang/open/0321a`**, because it is a language change with a measured cost rather
than a vision question — it would be worth making whether or not any of the rest of this happens,
and the tree feels its absence today at 1,730 unwraps. Kept here as well because two vision
decisions sit downstream of it, which the issue records and this file is where they live.

## How should a `Vec` drop its reference to a popped element?

**Not a vision question — `core/vec.wac` ships with it and says so at the line:**

> The slot keeps its reference: there is no value to overwrite it with, so a popped element stays
> reachable from the backing array until something else is pushed over it. It matters only if T is
> large and the Vec is long-lived.

So the language has no answer and the standard container documents the absence. Nothing the body can
write clears it: a `T[]` at a non-defaultable `T` has no null to store, and `Point[10]()` builds ten
distinct `Point()`s rather than ten absences. `Sys.drain`'s queue has the same hole.

**The shipped comment understates it, which is the one thing worth adding.** *"Only if T is large"*
measures the element; retention follows **reachability**. A `T` that is a single pointer holds
everything it points at — one popped root can retain a whole graph, and `http`'s `Request` is
exactly that shape now that its fields are views into a connection buffer.

Three ways out, none free. Hold `T?[]`, which costs nothing for a reference `T` — a `ref null` array
is the same array — and boxes every element of a `Vec<i32>`, since `spec/spec/types.md` makes a
nullable primitive a reference to a synthesised one-field struct. Add an array operation meaning
*put this slot back to nothing*, doing nothing where the element type has no null: free everywhere,
and it needs the generic body to say it without knowing which case it is in. Or leave it, which is
what shipped.

## Whether there is optional chaining

`?` nests, so `x?.field` on a nullable field would answer `T??` where every language that has the
operator answers `T?`. That is the one place flattening earns its keep, and wac has neither `?.` nor
`??` today — so the question is whether adding one means giving it an explicit flatten, or not
adding it.

## Naming a union, and whether a union may contain one

`vision/packages/http` is unwritable without both. It declares
`export union<BadMethod, BadTarget, …> RequestFault;` because the alternative is repeating ten
members at every signature, and then `export union<RequestFault, BadStatus> ResponseFault;` because
the whole point is that the response parser says what it *adds*. The second relies on the first's
members flattening into it, which set semantics imply and nothing states.

`union<…>` appears all over the pages as a type expression and never with a name. Whether the name
is a distinct type or an alias decides the related question about a union as a match arm — which
this package also wants, for the one place that turns a fault into a message.

**And there is a third part nobody has written down: how one dispatches.** An enum has a tag, and
`spec/spec/enums.md`'s *How it compiles* says what that buys — *"`match` compiles to a comparison
chain on the tag, then one downcast in the selected arm"*, and, of the alternative, *"the
alternative is a `ref.test` per arm, and an integer comparison is cheaper than a type test."* A union
has no tag by construction: its members are unrelated structs that were not declared together, which
is the whole reason `union<RequestFault, BadStatus>` can compose and an enum cannot. So the spec has
already priced the mechanism a union needs, and priced it as the more expensive one.

Two things follow that the naming question does not reach. **The cost is real and small** — the same
file measures a 20-variant tag chain at 2.5 ns and a payload-less construction at 0.9 ns over an
integer, issues 0030 and 0031 — so this is a few nanoseconds an arm, not a reason to choose. **And
the tag is load-bearing for something else**: the spec says it *"is also why exhaustiveness is
checkable at all"*, which for a union is still true by a different route, since the members are
listed at the declaration — but it is true for a different reason, and that reason is what a
`union` as a match arm would have to rest on.

## A funcref slot for an async function is three constructors deep

`vision/packages/fs/src/mount.wac` holds six operations as funcref fields, and the type of one is

    fn<Ticket<Result<Bytes, Fault>>(string)> read;

to say *reads a path, may fail*. Correct, checkable, and unreadable — and six of them in one struct.

The spelling that reads correctly is `fn<async Result<Bytes, Fault>(string)>`, which is what I wrote
first and which means something else: `async` is a property of a **definition**, and
`[§wac-async-lambda-slot-9wq4nkz]` says the slot names the ticket — *"a lambda writes no return type,
so `fn[Pending<R>(…)]` is what permits `async` and names `R`"*. The claim is right and the ergonomics
are the complaint.

Three things it could be, and the middle one is doing the most work with the least argument behind
it:

- **Leave it.** The nesting is honest: three constructors because three things are true. A reader who
  knows the language reads it fine, and every abbreviation below hides one of the three.
- **`async` in a funcref type, as sugar.** `fn<async R(…)>` desugars to `fn<Ticket<R>(…)>` and reads
  the way the definition does. It puts a keyword in a type where it is not one, which is exactly the
  confusion that produced the wrong version — but sugar for a confusion people already have is not
  obviously the wrong move.
- **A shorter name for the pair.** Most of the depth is `Ticket<Result<T, E>>`, which is *"eventually,
  and it may fail"* — the ordinary shape of a capability call. If that pair is common enough to
  deserve a name it should have one, and if it is not then the nesting is rare enough not to matter.

**Counted, and it is common.** There are **427** `Pending<X>` in the tree's code — 738 by grep, so
42% of the hits are prose, which is the usual gap. Of the 427, **125 wrap something that is already a
failure**:

    Change        36    i32 fault, string message, bool ok()
    Read          45    an enum with a Failed arm
    Exec          33    error non-empty means it never ran
    FileResult    11    bool ok, u8[] bytes, string error, i32 fault
    ─────────────────
                 125    29% of every ticket in the tree

Plus 33 `Pending<bool>`, most of which are *did it work* and would become `Result<void, E>` rather
than staying a bool.

So the pair is not a corner: **three in ten of the tree's tickets are it**, and that is before the
`bool ok` structs in `packages/tor` and the ten `FAULT_` integers in `packages/fs` become `Result`s
too. A shape that appears in a third of a construct's uses has earned a name, and the argument moves
from *should this be shorter* to *what should the short thing be called*.

That does not by itself settle the other two bullets — sugar in a funcref type is still a separate
question from a name for the pair — but it removes the option of leaving it alone on the grounds
that it is rare.

## The one breaking change, and no page says why it is worth 444 sites

`fn[T(…)]` → `fn<T(…)>` is the **only** thing in the whole proposal that takes something away.
Measured: 444 sites in 80 files, and 47 of `spec/cases`'s 323 programs stop parsing — every one of
them for that reason and no other. `GRAMMAR.md` has the method.

**And no page argues for it.** It appears once, in a list of constructs, as *"`fn<void()>` as a
type — replacing today's `fn[void()]`"*. Nothing states the benefit. The plausible one is
consistency: every other type that takes parameters writes them in angles — `Vec<T>`, `Ticket<T>`,
`Result<T, E>` — and a funcref in brackets is the odd one out, with `[` otherwise meaning an array
or an index.

Against it, one thing that is not a matter of taste and was found by building a reader rather than
by arguing. **`fn<` is the one place an angle bracket follows a keyword**, and a scanner deciding
whether `<` opens a type argument list or something else has an identifier before it everywhere
else. `tools/specparse.ts` read `fn<void()> call;` as a JSX element opening `<void…` and every
vision file using the shape stopped parsing; the fix is one entry in a list, and it is a list that
would not have needed the entry. `fn[` has no such problem — a bracket after `fn` is unambiguous.

So the trade is: a consistency nobody has written down, against 444 sites, 47 cases, and one more
special case in the lexer. **It is the only decision here where the cost is exact and the benefit is
unstated**, which is a reason to state the benefit rather than to withdraw the change — but it
should be stated before it is taken.

## A type alias cannot take parameters, so three types are written as inheritance

`typedef` is `[ "export" ] , type , IDENT , ";"` — `export Slice<u8> Bytes;` — and takes no type
parameters. So a name for a *partially applied* type has nowhere to go, and
`vision/core/coroutine.wac` writes three of them as inheritance instead:

```wac
export struct Generator<Y, R> : Coroutine<never, Y, R> { }
export struct AsyncGenerator<Y, R> : Coroutine<TicketBase, Y, R> { … }
```

`Generator` is an empty struct whose whole content is its parent. That is an alias spelled as a
subtype, and it costs the thing aliases are for: `Generator<i32, void>` and
`Coroutine<never, i32, void>` are two *types* under nominal typing, so a function taking one does not
take the other.

It also props up **a generic parent**, one of the three constructs the grammar has and no vetted page
mentions. Removing `AllOf` and `AnyOf` from `ticket.wac` took two of its five uses; these three are
the rest, and they are not asking for inheritance.

So the question is whether `typedef` should read

    export Coroutine<never, Y, R> Generator<Y, R>;

which is one more form of the same declaration and makes the generic parent a construct with two
real uses left rather than five — or whether a parameterised alias is a different feature with its
own rules about where the parameters may appear.

## Naming a type takes the only shape a top-level variable could have

Writing the vision additions as productions forced a spelling for
`export union<A, B> Fault;` and `export Slice<u8> Bytes;`, and the rule is

    typedef = [ "export" ] , type , IDENT , ";" ;

which is *a type, a name, a semicolon* — indistinguishable from a field declaration, and from a
variable declaration with no initialiser. It works only because wac has no top-level variables, so
nothing else at that position has that shape.

Two consequences nobody had written down.

**A typo is a declaration.** `i32 x;` at the top of a file is not an error under this rule; it
declares a type named `x` that is another name for `i32`. Today it is *"expected `=`"* — a
module-level `const` must be initialised — so the language currently catches a line that vision
would accept and quietly give a meaning to.

**And it spends the shape.** If wac ever wants an uninitialised module-level binding, or a `let`, the
obvious spelling is taken. That is a real cost of choosing the terse form and it is not obviously
worth paying: `type Bytes = Slice<u8>;` collides with nothing, costs one word, and says which of the
two names is being introduced — which the terse form leaves to the reader knowing that `Slice<u8>`
is a type and `Bytes` is not yet one.

The argument for the terse form was that it is *one* form whether the type is a union or an
instantiation. A `type` keyword is also one form for both. So the choice is between a word and a
shape, and the shape is the scarcer resource.

## A fault that is safe to log and unsafe to return

`vision/packages/tor` is the first package here where refusing with a reason is a *security*
decision rather than an ergonomic one. A relay that answers "your EXTEND2 failed check seven of
eleven" has told a prober which check it failed; the same sentence in the relay's own log is exactly
what an operator needs to debug an interop failure against C tor.

So the fault wants two dispositions and `Result` gives it one. `Err(Invalid)` is a value the caller
receives, and there is nothing in the type that says this one may be written down and not sent back.

Three shapes, none of them obviously right:

- **A convention.** The caller decides, and the type says nothing. Cheapest, and it is what every
  language does, and it is how a reason ends up in a wire response by accident.
- **Two error sets.** A function answers `Result<T, union<Public, Private>>` and the boundary that
  serialises may only see the first. That is a real distinction the compiler could hold, and it
  doubles the width of every signature that carries either.
- **`secret` again.** `crypto/src/secret.wac` proposes a qualifier that propagates like `const`, and
  *"a laundered `secret` is a key in a log line"* is the same sentence with the direction reversed —
  here what must not escape is a fault rather than a key, and the machinery is the same flag on a
  name. Worth noticing that the two proposals want opposite defaults: a secret must not reach a log,
  a private fault must reach only a log.

Nothing in `vision/` discusses this, and the packages that would need it — `tor`, `ssh`, `tls` — are
the three largest after the compiler.

## Spelling `Ok` when the value is `void`

`Result<void, E>` depends on `design/lang/0014` D5, *"`void` becomes usable as a type argument"*,
which is settled. What is not settled is how a body says it succeeded.

`gzip`'s rewrite writes `return Ok;` — a variant constructor with no argument list, where `Ok` is
declared `Ok(T value)` and `T` is `void`. The alternatives are `Ok()`, which reads as a call
returning nothing rather than a variant carrying nothing, and `Ok(void)`, which names the type where
a value goes. All three are ugly and one of them has to be chosen the first time somebody writes a
fallible function that answers nothing — which is most of them.

## Whether vision's new words are keywords, which nobody had asked

`try`, `gen`, `defer`, `schedule`, `yield`, `in`, `union` and `secret` are written all over these
pages and no entry says what they *are*. `vision/GRAMMAR.ebnf` had to decide in order to exist, and
it decided **contextual** — none of them is a keyword, each is an `IDENT` that a rule matches by
spelling. All forty-four vision files parse that way, so the question is not *can they be*.

The question is what it costs either way, and it is not symmetrical.

**Contextual is free at the parser and not free at the reader.** `spec/spec/grammar.md` already has
two contextual words — `from` and `fill` — and its comment on `from` is the whole argument in one
line: *"contextual: an ordinary identifier elsewhere"*. So the machinery exists and vision adds
nothing to it. But eight of them is a different thing from two: a program can declare a variable
called `union`, and then a rule that expects the word and a reader who expects the name are looking
at the same token.

**A keyword is a sweep.** `packages/gzip` has a method named `fill`; `match` is already a keyword and
that is why `vision/packages/regex` had a payload named `match` that does not compile. Every word
promoted takes a name away from every program in the tree, and `speckeywords_test.wac` exists
because the fence *"has drifted from the implementation three times"* — a keyword is a thing with a
guard around it, which is the honest measure of its cost.

So the measurement is a count per word of how many names in the tree already use it, over `.wac`
with comments and string literals stripped:

| word | uses | files | |
|---|---:|---:|---|
| `try` | 0 | 0 | free |
| `defer` | 0 | 0 | free |
| `schedule` | 0 | 0 | free |
| `yield` | 0 | 0 | free |
| `never` | 12 | 8 | `Pending<i64> never = …` in an example, `i32 never` in a test — and **1,882 by grep**, the widest gap in the table |
| `union` | 6 | 1 | four locals in `bindgen.wac`, all called `union` and all strings |
| `gen` | 38 | 8 | `Exec gen = cli.exec(…)`, mostly in tls tests |
| `in` | 188 | 55 | `export Line nextLine(Lines s, Feed in)` — a parameter name |
| `secret` | 182 | 31 | `u8[] secret = handshakeTrafficSecret(…)` — quic, tls, crypto |

**Four of the nine cost nothing at all**, which was not the expected answer and is the useful half:
`try`, `defer`, `schedule` and `yield` appear nowhere as names, so the choice for them is free and
should be made on how they should read rather than on what they break.

**And the guess about which two were expensive was wrong.** `union` looked costly and is four locals
in one file. `secret` did not come up at all and is the worst of the eight after `in` — 182 names,
in `quic`, `tls` and `crypto`, which are exactly the packages the `secret` qualifier is *for*. A
keyword that breaks its own consumer is a different kind of finding from a keyword that is merely
expensive, and it is an argument for that one staying contextual whatever the others do.

`in` is 188 names in 55 files and there is no way to make it cheap. `for … in` is on `SHOWCASE.md`,
so it is not mine to withdraw — but the cost of the *word* belongs beside it.

(Counted by stripping comments and string literals and matching whole words, so a little noise
survives in files that build source text as strings. The shape is not close enough to the margin for
that to matter.)

## What `try` inside a generator does, and what the loop consuming it sees

`vision/packages/gzip/src/inflate.wac` is `async gen<Bytes> Result<void, Fault>` and its body writes
`try await br.byte()` eleven times. So the failure has two levels to cross: `try` inside the machine
has to end the machine and become its **return**, and the consuming `try await for` then propagates
that in turn. Two `try`s at two levels for one failure.

That has to be roughly what happens and nothing says it. The coroutine entries are about `yield` and
the ticket; `try`'s rule is about a function's error set. **A generator is the one thing with a yield
type and a return type at once**, and the interaction between them is where every consumer of this
design ends up.

Three parts of it are separately open. Whether a `try` that fires mid-body leaves the generator
*done* or merely stopped. Whether `try await for` binds the return at all, or whether a caller has to
ask the generator for it after the loop — `gzip` depends on the first, because it emits its tail
before checking the checksum and that is only defensible if the loop cannot finish without meeting
the fault. And whether a generator's declared error set has to be a subset of its consumer's, which
is `try`'s membership rule one level out.

## Whether `drain` can terminate while the accept loop is one of the things it is draining

`vision/packages/server`'s `main` accepts in a loop and calls `handle(sys, conn)` without awaiting,
then `await sys.drain()` before returning. `drain` loops until its queue is empty, so it stops only
once accepting has stopped — and the accept loop suspends on the listener, which puts *it* in the
queue too. A connection arriving during the drain is scheduled onto a queue being emptied. Whether
that is fine, or a program that never exits, is not decidable from anything written down.

## Re-export and package entry points — taken, in the barrels

The cost is measured: `itoa64` and `utoa64` exist twice in library code — `packages/fmt` and
`packages/wactest` — because unifying them touches forty import lines, and *"wac has no re-export —
importing a symbol from a file that merely imports it is a compile error."* `wac-mono 0072` is *closed* and is about `wc`'s counts being `i32`; it names the `itoa64` duplication only as an obstacle to its own fix. Nothing is open for re-export.

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

## Whether a `wait` that cannot advance traps or answers

**Settled once already, the other way.** `design/lang/0014` D7 landed in `std/platform.wac`: a wait
on a ticket only a continuation can answer traps, with

    trap "this ticket is answered by a continuation, so waiting cannot advance it — call core.drain()"

and the comment beside it says why — *"waiting is a mistake rather than a delay"*. It replaced
returning whatever the resolver had, which for that shape is a default: *"a program that asks for a
file size and is told zero, with nothing said."*

`vision/core/ticket.wac` answers `Err(Stuck)` instead. That is a change to a shipped decision, not a
new feature, and the argument is the one `http`'s `Parsed` and `regex`'s `Searched` both turned on:
a `Result` earns its place when the arm is something a caller acts on. Here it might be — the trap's
own message tells the caller what to do, which is `drain()` — and a trap cannot be acted on at all.

Against that: a caller who could have called `drain` and did not has a bug, and the trap says so at
the moment it happens rather than handing back a value that has to be checked.

