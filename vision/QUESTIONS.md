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
becoming the thing being refused.

This entry is about the **head**. What `try` on that head means when the loop is *inside* a generator
is a separate and much larger question — two levels of failure crossing for one fault — and is the
`try` inside a generator entry below rather than a sentence here.

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

### A third ending, added 2026-09-04, and it is not the same question

A trap unwinds. Returning unwinds. **An abandoned generator does neither** — `cat big | head -1`
leaves `cat`'s machine suspended mid-body, and nothing happens to it at all. There is no event to
hook, which is what makes it different from the two above rather than a third instance of them: a
trap at least *arrives* somewhere, and this is the absence of an arrival.

Three things a scope-scoped side effect has to survive, then, and they are not one rule:

    a trap          unwinds through the scope        — is a `defer` reached?
    a return        unwinds through the scope        — is a `defer` before a loop reached from inside it?
    abandonment     nothing reaches the scope        — is anything reached?

Only the third has *no mechanism available*: whatever answers it has to be something the runtime does
when it notices nobody holds the machine, which is a collector's question and not a control-flow one.
That is why `@/packages/std`'s four producing capabilities have no `close` and its one consumer does
— the entry below has the count — and why the interim answer there may have to be a method rather
than a rule.

**And a fourth thing, from `@/packages/box/src/tee.wac`: what `defer` does with a call that
suspends.** `defer closeAll(sinks);` where `closeAll` is `async` registers a cleanup that cannot
finish synchronously, at a point where the function is already leaving. Whose continuation is it, and
what drains it? Nothing says, and the applet that most wants `defer` is the one that shows this is
two unanswered questions wearing one keyword.

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

## Four projections examined, four wrong in a different way, and the count is why

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
of four. `Random` is a single capability raised to a type — `randomBytes`, and there is no second
one. And **standard input has no projection at all** — `readStdin` is a host capability that
`packages/ssh` and four `platform` files use, and none of the seven had it.

**`Clock` was in that sentence too, as another single capability raised to a type, and it is wrong.**
The host has three time capabilities — `nowMillis`, `monotonicNanos` and `sleepMillis` — and the
projection has the first two. Corrected 2026-09-04 by `wactest`'s `within.wac`, which needed the
third; the bounded-wait entry below has what that cost and the second, larger thing missing from the
same surface.

So this check found four defects on its first pass and a fifth on its second, in a projection it had
already cleared. **A capability the host groups with two others is exactly the kind a two-of-three
count reads as complete**, and *single capability raised to a type* is a shape that stops you
counting — which is worth more than the fix, because `Random` really is one and the sentence looks
the same for both.

**Standard input names the root cause, which is why the defects are all different.** The seven do not
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

## Every example on every page is written against a `Sys` that no longer exists at all

The projections — `Sys` split into `Files`, `Net`, `Proc`, `Env`, `Out`, `Clock`, `Random` — were
invented during the packages exercise, argued from a count of the host's fifty capabilities and from
`box`'s applets, and written into `vision/std/platform.wac`. That struct has **eight projection
fields and no flat methods**: no `readFile`, no `log`, no `listen`.

Every vetted page still writes the flat form. Re-counted 2026-09-04 over the ```wac fences, as
`sys.<name>(` against `sys.<group>.<name>(`:

    SHOWCASE.md    8   flat, 0 projected
    TECHNICAL.md   9   flat, 0 projected
    IDIOMS.md      4   flat, 0 projected
    QUESTIONS.md   1   flat, 0 projected
    ─────────────────
                  22   flat call sites on the agreed pages, and not one projected

(This entry said seventeen when written and I cannot reproduce it; the pages have not been edited
since, so the two counts are measuring different things and only this one has its method attached —
the regexes are above.)

**The other side moved much further, and in a direction the entry did not anticipate.** Across the 59
rewritten files there are **four** projected call sites and **one** flat, in **two** files — because
almost nothing takes a `Sys` at all:

    functions taking a `Sys`:       2      `page` and `main`, the two entry points
    functions taking a projection: 16      Out ×10, Files ×7, In ×4, Clock ×2, and one each of
                                           Net, Proc, Page, Socket, Endpoint

So the divergence is not *the pages use the old spelling and the code uses the new one*. It is that
the code mostly does not use **either**: a function takes `Out` and `Files` directly, and `Sys` shows
up only where the launcher hands one over. The projections did not become a *way to reach* a
capability, they became the parameter — which is the thing they were argued for, arrived at by
writing rather than by deciding, and it makes the flat form on the pages wrong twice over.

It also bears on *whether the whole grant is a thing that exists*, below: a bundle that two functions
in fifty-nine files take is doing less work than the entry defending it assumes.

### And then the bundle was deleted, which makes this worse rather than settled

`Sys` is gone from `vision/std` — the queue it was really holding is a `Tasks` projection, which is
where `std/platform.wac` already puts it. So the divergence went from *the pages use a flat spelling
of a type that exists* to **the pages name a type that does not**: 22 call sites on `SHOWCASE.md`,
`IDIOMS.md`, `TECHNICAL.md` and here, every one of them `sys.something(…)`.

**This is the one thing in this directory I should not fix**, and saying so is the point of the
escalation. The three pages are *agreed*: `README.md` calls them what the operator has reviewed, and
`vision/packages` is disposable precisely so that the pages do not have to be. A rewrite that
silently reworded 22 examples on the reviewed pages to match a struct I deleted this afternoon would
be the exercise editing its own brief.

So the choice belongs to whoever owns the pages, and it is a real one rather than a formality:

- **`Sys` comes back**, as the bundle the examples read best against, and the measurement — one user
  in fifty-nine files — is the price of an examples-first design. That is a defensible answer; the
  pages are the product and the packages are the test.
- **The examples change**, and every one gets longer: `sys.readFile("a.txt")` becomes a function that
  was handed a `Files`, which means the surrounding signature has to be shown. Several of the 22 are
  one-liners whose whole point is brevity.
- **Both**, with the flat form kept on the pages as sugar over a program that was handed everything —
  which is a third design nobody has proposed and which the *no ambient capabilities* line would have
  to be squared with.

The exercise's job was to find this, and it has: the code and the pages have made opposite choices,
both for good reasons, and no amount of writing more packages resolves it.

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

**And it is not hypothetical: the construct is in the tree, one rung down.** `issues/lang/0329a`,
filed 2026-09-04 — `bootstrap/drivers/` has three files with module-level mutable variables,
`u8[] built;` and six more in one of them, compiled by wac-L5 as part of the ladder. `wacc`'s
top-level parser has no case for one and neither does `spec/spec/grammar.md`, so the product refuses
what the rung below it accepts, and those three files are the only ones in 1,578 the spec grammar
refuses other than seven written to be refused.

Which changes what this entry is asking. Not *is this an addition nobody wrote down* — somebody
already writes it, in the most load-bearing directory there is, and the question is whether the
language has it. The *local* case (`i32 n;` inside a function) is still refused everywhere and is
still five examples that may have elided an initialiser for brevity; the two are not the same
construct and the entry had been treating them as one.

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

That is the whole of what anything says about `never`. It is **declared nowhere**, it is not in
`GRAMMAR.ebnf`'s type rule — it parses only because an unknown word is an `IDENT` and
`IDENT , [ type_args ]` is a type — and no page argues for it. The coroutine design rests on it:
`Generator<Y, R>` *is* `Coroutine<never, Y, R>`.

**Counted on tokens rather than on text, 2026-09-04: two files.** Its own declaration site in
`core/coroutine.wac`, and `@/packages/wactest/src/within.wac`, written the day before to drive a
coroutine by hand — which makes that the **first consumer `never` has ever had**, and it did depend
on the claim: `Step<TicketBase, never, R>` matched exhaustively in two arms, so the feature was
exercised by something other than the doc comment asserting it. Until then the only file using the
type was the file declaring the design that needs it.

(A grep said nineteen files, because *never* is an ordinary English word and seventeen of the
nineteen were prose. That is what `tools/specparse.ts --tokens` exists for.)

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

## A sentinel drawn from the value's own range, in three places

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

**And there is a third instance, which is why the heading names the pattern rather than the pair.**
`packages/unicode`'s `decode` answers a struct whose `code` field otherwise holds a code point, with
`-2` meaning *truncated* and any other negative meaning *malformed* — found while writing
`vision/packages/stream`, whose `scalars` is written against `union<Scalar, Truncated, Malformed>`
instead. It sat in that package's own list of what could not be written, unpromoted, because it reads
as a `unicode` defect rather than as this question.

It is not, and the difference matters twice.

**`decode` is not a capability**, so the fix the two above share — *make the capability answer a sum*
— has no motivating pressure here. If the answer to this question is *a sum, always*, then it is an
idiom that ordinary code has to follow and belongs on a page, not a decision about two fields in
`vision/std`. Framed as a capability question it cannot reach the majority of the code that has the
problem.

**And `decode` is the instance that shows the shape at its worst**, because the sentinel is not one
value but a *subrange*: every negative is reserved, one of them specifically, and the type says none
of it. `In.read`'s empty array is at least a value a reader can enumerate. A reserved subrange cannot
be documented in the signature at all, and a caller who forgets the sign test gets a code point that
is merely very wrong rather than obviously absent.

Three instances found in three different packages, none of them looking for it, is also the argument
that there will be more.

**And a fourth thing happened on 2026-09-04 that may dissolve the question rather than answer it.**
`Files.open` was added — the streaming half of the filesystem, which had no projection — and it
answers an `AsyncGenerator<Bytes, …>`. So `@/packages/box`'s `cat` now has **two loops for one job**:
a `try await for` over a file, and a `while (true)` testing `in.read()` for an empty array. Same
behaviour, two shapes, in the program whose whole purpose is to treat the two alike — and `cat -`,
which interleaves them, cannot be written as one loop at all.

If `In.read` became `In.stream()` answering a generator, the two halves are one function and **the
sentinel stops existing rather than being given a better spelling.** That is a different move from
*answer a `Read` sum*: it says the question was never about how end is *said* but about `In` not
being a stream in a system that now has them. `Socket.recv` is the same argument one step behind —
its `Read` sum is a hand-rolled generator step, and `Listener.accepted` next to it already answers a
generator.

Which leaves three answers rather than two, and the third is the largest: give `In` and `Socket` a
sum, or give them a stream, or leave them and accept that a capability's *end* is spelled three ways
depending on when it was written.

**Written, 2026-09-04, and the third one is right.** `In.read` is now
`In.stream()` answering `AsyncGenerator<Bytes, Result<void, NotGranted>>`, and `cat` was rewritten
against it rather than patched. The `pump` function is gone; there is one `copy`, and `-` on the
command line is an operand like any other, so `cat a - b` interleaves a file, a pipe and a file
through one loop with nothing in the body knowing which is which. **The sentinel did not get a
better spelling. It stopped existing**, because a generator ending is the loop ending.

So the question was never how a capability says *end*, and both earlier answers were arguing inside
the wrong frame. That is worth keeping separately from the fix: *sum versus sentinel* was a
well-formed question with a defensible answer on each side, and it was a question about how to spell
something that should not have been there.

**Two things it costs**, and neither is fixed.

`Read` could say `Failed(string why)`. A generator's return type has to carry the same information
and here it is `Result<void, NotGranted>`, so a refused grant and a broken pipe arrive as the same
value — and a file's read failing because it is a directory, or was removed underneath, has no arm
either. `@/packages/fs`'s `Fault` is the union that exists for this and `std` cannot use it, because
`std` is below the packages. So the capability answers the one failure it can name from where it
sits. `Read`'s `string why` was wrong for a different reason and neither of the two is right.

And `copy` returns `void`, so it swallows the source's failure: `try await for` propagates the
generator's `Err` as *this* function's return, and there is nowhere for it to go. Making it
`async Result<void, NotGranted>` is correct and gives `cat` two failures per operand — *cannot open*
and *stopped reading* — which the shipped `cat` also has and prints one sentence for.

**`Socket.recv` is now the odd one out**, and the move is not obviously available. Its `Read` is a
generator step written by hand and `Listener.accepted` beside it already answers a generator, so
`recv()` → a stream is the same rewrite again — except a socket is bidirectional and `send` has
nowhere to live on a generator.

## Three type names are declared twice, and `union` is the reason it matters

**128 type names across `vision/`, five declared in more than one file.** It was 107 and three when
this was written; re-counted 2026-09-04:

    BadMethod    gzip/src/fault.wac  (i32 cm — a DEFLATE compression method)
                 http/src/fault.wac  (empty — an HTTP verb)
    Truncated    gzip/src/fault.wac  (string field)
                 unicode/src/utf8.wac  (empty)
    Fault        fs/src/fault.wac    union<NotGranted, NotFound, Denied, …>
                 gzip/src/fault.wac  union<SourceFailed, Corrupt>
    Span         regex/src/regex.wac (where a match was)
                 wacc/src/ast.wac    (where a node came from)
    Node         core/jsx.wac        (a markup element, text or fragment)
                 fs/src/mount.wac    (a file or a directory)

The rate went from three in 107 to five in 128 with nobody watching, and **both new ones arrived in
two days, from files written without noticing.** That is the finding rather than the five: a corpus
that grows collides at a roughly constant rate, and nothing counts.

**`Node` is the one that is different in kind, because one of them is in `core`.** `core/jsx.wac`'s
header is explicit about why it is there — *"a tree built in one repository and a renderer in another
must name one type or nothing composes, and no author chose the name to be able to fix it"* — and
then a package declares a different `Node` for a directory entry. Nominal typing keeps them apart and
imports are per-file, so nothing breaks; what breaks is the argument. A name the compiler emits
constructor calls for, chosen so that *nobody has to agree on it*, is a name a package cannot safely
reuse, and there is no rule saying so.

`Span` is the ordinary kind: two packages, two meanings of *a range*, neither wrong.

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
productions to 564, and every vision file still parses.

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

**The same check the other way round used to come back clean, and no longer does — which turns out
to be the more interesting half.** It said: every construct in `GRAMMAR.ebnf` is used by at least one
vision file, nothing has been proposed and then not written with. Re-counted 2026-09-04 over the then-52
files, **six constructs had no user in any of them**:

    verbatim name  `@"for"`          quoted tag  `<"my-widget">`     hyphenated attribute
    `auto`                           a list literal                  `coroutine f()`

**And *having a user* is not the same question as *the rule doing work*, which is the thing to check
and which one of the three fails.** Each rule was deleted from `GRAMMAR.ebnf` in turn and the tree
re-parsed:

    verbatim name `@"for"`   removed → refused at counter.wac:31:21
    hyphenated attribute     removed → refused at counter.wac:32:35
    `coroutine f()`          removed → refused at within.wac:113:65
    `auto`                   removed → **nothing changes**, 564 productions become 562

The first three are load-bearing: delete the production and a real file stops parsing at exactly the
token it is about. `auto` is not, because it is an `IDENT` and `type` begins with an `IDENT`, so the
alternative in `var_decl` is decoration — the entry on contextual keywords below has why.

That is a cheap check that nothing was doing and it separates two things the delta had been treating
as one. A construct can be *used* and still not be a construct.

Three of the six have users now, all written the same day to be them, and all three found something.
`coroutine f()` has `wactest`'s `within.wac`: the operator works and nothing can be *bounded* with
it. A **verbatim name** and a **hyphenated attribute** have `@/packages/page`'s `counter.wac`, the
first page anywhere in `vision/` — `<label @"for"="echo">`, where `for` is a keyword *and* the
attribute that makes a label clickable, so the escape is the only way to write the line at all, and
`data-role="echo"`, which is ordinary HTML.

**That leaves two, and a list literal got its first case on 2026-09-04 by somebody writing a line
that wanted it.** `@/packages/box`'s `cat` treats `-` as an operand, so with no operands at all it
wants `Vec<string> names = a.operands.len() == 0 ? ["-"] : a.operands;` — after which a file, a pipe
and no-arguments are one shape. What stops it is that there is no way to build a one-element
collection: `Vec` has `create()` and `push`, which is two statements and a name, and a `Vec.of(T)`
helper cannot be written usefully because **there are no variadics** — `of` would need one overload
per arity, which is the argument for a literal restated as a library. The line is a four-line branch
instead. A small case, and the first one, after nine days of the construct being in the grammar on
the strength of appearing on a page.

A **quoted tag** wants a custom element and no subject has had one.

**`auto` was the one to worry about and it turns out to have no case here.** Every local declaration
with an initialiser in the 56 files was measured: **78 of them, and the longest type is nineteen
characters** — `Queue<Continuation> mine`. Fifty-six of the seventy-eight are four characters or
fewer, because they are `i32`, `bool` and `u8[]`. There is nothing for it to elide.

And the types that *would* be worth eliding are not in declarations at all. The worst type written
anywhere in this tree is `Result<Result<Socket, NotGranted>, TimedOut>`, forty-four characters, and
it is a **return type** — `auto` is a `var_decl` form and cannot go there. That is the same shape as
`secret`, whose whole entry is that a parameter qualifier cannot say what a function returns: two
proposals, both landing in the position where the problem is not.

The pages' own four uses split the same way. `auto got = await Ticket.all(…)` and
`auto listener = await sys.listen(8080)` elide `Ticket`-derived types the rewrites never wrote down;
`for (auto line in lines)` twice is a **loop binder**, which is not `var_decl` and which the delta
never added `auto` to — it parses because `auto` is contextual, as the keyword entry below now
records.

Every one of them is on an agreed page, and that is why they are in the grammar: they were added
*from* `TECHNICAL.md`, `SHOWCASE.md` and `IDIOMS.md` after a pass that asked what the pages have and
the delta did not. `auto` is on three pages and in no rewrite.

**So there is a third category, and it is the one the paragraph above did not have.** That paragraph
splits constructs by how they were found — *wanted while writing an example*, which lands on a page,
against *refused by a tool*, which lands in a generated file. These six are neither. They are on a
page, agreed, reviewed, and **nothing has ever been written with them.** A construct nobody has
refused and nobody has used is the one no process here notices at all: the refusal-driven ones at
least have a tool shouting about them.

Which of the two lists is worse is a real question. Three constructs argued nowhere but load-bearing
in the code, against six constructs agreed everywhere and load-bearing in nothing — three of them
still, once subjects were written to want the other three.

**And the single-consumer count has moved, which is what the later subjects were for.** It was
`schedule` (once, in `Sys.drain`), `trap` as an expression (once), and `secret` (twice, both inside
the file proposing it). Today `schedule` has two — `Sys.drain` and `wactest`'s `isolated`, written to
be the second — and `secret` has its first external consumer in `tls`'s key schedule. Both second
consumers found something: `drain` does not compose with `schedule`, and `secret` has no return
position. `trap` as an expression still has exactly one use and is the last of the three unevidenced.

(The first pass of that count said `secret` had **none**, because the pattern it matched wanted
`secret <word> <word>` and the real spelling is `secret u8[] key`. The re-count above had the same
kind of miss in the other direction: it scored the list literal as having one user, and the hit was
an EBNF fragment inside a comment. Both were caught by looking at the lines before believing the
total, which is the only reason neither is stated above as a finding.)

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

## The one breaking change, and no page says why it is worth 378 sites

`fn[T(…)]` → `fn<T(…)>` is the **only** thing in the whole proposal that takes something away.
Measured: 378 sites in 75 files, and 47 of `spec/cases`'s 323 programs stop parsing — every one of
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

So the trade is: a consistency nobody has written down, against 378 sites, 47 cases, and one more
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

**That premise was checked on 2026-09-04 and it is false**, which turns the rest of this entry from a
prediction into a demonstration. `bootstrap/drivers/` has three files with module-level mutable
variables — `u8[] built;`, `string[] paths;`, seven of them in one file — compiled by wac-L5 as part
of the ladder. `wacc` cannot parse one and neither can `spec/spec/grammar.md`; that disagreement is
`issues/lang/0329a`. What matters here is what the two grammars then do with the files:

    spec grammar     accepts 1 of the 4 bootstrap drivers
    vision grammar   accepts 2

**The extra one is `emit_and_run.wac`, and vision accepts it by misreading it.** Its `u8[] built;` is
a variable — the file's own comment says *"held in a global between the two calls"* — and `typedef`
takes it as a declaration of a type named `built`. Over 1,578 files this is the **only** place the
delta accepts something the spec grammar refuses, and it is a file it has understood wrongly. Every
other difference between the two grammars, all 84 of them, runs the other way and is `fn[`.

So *a typo is a declaration* is not the hypothetical below. It is one already-written line, in the
ladder, silently given a meaning by a grammar that is nine days old.

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
spelling. Every vision file parses that way, so the question is not *can they be*.

**A third cost, measured 2026-09-04, and it is the one that bites a tool rather than a reader: the
grammar cannot state the feature, so nothing can check it.** `var_decl` is written
`[ "const" ] , ( type | "auto" ) , IDENT , "=" , expr , ";"`. Delete the `| "auto"` and **nothing
changes** — the whole tree still parses, both halves of `IDIOMS.md`'s examples still parse, and the
delta drops from 564 BNF productions to 562. `auto` is an `IDENT`, `type` begins with an `IDENT`, so
`auto got = g();` matches as a declaration of type *auto*, and `for (auto line in lines)` matches
`for_head = type , IDENT , "in" , expr` for the same reason — a position the alternative was never
added to and did not need to be.

**And there is a rule for which productions the cost eats, found by removing all 47 in turn.** Every
entry in `GRAMMAR.ebnf` was deleted one at a time and `vision/` re-parsed with the rest. **Thirty-one
of the thirty-nine change what parses. Eight did, when this was measured — seven do now, because
`field_pattern` gained a consumer the same day. They split two ways.

**Three are decoration**, and all three are the contextual-keyword cost:

    var_decl's `auto`     `IDENT IDENT = expr` is already `type IDENT = expr`
    union_type            `IDENT type_args` is already a type name
    type                  the delta's only change to it is to reference `union_type`

The third is the second one's consequence, and it is worth naming separately: `type` is replaced
wholesale so that one alternative can be added, that alternative can never match, and so the whole
replacement is a copy of the spec's rule.

**Three are unexercised rather than redundant** — each is a real widening no file has used:
`list_literal`, `keyword_as_name` (a keyword as an attribute name) and `jsx_element` (which widens a
tag to `jsx_tag`, needing a quoted tag). Removing any of them changes nothing *here*, and each would
refuse a file somebody has not written.

**Two of the five left this list the same day, both because somebody wrote the subject that wanted
them.** `field_pattern` — the brace pattern — is used by `@/packages/wacc/src/walk.wac`, and removing
the rule refuses it at `23:14`. `binding`'s `is` form is used by `@/packages/box/src/gunzip.wac`, and
removing it refuses at `57:9`. Which is the useful way to read the list: it is not *rules that are
wrong*, it is *rules waiting for a consumer*, and the difference from the three **decoration** rules
is that no subject can ever move those — their slot already accepts an identifier.

The two remaining JSX ones are the honest hard case. A quoted tag and a keyword-as-attribute both
want a **custom element**, and nothing in this repository has one; writing a page with a web
component in it to justify two productions would be manufacturing the evidence rather than finding
it. So they stay unexercised, and that is a fact about the corpus rather than about the constructs.

Both are positions where an `IDENT` is *already* admitted in that slot, so the production adds
nothing a parser could act on. The other six new words are in positions where it is not — `defer`
before a block, `coroutine` before a call, `gen` before a return type, `yield`, `try` and `schedule`
as statement or expression prefixes — and removing any of those rules makes real files stop parsing.
Confirmed for `defer` (54/57), `gen_yield` (51/57), `yield_stmt` (51/57), `schedule_stmt` (55/57) and
`coroutine_expr` (a refusal at the exact token).

So the rule is: **a contextual word's production is redundant exactly where the slot already accepts
an identifier.** Type position and declaration position do; a statement prefix and an expression
prefix do not. That predicts the answer without testing, and it says the cost is two productions
rather than a vague unease.

`union` is the one that matters, because it is the *headline* proposal and it is the one where the
grammar is silent. Eleven files write `union`, five of them inline in type position, and
`union<E, NotText>` is indistinguishable from `Vec<E, NotText>` to every parser that could be
generated from this file. What the grammar can still say is the *declaration* — `export union<A, B>
Fault;` is `typedef`, and that one is load-bearing — so of the two union forms the delta proposes,
the grammar expresses one and cannot express the other.

That is not an argument against contextual keywords. It is the statement of what the grammar stops
being able to say, measured: a recogniser accepting a file proves nothing about the words in it, and
for two of the eight the production is decoration.

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


## A wac program cannot enumerate a module's exports, and the runner has to

`vision/packages/wactest` proposes that a test declaring `fn test_x(Sys sys)` be told apart from one
declaring `fn test_x()` by its *type*, so the runner grants a capability only to the tests that asked
for one. Checked against the boundary, the answer splits, and the split is the finding.

**A wac program cannot.** `Cli.load` hands back a handle and `Cli.call` is
`fn[CallResult(i32, string, i32)]` — a handle, a name, and one `i32`, answering a status, a message
and an `i32`. One fixed calling convention, and nothing crossing it carries a signature. So a program
can discover *whether* a name exists, by calling it and reading the status, and can learn nothing
whatever about its shape.

**The host can, and already does.** `spec/cli/wac.md`: *"Named exports are called after `main`, each
with its trap caught"* — and `wac test` calls `export string test_x()`, which is not `Cli.call`'s
shape at all. The host has the module's export section; reading a signature out of it is what
`bindgen` does at build time.

So the proposal stands and its cost moves, which is the part worth an entry here rather than a note
in that package. `wactest`'s whole rewrite was about pulling host-side workarounds back into the
language — `host.wac`, `built.wac` and `daemon.wac` mostly stop existing — and **this one thing
cannot come back across.** A test runner written in wac can run tests and cannot decide what to hand
them.

The question is whether that is a permanent property of the boundary or a missing capability. `Cli`
is the only route a wac program has to another module, and it was shaped for *invoking* rather than
for *reflecting*; an export table is data the host already holds and could hand over. Against that:
a capability that answers "what functions does this module have, and of what types" is a reflection
API, and every other capability in `vision/std` answers a question about the world rather than about
a program's own shape. Nothing else in the proposal wants one, and one consumer is a weak case for
a whole new kind of capability — but the consumer is the test runner, which is the program that most
has to know what it is calling.

### The host side is not *cost*, it is two halves that already exist and have never met

Written above as though the runner's work moved somewhere expensive. Read on 2026-09-04, and the
host has both pieces already — for two different callers.

**It reads full signatures, for named exports.** `native/v8/src/main.rs`'s `call_named` filters the
manifest's `exports` to a `Vec<ExportSig>` of `{ name, params: Vec<String>, ret: String }`, checks
the arity, coerces each argument **to its declared type**, and prints the return according to `ret`.
So *"which of nine projections does this export take, in what order"* is a question the host answers
today, for every named export, and it prints the answer when you get it wrong.

**And it builds capabilities from a signature, for `main`.** `spec/cli/wac.md`
`[§wac-cli-nocaps-5hq2xn9]`: *"all three hosts read `main`'s parameter list rather than building a
world and hoping the program wants it."* That is the mechanism, spec-tagged, and it exists because
`export i32 main() { return 3; }` — a program granted nothing — is *"the language's central claim"*.

**Neither half is new. They have never been joined.** `call_named` coerces from **argv text**, so it
can build an `i32` from `"3"` and has no way to build a `Files`; `worldFor` builds a world and only
for `main`. What `wactest` needs is those two lines of the host meeting: read the export's parameters
as `worldFor` reads `main`'s, and construct rather than coerce.

That changes the entry's conclusion rather than its finding. A wac program still cannot do it — that
part stands. But the cost is not *a whole reflection API*, and it is not *the runner's job moving to
the far side*: it is the host doing for `test_reads` what it already does for `main`, using a table it
already parses for `wac run somefunction 3`.

### And the JavaScript host cannot do it at all, for a reason the projections make worse

The Rust hosts read the parameter list. The JavaScript one does not, and says so:

> **A `main` that declared nothing gets nothing** … the classes are in the module because the program
> named the *types*, so a program that named none has no `Core` to build from and `Core.of` is
> `undefined.of`. The two Rust hosts read `main`'s parameter list for this; **here the absent class
> is the same signal**, and it is the one this side has.

`worldFor` returns `[Core]` or `[Core, Cli]` and `entryNode.ts` spreads it — `app.main(...worldFor(…))`.
Positional, fixed order, chosen by which classes the module happens to contain.

With two capabilities that works, because *does the module mention `Cli`* and *does `main` take a
`Cli`* coincide. **With nine projections it stops working twice over**: a program whose helper
mentions `Files` would be handed one whether `main` asked or not, and a `main(Out out, Files files)`
would receive them in whatever order `worldFor` happens to build.

So the projections have a host cost. The entry below costs all three, and the short version is that
it lands *evenly*: every host enumerates the three possible shapes of `main` — `()`, `(Core)`,
`(Core, Cli)` — and none of them has a mechanism. One change, made three times.

## A machine you can step, and the bounded wait the rewrite dropped

`vision/packages/wactest/src/within.wac` is the first code in this tree to drive a coroutine by hand,
which is what `core/coroutine.wac` describes the operator as being for: *"the machine underneath is
reachable with the `coroutine` operator for the rare code that drives one by hand."* Until it was
written the operator had no user at all.

The subject is a real gap the shipped code apologises for. `packages/wactest/src/daemon.wac`'s
heading is *"Waiting is a poll, and the bound is a count rather than a clock"*, and
`waitForPort(cli, host, port, tries)` bounds itself by dialling a fixed number of times — because an
`await` runs to completion or traps, and a program cannot say *stop if this takes longer than half a
second*.

**The operator held up.** The machine came back unstarted, `step` drove it, and `Step<TicketBase,
never, R>` matched exhaustively in two arms, which is the `never` claim exercised by something other
than the doc comment asserting it.

**And the bound still cannot be written.** `TicketBase.advance(bool block)` has two settings:

    advance(true)    wait on the world — unbounded, so it blows through the deadline
    advance(false)   poll — so the driver spins the CPU for the whole bound

A deadline can use neither, so the file written to replace a busy retry is a busy retry.

**This was first written up as a missing language feature. It is not — it is a capability the
rewrite dropped**, and the correction is the whole value of the entry. `std/platform.wac` has
`fn[i32(i32[], i32)] waitAny`, whose second argument is precisely the setting `advance` lacks:

    waitAny(ids, -1)     as long as it takes
    waitAny(ids, 0)      which is ready right now
    waitAny(ids, 500)    bounded — answers -1 when the time ran out

One integer, three settings. `advance` is a `bool`, so it has the two ends and not the middle. The
word `waitAny` appears exactly once under `vision/`, inside a `TECHNICAL.md` quotation: the primitive
is not narrowed, it is gone.

**And the shipped file carries the argument vision would need**, with a rejected alternative attached:

> **Returns -1 when the time ran out** … it is why there is no `recvWithin`. A deadline belongs to
> the wait rather than to each capability, so this one parameter bounds `connect`, `accept`,
> `readFile` or a child's `exitCode` without any of them knowing about it.

> The deadline **costs nothing**: no opcode, no slot, no ticket to dispose of, because
> `Atomics.wait` takes a timeout and the wait is already in this worker's own memory. An earlier
> design passed a timer ticket in the list instead; it worked, and every caller had to remember to
> cancel the loser or lose a slot for good.

So `advance(i64 waitNanos)` is not a proposal, it is a restoration, and the only genuinely open parts
are the unit and whether `-1` or a separate call means *unbounded*.

**It is the second thing missing from the same surface**, which is what makes it a pattern rather
than an oversight. `Clock` here is `nowMillis` and `monotonicNanos`; the host's third time capability
is `sleepMillis`, and the projection does not have it. The shipped `waitForPortWithin` sleeps 5ms
between attempts and gets a deadline loop that does not spin. `within` has neither the sleep nor the
bounded wait, so spinning is not a choice it made.

**Which is a fifth instance of the projections finding, arriving by a different route.** The entry
above has `Files` short by two methods, `Net` short by a shape, `Proc` short by its purpose, and
standard input with no projection at all — all four found by giving a projection a consumer. This one
was not: no consumer asked for `sleepMillis` or for a bounded `advance`, because nineteen packages
all `await`, and `await` is the construct that hides the question. It was found by asking what the
*host* has that the projection does not — the same check `Files` needed and the only one that does
not wait for somebody to want the missing thing.

The narrowing also reads as an improvement at the point it is made. `advance(bool)` is more readable
than `advance(i32)`, and a `bool` is exactly the right type for a two-state question. Nothing at the
call site says the shipped version had three states; the argument for the third is four screens away
in the file being replaced.

**And `advance`'s own comment overstates it.** *"Answers whether anything moved, which is what lets a
driver tell not yet from never."* One `false` is *not yet*. *Never* is an unbounded run of them, and
a driver that can tell an unbounded run from a long one is a driver with a deadline — so the sentence
describes a driver that cannot be written yet. `core/ticket.wac` does detect *never*, in `wait`, by
seeing re-entry on a ticket only a continuation can answer; that detection is structural rather than
temporal and is the right one. The comment on `advance` reads as though it were the same thing.

## Every host capability against every projection, in one pass instead of five accidents

The projections have been found wrong five times and every time by a different accident: `Files`
short by two when `fs` was written, `Net` short by a shape when `quic` was, `Proc` short by its
purpose, standard input with no projection at all, and `Clock` two of the host's three. Four of the
five waited for somebody to pick a subject that wanted the missing thing.

So the check was run properly on 2026-09-04 — every `fn[…]` member of `Core`, `Cli` and `Page`
against every `fn<…>` member of every projection in `vision/std`.

    host capabilities            62      (Core 8, Cli 42, Page 12)
    vision projection members    38
    host names with no vision member of that name   30

**Thirty is not thirty holes.** Roughly ten are renames the exercise made on purpose — `readFile` is
`Files.read`, `readStdin` is `In.read`, `randomBytes` is `Random.fill`, `accept` is
`Listener.accepted`, `bindDatagram` is `NetWithDatagrams.bind`. What is left after taking those out
is the answer, and it has a shape.

**The whole streaming half of the filesystem is missing, and four packages needed it.**
`openInput`, `readChunk`, `closeFeed`, `openOutput` and `outputError` have no counterpart:
`Files.read(path)` answers the whole file and there is nothing else. Meanwhile
`@/packages/stream`, `@/packages/gzip` and `@/packages/unicode` are all transformers taking an
`AsyncGenerator` and **nothing in the tree produces one from a file** — `scalars.wac`'s own comment
says *"`E` is whatever the source fails with — a socket's failure, a file's, a fake's"*, and a file's
did not exist. Four packages about streaming and one possible source, `Socket.recv`.

That one is now fixed in `vision/std` — `Files.open` answers a generator, `Files.create` answers a
`Sink` — and the fix is not the host's two members renamed, because **the host's streaming is a
hidden global**. `openInput(path)` then `readChunk()` with no handle between them means there is
*the* input, one at a time, for the whole program. A projection assembled from that shape inherits
it. `open` answering a stream per call is the same capability with the state given back to the
caller, and it is the clearest case yet of the difference between projecting a host and copying one.

**And the rest of what is missing is the process half**, which nothing has been written against:
`load`, `call`, `unload` and `validated` — invoking another module, which is the *typed exports*
entry above; `spawnSelf` and `execWithIn`; `pushChild`/`popChild`; `chmod` and `setExecutable`. Nine
capabilities behind `Proc`'s two, in the projection that was already found *short by its purpose*.

**What the pass is worth is not the list.** It is that it took an afternoon and would have found four
of the five earlier defects before any of the packages that found them. `QUESTIONS.md` has an entry
saying the four should have been found by *"checking against the host rather than waiting for a
consumer"*, and then the fifth was found by a consumer anyway. The check is cheap, mechanical, and
was not run until three more defects had been discovered one at a time.

The open question is what to do with it, and there are two answers. Either the projections are
**complete** covers of the host — in which case this is a gate, and something has to run it — or
they are **what somebody has needed**, in which case the honest thing is to say so on the page and
stop treating each gap as a discovery. `vision/std`'s header claims the first by implication, since
it argues from a count of the host. Nothing has ever checked the claim.

## Three capability groups are paired calls over hidden state, and none survives being a value

Found by the whole-host audit above, once the missing capabilities were looked at together rather
than one at a time. Three groups in `std/platform.wac` have the same shape:

    openInput(path)                        readChunk()            closeFeed(i32)
    openOutput(path)   outputError()                              closeFeed(i32)
    pushChild(args, stdin, cwd, capture)                          popChild() -> Captured

In each, a call establishes something, later calls act on *the* something, and a final call ends it.
There is no value in between. The consequences are written into the host's own comments:

- **A `popChild` with nothing pushed** answers *"two empty arrays rather than failing: the caller has
  nothing to clean up, and there is no state to corrupt"* — which is what you have to say when
  nothing can tell an unpaired call from a paired one.
- **`outputError()` reads a failure back afterwards**, as a separate capability, so a write's success
  and the reason it failed are two calls apart.
- **`closeFeed(i32)` takes an integer** that neither `openInput` nor `openOutput` mentions.
- **One at a time.** There is *the* input and *the* output for the whole program, so two files cannot
  be read at once by any means.

**The projection answer is the same in all three and it is not a rename.** `Files.open` answers a
generator, `Files.create` answers a `Sink` with `write` and `close` on it, `Proc.run` answers a
`Captured`. The state moves into a value the caller holds, the pairing becomes the lifetime of that
value, and *the* input stops existing. Nesting comes free, because calls nest.

**And for one of the three that has already been done, in this repository, and I wrote the entry
above without knowing it.** `packages/platform/src/frame.wac` is `pushChild`/`popChild` as a value,
and its header is the argument better put than I put it:

> A child's world as a **value**, instead of a frame the host holds. … The child is not compiled
> differently, does not know, and cannot tell — which was already true of the host frame. What
> changes is where the state lives: a local the caller holds, rather than a stack inside the host
> that an unmatched `popChild` corrupts for the rest of the session.

It is the live path: `packages/wac/src/grants.wac` builds through it and `sh_test.wac` says *"every
other `"sh"` in the suite is `Frame.of(…)`"*. And `packages/platform/example/inside.wac` and
`insideValue.wac` are **the same program written both ways, kept side by side** — the paired
capability and the value, in one directory.

That does not weaken the finding; it is the finding with a witness. Three things follow.

**What made it possible was closures**, `design/lang/0002`. The header says so: *"until closures
landed a substitute capability had nowhere to put what it collected."* So `pushChild` is not a bad
design, it is a design from before the language could express the good one — which is the same story
as `packages/fs`'s mount table, whose header argues for *"a funcref plus explicit state"* and says a
funcref cannot capture, three weeks after lambdas landed.

**The capability did not change and cannot.** `frame.wac` is a *package* over a host boundary that
still passes scalars and arrays. So the question this entry asks — host's mistake or boundary's
constraint — has its answer demonstrated on both sides at once: the state can live in wac, and the
capability stays paired because nothing has re-cut the boundary since closures arrived.

**And nobody has written the other two.** There is no `frame.wac` for `openInput` or `openOutput`,
which is exactly why `tee` still buffers a pipe. One of three groups got a value, six weeks ago, by
somebody who needed it; the other two are still waiting for their consumer to be annoyed enough.

**Why this is a question and not just a fix.** Three instances is enough to ask whether the pattern
is the host's mistake or the boundary's constraint. The argument that it is a constraint: the host
side is JavaScript or Rust, a capability is a funcref taking scalars and arrays, and *a handle is an
`i32`* is the only thing that crosses — so `openInput` returning nothing and `closeFeed` taking an
`i32` is what the boundary can express. `Socket` and `Child` are the counter-argument: both are
values with an `i32` handle inside, and both work.

So the question is why `Socket` got a value and the input stream did not. If the answer is *nobody
needed two at once*, that is the projections finding again in a third form: **the shape was chosen by
the first consumer and the first consumer only ever wanted one.** If the answer is that a `Feed`
value costs something a `Socket` does not, nothing says what.

**The ledger on *one at a time*, assembled 2026-09-04 after writing `@/packages/box/src/tee.wac`.**
The single cursor is not an oversight — `packages/fs/src/fs.wac`'s `openOut` states it and gives the
reason: *"One cursor per filesystem, not a handle table: a shell redirects one command at a time, and
a table would be a second thing to leak."* Which is a **first-consumer argument**, the same shape
this document keeps finding in the projections: a shell does redirect one command at a time, and a
shell was the consumer that existed.

What it has cost, all of it already written down somewhere in the tree and none of it filed against
the capability:

- **`tee` buffers a pipe.** Its header: *"The one applet that still buffers by nature rather than for
  want of an API. The world has one current output … `tee` wants two at once and cannot express
  that."* A program whose whole purpose is to sit in the middle of a pipe, holding the pipe in
  memory. `@/packages/box/src/tee.wac` is it written against `Files.create`, and the fix is that a
  `Sink` is a value, so holding two is holding two values.
- **`>` had two implementations.** The same `openOut` paragraph: *"the only streaming write in the
  world was `Cli.openOutput`, which redirects the process's standard output. So `packages/sh` had two
  implementations of `>`: the sequential path wrote through this filesystem and the streaming path
  wrote through the host, and they disagreed about which disk a sealed session's redirection landed
  on. Latent, because a sealed session does not spawn (wac-mono 0116) — and a leak the day it does."*
- **`tee -a` cannot be written at all**, and this one is *not* the projection's fault. `openOut`
  truncates deliberately — *"Truncate now, through the ordinary write, so that every check
  `writeFile` makes happens once and in one place"* — and the host has no append either. So the
  system does not have the capability rather than the rewrite having dropped it. The first gap this
  exercise has found where projecting faithfully reproduces a real hole.

Three consequences, three places, one cause, and the cause is documented as a deliberate decision at
each of the two layers that made it.

**And one thing genuinely does not survive the move.** `Proc.run` here takes no grants, because the
shipped `pushChild` is explicitly *not* isolation — *"the child is the same instance with the same
authority; it can still open any file the parent could. A real boundary is `spawn`."* So the
projection has `spawn(cmd, args, grants)` beside `run(args, stdin, cwd)`, and the second is the one
whose name suggests it takes grants and cannot. Written out rather than smoothed, because *this runs
something with your authority* is the honest signature and there is no way to say it in a type.

## Whether *the whole grant* is a thing that exists, which `Page` made unavoidable

`Sys` is the exercise's own invention and its comment called it *"everything this program was
granted, and the only thing that can produce a narrower one."* Adding the ninth projection broke the
first half, and it turns out the first half was never right.

The shipped entry points are `export i32 main(Core core, Cli cli)` and
`export i32 page(Core core, Cli cli, Page page)`. Authority arrives as **two or three parameters**,
and there has never been a value holding all of it. `Sys` bundles what `main` gets; there is nothing
it could be for `page` short of a different `Sys`, a nullable field, or a second bundle.

Three answers, and the middle one is the one that looks reasonable and is not.

**`Page? page;` on `Sys`.** Every consumer unwraps, and the unwrap is a *runtime* question the entry
point already answered statically: a program exporting `page` has one and a program exporting `main`
does not. A grant that has to be tested is weaker than a grant that cannot be held, and the whole
argument for projections is that narrowing is structural.

**A second bundle** — `Sys` and something like `Ui` — which is what the parameters already are, and
then *the whole grant* is simply not a thing and the doc comment stops claiming it is.

**No bundle at all**, which is the shipped design: capabilities are parameters, and `Sys` exists here
only so that `sys.files` can be a narrowing. That is a real option and its cost is the one this
exercise was arguing against — a program that wants files and a clock takes two parameters, then
three, then six, and a dispatcher that calls many such programs is back to passing everything.

**The reason it is a question rather than a preference** is that `Sys` is load-bearing for something
else: `drain` and `pending` live on it, and `issues/lang/closed/0298c` is a whole compiler that could
not rebuild itself because *two* capabilities each made a scheduler. Whatever replaces the bundle has
to keep one queue reachable from everything, and *"the parameters are the grant"* has no obvious
place to put it.

**Measured 2026-09-04, and the code has already answered most of it.** Across the 59 rewritten files,
**two** functions take a `Sys` and **sixteen** take a projection directly — `Out` ten times, `Files`
seven, `In` four. The two are `page` and `main`, the entry points, which take one because the
launcher hands one over.

And of those two, `counter.wac` took a `Sys` to reach `sys.out.log` and now takes an `Out`. So
**exactly one function in fifty-nine files needs a `Sys`, and it needs it for `drain`.** That is not
an argument for a bundle of nine projections; it is an argument that the scheduler wants a home and
took the nearest one.

Which reframes the three answers above. *No bundle at all* is not the radical option — it is what
the code does everywhere except at one call to `drain`, and it arrived by writing rather than by
deciding. The question left is narrow and answerable: **where does the queue live if not on `Sys`?**

So this is not really about `Page`. It is that `Sys` was introduced to hold projections and quietly
took on a second job, and the first program that could not be handed one is where that shows.

### Answered by the shipped design, and `Sys` is gone

`std/platform.wac` already has the queue on a capability, with the reason written at the field:

> The scheduler is a value the host builds at start-up and hands over with the rest of the
> capabilities, which is what keeps "no ambient anything" true — a program given no world cannot
> schedule.

That is `Core.sched`, with `drain` and `drainFor` as methods on `Core`. So the answer to *where does
the queue live* is **on a projection, like everything else**, and the bundle was never holding the
projections — it was holding the queue, and giving it a name is the whole change. `vision/std` has a
`Tasks` now and no `Sys`.

**And the shipped design does not put the queue in one place, which is the part that matters.**
`Core` has a `Sched sched` field and so does `Cli`, both pointing at one value the host constructs —
`issues/lang/closed/0298c` is what happens when they point at two. So the rule survives the bundle
going and gets harder: nine projections must reference *this* `Tasks`, where the design that had two
already shipped the bug once. A bundle never enforced that either; what it did was make the queue
easy to find.

Three things the change turned up, none of which a bundle would have shown.

**`wactest`'s `isolated` took a `Sys` and never used it.** The isolation is `schedule`, which needs
no capability, and the queue it redirects to is a local — so the function held authority over a
filesystem, a network and a process table in order to run a lambda. That is `packages/box`'s
measurement, *ten applets of sixty-three never mention `fs`*, happening inside `vision/` one file
away from the paragraph arguing against it. **A bundle makes an unused capability free to accept and
invisible afterwards; a parameter list makes it a word somebody has to type.**

**`server`'s `main` now says what the program is** — `main(Net net, Out out, Clock clock, Tasks
tasks)` — and `Tasks` is the awkward member of the four. The other three are things the program
*does*; a scheduler is something it *has*, and it is in the signature because the queue must be
reachable from the one place that drains it.

**And it makes the runner's job bigger as the grant narrows.** `wactest` proposes telling a pure test
from an authority-taking one by reading the export's type. *Does it take a `Sys`* is one type test;
*which of nine projections does it take, in what order* is a signature to read. Same work `bindgen`
already does and more of it — the trade rather than a snag, and worth stating because narrowing a
grant is usually described as costing nothing.

## `wac.json5` says `vision/` is self-contained and seventeen imports say it is not

`vision/wac.json5` is empty and its comment is the whole design:

> `@/` is the root of the project containing the *importing file* … so a file in `vision/` never
> reaches out of `vision/`, and the code reads as though this directory were the repository. The
> corresponding real thing is always at the same path with `vision/` taken off the front.

Checked on 2026-09-04 by resolving every import specifier in the 53 rewritten files. **Seventeen, in
twelve files, name something that is not in `vision/`:**

    @/packages/crypto/src/{sha256,hkdf,hmac}.wac      tls/keyschedule
    @/packages/box/src/lib/args.wac                   box/cat, box/echo
    ./stringify.wac ./atof.wac ./huffman.wac ./crc32.wac ./routes.wac ./host.wac
    ./percent.wac ./response.wac ./headers.wac ×2 ./case.wac ./printable.wac

Against eleven `@/` imports that do resolve inside `vision/`, so it is not that the mechanism is
unused — it is used, and a third of the time it names nothing.

**All fifteen distinct targets exist in `packages/`**, at exactly the path with `vision/` taken off
the front. So this is a *convention* rather than seventeen mistakes: an import may name a file the
rewrite chose not to write, meaning *unchanged, take the original*. Every README says which files it
wrote and why the rest are absent — `json`'s *"`stringify.wac` is not rewritten because nothing in it
changes"* — and none of them says the imports still point at them.

**The convention contradicts the manifest**, which is why it is worth an entry rather than a
correction. Either

- `vision/` is a project and these imports are broken. Fixing them means writing fifteen files whose
  READMEs argue at length for not writing them, which is a real cost for no finding.
- or `vision/` is an **overlay**: `@/x` resolves in `vision/` if something is there and falls through
  to the repository root if not. That is what every one of the seventeen already assumes, it makes
  *"the corresponding real thing is at the same path with `vision/` taken off the front"* a
  resolution rule instead of a remark, and it is the thing the manifest's comment explicitly rules
  out.

The second is also a real question about the language, not only about this directory: a project that
layers over another is how a fork, a patch set, or a vendored dependency with local changes wants to
work, and `packages/wacc/src/path.wac` resolves by path arithmetic with no filesystem, so *fall
through if absent* is not something the resolver can currently express. `@/packages/wacpkg`'s
README already found that the entry-point proposal lands in the same place, on `Res`'s `mapFrom`/
`mapSpec`/`mapTo` — which is the reader's answer to a question the resolver cannot ask.

**The convention covers a missing file and not a missing name**, which is worth separating because
the second is an ordinary mistake. Extending the import check from *does the file exist* to *does it
export this name* found four, and three were real: `@/packages/wacc/src/walk.wac` imported `Ty`,
`Arm` and `JsxAttr` from a sibling that referenced all three and declared none. `./stringify.wac`
naming a file nobody wrote is the convention; `Ty` naming a type nobody wrote is a dangling
reference, and nothing distinguished them until the check did.

**The second unstated convention in this directory**, and it is the same shape as the first: `{ … }`
for a body nobody wrote, which a lexer special case strips, and now an import for a file nobody
wrote, which nothing checks at all. Both are load-bearing, both are invisible to every tool, and both
were followed perfectly by hand — the seventeen contain no typos, which is luck rather than a
property.

## An enum's payload is a struct and is not treated as one

Three spellings of the same fields, and only one of them can use their names:

    Point q = Point { x: 3, y: 4 };     // a struct: by name, order-independent, a nullable omitted
    Shape b = Shape.Circle(2.0);        // a variant: by position, and only by position
    case Circle(r): …                   // and read back by position too

`spec/spec/structs.md` `[§wac-struct-named-4y8pg2j]` makes a struct's field order irrelevant and
`[§wacc-struct-nullable-optional]` lets a nullable one be left out. An enum's payload fields have
names — they are written `Binary(i32 op, Expr left, Expr right)` — and nothing can use them.

**Counted over the tree, excluding `spec/cases`:** 812 match arms bind two or more payload fields;
**291 of those are on a variant where two fields share a type**, which is what makes a swap silent.
Twenty-three such variants, thirteen of them in `packages/wacc/src/ast.wac` — the compiler's own AST,
and the most matched-on type in the repository.

    Ternary(Expr cond, Expr then, Expr els)     17 arms   a swap inverts every conditional
    Binary(i32 op, Expr left, Expr right)       26 arms   turns `a - b` into `b - a`
    Index(Expr arr, Expr index)                 17 arms   turns `a[i]` into `i[a]`
    StructDecl(…7 fields…)                      54 arms   four are wildcards at most sites
    Func(…, bool exported, …, bool isAsync)     43 arms   two adjacent booleans, opposite meanings

**The brace pattern is one direction of this and has its first user.** `Ok { v }:` was one of the
constructs nothing used and one of the eight rules whose removal changed nothing;
`@/packages/wacc/src/walk.wac` uses it and the rule is load-bearing now — delete `field_pattern` and
that file refuses at the exact token. Writing it moved two things.

**It is the struct-literal rule, not a new pattern form.** Same braces, same field names, applied to
destructuring instead of construction. Presented as a pattern it reads as a convenience; presented as
*the payload finally reaching the struct rule* it is one rule in one more place — and then the other
two rows below follow without needing arguments of their own.

**The subset is the value and the proposal leads with the other half.** It writes `Ok { v }`, every
field named, with `{ .. }` as an afterthought. Six of `walk.wac`'s thirteen arms bind a subset, and
the real comparison is `StructDecl { nameTok, fields, methods, .. }` against
`StructDecl(nameTok, _, fields, methods, _, _, _)` — four underscores whose count is load-bearing, in
a variant that has gained a field twice. Weaker than it sounds in one way: `[§wac-arm-partial]`
already ignores fields positionally, so naming a subset is the same capability without an index.

**And construction is the half nothing proposes, where the worst case lives.**

    Decl(DeclKind.Func(t, ty, ps, body, true, tps, false), at)

Swap the two booleans and the compiler is silent, every diagnostic still points at the right line,
and an unexported function becomes an exported synchronous one. The notation exists twice over:
`Point { x: 3, y: 4 }`, and `i32[n](fill: -1)` in call position with the spec's reason — *"Named
argument syntax cannot collide, since a call rejects it outright."* So `Func { nameTok: t, exported:
true, … }` needs no new syntax, only the existing rule in one more place.

Two smaller rows in the same table, both of which the promotion would settle: a payload field cannot
be `const` where a struct field can, and a nullable payload field cannot be omitted where a struct's
can — `ArrNew(Ty elem, Expr? size, Expr? fill, Expr[] elements)` has two nullables and every
construction passes `null` for at least one, positionally.

**What is genuinely open** is the pattern's own notation rather than whether to have it. A binding
that renames — `Binary { left: lhs }` — is not in the grammar, so a payload field's name becomes a
local's name and two nested arms binding `left` from different subjects cannot both exist; the struct
literal it borrows from has the colon and the pattern declines it. And a nested pattern —
`Binary { left: Ident { tok } }` — was withdrawn in `GRAMMAR.md` because *"a field access that
already exists"* says the same thing, which is true for **reading** a field and not for **matching**
one: the nested form is what makes an arm apply only when the inner variant does. Withdrawn on the
reading argument; the matching argument was never made.

## Matching a payload by type does not bind it, so the arm knows the shape and cannot read it

`GRAMMAR.ebnf` has `binding = IDENT | "is" , type`, and the `is` form got its first user on
2026-09-04 — `@/packages/box/src/gunzip.wac`, which tells a decoder's two kinds of failure apart:

    Err(is SourceFailed):  { … }    // somebody else's disk — a caller may retry
    Err(is Corrupt):       { … }    // a statement about the archive — retrying reads the same bytes

That distinction is `@/packages/gzip/src/fault.wac`'s central argument and `issues/system/0102`'s
subject, so it is a real consumer rather than a demonstration. The rule is load-bearing now: remove
the `is` alternative and that file refuses at `57:9`.

**And the arm cannot read what it matched.** A payload is bound by name *or* matched by type, never
both. `SourceFailed` carries one field, `string why`, and the arm above knows it has a `SourceFailed`
and has no way to reach it — so the message is *read failed* where the shipped equivalent prints the
host's own sentence. `Err(is SourceFailed f):` is the obvious spelling and is not in the grammar.

Nothing argues against it, and the reason it is missing is visible: `TECHNICAL.md`'s two examples are
both `Err(is NotFound):` on a **payload-free** member, which is the one case where binding has
nothing to bind. The construct was written from the example that does not need the other half.

**The workaround loses the thing that made it a match.** `Err(f): { if (f is SourceFailed) { … } }`
is writable today — and then the `match` has one `Err` arm, so nothing checks the inner `if` chain
for coverage. Matching by type is what makes the two-way split exhaustive; binding is what makes it
useful; and they are exclusive.

## A union may contain a union, and flattening it would be wrong

Asked and left open in the entry on naming unions. Answered here by use rather than by argument.

`@/packages/gzip`'s `Fault` is `union<SourceFailed, Corrupt>` and `Corrupt` is itself
`union<BadMagic, BadMethod, BadBlockType, BadHuffmanCode, BadDistance, Truncated, ChecksumMismatch,
LengthMismatch>`. `@/packages/box/src/gunzip.wac` writes `Err(is Corrupt):` and matches all eight
without naming them, because it has one sentence for the whole group and **the group is the design**
— the fault file's own words are that what separates the two halves is *"not the type"* but whether a
caller may retry.

So the flattening answer — where `union<A, union<B, C>>` means `union<A, B, C>` — is wrong for this
case, and this is the first case there has been. Flattened, `is Corrupt` has nothing to name and the
applet needs eight arms saying the same thing.

That is evidence rather than a decision: one consumer wanting nesting does not settle what nesting
*means* — whether `is SourceFailed` and `is Corrupt` are exhaustive over `Fault`, whether a value can
be matched at either depth, and what a member appearing in two nested unions does. What it settles is
that flattening is not free, which is the answer the entry above was leaning toward.

## Giving a paired protocol a value fixed the pairing and kept the buffering

The entry above found three capability groups that are paired calls over hidden state and gave each
a value: `Files.open` a generator, `Files.create` a `Sink`, `Proc.run` a `Captured`. Writing the
first consumer of the third showed the third one was half a fix.

**A `Captured` is the whole output in memory.** `Captured { Bytes out; Bytes err; i32 status; }` is
exactly what `packages/sh/src/exec.wac`'s sequential pipeline already carries as `u8[] carried`, and
the shipped `Captured` has a `truncated` field and an 8 MiB cap because somebody hit it. What that
cost is in the tree, in the shell's own words:

> Here a stage that overflowed what this shell will hold produces no bytes, so the stage after it
> counts an empty input and reports success: `seq 1 1500000 | wc -c` printed `0` with status 0, and
> `n=$(…)` captured a plausible number with the reason on a stream no script reads.

A wrong answer with status zero, and a whole `refusedStage` mechanism exists to notice the overflow.

**And it was inconsistent with the same audit's other two answers**, which is the tell I missed: two
of the three gave a stream because a stream is what a caller wants, and the third gave a buffer three
fields wide. One audit, two shapes, in one file.

So `run` takes a stream and answers one, `@/packages/sh/src/pipeline.wac` is a fold over the stages,
and nothing between two stages is held whole. **Laziness comes with it and is the half buffering
cannot do at all**: `cat big | head -1` pulls one chunk and stops, where the shipped sequential path
runs `cat` to the end and the streaming path only avoids that by having a kernel hold the pipe.

Three things it opened.

**A pipeline's status is every stage's, and a generator returns one value.** Each stage's `Exit` is
the return of a generator that the next stage has already consumed, so by the end only the last is
reachable. Bash's rule *is* the last stage's status, so it reads like a match — and
`packages/sh/src/refusal.wac` is a whole file on why that rule hides a failure. Awaiting an earlier
stage's return deadlocks: it does not finish until the later one has drained it. `$PIPESTATUS` is the
shell's name for this and it is not a shell question — it is *what a caller can learn from a
generator it has handed to another generator*, which is the entry on whether `try await for` binds
the return, with more than one producer.

**Abandoning a generator is unspecified, and laziness is what causes it.** `head -1` stops pulling
and `cat`'s generator is suspended forever holding a file. Nothing says whether its `defer` runs,
whether it is distinguishable from one that finished, or whether the file closes. The last is the
sharp one: `Files.open` answers a generator and `Files.create` answers a `Sink` **with a `close`
method** — a sink can be closed and a source cannot.

**And `Captured.err` is gone with the buffer, which is a loss rather than a tidy-up.** A captured
child's standard error was separable from its output; a stage sharing `Out` writes where the shell
does. Getting it back means `run` answering two generators, or one generator of a two-armed sum —
and the second is `Read`'s shape, which this document is already unsure about.

## Four capabilities answer a generator nobody can close, and the one that answers a value can be

Systematic rather than an oversight in one place. In `vision/std`:

    Files.open(path)        AsyncGenerator<Bytes, Result<void, NotGranted>>     no close
    In.stream()             AsyncGenerator<Bytes, Result<void, NotGranted>>     no close
    Listener.accepted()     AsyncGenerator<Socket, Result<void, NotGranted>>    no close
    Proc.run(argv, …)       AsyncGenerator<Bytes, Exit>                         no close

    Files.create(path)      Sink { write, close }                               close

**Every capability that produces has a bare generator and the one that consumes is a struct with a
method.** The host has `closeFeed(i32)` for the read side, so this is a capability the rewrite
dropped, in the same way `Clock` dropped `sleepMillis` — and it was not visible until laziness made
abandonment ordinary.

It stayed invisible because nothing had ever stopped reading early. `@/packages/box`'s `cat` and
`gunzip` drain to the end; `tee` drains to the end. `@/packages/sh/src/pipeline.wac` is the first
thing that does not: `cat big | head -1` pulls one chunk and `head` stops asking, leaving `cat`'s
generator suspended forever with a file open.

**Two answers, and the cost of each is countable rather than arguable.**

**A `Source` beside the `Sink`** — `{ AsyncGenerator<Bytes, R> chunks; fn<Ticket<…>()> close; }`.
Symmetric, needs no language decision, and the file closes when the caller says so. It costs the
spelling at every consumer: `try await for (Bytes c in source)` becomes `… in source.chunks`, across
four capabilities and the four files that use them today, and it makes a stream stop being *the*
value a producer answers. It is also the shape that admits a producer with no close — `In.stream()`
has nothing to release — so a third of them would carry a method that does nothing.

**Or abandonment is defined once, in the language.** Whether a generator that nobody steps again
runs its `defer`, and whether it is distinguishable from one that returned. That answer covers every
generator rather than four capabilities, and `Files.open` needs no method because `defer { close(); }`
inside the producer is the ordinary way to write it.

The second is plainly the better answer and it is blocked on the same thing three other entries here
are: **what a scope's end means when the scope is a suspended machine.** `defer`'s meaning, `schedule`
restoring its target on a trap, and a ticket's `inWait` after one — the same question, and this is the
fourth place it decides something concrete.

Which makes the interim position worth stating rather than leaving implied: a leaked file handle is
not a thing to defer to an open question, and if that question stays open the `Source` is the answer
by default rather than on merit.


## Nothing here has been costed against an implementation, and there are three of them

Measured 2026-09-04. `vision/` mentions a host **280 times across 38 files** — and every one of them
cites what a host *does*, as a fact about the world being designed against. The lines asking what a
host would have to *do differently* if this were built number **two**, and both were written today
while reading `native/v8/src/main.rs` for something else. Nothing reasons about the three hosts
differing.

That matters more here than it would elsewhere, because the three are the point.
`design/system/0001` D9 keeps the wasmtime host on the grounds that it is *the only host that tests
the claim that a wac program does not depend on one* — and a capability surface is exactly the part
of the language where that claim is cashed.

Two things already found by looking, neither of them large and both invisible from inside wac:

**The JavaScript host infers a signature it cannot read.** `worldFor` returns `[Core]` or
`[Core, Cli]` and `entryNode.ts` spreads it positionally into `main`, choosing by which classes the
module contains — its own comment says the two Rust hosts read the parameter list and *"here the
absent class is the same signal"*. With two capabilities the signal and the signature coincide. With
nine projections they come apart in both directions: a program whose *helper* names `Files` is handed
one `main` never asked for, and `main(Out out, Files files)` is handed them in `worldFor`'s order
rather than its own.

**And the reflection `@/packages/wactest` wants is two shipped mechanisms that have never met** —
`call_named` reading an export's parameter *types*, and `worldFor` building a world from `main`'s.
The entry above has it.

**What this does not say is that the proposal is unimplementable.** Neither finding is fatal and one
is a JavaScript-side rewrite of about twenty lines. What it says is that a proposal this size, nine
projections deep, has been argued for nine days against wac and against the shipped *design*, and
never once against the three programs that would have to run it — and the two things that fell out of
half an hour of reading suggest that is where the next ones are.

### Costed, and it is the same three-arm match in all three hosts

Asked the concrete version — *what does each host have to do to hand a program nine projections
instead of two?* — and answered it wrong twice before reading the right function. Both wrong answers
are left named here, because the shape of the mistake is the useful part.

**First guess:** *nothing structural for the two Rust hosts, since they read the parameter list.*
**Second:** *wasmtime matches two literal strings and needs a redesign; the V8-in-Rust host has a
fifty-arm capability table and generalises for free.* The second was written after reading a
capability table that has nothing to do with the question.

Here is what each host actually does with `main`'s signature.

    native/src      build [Core, Cli] in that fixed order, then `args.truncate(params)`
    native/v8/src   match main_sig.params.as_slice() { [] | ["Core"] | ["Core","Cli"] }
    host/*.ts       worldFor returns [Core] or [Core, Cli] by class presence, spread positionally

**A three-case enumeration, written three times, three different ways.** `()`, `(Core)`,
`(Core, Cli)` — and nothing else is expressible in any of them. wasmtime's truncation works only
because the two capabilities are *nested*: a prefix of a fixed list. Nine projections are a **set**,
not a prefix, so truncation, a three-arm match and a class-presence check all fail the same way.

**What misled me is worth more than the correction.** The `(owner, field) → Cap` tables are real and
are fifty arms each — and they dispatch a *method call*, which is already general over any grouping,
because a call arrives with its owner's name attached. World construction is the other question and
nothing in any host generalises it. Two tables in one file, one general and one a three-arm match,
and I read the general one and answered about the other.

So the cost is **uniform and small and free nowhere**: each host replaces its three cases with a
name→builder lookup, which each already has the parts for. That is a better answer than *different
for each* — it means the projections need one change made three times rather than three changes, and
the version made three times is the one most likely to drift.

**And one thing measured that is worth keeping.** The two Rust hosts' capability tables were diffed
by `(owner, field)`: **fifty pairs each, `Cli` 42 and `Core` 8, and the two sets are identical** —
nothing in one that is not in the other. So the hosts agree exactly on what a capability *is*; where
they differ is only in how a world gets handed over, which is the three-arm match above. That makes
the `Page` gap below sharper rather than softer: it is not a host lagging, it is a capability neither
of them has at all.

## The 62 capabilities are a union no host implements, and the shipped design has a word for that

The grouping argument at the top of `vision/std/platform.wac` counts the host's capabilities and
finds groups in them. That count was 50, then 62 once `Page` was noticed. Both treat *the host* as
one thing. Checked against the four entry points on 2026-09-04:

    native/src        (wasmtime)      Page: 0 mentions,  drawPixels: 0,  nextEvent: 0
    native/v8/src     (V8 in Rust)    Page: 0 mentions,  drawPixels: 0,  nextEvent: 0
    packages/platform/host           `pageOf` is imported by `entryBrowser.ts` and nothing else

So **`Page`'s twelve exist on one of four entry points**, and the number every grouping argument
here rests on is a union across hosts that none of them provides. A command-line host has 50.

**The shipped design says this outright and has a name for it**, which vision does not:

> A page to draw on and events to answer, for `--target browser`. **A third profile beside `Core` and
> `Cli`, and only a browser provides it**: a page capability that pretended to work in a terminal
> would be a lie, and the whole point of these structs is that reading one tells you what a program
> can reach.

Three *profiles*, each stated to be available or not on a given host. `vision/std` has nine
projections and no notion of a profile at all — nothing in the file says which of the nine a given
host supplies, and the count that produced them silently unioned two profiles that never coexist.

**And splitting into nine makes this worse rather than better, which is the part worth arguing.**
The whole claim for projections is that a signature says what a program reaches. It now does — and
it says nothing about *where the program can run*. `main(Net net, Out out, Clock clock, Tasks tasks)`
and `page(Out out, Page ui)` look like the same kind of thing; one runs on wasmtime and one cannot,
and no reader of either line can tell. Under three profiles the answer was in the parameter list,
because there were three possible parameter lists.

Two ways out, and the second is the interesting one.

**Keep profiles as a layer above projections** — a `Page` is browser-only and the other eight are
everywhere — which is the shipped answer with more values under it, and needs a place to write the
rule down that today does not exist.

**Or let the projections *be* the profile**, and say a host provides a set: wasmtime provides eight,
a browser provides nine, and *which host can run this program* is answerable by set inclusion over a
signature. That is strictly more expressive than three named profiles, it is what the nine values
already almost are, and it is the version where the type genuinely carries portability. What it needs
is the one thing nothing in this directory has: a statement of **which host supplies what**, which is
a table, and which has to live somewhere a program can be checked against.

Neither is written. `design/system/0001` D9 keeps the wasmtime host because it is *the only host that
tests the claim that a wac program does not depend on one* — and that claim already has an exception
the size of a browser, stated once, in a doc comment on the capability it applies to.

## A missing capability is a value in four places and a trap in forty-six, and both are argued

Set out to write the table the entry above asks for — *which host supplies what* — and found the
question is malformed, for a reason worth more than the table.

The two Rust hosts' capability sets are **identical**: fifty `(owner, field)` pairs each, `Cli` 42 and
`Core` 8, nothing in one absent from the other. So there is no host-by-host set to tabulate. What
varies is what happens when a program asks for something the host has not built, and the tree answers
that **two different ways, in two comments that contradict each other.**

`native/v8/src/main.rs`, mapping four capabilities rather than leaving them to the default:

> Mapped rather than left to `Cap::Unsupported`, which *throws*: **a capability a host does not have
> must be a value the caller reads**, or `LoadedModule.unavailable()` can never be observed and every
> portable program dies on the ask instead of taking its other route.

`native/src/main.rs`, defending the default:

> The whole of D6 in one arm: **a runtime that answered zero here would make every program that used
> the capability wrong in a way nothing could see.**

Both are right, about different capabilities. `load` has a natural *unavailable* answer a caller can
branch on; `readFile` does not, and a zero-length file is not the same as no filesystem. So the rule
is honoured by hand four times — `load`, `call`, `unload`, `validated` — and the other forty-six
throw.

**Which is the answer to the profile question, arriving from underneath.** Portability is dynamic
where a missing capability is a value, and static where it traps. The tree is dynamic four times and
static forty-six, and nothing says which a new capability should be.

`vision/std` makes that harder in the way the projections make everything harder: **a projection
cannot be partly there.** `Page` either is a parameter or is not. Under a flat `Cli` a host could hand
over a struct whose `drawPixels` throws and whose `readFile` works, and a program could ask; under
nine values a host that lacks `Page` cannot hand one over at all, and *"take your other route"* has
nowhere to be written. That is strictly better for the forty-six and strictly worse for the four.

So the honest form of *which host supplies what* is not a table of sets. It is:

- **the fifty are the same everywhere** — the two Rust hosts agree exactly, and the question does not
  arise for them;
- **`Page`'s twelve are the browser's alone**, which is the profile finding above;
- and **what a host does about a capability it lacks is unspecified**, decided per capability by
  whoever added it, with two comments in two files giving opposite reasons.

The third is the one to settle, and it is not a vision question — it is `design/system/0001` D6's,
which the second comment cites and the first one contradicts.

## `Map.create()` takes nothing here and two funcrefs in the tree, which contradicts a decision

Found by auditing `DECISIONS.md` against the spec and the code — the first time its three entries had
been checked against the thing they are meant to reach.

The shipped signature is `Map<K, V> create(fn[i32(K)] hash, fn[bool(K, K)] eq)`, and `core/map.wac`'s
header gives the reason: *"`Map<K, V>` takes its hash and equality as funcrefs rather than requiring
anything of K, because wac has no traits and no constraints on type parameters."*

`vision/core/map.wac` writes `Map<K, V> create()` and says it changed only the nullability of `get`
and `pop`. A `create` with no hash argument can only mean the language hashes `K` for you — which is
what `DECISIONS.md` settles that it does not:

> `is` on two references is `ref.eq` and costs nothing. Identity hashing is not free … A type that
> wants to be a hash key carries the field itself.

**So a decision and a core file in the same directory disagree, and the sharp part is who obeyed.**
`@/packages/quic`'s `Router` needs to key connections by a byte-string id, read the decision, hashed
the id to a `u64` and keyed on that — calling it *"the first place in nineteen subjects where that
decision has cost anything, which is worth recording either way: a decision whose consequences nobody
has met is a decision nobody has tested."* It cost `quic` something because `quic` read the decision.
It cost the four other callers of this `Map` nothing, because the file silently granted what the
decision refuses.

That is the thing worth having: **the decision was tested once, by the subject that went looking for
it, and violated four times by subjects that did not.** A page nothing checks is checked by whoever
happens to read it.

**Which of the two is right is a real question and this does not answer it.** Restoring the funcrefs
puts two arguments on every construction that are the same two functions almost every time —
`hashBytes` and `bytesEq` — which is the noise `core/hash.wac` exists to reduce and does not remove;
`Map<string, V>` is the common case and it is the one that pays. Keeping `create()` needs a story for
where the hash comes from, and *no traits, no constraints on type parameters* is the reason there is
none.

The third option nobody has written down: a **default** hash and equality for the types that have an
obvious one, with the funcrefs still available for the rest. That is not a trait — it is
`generics.md`'s twice-checking with a defaulted argument, and `Result<T, E = union>` already shows a
default type argument in the delta. Whether a *value* argument can default the same way is the part
that is missing, and it is a smaller question than traits.

## The lifecycle rules are per-entry and landing is per-clause

`README.md` gives each of these documents a rule for when an entry goes:

    an example      kept and marked `done` when it lands
    a decision      deleted once it reaches `spec/`
    a question      deleted once it is answered

All three are stated per **entry**, and the first attempt to apply one showed that landing happens
per **clause**. `DECISIONS.md`'s *`_` is a binding that cannot be read* is four claims:

    a pattern      in `spec/spec/enums.md`, 68 uses across 16 shipped files
    a parameter    not in the spec, zero uses anywhere
    a local        not in the spec, zero uses — `i32 _ = f();`, the entry's own example
    reading fails  not in the spec, and the entry says it is the half that matters

A quarter landed. The rule says *deleted once it reaches `spec/`*, so it can never fire, and the
entry can never be current either: nothing in it distinguishes the clause with 68 uses from the one
nobody has written.

**The failure is quiet, which is why it is worth an entry rather than a tidy-up.** A document whose
removal rule cannot fire does not accumulate obviously-stale entries — it accumulates entries that
are three-quarters true, which read exactly like settled ones. `DECISIONS.md` is three entries long
and one of them is in that state; the ratio is what to worry about rather than the count.

Two ways to fix it and they are not equivalent. **Split entries until each is one clause** — which
makes the rules work as written, and turns a readable paragraph into four lines that each need their
own reason, losing the *"enough of the reason that it can be revisited"* the file opens with. Or
**mark clauses rather than entries**, which keeps the prose and needs a notation the pages do not
have and a reader has to learn.

The same question is live for `QUESTIONS.md` and worse, because a question is *supposed* to bundle:
*"`secret` has no return position, no field position and no release"* is three findings held together
because they share a cause, and splitting them would lose the thing that makes them one entry. So the
answer is probably not the same for the three documents — and today all three carry the same
sentence.

## `for … in` means two things by receiver, and the `Vec` one is a method nobody proposed

Counted over the 59 rewritten files, by what the loop head iterates:

    15  `for (T x in name)`          an array, or a variable holding a generator — native
     6  `for (T x in call())`        a call answering a generator — native
     9  `for (T x in v.items())`     a `Vec`, and only through a method `vision/core/vec.wac` added

**A `Vec` is the one container that cannot be iterated directly**, and it is the container this tree
uses everywhere. `gen<T> void items(const this)` has no counterpart in the shipped code: `.items()`
appears **zero** times across `packages/` and `core/`, and `core/vec.wac` has no iterator at all.

So nine of the thirty loops depend on a library addition that no page proposes and no entry here
records, and a reader of `for … in` on the pages cannot tell which of the two they are looking at.

**And it answers an open issue by writing rather than by deciding.** `issues/lang/open/0322a`:

> **What it does on a `Vec`.** `Vec` has `get(i)` rather than `[]`, so either the desugaring knows
> about `Vec` — which is a built-in knowing about a library type — or `Vec` grows whatever the
> desugaring calls. The second is cleaner and is a decision rather than work.

`vision/core/vec.wac` took the second. The issue's own next line scoped out the way it took it:
*"Nothing about generators, which the general form needs and this does not."* So the answer in the
tree is the **larger** of the two shapes the issue offered — a generator per container rather than a
name the desugaring calls — and it arrived without either being argued.

**Which of the two is a real question and the difference is not cosmetic.** A desugaring that calls
a named method needs `Vec` to have that method and nothing else; a `gen`-returning `items()` makes
every iteration a coroutine step, which is what `../bench/` would have to price and has not. It also
makes `for … in` over a `Vec` a *different construct* from `for … in` over an array — one is a loop
the compiler writes, the other is a machine it drives — and the delta's `for_head` rule cannot tell
them apart, because both are `type , IDENT , "in" , expr`.

The smaller shape has a cost the issue does not mention: a built-in that calls `v.items()` by name is
a built-in that knows a library method's name, which is the objection it raises against the *other*
option one clause earlier.

## The rename table lists types and not members, and there are 108 member sites it misses

`GRAMMAR.md`'s table is introduced as *"what it renames or replaces, which the parser cannot see
because the old spelling is perfectly good. It is the class with a migration attached, and nothing
had collected it."* Six rows: `Sys`, `Ticket<T>`, `fn<T(…)>`, a caseless match arm, `default:`, `T?`.

Every one is a **type** or a piece of syntax. Diffing `vision/core` against `core/` and
`vision/std` against `std/` — the first time that has been done member by member — turns up renames
and signature changes *inside* those types, which the table does not have a row for:

    orElse  -> or                34 sites in 11 files    a rename
    unwrap  -> orTrap(why)       16 sites in  5 files    a rename *and* a new required argument
    isDone  -> settled           30 sites in  7 files    a rename, method to funcref field
    then    -> (gone)             9 sites in  5 files    replaced by `Continuation`
    cancel  -> (gone)            19 sites in 10 files    no counterpart proposed
    ─────────────────────────────────────────────────
                                108 sites in 32 files

Small beside `fn[`'s 378, and the point is not the number. **A migration sized from the table would
be wrong in kind**, because a type rename is mechanical and two of these are not: `unwrap()` becomes
`orTrap(why)`, which needs a *message written per call site*, and `cancel` has nowhere to go at all.

`Result.ok()` and `.err()` are dropped too and are not countable this way: `.ok()` has 372 uses
across 59 distinct receivers and almost all of them are `Change.ok()`, which is a different type that
`@/packages/fs` replaces with a union. Worth stating rather than guessing — the receiver names are
`made`, `wrote`, `gone`, `opened`, and no grep separates them from a `Result`.

**And a third of the rows are not renames but deletions**, which the table has no column for. `then`,
`cancel`, `ok`, `err`, and thirteen of `Vec`'s nineteen members are absent from `vision/core` with no
entry saying whether that is a proposal or an omission. For `Vec` the answer is *omission* —
`core/map.wac`'s rewrite says *"only the surface a rewritten package reached for"* and `vec.wac`
did not. For `cancel` it is genuinely unclear, and it is the one to look at: a ticket that cannot be
cancelled is a design position, and nothing here has taken it deliberately.

## `Ticket` has no `cancel`, on the grounds that cancelling does not exist, and it does

`core/ticket.wac` said it twice, in `any` and in the file's closing note: *"The losers are not
cancelled, because there is no such thing."* `std/platform.wac`:

> `void cancel(const this)` — Stop caring. **Detach, not abort**: the host may already be inside the
> work and generally cannot be interrupted. What this guarantees is that the answer is discarded.

It is `this.drop(this.id)`, a host capability, with **19 call sites in 10 files** — and the
distinction it draws, *detach not abort*, is precisely the one the vision comment was denying is
available.

**Not cancelling costs a slot, and the shipped design says so where it matters most.** From the
argument for giving `waitAny` a timeout parameter rather than passing a timer ticket in the list:

> An earlier design passed a timer ticket in the list instead; it worked, and **every caller had to
> remember to cancel the loser or lose a slot for good**.

That is the reason a design was *rejected*. And `Ticket.any` is the same shape — several tickets, one
winner, the rest abandoned — with cancellation removed on the strength of a claim that cancellation
is not a thing.

So this is one wrong sentence and one real gap behind it, and the gap is the interesting half:
`Ticket` has no `cancel` and no `drop` to call, because `TicketBase` is `settled` and `advance` and
nothing else. Adding one is not obviously right either — three questions, none of them settled here.

**What does a cancelled ticket answer?** `wait` on it is neither a value nor a failure the program
caused. `Result<T, union<Circular, Stuck>>` has no arm for *you dropped this*, and adding one makes
every caller handle a case only the caller could have created.

**What cancels the losers of an `any`?** The shipped answer is *the caller remembers*, which the same
paragraph calls out as the flaw in the rejected design. `any` could cancel them itself — it is the
only thing that knows they lost — and then `any` decides for a caller that may still want one.

**And it is the fourth thing that turns on a scope ending.** A trap, a return, an abandoned
generator, and now a deliberate drop: all four ask what happens to work nobody is waiting for, and
the last is the only one with a shipped mechanism. That is an argument for looking at it first.
