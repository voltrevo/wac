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

### Tested 2026-09-05 — 64 candidates, and a tuple would be wrong in every one

The entry above says forty packages found no place for a tuple. Counted what they found instead:
**64 exported two-field structs with no methods** — the exact population a tuple replaces.

They are overwhelmingly fault members, and **34 of the 64 have both fields at the same type**:

    BranchTooShort   { i32 have;    i32 need    }
    TooFewParticipants { i32 saw;   i32 want    }
    ChecksumMismatch { u32 want;    u32 got     }
    BadDistance      { i32 distance; i32 available }
    TrafficKeys      { u8[] key;    u8[] iv     }
    DivMod           { Big q;       Big r       }

As `(i32, i32)` every one of those loses the only thing that distinguishes its members. **That is
the answer to why nothing reached for a tuple**, and it is not *nobody needed a pair* — it is that
every pair here is a pair whose members must not be confused, which is the one property a tuple
gives up.

**And two of the 64 prove it against each other.** `std`'s `WrongSize { i32 want; i32 got; }` and
`@/packages/ssz`'s `BadFirstOffset { i32 got; i32 want; }` are the same two fields in **opposite
orders**, in two packages, both correct. As tuples they would be one type, and `Err(WrongSize(a, b))`
would compile where `BadFirstOffset` was meant.

So the zero is real and the reason is a positive one. What a tuple would be for — a pair whose
members are told apart by *position* — is what this directory never wants, because it has spent five
days finding places where position was the bug.

*(A second, smaller thing the count found: `Span` is declared twice, `{ from, to }` in
`@/packages/ts/src/bundle.wac` and `{ line, col }` in `@/packages/wacc/src/ast.wac`. Same name, two
meanings, two packages — the bare-variant-namespace entry's shape at the level of a struct.)*

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

## The wire format has two dimensions and the value has arbitrarily many

`vision/packages/sh/src/exec.wac` says the important half already: within one instance authority is a
value, across a spawn it is not and cannot be, and *"the bitfield is not a design compromise, it is
the serialised form of a capability."* What it does not say is that **the two are diverging, and
vision's own other proposals are what widens the gap.**

The shipped wire format is a category and a root: `cli.spawn(src, args, GRANT_READ | GRANT_NET, dir,
…)`, and `std/platform.wac` puts it well — *"A shell served over a socket can be given one directory
and no network."* Two dimensions, and both of them are things a host can enforce.

**And `vision/std`'s own `spawn` carries one of the two.** Measured 2026-09-04: `Proc.spawn` takes
`Vec<Grant>` — the category — and the `dir` is gone with the three other parameters the arity
comparison found missing. So the gap this entry is about has a third side nobody had looked at: the
value is wider than the wire, the wire is wider than what vision proposes to send, and the package
written to study the boundary states two dimensions while the signature it studies has one.

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

**And a second site, which is what turns it from a coroutine detail into the rule error sets rest
on.** Added 2026-09-04 from `@/packages/gzip`. A source that cannot fail still has to name a failure,
because `AsyncGenerator<Y, R>`'s `R` is not optional — so `once(b)`, a stream over one value the
program already holds, answers `Result<void, never>`. Every consumer's signature is
`union<E, Fault>`, so at that call site it is **`union<never, Fault>`**, and unless that reduces to
`Fault` every buffer-in caller in the tree answers a union with a member nobody can construct.

`union<A, B>` lowers to an enum of one-field variants — `TECHNICAL.md` measures it — so *reduce the
union* and *delete the arm* are **the same operation** as `Step<never, Y, R>` losing its `Waiting`.
One rule, two sites, and only the first was written down:

| | |
|---|---|
| `Step<never, Y, R>` | a match is exhaustive in two arms rather than three-with-a-dead-one |
| `union<never, E>` | is `E`, and a caller does not handle an arm that cannot exist |

That matters for the *argument* rather than the implementation. A feature justified by one design's
convenience is easy to decline; a feature that error-set composition does not work without is not,
and error sets are the thing this directory has changed most. It also sharpens the open part above:
if a dead arm must stay legal for a generic body to be writable, then `union<E, Fault>` with `E`
opaque needs the arm and `union<never, Fault>` must not — which is exactly the two-pass shape
`generics.md` already has, arriving from a second direction.

**A ninth contextual word.** `never` was missing from the keyword-cost table in this file. Measured:
**1,882 grep hits and 12 in code**, in 8 files, two of them genuine variable names —
`Pending<i64> never = core.sleepMillis(10000);` in `platform`'s wacland example and `i32 never` in a
raster test. So it is cheap to take, and the 99.4% prose rate is the most extreme in the table by a
distance, which is what happens when a reserved word is also an ordinary English one.

## A sentinel drawn from the value's own range — six, and this entry owns the list

Counted 2026-09-04, after `@/packages/tty`'s note claimed five and double-counted one:

| where | the sentinel | in the range of |
|---|---|---|
| `@/packages/unicode`'s `decode` | `s.code == -2` means truncated | a code point |
| `@/packages/regex`'s `search` | `NO_MATCH` at `-1`, `BUDGET` at `-2` | a match offset |
| `std`'s `Socket` | a negative handle | a handle |
| `std`'s `In.read` | an empty array means *end* | a read's bytes — **fixed**: `In` is a stream |
| `@/packages/tty`'s `Sig` | `0` means *nothing happened* | a signal number |
| `@/packages/wacpkg`'s `mapped` | `""` means *no mapping* | a resolved key |

`@/packages/tty` listed *"`Read.code`, `search`'s `NO_MATCH`, `decode`'s `-2` and `Socket`'s negative
handle"* and called itself the fifth. `Read.code` and *`decode`'s `-2`* are the same instance under
two names — `Read` is `std`'s socket sum and has no `code`; the field is `Scalar.code`, `unicode`'s.
So four names for three facts, and the ordinal was one too high.

One of the six is fixed and the fix is the useful part: `In.read` stopped being a ticket-and-a-
sentinel by becoming a **stream**, and the sentinel did not get a better spelling — it stopped
existing, because a generator ending is the loop ending. Two of the remaining five (`Socket`'s
handle, `mapped`'s `""`) are the same shape and could go the same way; `search`'s `NO_MATCH` and
`Sig`'s `0` want a sum type instead.

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
  per-line. `../bench/slicecost.wac` puts that at 2.6 ns on the v8 host, which is nothing against I/O and not
  nothing against `Out.write` in a loop.
- **`u8[]` everywhere** makes the capability surface the *owning* type and pushes the view to the
  parsers, which is where `slice.wac`'s argument for it actually lives.
- **Mixed, deliberately**, with a stated rule — for instance, *a capability that hands bytes over
  answers `Bytes`, one that is handed bytes takes `u8[]`* — which is the direction the widening
  already permits and would have made this seam typecheck by construction.

The third is the only one that treats the one-directional rule as information rather than as an
obstacle, which is a point in its favour.

**None of the three was taken, and the seam this entry predicted now exists.** Measured 2026-09-04:
four call sites in `@/packages/box` pass a `Bytes` — pulled from a generator — straight into
`Out.write`, whose parameter is `u8[]`. `u8[] → Bytes` is the direction the widening goes, so these
are the way it does not, in `cat`, `tee` and `gunzip`, written on three different days by somebody
who did not look.

And a second write shape arrived while the question was open. `Files.create` answers a `Sink` whose
`write` is `fn<Ticket<Result<void, NotGranted>>(Bytes)>`, against `Out.write`'s `fn<bool(u8[])>` —
different parameter type *and* different return. `tee.wac` writes to one of each in the same loop and
reads as though they were interchangeable.

So the entry's own conclusion — that the mixed rule *"would have made this seam typecheck by
construction"* — is now the only one of the three that also *repairs* something, since `Out` hands
bytes over and `Sink` is handed them, which is exactly the split it proposes. That is an argument the
entry could not make when it was written, because there was one write shape and no consumer.

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

### Tested 2026-09-05 — five uses, all want the same answer, and the trap half is a host question

Named the callers and asked what each would do under each answer. There are five now, not four, and
one is in `core`:

| | what it restores | if `defer` does not run on an early exit |
|---|---|---|
| `@/packages/json/src/parse.wac` ×2 | `this.depth -= 1` | a reused parser leaks depth and grows stricter |
| `@/packages/server/src/main.wac` | `conn.close()` | a connection leaks per failed request |
| `@/packages/box/src/more.wac` | `in.setMode(was)` | the terminal stays in cbreak |
| `core/ticket.wac` | `this.inWait = false` | a ticket answers `Circular` for ever after |

**All five want the same answer**: `defer` runs on every exit, including a `return` from inside a
loop and including a `try` propagation. Not one wants the other, and `core`'s is the sharpest — a
re-entrancy flag that never clears is a `wait` that refuses everything.

**And the trap half turns out to be a host question, not a language one.**
`packages/wactest/README.md` settles what a trap does, having been wrong about it for long enough
that *"72 host-side files were written around it"*: a trap **unwinds that module and nothing else,
leaving the tests after it to run normally.** So the module is gone, and everything four of the five
`defer`s restore is module-local state that dies with it. Whether they ran is unobservable.

The exception is `more.wac`, and it is the only one: `in.setMode(was)` restores **the host's**
terminal, which outlives the module. If a pager traps, the question *did the `defer` run* is answered
by a person's shell no longer echoing.

So the rule splits cleanly, and neither half is the open question this entry described:

- **On a normal exit** — every use wants it, unanimously, including through `try`. Nothing here is
  undecided.
- **On a trap** — observable only where a `defer` restores state outside the module, which is one use
  in five, and the decision is whether a capability's state should be restored when its holder dies.
  That is a question about `std` and the host, and `../QUESTIONS.md`'s entry on a terminal mode being
  ambient is where it already lives.

*(Distinct from* What a trap does to a scope *above, which asks what **unwinding** does to a
`defer` and to `schedule` together. This asks what the construct **is**. They were easy to read as
one and answering either leaves the other open.)*

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

## Five examples the vetted pages need, and not one is a language question

Collected 2026-09-04 from five separate entries. They were five because each was noticed while
writing about something else, and keeping them apart made this file look like it had five more open
language questions than it has. **None of them is a question**: each is a known answer with no page
showing it, which is `SHOWCASE.md`'s work rather than a decision anybody has to take.

Worth one entry because the *pattern* is a finding about this document: it holds two genres — what
the language should do, and what the pages should say — and the second is much cheaper to add, so it
accumulates.

- **`wait`.** Nothing on the page mentions it. Candidates: driving a coroutine to completion from
  sync code, the `Err` when this host cannot be waited on, that it drains the dependency set rather
  than descending depth-first, and the circular case. Four is probably too many for one feature.
- **The keyword rule.** `await` is illegal in a generator, `yield` is illegal in an async function,
  and an async generator has both. Probably a refusal, since the legal cases already appear.
- **Stepping a finished machine.** It has to be a no-op: a scheduler can hold a continuation for a
  machine somebody else waited to completion, and there is no way to withdraw the registration.
- **`auto` refusing to widen.** `auto` takes the type an expression already has and `union` is the
  widening marker; an array whose elements disagree is the case that separates them.
- **A default type argument.** `enum Result<T, E = union>` is what makes `Result<T>` an ordinary
  generic rather than a special form, and it is what lets `Result`'s current blessing expire.

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

**1.4 ns a box on the v8 host, and 0 ns when the answer is `null`.** The asymmetry is the part worth having,
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

### Tested 2026-09-05 — eleven forced unwraps, **no chains at all**, and `?.` is wrong at every one

Optional chaining shortens `a?.b?.c`: a **chain**. Counted over the 157 files — `x!.` appears
**11 times, and not once with two forced links in one expression.** There is no chain to shorten.

What the eleven are is the finding. Every one is a single `x!` immediately after a null test, and in
every one **the absent case has a specific, non-null consequence**:

| | what it writes | what `?.` would give |
|---|---|---|
| `@/packages/json/src/value.wac` | `(this.index is not null) && (this.index!.get(key) is null)` | `this.index?.get(key) is null` — which conflates *no index* with *no such key* |
| `@/packages/raster/src/surface.wac` | `this.damage is null ? r : this.damage!.cover(r)` | nothing — the absent case answers `r`, not null |
| `@/packages/raster/src/frame.wac` | `t!.at.x` … five fields after `if (t is null) { return Ok; }` | five separate absences where the code has one |
| `@/packages/lightclient/src/validate.wac` | `attested!.slot` after a check that returns a **fault** | a null, where the caller needs `MalformedHeader` |

**`?.` answers *something was absent* without saying which link**, and every site here either needs
to say which, or needs the absent case to produce a value, a fault or a return.

So this is the `bool` that answers several questions, at expression level — and this directory has
spent five days removing that shape from signatures. The zero is not an oversight; it is the same
finding as the tuple one, in the other direction: **a construct that collapses a distinction finds no
users in code written to preserve distinctions.**

The honest limit: `?.` earns its keep where a caller genuinely wants *null if anything is missing*,
and with no chain anywhere in 157 files there is no evidence either way about whether such a caller
exists here. What can be said is that none of the eleven is one.

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

*(Whether a union may **contain** one is settled by use and lives in* Flattening a union: three
behaviours *below — three consumers, three answers, and the members being disjoint or not is what
separates the first two. This entry is the naming and dispatch half, which is a different question
and was tangled with it.)*

**And there is a third part nobody has written down: how one dispatches.** An enum has a tag, and
`spec/spec/enums.md`'s *How it compiles* says what that buys — *"`match` compiles to a comparison
chain on the tag, then one downcast in the selected arm"*, and, of the alternative, *"the
alternative is a `ref.test` per arm, and an integer comparison is cheaper than a type test."* A union
has no tag by construction: its members are unrelated structs that were not declared together, which
is the whole reason `union<RequestFault, BadStatus>` can compose and an enum cannot. So the spec has
already priced the mechanism a union needs, and priced it as the more expensive one.

Two things follow that the naming question does not reach. **The cost is real and small** — the same
file measures a 20-variant tag chain at 2.5 ns and a payload-less construction at 0.9 ns, v8 again over an
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

**Measured 2026-09-04, and two of the three do not compile.**

| written | today |
|---|---|
| `Res.Ok` — qualified, no parentheses | **compiles and runs**, at `T = void` and at every other `T` |
| `Res.Ok()` — empty parentheses | `a variant with the wrong count` |
| `Ok` — unqualified, no parentheses | `unresolved name Ok` |
| `Ok(Unit())` — a one-member struct standing in for `void` | compiles and runs |

So the choice is narrower than the entry assumed and worse. The one spelling that works is the
qualified bare form, and **it works through `issues/lang/0335a`** — a payload-carrying variant
written bare is accepted at *every* `T`, so `enum Sh { A, B(string s) }` with `return Sh.B;` also
compiles and traps on a null. Fixing that bug removes the only spelling that works unless `void` is
carved out, which is what makes this entry the decision the fix is waiting on rather than a
preference between three uglinesses.

And it is not the whole of the problem: see below, because the *unqualified* form this directory
writes everywhere does not work at any `T`.

## Whether vision's new words are keywords — 226 identifiers say, and 175 of them say `secret`

`try`, `gen`, `defer`, `schedule`, `yield`, `in`, `union` and `secret` are written all over these
pages and no entry says what they *are*. `vision/GRAMMAR.ebnf` had to decide in order to exist, and
it decided **contextual** — none of them is a keyword, each is an `IDENT` that a rule matches by
spelling. Every vision file parses that way, so the question is not *can they be*.

**It did not decide, and that is the first correction here.** `tools/specparse.ts` read the keyword
set from the spec's fence and the delta was applied to the *rules* only, so a delta could change the
grammar and **could not change the lexer**. Contextual was not the answer vision picked; it was the
only thing the mechanism could express. The `…` filter in the same tool — a character dropped by name
before parsing, because there was nowhere to declare it — is the identical gap, worked around rather
than closed.

Fixed 2026-09-05: `(* keywords += a b c *)` in the delta, unioned into the fence's set. One line, and
it makes both answers runnable.

**So the six free words are now demonstrated rather than asserted.** With `try`, `yield`, `defer`,
`schedule`, `auto` and `coroutine` as real keywords, **178/178 vision files still parse.** They are
in `GRAMMAR.ebnf` as keywords now; `secret` and `gen` are deliberately not.

**And the cost of the other answer is a parse result rather than a grep.** Put `secret` in the list
and run the vision grammar over the shipped `packages/quic`:

    secret a keyword:      7 of 40 files refused — "no rule reaches 'secret'"
                           initial.wac:72, keys.wac:79, server.wac:245, and four tests
    control, same files:   40/40 parse

Which is what the 175 looks like when something runs it.

**The other side of the trade, measured 2026-09-05 and never before:** if they were real keywords,
how much existing code would stop compiling? Counted on the shipped tree's token stream — occurrences
of each word **as an `IDENT`**, so a string or a comment does not count:

    secret     175   in 30 files
    gen         38   in  8
    never        7   in  3
    union        6   in  1
    auto, coroutine, defer, schedule, try, yield      0
                     ————
                     226

**`secret` is the cost, at 4.6× the next word**, and where it lands is the point:

    packages/quic/src/initial.wac:72     u8[] secret = initialSecret(clientDcid, isServer);
    packages/quic/src/client.wac:258     u8[] secret = handshakeTrafficSecret(dhe, transcript2(…), true);
    packages/crypto/test/wac/nistcurve_test.wac:583
                                         u8[] secret = p256Ecdh(u8[32](fill: 0x22), good);

Every one is `u8[] secret = …` — a **local holding key material**, which is exactly the declaration
`@/packages/crypto/src/secret.wac` wants to write as `secret u8[] secret = …`. The qualifier whose
entire purpose is cryptographic material collides precisely with the code that would use it, 175
times, and the collision is not incidental: it is the same word for the same thing on both sides of
the declaration.

Six of the ten cost nothing at all, which is worth as much: `try`, `yield`, `defer`, `schedule`,
`auto` and `coroutine` are free, so *make them keywords* is available for six of the ten and the
question is really about `secret` and, distantly, `gen`.

So the trade now has both sides. **Contextual**: the grammar cannot state the feature and no tool can
check it. **Keyword**: 226 renames, 175 of them in the two packages the feature is for. And they are
not the only two options — a keyword that is only a keyword *before a type* is what `const` already
is, and `secret u8[] key;` versus `secret = k;` is one token of lookahead. That is not free either:
it is the contextual case with a rule, which the grammar *can* state, and it is what
`spec/spec/grammar.md` does for `from` and `fill` today.

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
is a type error today — and `packages/fmt`'s header says that is **deliberate**. The word is in the
original and the reason is recorded nowhere I could find.

**Measured 2026-09-04**, and the message this entry quoted was not the one:

    "n=\{n}"   →  untyped binary whose operands disagree: string and i32

Not `operands have mismatched types`. The wording matters a little, because *untyped binary* says
the compiler is treating this as the ordinary `+` rule reaching an untyped literal — which confirms
the entry's premise from the implementation's side: interpolation really is sugar for `+` today, so
widening `+` is the whole of the change and there is no separate interpolation rule to write.

Also measured: `"listen: \{e.what}"` — a **string** field — compiles and runs, so the shipped half is
shipped and only the scalar case is the proposal. `@/packages/page/src/counter.wac` has the one use
of the proposed form in real code here, `out.log("counted to \{n}")`.

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

**Measured 2026-09-04, and this is the one that does not paper over.** Passing an `i32[]` where a
`Sl<i32>` is expected is one type error *and* an invalid module — the engine refuses it with
`call[0] expected type (ref null 3), found local.get of type (ref null 0)`. The other two vision
assumptions measured the same day — an unqualified variant construction and `u8` as a scalar — both
emit modules that run correctly. So of the three, this is the only one where the code generator
also has nothing to fall back on, which is what a widening between two different heap types should
look like: there is a struct to allocate and no instruction that invents one.

That makes it a *bigger* ask than the other two and a clearer one. `T` to `T?` is free because a
nullable reference is the same reference; `T[]` to `Slice<T>` allocates a three-field struct, so an
implicit widening here is an implicit allocation, at every call site, invisibly. Worth deciding on
that basis rather than on the analogy the file offers — and the answer may well be that it should be
explicit, which costs `Slice.all(a)` at the call sites and says where the allocation happens.

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

Re-checked on 2026-09-04, after the crypto digests were written. **Seventeen references to twelve
distinct files that are not in `vision/`:**

    4  @/packages/box/src/lib/args.wac                      box/{cat,echo,gunzip,tee}
    2  ./response.wac        2  ./headers.wac               http
    1  ./stringify.wac  ./atof.wac  ./routes.wac            json, fmt, server
    1  ./huffman.wac  ./crc32.wac                           gzip
    1  ./case.wac  ./printable.wac                          unicode
    1  ./percent.wac  ./host.wac                            url

Against eleven `@/` imports that do resolve inside `vision/`, so the mechanism is used and a third of
the time it names nothing.

**All twelve targets exist in `packages/`**, at exactly the path with `vision/` taken off the front —
checked, all twelve.

### Eleven of the twelve are `./` siblings, which the first count missed

The earlier version of this entry counted the `@/` form and read the rest as the same thing. They are
not. `@/` at least **names a project root**, which a resolver could be told to chain; `./stringify.wac`
names the directory the importing file is already in. An overlay for relative imports means **a
file's own directory is two directories**, which is a larger claim and one no manifest key could
express — and it is what eleven of the twelve already assume.

So the question is not *should `@/` fall through*. It is whether a *directory* can layer over another
directory, and `@/` is the smaller half of it.

(An earlier count said fifteen distinct targets and listed three crypto files among them. Those were
written on 2026-09-04 and five references went with them. A count in a comment ages against work that
has nothing to do with the question it is counting — the argument for numbers living beside the
method that produces them.) So this is a *convention* rather than seventeen mistakes: an import may name a file the
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
through if absent* is not something the resolver can currently express.

### Corrected 2026-09-04 by writing the resolver: it needs no language change

`@/packages/wacpkg/src/resolve.wac` is the resolver as this directory would have it, and writing it
showed the sentence above to be half wrong.

**An overlay is not a manifest key**, and that half stands: a key would mean *if absent, look over
there*, and absence is a filesystem question the resolver cannot ask.

**But the reader can ask it.** `Res` already carries `mapFrom`/`mapSpec`/`mapTo` and `resolveVia`
consults them *first*, with the reason written at the line: *"A mapping first, because only the
reader could have resolved one."* That is how a **git dependency** works — something with a
filesystem and a lockfile looks it up and hands the resolver an answer. An overlay is the same fact:
try `vision/<path>`, fall back to `<path>`, emit a mapping. Seventeen mappings for this directory,
computed by something that already walks the files in order to read them.

So three proposals — a package entry point, a git dependency, and an overlay — are **one mechanism,
and the mechanism exists**. None of them needs a change to `path.wac`, which is the file all three
were assumed to be about. `../packages/wacpkg/README.md` had already reached that conclusion for the
entry point and said why it had been missed: *"it was written without looking."*

What remains is smaller and is a real choice: **is the fallback the reader's policy or something a
project declares?** As a policy it is one flag on whatever drives the compiler and no language
surface at all. As a declaration it is a manifest field the *reader* honours — `{ overlay: ".." }` —
which is still not the resolver reading a manifest, and is how a fork or a vendored dependency would
want to say it once rather than per invocation. `@/packages/wacpkg`'s
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

### Tested 2026-09-05 by counting what the first consumer actually uses it for

`@/packages/wacc/src/walk.wac` is the brace pattern's only consumer, and it has **13 brace arms**.
They are not one thing:

| | arms | what the positional form does |
|---|---|---|
| a whole-payload wildcard — `IntLit { .. }`, `Call { .. }` | **6** | `Call(_)` already, and `ast.wac` says so: *"`{ .. }` duplicates something rather than adding it"* |
| every field by name — `Ternary { cond, then, els }` | **6** | `Ternary(cond, then, els)`, which compiles with any two of the three transposed |
| a **subset** by name — `Cast { operand, .. }` | **1** | `Cast(_, operand, _)`, counting underscores |

So **six of thirteen are served today**, six are legibility and transposition safety, and **one does
something the positional form cannot do at all.**

That is a different claim from the entry's, which leads with *291 match arms in the tree bind two or
more payload fields where two share a type*. The 291 is the size of the **hazard**, not of what the
pattern buys — and searched for, the hazard has no incident: no commit in this repository's history
records a transposed binding being fixed. Weak evidence, since one could have been caught before a
commit, and it is the only evidence there is.

**So the ask splits three ways and only one part is unarguable:**

- **Subset binding** — impossible today, wanted once in the one consumer, and the case `ast.wac`
  makes for it is exact: `Func { nameTok, body, .. }` binds two of seven where fifty-four
  `StructDecl` arms bind a handful of nine.
- **By-name binding** — legibility, plus a safety property with 291 opportunities and zero known
  failures. Worth having, and it is not the emergency the count implies.
- **`{ .. }`** — already available as `(_)`, and this file said so before the consumer existed.

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

**Promoted 2026-09-05, then narrowed the same day, and the narrowing is the entry.** What follows was
written as *this is the construct standing between this directory's AST argument and an AST*, promoted
twice, and it is wrong in its general form. `GRAMMAR.ebnf` has **two** pattern languages and this
entry reads one:

    binding_list   = binding , { "," , binding } , [ "," ] ;
    binding        = IDENT | "is" , type ;
    arm_payload    = "(" , [ binding_list ] , ")" | "{" , field_pattern , "}" ;
    field_pattern  = ".." | IDENT , { "," , IDENT } , [ "," , ".." ] , [ "," ] ;

The parenthesised form binds by **position** and can match by type without binding. The **brace
pattern** binds by **field name** — `@/packages/wacc/src/walk.wac` uses it in every arm — and
`match_arm` is `IDENT , [ arm_payload ]`, which does not care whether the `IDENT` names an enum
variant or a union member. So `Func { name, ret, .. }:` is grammatical and
`@/packages/wacc/src/genlower.wac`'s `generatorsIn` is written with it.

> **The brace pattern binds field names, so an arm can read its subject exactly when the subject has
> fields.** An enum variant with a named payload has them; a union member that is a *struct* has them;
> a union member that is itself a *union* does not — which is `gunzip`'s `Err(is Corrupt):`, where
> `Corrupt` is eight members and there is nothing to name.

So the gap above is real and it is about **nested unions**. It does not reach a union of structs, and
a union of named structs is therefore usable as an AST in both directions.

**How it survived three commits is the part to keep.** I took a real gap, generalised it to the case
in front of me, and the two differ in the one property the brace pattern needs. Then each restatement
was more confident than the last — *a small gap*, *load-bearing*, *it splits a pass in half* — because
each new file made the consequence larger. **How important a claim would be is not evidence for it**,
and here it made the claim harder to check rather than easier: the check was one grammar file in the
same repository, and the thing to check was a construct's *absence*, which a targeted grep cannot
find. Reading the production whole is nineteen lines.

*And the instrument that produced it now has a flag.* `tools/specparse.ts --rule=<name>` prints one
production **whole**, from its first line to its terminating `;`, in the spec grammar or in the
vision delta. It exists because a grep of an EBNF file is a lie about anything with alternatives on
later lines, and that cost two wrong findings in one day:

  * `arm_payload`'s second alternative is the brace pattern. Reading the first produced three commits
    claiming a union arm cannot bind its fields.
  * `match_arm`'s second alternative is `"else" , ":" , { statement }`. Reading the first produced a
    half-written claim that a statement `match` cannot have a default, which 635 arms in 94 shipped
    files disprove. That one was caught before it was written down, by running the parser over
    `packages/fs` and watching it pass.

Both are the same shape and neither is careless: **a targeted grep cannot find an absence**, because
the thing being looked for is the thing that is not on the line that matched. A habit does not fix
that and a flag does.

*Also re-checked the same day:* every claim in this directory that a construct **is not in the
grammar** was read against its production, since the one below was wrong. Two survive and both hold —
`Binary { left: lhs }`, a binding that renames, is refused by `field_pattern = ".." | IDENT , { ","
, IDENT } , …`, which takes bare identifiers; and `Err(is Corrupt c):` is refused by `binding = IDENT
| "is" , type`, an alternation. The rest of the hits are quotations of the spec rather than claims.
So the error below was a single generalisation rather than a habit, which is worth knowing in both
directions.

*The superseded argument, kept:* Written above about a two-arm error union whose payload is one string, which made it look
small. `@/packages/wacc/src/ast.wac` counts the positional-swap hazard across the tree and its two
worst entries are declarations — *"`StructDecl` has seven fields and fifty-four arms; `Func` has
seven and forty-three, including `bool exported` and `bool isAsync`, which are adjacent, identical
and mean opposite things"* — and the fix that argument implies is a **union of named structs**
instead of an enum of positional variants. `@/packages/wacc/src/decl.wac` writes it, and it works:
there is no order to get wrong and a transposition is a compile error.

Then nothing can read one.

| | construction | reading |
|---|---|---|
| enum of positional variants | swappable, silent | binds seven locals |
| union of named structs | **named, checked** | **cannot reach the fields** |

An enum arm binds its payload, in the wrong order if you are unlucky, which is the hazard. A union
arm gives you the knowledge that it is a `Func` and no way to reach `name`. So the fix trades a
silent wrong answer for a pass that cannot be written at all, and there is no third option today.
`Func f:` — `Err(is Corrupt c):` generalised — closes it, and with it the swap hazard in the largest
enum in the compiler goes away for one keystroke per field.

**And rewriting `@/packages/wacc/src/genlower.wac` against the new `Decl` says exactly which half
stops.** That file had ended at a signature for want of a declaration node; with one, `plan` and
`emit` are writable and `generatorsIn` is not:

  * **Emitting only constructs.** `StructDecl { name: t, fields: fs, … }` is where the
    union-of-named-structs is at its best — named, checked, nothing to transpose.
  * **Walking has to read.** Finding the `gen` functions means matching a `Decl`'s `kind`, and the
    arm knows it has a `Func` and cannot reach `isAsync`.

> **The binding gap splits a pass in half.** A compiler pass is *find the nodes* and *emit the
> replacement*; a union of named structs makes the second half safer and the first half impossible.

So the cost is not one function. Every rewriting pass over declarations is blocked until `Func f:`
exists, and every pass that only *produces* them is not. It also explains why `desugar.wac` and the
`union` lowering were writable: statements and types in that tree are **enums**, whose arms bind.
Only declarations are a union, because only declarations were written after the argument for unions
was made.

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

**And the shipped streaming pipeline solves the same problem the opposite way**, which was found
later and changes the question. `runPipeline`: *"`seq 1 200000 | head -1` used to take twelve seconds,
because each stage ran to completion and handed its whole output to the next. A real shell returns at
once: **`head` closing its input is what stops `seq`.**"* Issue 0038.

So the mechanism is an explicit close travelling upstream, and this design replaced it with the
absence of a pull — the same trade `Socket.closeSend` is about one layer down, and the shipped answer
is a positive signal in both places. Three things an absence cannot do that a close can: carry a
reason, be told apart from a slow consumer, and **reach past one link**. `head` closing its input
stops `seq` through however many stages lie between; a consumer that merely stops pulling stops the
stage next to it and nothing further.

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
entry can never be current either: nothing in it distinguishes the clause with the uses from the one
nobody has written.

**Re-measured 2026-09-05 on the token stream, and three of the four clauses move.** The two *zero
uses* claims are confirmed — no `T _` parameter and no `T _ = e;` local exists in `packages`, `core`,
`std` or `tools`. The first clause does not reproduce:

    entry says   68 uses across 16 shipped files
    measured     79 `_` tokens, on 58 distinct lines, in 16 files

Sixteen matches and no measure gives 68, so the number was counted some other way and the entry does
not say which — which is the ordinal problem this file has an entry about, in this file.

And the measurement found something the entry does not have. **Every one of the 79 is inside
parentheses:**

    prev='('  next=')'    47   in 12 files
    prev=','  next=','    14   in  5 files
    prev=','  next=')'    12   in  9 files
    prev='('  next=','     6   in  5 files

There is **no bare `_:` arm anywhere in the tree.** So `_` in shipped wac means exactly one thing —
*this payload field is unused* — and never *this whole case is unused*, which is the use most
languages have it for and which nobody here has written. The entry frames `_` as *a binding that
cannot be read*; the tree says it is *a payload position that is not named*, and those differ in
whether the wildcard-arm use is missing or merely unexercised.

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

## Eight capabilities lost their ticket, and nothing anywhere says why

The capability audit compared **names**. Comparing **signatures**, member by member against
`std/platform.wac`, is a different check and had not been run. It turns up one change made eight
times and argued nowhere:

    vision                              shipped                        
    Env.arg        fn<string(i32)>      fn[Pending<u8[]>(i32)]        ticket gone, u8[] → string
    Env.argCount   fn<i32()>            fn[Pending<i32>()]            ticket gone
    Env.get        fn<string?(string)>  fn[Pending<u8[]?>(string)]    ticket gone, u8[] → string
    Env.cwd        fn<string()>         fn[Pending<string>()]         ticket gone
    Clock.nowMillis      fn<i64()>      fn[Pending<i64>()]            ticket gone
    Clock.monotonicNanos fn<i64()>      fn[Pending<i64>()]            ticket gone
    Random.fill    fn<void(u8[])>       fn[Pending<u8[]>(i32)]        ticket gone, allocate → fill
    Out.write      fn<bool(u8[])>       fn[bool(u8[])]                same, once restored

Seven of the eight are synchronous here and a ticket in the tree. Searching `vision/` for the word
*synchronous* finds three hits and none of them is about this.

**It is probably right, and that is why it needs saying.** Every one of the seven is a fact the host
already holds: `argCount` cannot block, a clock read is a load, filling bytes from an entropy pool
does not wait on the world. `std/platform.wac`'s reason for making them tickets anyway is
uniformity — everything crossing the boundary is a `Pending` — and dropping it for the ones that
cannot block is a real simplification that removes an `await` from every use.

What is missing is the rule. **Which capabilities may be synchronous?** *Those that cannot block* is
the obvious answer and it is not checkable from this side: whether `cwd` blocks is a property of a
host, and `native/v8/src`'s table has an arm for it either way. A host that had to *fetch* the
working directory — a page asking its opener, a remote shell — could not supply
`fn<string()>` at all, and would have to fail at construction rather than at the call.

**And `Random.fill` changed shape twice over**, which is the one to look at separately: not just
synchronous but *fill-in-place* against the shipped *allocate-and-return*. That is the slice argument
arriving in a capability — a caller who owns the buffer avoids the allocation — and it is exactly the
change `core/slice.wac` exists to enable. It is also the only member here whose new signature cannot
express what the old one did: `randomBytes(n)` with no buffer to hand is now two lines.

## Two members added by an audit answer a type that cannot express what they are for

`Stat` here is three fields — `size`, `isDir`, `modified`. The shipped one is eight: `exists`,
`isFile`, `isDir`, `size`, `modifiedMillis`, `isSymlink`, `isExecutable`, `fault`. Found by the
signature diff, which had already turned up `Out.write`'s missing `bool` and seven capabilities that
quietly became synchronous — the same check, one type further along.

**Two of the five missing make members of `vision/std` itself meaningless**, and both members were
added *by the audits that this document records as successes*.

`Files.linkStat` came from the projections audit — *"the `Files` projection was missing two of the
fourteen"*. What `linkStat` is **for** is `isSymlink`, and the shipped doc says so:

> **Always false from `stat`**, which follows links and therefore describes what one leads to.
> `linkStat` is the one that answers this. Both exist because both questions are real: `find` wants
> to know whether to descend into what a name leads to, and `tar` wants to know whether the name is a
> link before it stores anything.

Two members answering three fields answer the same question. The audit restored the **call** and not
the thing it is for.

`Files.setExecutable` came from the host-capability diff. `Stat` has no `isExecutable`, so a program
can set the bit and cannot read it — and the shipped field's doc is the reason it matters:
*"one bit, not a mode … it is what distinguishes git's `100644` from its `100755`"*, with
`issues/system/0132` naming the commit that recorded every blob as `100644` because nothing could
tell.

**Which is the finding rather than the two fields.** An audit that compares *what a capability can be
asked* is not an audit of *what it can answer*, and both of these passed the first and fail the
second. That is the third form of the same mistake this document has now recorded: comparing names
missed signatures, comparing signatures missed return **types**, and each was a cheaper check
standing in for a dearer one.

**And `exists` is not a missing field but a question about the `Result`.** `Files.stat` answers
`Ticket<Result<Stat, NotGranted>>`; `NotGranted` means *the grant did not include this*, not *there
is no such file*. Absence has nowhere to go — not an `Err` this can name, and no `exists` to say it
with. Same hole as `Files.open` and `In.stream`, in a third place, which is why it belongs to the
entry about a capability answering only its own failure rather than here.

## The layering rule is broken in the one signature that has been used to justify a hole

*`std` is below the packages* is the reason given, in `vision/std/platform.wac` and three entries
here, for why a capability can only fail with `NotGranted`:

- `Files.open` cannot answer `@/packages/fs`'s `Fault`, so a file that is a directory or was removed
  underneath has no arm;
- `Sink.write` cannot say *the disk is full*, only *the grant did not include this*;
- `Files.stat` cannot say *there is no such file*, which is what a `stat` is for.

Measured 2026-09-04: **`Proc.spawn` answers `Ticket<Result<Child, NotGranted>>` and takes
`Vec<Grant>`, and both `Child` and `Grant` are declared in `@/packages/sh/src/exec.wac`.**
`vision/std/platform.wac` imports one line, from `core`, and nothing from a package.

So the rule is broken in one signature and load-bearing in three others, and the three where it holds
are the three that produce holes this document has separately filed as problems. Two answers and they
are not close:

**The rule holds and these two move.** `Child` is a capability's answer, so it belongs beside
`Socket` and `Listener` in `std`; `Grant` is a *request* crossing a spawn and belongs there too, and
`@/packages/sh`'s whole subject is that a grant is the wire form of a capability rather than a
package's idea. That is a small move and it makes the three holes real constraints rather than
accidents — which is worth something on its own, because a constraint everyone works around is
cheaper than one that is enforced unevenly.

**Or it does not hold, and `Files` may answer a union the packages define.** That is what every
complaint about `NotGranted` in this document actually wants, and it turns out to be the option
already in use. What it costs is the thing the rule protects: `std` importing `@/packages/fs` makes
the capability layer depend on a package, so a program that wants a file also links a filesystem
library, and *which* library becomes part of the capability's type.

Nothing chose between them. `Child` and `Grant` are where they are because `@/packages/sh` was
written first and needed them, which is the same *derived from whoever consumed it first* this
document opens with — arriving in the layering rather than in a projection.

**And the `Child` itself has no read.** It is `exit` and `send`; the shipped one carries `handle`,
`errHandle` and `fsHandle`. A shell spawns in order to *get* something, so this is a capability for
programs whose output nobody wants. `@/packages/sh/src/pipeline.wac` does not notice because it runs
its stages with `Proc.run`, in this instance, and never spawns one — the only consumer of `spawn` in
the tree is the file that declares the type it answers.

## The fourth audit reads what a capability means, and finds behaviour inherited by silence

Names, then signatures, then the types they answer. Each pass found what the one before could not
see, and each was cheaper than the next. The fourth is reading the **prose on both sides** — what a
shipped capability is documented to *do*, against what its vision counterpart says it does. Two
findings on the first look, and they are different kinds.

**A description that contradicted its own code.** `Ticket.any` said *"answers with the first to
settle"*. Its `firstValue` walks the list in order and takes the first settled one, so the behaviour
was the caller's order all along — and the caller's order is the rule, with a decision behind it:

> **When several are ready, the answer is the first of them in the list you passed** — not the one
> that finished first … *"first in the caller's list rather than first to finish, so the answer does
> not depend on how the threads were scheduled"*, which is `design/system/0001` D12.

D12 is determinism. *First to settle* is a race and *first in the list* is reproducible, so a reader
implementing from the sentence would have written the race — and nothing in a signature, a name or a
return type could have caught it. Corrected.

**And behaviour inherited by silence.** `Files.create` answers a `Sink`, replacing `Cli.openOutput`,
whose doc states in one paragraph two things this does not:

- *"A path **truncates** that file"* — `create`'s signature is silent, so a caller cannot tell it from
  an append. Which bears on a finding already filed: `@/packages/box`'s `tee` records that `tee -a`
  cannot be written **because there is no append anywhere**. If `create` truncates, that holds; if
  nobody decided, the applet's finding rests on an unstated default.
- *"how a program that has finished writing a file knows the bytes are there, since `rename` over a
  file still open would move it half-written. `cp` does exactly that."* — **closing is the durability
  point**, and `Sink.close` answering `Ticket<Result<void, NotGranted>>` says nothing about whether a
  settled ticket means the bytes are on disk or the handle is gone.

**Which is the shape of this pass, and it is not the shape of the other three.** The first three found
things *missing* — a member, an argument, a field. This one finds things **present and unspecified**:
a signature that is complete, a name that matches, a type that fits, and a meaning that was never
carried across. Nothing mechanical detects it, because there is nothing to diff — the shipped
knowledge is in a paragraph and the rewrite's absence of it is an absence of a paragraph.

That makes it the expensive pass and the one most likely to keep yielding. Three hits from three
capabilities read, against a surface of forty-four — and the third is the worst of them.

**`Net.listen` had dropped the bind address.** It was `listen(i32 port)`. The shipped one is
`listen(string host, i32 port)` and the doc says why in the plainest terms this file has:

> **`listen` takes the address to bind, and it is not optional.** It used to take a port alone and
> the host bound `0.0.0.0`, so every server written on this platform was reachable from every
> interface and no program could ask for loopback. For most servers that is a deployment surprise;
> for `packages/tor`'s SOCKS proxy it is the difference between serving the person at the keyboard
> and running an open proxy that sources strangers' traffic out of somebody else's exit node. Every
> other SOCKS implementation binds loopback for that reason, so the safe configuration was not only
> unavailable, it was the one people would assume they already had.

The port-only form is the exact shape that was removed, and the rewrite removed it again. Restored in
`vision/std`, and `@/packages/server` now binds `"127.0.0.1"` — a demo server being the program that
should least be reachable from the network by default.

**`SHOWCASE.md` writes `sys.listen(8080)`**, on the front page, and that is not mine to edit: the
pages are agreed and `vision/packages` is disposable precisely so they need not be. It joins the
`Sys` escalation as the second place where the code and the reviewed examples have diverged — and it
is the more urgent of the two, because the other one is a spelling and this one is a default.

**What it says about the exercise is worth more than the fix.** Three passes compared what a
capability *is* — its name, its shape, the type it answers — and all three passed this signature: one
parameter fewer is not a missing member, not a changed return, not an unrepresentable outcome. Only
reading the sentence next to the shipped one finds it, and the sentence exists because somebody
already made this mistake once.

## Arity is the cheap pre-filter for the semantics pass, and it finds `spawn` at three of six

Reading prose on both sides is the pass that cannot be mechanised, but choosing *where* to read can
be. Comparing the parameter count of every paired member — 23 pairs, one script — leaves four
disagreements, and three are the deliberate value-for-handle rewrite: `Socket.send` and `Socket.recv`
lose the shipped `i32` handle because a `Socket` is a value with the handle inside.

The fourth is **`Proc.spawn`, which takes three of six.** Shipped:
`spawn(u8[] wasm, u8[][] argv, i32 grants, string cwd, i32 inherit, bool serveFs)`. Vision keeps the
first three, with the bitfield as a `Vec<Grant>`.

**Two of the three dropped were added to fix something, and the docs say what.**

> `cwd` is where the child's relative paths resolve from … A shell has an opinion: without this,
> `cd sub; prog f` looked in the wrong place, because a spawned program inherited the *host's*
> directory rather than the shell's. `pushChild` took a directory from the start for exactly this
> reason and `spawn` did not.

> `inherit` says which of the child's standard streams are this program's own rather than queues …
> **It was two bools until 2026-08-29**, and `INHERIT_OUT` is the one that was missing.

Nine days before the rewrite dropped it. And `serveFs` is not a grant at all but a promise, which is
why removing it is worse than narrowing: *"A parent that passes true and then does not serve parks
its child, which is the one failure this cannot make safe and the reason it is stated rather than
assumed."* With no parameter there is nothing to state and the child waits for an answer that never
comes.

**And the `Vec<Grant>` drops a dimension**, which belongs to *the wire format has two dimensions*
above rather than here and is recorded there.

**Which is the general finding: a dropped parameter is invisible to three of the four audits.** A
name still matches, a signature is still well-formed, the answer type is unchanged — only arity moves,
and only prose says whether the movement was a simplification or a deletion. Two of the four
deltas here are the first and two are the second, and nothing but reading tells them apart.

Not fixed, unlike `Net.listen`. That one restored a parameter whose absence had a stated history of
harm; these three need a decision about what `spawn` is *for* in a design where a capability is a
value and a spawn is the one place it cannot be — and `@/packages/sh` is where that decision belongs.

## A type change at the same arity is the second cheap filter, and it finds argv back as text

Arity found `Net.listen` and `Proc.spawn`. The next filter costs the same script: pairs whose
parameter count matches and whose **types** do not. `Env.arg` and `Env.get` are the hit, and it is
the same shape as the other two — a change the shipped design made deliberately, undone by a rewrite
that did not read the sentence beside it.

`Cli.arg` answers `u8[]`, and says why:

> Not a `string`, and that is the whole of wac-mono 0065. An argument is bytes on every system this
> targets, and a capability that called it text forced a conversion at the boundary — `TextDecoder`
> one way, `TextEncoder` the other — so a name that is not valid UTF-8 came back as replacement
> characters. **It was silent:** `cat $(printf '\xff\xfe')` named a file nobody had asked about, and
> a program using the argument as a path would have opened the wrong one.

`Cli.env` the same: *"an environment value is not text on any system here, and this is how a path in
`$HOME` or `$WACPATH` survives being one."*

`vision/std`'s `Env` had `arg` and `get` answering `string`. Restored to `Bytes`.

**The distinction is specific, which is what makes flattening it a loss rather than a simplification.**
Shipped, argv and environment values are bytes; **paths and `cwd` are strings** — `readFile(string)`,
`cwd() -> Pending<string>`. Two of each, in the same four members, and the rewrite made all four
text. A design that made everything bytes would at least be a position; making everything text is the
position that was measured and abandoned.

**Three deliberate fixes undone, by three different filters.** A bind address, three spawn
parameters, and now a byte type — each one a change with an issue number or a paragraph of history,
each one reversed by a rewrite whose author read the *signature* and not the sentence under it. That
is not carelessness about any one of them; it is what happens when the input to a rewrite is a
declaration.

Which suggests the filter worth building next, and it is not a filter: **the shipped file's comments
are the specification, and nothing carries them across.** `GRAMMAR.ebnf` is derived from the code and
`GRAMMAR.md` from the parser; nothing is derived from the prose, and the prose is where every one of
these three lived.

## Grepping the shipped file's prose for history is the filter nothing had, and it found two more

The last entry ended by saying the shipped comments are the specification and nothing is derived from
them. That was a thing to build, and it is one grep: **fourteen members of `std/platform.wac` carry a
history marker in their doc** — *"it used to"*, *"was … until"*, *"without this"*, an issue number —
and each one is a shape that is the way it is because somebody changed it.

Checked against `vision/std`, and twelve were already known: `waitAny` and `load`/`validated` dropped,
`arg` reversed, `openInput`/`openOutput`/`pushChild` restructured, `spawn` short of three parameters,
`setExecutable` unreadable, `connect`/`listen` fixed this morning. Two were new.

**`Socket.closeSend` was missing**, and it is the newest of the fourteen — added 2026-08-20:

> **Say "that is all" without saying "goodbye"**: end the outbound direction and keep reading.
> `closeSocket` stops the socket both ways, so a client that used it to signal end-of-input could
> never receive the answer. That is the exchange every request/response protocol over a raw socket
> needs — the server reads to the end and only then replies. `issues/system/0215`.

With only `close`, a client that has finished speaking has one move and it is the wrong one, so an
HTTP client against a server that reads to EOF cannot be written. Restored.

**And `outputError` is the other half of a `bool` I restored yesterday.** `Out.write` answered `void`
where the shipped one answers `bool`; that was found and fixed. But `bool` alone *is* the state the
shipped design fixed next:

> A closed pipe is an answer rather than an error — `yes | head -1` ends that way and should exit 0 —
> so the two have to be distinguishable. Without this a full disk and a departed reader were the same
> `false`, and every filter treated both as "my work here is done".

`Cli.outputError` is that distinction, as a second call that reads back why the last one failed —
**the fourth paired call over hidden state**, after the three the projections audit turned into
values. So the vision answer is not to add the second call: `write` answers
`Result<void, union<PeerGone, Failed>>`, the reason arrives in the call that failed, and `PeerGone`
gets its own arm because a filter that reported it would be wrong about the commonest way a filter
ends.

**What the filter says about the exercise.** Fourteen members have a documented history and the
rewrite reversed, dropped or hollowed out **five** of them. Not because five decisions were
re-litigated — because none of them was read. A rewrite whose input is a set of declarations cannot
see a paragraph, and every one of these five is a paragraph. The filter is a grep for `used to`; it
should have been the first thing run and it was the seventh.

## The closure design has no mount table, and a listing is what a table is for

The history-marker grep found five reversals in `std/platform.wac`. Run over the shipped counterpart
of every rewritten package — 767 markers across twenty — the first thing it finds outside `std` is a
different kind of loss.

`@/packages/fs` argues that a `Mount` of closures beats the shipped `Backing` tag, because a tag makes
every operation know about every backing. It composes them four ways: `inMemory`, `onHost`,
`readOnly(inner)`, `overlay(base, top)`. **All four compose backings at one path.** Nothing hangs
`/dev` off a root that is something else — there is no mount table, and `packages/fs/src/fs.wac`
says what a table is for:

> Without this a mount is invisible from above: `ls /` on a session with `/dev` and `/proc` listed
> neither, because the root's own tree has no entry for them — **the mount table is the only thing
> that knows**. A listing that omits a directory you can `cd` into is worse than a wrong one, because
> nothing about it looks wrong.

*The mount table is the only thing that knows* is exactly what a per-backing closure deletes.

**A `mountAt(Mount root, string at, Mount sub)` is writable and does not fix it.** One more closure,
dispatching by longest prefix — and `readDir("/")` routes to the root, which has no entry for `dev`.
The combinator would have to merge the names itself, which is `withMountsUnder` again. The tag got it
for free because one value held every mount; the closure design pays for it once per composition.

**And the rewrite had already found this one step earlier.** `overlayReadDir` is annotated *"The one
operation an overlay cannot delegate to either side"* — a listing is the one answer that comes from
both sides. The same sentence is true of a mount table and nobody wrote it, so the file states the
general fact about one case and treats the other as absent rather than unsolved.

**Which is the shape worth taking away.** Every other finding from this exercise about `Mount` is in
its favour: `readOnly` is three lines, `empty` is a value, a third backing costs nothing. Those are
all *per-path* operations. `readDir` is the one operation that is inherently *about the set of
mounts*, and it is the one a design of independent closures has no place to put. A tag is a bad
answer to "what backs this path" and the only available answer to "what is mounted below here".

## `Run` confers `Env`, the tree knows, and `vision`'s spawn cannot say otherwise

The prose filter, run over the twenty rewritten packages, found this in a comment on a *test helper*
— `packages/wactest/src/childenv.wac`:

> `issues/system/0198` is the half that is still open: **inheritance is an authority nobody
> declared**, and the day `Cli.exec` clears by default, the callers here that *want* the host's
> environment are the ones that will have to say so.

`std/platform.wac` states the mechanism, at `execWithIn`'s `clearEnv` parameter:

> False — what `Cli.exec` passes — *adds* `env` to everything this process holds, and that
> inheritance is an authority nobody declared: **a program refused `--allow-env` can still read
> `HOME` by running `printenv`, so `--allow-run` confers `--allow-env`.**

One grant conferring another, by default, in a system whose first line is *authority is a value*. The
fix exists and is not the default: *"not the default **yet**, and the reason is a count rather than a
doubt: 342 call sites … Flipping the default is that sweep, not this parameter."*

**And `vision` made it worse by removing the parameter.** `Proc.spawn` is
`(Bytes wasm, Vec<Bytes> argv, Vec<Grant> want)`. No environment — a child cannot be given one and
cannot be denied one, so whatever the host does is what happens. In the shipped design this is a
default that a caller can override; here it is not expressible. And `@/packages/sh`'s `Grant` lists
`Env` beside `Run` as separate categories, which claims a separation the signature cannot deliver.

**Which is the exercise's central claim meeting a filed issue against it.** *No ambient capabilities*
holds inside an instance: a function handed no `Files` cannot read. At the instance boundary the
environment crosses because nobody said it should not. `@/packages/box` found the same edge from the
other side — authority is per-instance and per-function narrowing stops at the module edge — and this
is that edge with a leak that has a number.

**The shape of the fix is the open part**, and the shipped doc says what its own answer cannot do:

> **Removing a named variable is still not expressible**, and `clearEnv` is not it: a caller who
> wants everything *except* one name has to name what stays, and nothing here can enumerate the
> environment — `Cli.env` answers one name at a time.

So the environment is the one part of a grant that is neither a **category** nor a **root**. The
*two dimensions* entry above has room for a third and does not have one — and unlike the value-side
expressiveness that entry is about, this third dimension is something a host could enforce, which is
the property that entry uses to separate what belongs on the wire from what does not.

## *This exists because the language cannot* is a claim about causation, and it is right eleven times in seventeen

The prose filter was pointed at the shipped tree and found five reversals in `std` and two more in
`fs` and `sh`. Pointed at `vision/` instead, it asks a different question: **where does this directory
claim that shipped code exists because of a language limitation, and is that why?**

Seventeen such claims. `packages/regex`'s README already records the habit and the count — *"That
reads like a language gap, and after seven wrong claims of exactly that kind this exercise checked
instead of assuming"* — and checking is what it did: `Vec<Range>` compiles today, so the flat parallel
arrays are a *layout* choice and the rewrite left them alone. Most of the seventeen have been through
that.

**One had not, and it is the eighth wrong one.** `@/packages/wactest` says five shipped files —
`host.wac`, `built.wac`, `daemon.wac`, `repo.wac`, `childenv.wac`, 1,242 lines — *"are largely that
workaround"* for a test being unable to hold a capability. Each of the five opens by saying what it
is for, and only the capability part goes: `built.wac` is 599 lines of build cache with a freshness
rule, `daemon.wac` is a readiness poll, `host.wac` is three machine facts that ten test files had
copied verbatim. A freshness rule survives whoever is allowed to call it.

**And one was checked and is right, which is worth saying because the failures are the memorable
ones.** `@/packages/fmt` says `itoa64` exists twice *"because the language has no way to say this name
is also available here"*. The shipped comment makes the causal link explicit: *"wac has no re-export —
importing a symbol from a file that merely imports it is a compile error — **so** unifying them means
editing the import line of all forty-odd wac test files."* No re-export is why the fix is a
forty-file sweep rather than one line. The claim holds.

**Eight of seventeen wrong is the number to sit with**, and it is not carelessness about eight things.
A limitation is real, some code sits next to it, and *because* is the cheapest connective in English.
The check is always available and always the same: the file usually says why it exists in its first
paragraph, and the paragraph is not what a rewrite reads.

## One entry of fifty-one has no marker, and the reason is that the marker has two values

Each of the three example pages opens with *"Each is marked **done** or **not yet**, and that marker
is the only thing here that refers to an implementation."* Checked on 2026-09-04 against all
fifty-one entries, reading only standalone marker lines with code fences blanked — because a first
pass matched `Done` the enum variant inside a `c.step(); // Done` comment and reported the wrong
answer for a third of `TECHNICAL.md`.

Five **done**, forty-five **not yet**, and **one with no marker at all**: *`await` needs a ticket*.

**It is not an oversight, and the entry's own body is why.** The rule is enforced for one spelling
and not the other:

> `await n` … is already refused — `[§wac-await-pending-9km2xtr]`, code 212, *this cannot be awaited*.
> `await 5` is not: it checks clean and fails in the emitter with *a null in a `Pending<i32>` slot*.
> The refusal fires on a name and on nothing else, which is `issues/lang/open/0323a`, **found by
> checking this entry**.

So the honest marker is *done for an identifier, not yet for a literal*, and the convention has two
values. The entry lost its marker at the moment it became the most informative one on the page.

**Which is the finding rather than the missing word.** A two-valued marker is a claim that an entry
is one feature, and the entries most worth reading are the ones where checking split the feature in
two. `Const through an accessor` is the counter-case and shows the same seam from the other side: it
was moved from *not yet* to **done** when checking showed the rule *is* implemented and only its
help text is wrong — *"the entry is a picture of the diagnostic it should have, and it was marked
Not yet as though the rule were unimplemented"* — so one entry gained the right marker by splitting
rule from diagnostic, and one lost its marker by splitting name from literal.

**Not edited**, because these pages are agreed and the missing marker is a real question rather than
a typo: adding *not yet* understates a shipped refusal and adding *done* hides an open issue. It joins
the two other places where the code and the reviewed examples have diverged — `sys.listen(8080)` and
the `Sys` bundle — and is the smallest of the three and the only one that is the page's own
convention rather than the code's drift.

## The only measurement in this directory is single-host, says so, and none of its three users repeats it

`bench/slicecost.wac` is the one thing under `vision/` that compiles and runs, and it is careful:
a control measured last *"because this machine is shared"*, the drift stated (2 ms), the derivation
shown — `(71 - 49) / 8.39M` for **2.6 ns** a fresh view — and the limit named:

> **One host.** `native/wasmtime` is not built in this checkout … A different collector could move
> the allocation number and would not move the shape, since the shape is per-call against per-byte.

That is the right caveat and the right reason: the *shape* is engine-independent, the *number* is not.

**Three places quote the number and none of them quoted the caveat**, until 2026-09-04:
`core/slice.wac`, `@/packages/gzip`'s README, and `gzip/src/window.wac` — and the last two go
further, deriving *45% at an eight-byte call* from it. `gzip`'s argument for **not** using `Bytes` in
the DEFLATE window is that 45%, so a package-level design decision rests on one engine's allocator
through two hops, neither of which mentions an engine. Fixed by carrying the words.

**Which is this directory doing to itself what it spent a week finding the rewrite doing to the
shipped tree.** Five reversals in `std` happened because a paragraph beside a declaration was not
read. Here the paragraph is *in the same repository, written by the same exercise, three files away*
— and the number travelled while the sentence stayed home. A qualification survives exactly one hop
unless somebody carries it, and nothing carries it.

**Then swept, since the general form said where to look.** Every measured quantity cited outside
`bench/` — 17 of them across the pages and the code:

    2.6 ns, 0.5 ns          from `slicecost.wac`     4 citations, none carried the host
    1.4 ns, 0 ns, 2.5 ns,   from `nullablecost.wac`  2 citations, none carried the host, and the
    0.9 ns                                           bench did not state the caveat at all
    5 ms, 8 MiB, 2 ms       quoted from the shipped tree, and all three name their source

So the ns-figures were the whole of it, six of six unqualified, and the second bench had not even
written its own caveat down — `slicecost.wac` says *"a different collector could move the allocation
number and would not move the shape"* and `nullablecost.wac` says only *"on the v8 host"* in a
heading. Both now say it and all six citations carry it.

**And the three that were already right are the ones quoted from elsewhere.** `5 ms`, `8 MiB` and the
`2 ms` drift each arrive with *"the shipped `waitForPortWithin` sleeps"*, *"the shipped `Captured` has
a cap"*, *"the bench states"* — a citation to somebody else's measurement carries its source because
there is no other way to write it, and a citation to your own does not because there is. That is the
whole mechanism, and it predicts that this will happen again to the next number this directory
measures itself.

## The quotations are checkable after all — 462 of them, 0 unaccounted

**This entry said the checker *"is the thing that cannot be written"*. It was written on 2026-09-04
and the whole directory passes.**

    462 quotations: 189 shipped, 273 vision's own, 0 unaccounted

Every `*"…"*` of thirty characters or more in `vision/` is a sentence that exists — in
`packages/`, `design/`, `spec/`, `tools/`, `bootstrap/` or `harness/`, or in `vision/` itself.
Nothing is paraphrased and nothing is invented.

### Why three attempts failed and the fourth did not

The first three reported 39, 40 and 15 misses; eight were hand-checked and **every one was the
instrument**. This entry read that as four reasons, all of them about *attribution* — `*"…"*` means
quoted-from-a-file, quoted-from-this-page, quoted-from-this-file's-past, and a-phrase-being-named,
and nothing distinguishes them.

That diagnosis was right and it was not the obstacle. Two things fixed it:

**Give up attribution.** Do not ask *which file did this come from*. Ask *does this sentence exist*,
against two blobs — the shipped tree and `vision/` — and report shipped, own, or neither. The four
cases collapse into the first two, both legitimate, and the reader's actual question is the third
column.

**Normalise both sides, not just the quote.** This is what the earlier attempts missed and it
accounts for every one of the 41 apparent misses in the fourth attempt's first pass:

| | example |
|---|---|
| emphasis **inside the source** | `lex.wac` writes *"needs to know `*what shape*` a token is"* |
| comment continuation on wrapped lines | a quote spanning three `//` lines, or three ` * ` lines |
| case, because a quote may start mid-sentence | `Never a guess` against `never a guess` |
| typographic punctuation | `’` and `…` |

Strip comment markers, backticks and asterisks; fold the punctuation; collapse whitespace;
lowercase. Then it is a substring test.

### What is still open, which is smaller than this entry claimed

**A reader cannot tell which of the four a mark means**, and that has not changed — but it is now
measured rather than asserted. A second pass asked, of the 190 quotations that resolve to the shipped
tree, whether a path named within six lines is the file the sentence actually lives in:

| | |
|---|---|
| names a path, and it is the right file | **37** |
| names no path at all | **143** |
| names a path, and it is a different file | **10** |

All ten were hand-checked and **all ten are benign** — the named path is a *contrast* or a
cross-reference in the same paragraph, and the real attribution is prose:

- `@/packages/tty/src/line.wac` says *"the original explains that it deliberately does not import
  them"* — no path anywhere, and the path six lines up is the file being contrasted with;
- `@/packages/server/README.md` says *"`serve.wac`'s header"* — a bare basename;
- `@/packages/wac/README.md` attributes to `grantsIn`, a function, and names `@/packages/ens` in the
  next clause for an unrelated reason.

So **three quarters of the shipped quotations name no path**, and of the quarter that do, a fifth
name one the sentence is not in. The attribution is a noun phrase, a bare filename, a pronoun, or
nothing — which is why a checker for it is not a matching problem and cannot be fixed by a
normaliser.

So the ask is a *form* for inline attribution, and its cost is now known to be small — because the
matching problem, which looked like the hard part, is a normaliser. What it would buy is a reader
being able to follow a citation without working out first what kind of citation it is.

**And the general lesson is worth more than the form.** *The instrument cannot be written* was
concluded from three attempts that all failed for the same reason, and the reason was neither of the
two things this entry named. Three failures in one direction reads as a wall; it was one bug, on the
side nobody was looking at, because the quote was being cleaned and the source was not.

## A generator cannot be started early, and one program in the tree needs exactly that

`Socket.closeSend` was restored on 2026-09-04 after the prose filter found it missing. Writing its
first consumer — `@/packages/server/src/halfclose.wac`, the vision form of
`packages/platform/example/halfclose.wac` — found something the restoration did not.

The shipped example's own note:

> The accept is submitted **before** the connect and waited on after, because a host is free to
> complete them in either order and a program that waits on `accept` first would deadlock against a
> host that has not dialled yet.

Shipped, that is two lines. `Pending<Socket> accepting = cli.accept(srv.handle);` **starts** the
accept and hands back a value; `accepting.wait()` collects it after the connect has been dialled. A
ticket is a value, so starting and awaiting are separate acts.

**`Listener.accepted()` is a generator and has no such pair.** Calling it builds a machine that has
done nothing, and the first `await` on it *is* the accept. The two acts collapse into one, so the
ordering the note requires cannot be written — the loop has to dial first and accept second, which is
the deadlock the note warns about with the operands swapped.

**What makes it writable at all is that exactly one of the two kept its ticket.** `Net.connect` still
answers `Ticket<Result<Socket, NotGranted>>`, so the *dial* can be started early and collected late,
and the file does that. `In.stream`, `Files.open` and `Proc.run` all became generators this week; had
`connect` gone with them there would be no ordering of this program that is safe on every host.

**So the generator rewrite bought laziness and spent *start now, collect later*, and nothing recorded
the trade.** Both are real: laziness is what makes `cat big | head -1` stop after one chunk, and
start-now-collect-later is what makes two operations overlap without a scheduler. A ticket has the
second and not the first; a generator has the first and not the second. `Ticket.all` and `Ticket.any`
exist precisely to combine tickets that were started early — and there is no `all` for generators,
because there is nothing to hold before the first step.

The question is whether a generator can have both. `coroutine f()` hands back an unstarted machine,
which is the opposite of what is wanted; something like *step it once and hold the result* is the
shape, and it is `Ticket<Step<…>>` — which is what `AsyncGenerator.nextStep` already answers. So the
pieces are present and the ergonomics are not: the file that wants this writes
`try await for (Socket a in l.accepted())` and would have to abandon the loop form entirely to hold a
step.

## A numeric type cannot be spelled like a number

`@/packages/bignum` is the first package in this directory whose subject is arithmetic, and the best
it can write for `a * b + c` is `a.mul(b).add(c)`, and for `q < r` is `q.cmp(r) < 0`. wac has no
operator overloading, `GRAMMAR.md` does not propose it, and no issue asks for it.

Recorded as a want with one witness rather than proposed, because one package is a bad reason to add
a feature this large. What makes it more than ergonomics is that there are **two** bignums in the
repository: `packages/bignum` and `fmt`'s `FixedBig`, a fixed-size division-free specialisation that
is deliberately not built on the first because it must not allocate on its hot path. Two types that
both mean *number*, in different code, neither able to be spelled like one — and a third, `Big` in
`@/packages/bignum`, that is immutable and so is the one where `a + b` would read exactly as it does
for an `i32`.

The narrow version of the question, which is answerable without deciding the wide one: **is `==` on
a user type wanted?** `Big.eq` exists here because `==` is reference identity, and every value type
in this directory that is not a primitive has had to write one — `Slice`, `Bytes`, `Big`. That is a
smaller surface than the arithmetic operators and it is where the repetition already is.

## Wrapping is the only arithmetic, and at 64 bits there is no way to notice

`spec/spec/types.md` documents two idioms for detecting overflow and is explicit that the first
covers only what has a wider type: *"for 64-bit types there is no wider one"*. Its fallback compares
the result against an operand, which is written for `+`.

`packages/bignum`'s one real defect is a `u64` shift landing on exactly 2^64 — not an addition going
backwards, a value that was never representable — and the README says four hundred random operand
pairs never reached it. `issues/lang/0033` weighed a checked operator, the idiom, and a build mode,
chose the idiom, and closed **documented, not built** saying it lacked a real case to decide with.
The case is filed as `issues/lang/0332a`.

For this directory the question is narrower than 0033's: **`@/packages/bignum`'s `Big` wants no
wrapping anywhere in the package, and there is no way for a package to say so.** `wacc` has
`emitFilesChecked`, but it covers `+`, `-` and `*` rather than `<<`, and it is a property of the
*build* — so a library cannot state *my arithmetic never wraps* to whoever links it, and a program
that links both `bignum` and `crypto` has to choose one answer for two packages with opposite
requirements. Poly1305's borrow trick and ChaCha20's adds are wrapping **by design**; bignum's
carries are not. A whole-build switch cannot serve both, which is the part 0033's third option did
not have to face.

## A `const this` method still cannot hand back what it just built, if it named it

`issues/lang/0060` narrowed the const taint to a freshness test on 2026-08-11, and the test reads
the **return expression**: `return C(this.n)` is fresh, `C r = C(this.n); return r;` is not. Filed
as `issues/lang/0331a`, and here because this directory leans on `const this` harder than the
shipped tree does — nearly every method written under `vision/` is one.

The shape that keeps hitting it is a constructor that has to allocate before it knows what it holds.
`@/packages/bignum`'s `Big.of` takes a filled `u32[]`, which its callers must build and name; a
`Buf` fills bytes and then hands them over; `@/packages/page`'s renderer builds a string. None of
these can be an instance `const this` method whose result the caller may then mutate, and the escape
in every case is to make it a **static** — a method with no receiver, which is a free function with
a namespace. So the language's answer to *how do I write a const method that returns something
fresh* is *don't write a method*.

Twenty-three statics under `vision/` return their own type, in twelve files. That is **not** twenty-
three workarounds: a factory with nothing to receive is a static because it is one, and only
`packages/bignum` documents having chosen the shape for this reason. What the number says is that
the escape hatch is also the ordinary spelling, which is why nobody has had to notice it is an
escape hatch — and why the rule can stay this narrow without anyone filing it. `bignum` filed it
only because the rule reached its **public surface** rather than one method.

## A terminal mode is ambient, and it is the one place the principle has to bend

`vision/README.md`'s first principle is that a program gets what it is handed and nothing else. Every
capability in `std` obeys it: state reachable through `Files` is not reachable through `Net`, two
`Sink`s over one path are two values, and a child gets what its parent chose to pass.

**A terminal mode is not like that, and cannot be.** `@/packages/tty`'s README names the gap from the
other end — *"an editor still cannot have a keystroke at a time … because nothing can say so"* — and
the member that closes it is one line on `In`:

    Result<Mode, NotATerminal> setMode(Mode m);   // answering the mode it was in

The trouble is not the grant. It is that a shell and the editor it spawned hold **two `In` values
over one line discipline**, and a mode set through either is what the other sees. That is what a
terminal is: `stty -echo` in one shell changes what the next program reads. Making it private would
not be safer, it would be wrong — the editor's whole purpose is to change what the *terminal* does.

So this is the exception, and it is worth having written down as one rather than discovered by
someone who assumes the principle holds everywhere. The shape of the exception: **the capability
names a piece of shared hardware, and the state belongs to the hardware.** A clock is the same kind
of thing and does not notice because nothing sets it; a terminal is the same kind of thing and is set
constantly.

**And the sharing is not only between programs.** Found 2026-09-04 by writing the first consumer,
`@/packages/box/src/more.wac`, the pager `packages/box` has not got. `Mode.cbreak()` is a property of
*reading* — `ICANON` and `ECHO` off — and it is also the moment a program's **writing** has to
change. `packages/ssh/src/sshd.wac` says so from the other side:

> **The shell's output needs `\r\n`.** A terminal in raw mode does not return the cursor on a bare
> newline, so output written with `\n` stair-steps down the screen. That translation is `ONLCR`, and
> it belongs here rather than in the shell, which is writing bytes rather than talking to a terminal.

`sshd` owns both ends of one session and can put the translation in the middle. A pager holds an `In`
and an `Out` that know nothing about each other, so `in.setMode(cbreak)` silently makes every
`out.write` containing a `\n` wrong, and neither signature says a word about it.

So this is not two programs sharing a terminal — it is **two capabilities held by one program**,
which is the case a per-capability grant cannot express at all. A grant says what a program may
reach; it has nothing to say about two things it holds being views of one device.

Two consequences that are properly questions:

- **It is the first capability that has to answer *what it was*.** Restoring is the caller's job, and
  a program that assumes *canonical with echo* is wrong for anyone who was in a password prompt. So
  `setMode` returns the previous `Mode`, and that value is a small piece of the world the caller now
  owns and must give back.
- **Which is a use of `defer` nothing else here has.** Every other one — `conn.close()`,
  `closeAll(sinks)`, `Ticket.wait` — releases something acquired. This one *puts something back*, and
  the difference matters for the unanswered part of what `defer` means: a release that is skipped
  leaks, and a restore that is skipped leaves the next program reading a terminal that eats its
  keystrokes.

## A generator that suspends against nothing

`@/packages/tty`'s `Line.feedAll` is the first **synchronous** generator in this directory. Every
other one — `In.stream`, `Files.open`, `Proc.run`, `gunzip`, `scalars`, `Listener.accepted` — is an
`async gen` over a capability, and the loop that drives it is `try await for`. This one has all its
bytes in hand and yields a `Typed` per byte:

    gen<Typed> void feedAll(this, Bytes bytes) {
      for (i32 i = 0; i < bytes.len(); i++) { yield this.feed(bytes.get(i)); }
    }

It wants the stepping and not the awaiting. The original answers a `Typed[]` as long as its input, so
a 4 KB ssh payload allocates 4,096 records of which all but a handful are empty; a generator makes
the ones the caller has finished with go away, and that is the whole of the reason.

The question this raises is about the pages rather than the language. `core/coroutine.wac` has
`Generator<T, R>` and `AsyncGenerator<T, R>` as separate types, so the distinction exists; what is
written down everywhere is the async one. `../packages/stream`'s whole argument, `try await for`'s
justification, and the entry above on starting a generator early all reason about suspension — and
this file needs `for (Typed t in line.feedAll(bytes))`, a plain loop over a plain generator, which
`Slice.items()` in `core` also already is. **Two of the three uses in this directory are synchronous
and every page describes the third.**

## Bare variant names share one namespace per file, and five arms have been renamed around it

Every file in this directory writes a variant without its enum — `Ok(x)`, `Err(e)`, `Nothing`,
`Delivered(b)` — because the slot implies which enum is meant. That convenience has a consequence
nobody wrote down: **the arms of every enum in scope, plus every type and every declaration in the
file, are one namespace.** An enum's variant names are private only until a second enum arrives.

Five arms have been renamed away from the word that fitted, in four packages, in two days:

| where | wanted | got | collided with |
|---|---|---|---|
| `@/packages/tty` | `Effect.Line` | `Delivered` | `struct Line`, the same package's own |
| `@/packages/rlp` | `Item.Bytes` | `Str` | `core`'s `Bytes`, the payload's own type |
| `@/packages/abi` | `AbiType.Blob` | `DynBytes` | `Value.Blob`, another enum in the same package |
| `@/packages/abi` | `Value.Bytes` | `Blob` | `core`'s `Bytes`, again |
| `@/packages/ens` | `struct Address` | `EthAddress` | `AbiType.Address`, an arm of an import |

The last one happened while writing the file that demonstrates the other four, which is how long it
takes to hit.

**Three kinds, and they are not equally bad.**

- *Local*: `tty`'s. Both names belong to that package, a reader sees both declarations, either could
  move.
- *Against `core`*: `rlp`'s and `abi`'s `Value`. `core` exports `Bytes`, `Vec`, `Map`, `Queue`,
  `Slice`, `Result`, `Ticket`, `Step`, `Node`, `Attr` — ten words no package may use for an arm, a
  struct or a function, listed nowhere. Both instances were a variant named after **the type of its
  own payload**, which is the most ordinary thing a variant name does.
- *Against an import's arms*: `ens`'s. The colliding name is not even mentioned in the importing
  file — `AbiType` is imported, `Address` comes with it — so a declaration collides with something
  the author never wrote and cannot see without opening another package.

The third is the one that scales badly: a package's namespace is now every arm of every enum
anybody exports to it, and adding a variant to a widely-imported enum is a breaking change to files
that never named it.

**What makes it a language question rather than a naming convention** is that the qualified form
exists and is never used. `Item.Str(x)` and `AbiType.Address` are unambiguous, and nothing in this
directory writes them, because the whole point of the bare form is that the slot implies the enum.
So the collision is the price of a convenience, and the candidate rules all have costs:

- **Require the enum name when a variant is ambiguous.** Invisible until it fires, and what fires it
  is an unrelated import.
- **Resolve by expected type first, then by name.** Works for `schema.push(Address)`, where the slot
  is `AbiType`; does not work for a `match` arm, which is where `tty`'s and `abi`'s were.
- **Nothing, and rename.** What five files did. It costs the reader the good name every time.

The narrowest form, which may be the whole of it: **is a variant name in the same namespace as a
type name, and should it be?** `spec/spec/enums.md` does not say. `issues/lang/closed/0095` — *a
struct named like a variant resolves to the enum* — is the same question, answered for one direction
by fixing a resolver rather than by stating a rule.

## A length-prefixed nested format cannot be encoded in one pass

`@/packages/rlp`'s encoder has to know the length of a list's payload before it can write the list's
header. There are exactly two ways to do that without back-patching, and the package has now used
both:

- **the shipped one** encodes every member into its own array, sums, allocates the exact result, and
  copies everything in — so each byte is copied once per level of nesting;
- **this one** measures with a `sizeOf` walk and writes into a single `Buf` — so each node is walked
  once per ancestor.

Both are O(n·d). Neither is a mistake and neither is better; they trade allocations for walks. The
O(n) answer is back-patching, and a `Buf` cannot be written to twice.

**The reservable hole is writable and RLP does not fit it.** `i32 mark = out.hole(n)` and
`out.patch(mark, bytes)` are ordinary methods — an index survives a reallocation where the `bytes()`
view does not, which that method's own doc already admits — and they are what a serialiser wants. But
a hole needs a *size*, and RLP's header is 1 to 9 bytes depending on the length of the payload it is
measuring. The unknown is the size of the hole itself.

So the question is not *should `Buf` be able to insert* — it should not, since every insert is O(n)
and the type would stop being a promise about cost. It is: **what does a writer for a format whose
prefix width depends on its payload look like?** A fixed-width prefix (`ssz`, protobuf's fixed
variants) takes the clean version and RLP is the case that does not, which makes it the one worth
designing against. The fallbacks are reserve-the-maximum-and-shuffle, and reserve-one-and-shuffle-if
-it-grows, and both put back exactly the copy being avoided — for the *outermost* list only, which
may be the answer: one copy of the whole payload instead of d.

## Converting an index walk into a structure walk moves an allocation under the attacker's number

`@/packages/abi` decodes an ABI array by building a `Vec<AbiType>` of `n` copies of the element type
and handing it to the tuple walker — which is correct, because an array's elements really are a tuple
of identical members, and writing the two walks separately is how the offset rule gets stated twice
and diverges once.

`n` is a length word from the calldata. **The first draft built the `Vec` before checking it**: a
32-byte message allocating two billion entries, in the package whose README opens *"a malformed
offset is not an unusual input, it is an attack"*. The guard is four lines and had to be added by
re-reading; nothing failed, and no test would have.

The shipped package cannot have the bug, and not because it is more careful. Its schema is an `i32[]`
and an index into it, so decoding `n` elements passes the same index `n` times and allocates nothing.
**The tree is better in every way this exercise has argued for and it has a cost the flat form does
not, in exactly the place this package is careful.**

That generalises past the ABI, which is why it is here rather than only in the package README. Every
rewrite in this directory has replaced an index with a structure — `Vec` for a doubling loop, a
recursive enum for a prefix-order array, a `Slice` for three scalars — and the argument each time is
that the structure says what the index left implicit. It also *materialises* what the index left
virtual, and when the count comes from input, that is a resource decision the conversion does not
announce.

The lazy answer is a `Repeat(AbiType of, i32 n)` — a `gen<AbiType>` yielding one type `n` times —
and **it does not work, for the reason the entry above about generators gives from the other side.**
`tupleAt` iterates its schema twice: once to sum the head's width, once to walk it. A generator
cannot be restarted. So:

- a generator has no *start now, collect later* (`@/packages/server/src/halfclose.wac`);
- a generator has no *iterate again* (here);

two properties an array has for free, found in two packages a day apart, both while replacing an
array with something lazier. Whether `Generator<T, R>` should have either is the question; the honest
framing is that this directory has been treating laziness as strictly better and it is a trade.

## Where does a refinement of an integer live?

`@/packages/raster` draws text from `i32[] cps`, so it accepts a surrogate and `0x110000`; both draw
nothing, which is right for the font and wrong for the type. `@/packages/stream` named the type this
wants when it found the same thing from the other end:

> A *codepoint* can be a surrogate; a *scalar* cannot — that is what the word means in Unicode, and
> it is why the shipped method has to check at run time what its name does not promise.

`text(Slice<Scalar>)` is the signature. It is not written, because it would make a rasteriser depend
on `@/packages/unicode` for a type and nothing else — which is the dependency the shipped file
avoided by taking `i32[]`, and it was right to.

So the question is not about Unicode. **`core` holds containers and protocols — `Vec`, `Map`,
`Slice`, `Result`, `Ticket`, `Node` — and nothing in it is a refinement of a primitive.** A `Scalar`
is an `i32` with a rule; so is a `Port`, a `Nibble`, a byte offset that must be word-aligned, and the
`u8` this exercise has twice wished were a bounded shift count. Three packages have now wanted one
and each declared its own or did without.

Three shapes, and the interesting part is that they differ in what they cost the *user*, not the
implementer:

- **A struct with one field.** Writable today: `struct Scalar { i32 v; }` plus a checking
  constructor. Costs an allocation per value and a `.v` at every use, which for a code point in an
  inner loop is the reason nobody has done it.
- **A named type with a validating conversion**, no box — what a newtype is in most languages and
  what wac's nominal typing already almost gives, since two declarations of one shape are already
  two types. What is missing is a way to say *this one is an `i32` at run time*.
- **Nothing, and put the check at the boundary.** Which is what happens now, and the cost is that the
  boundary is wherever somebody remembered.

The second is the one worth pricing, and the reason it is a question rather than a proposal is that
it interacts with everything: a newtype over `i32` needs rules for arithmetic, for casts, for
`match`, and for whether `Slice<Scalar>` may alias an `i32[]` — which is the whole of why it would be
useful here and the whole of why it is not free.

## A host's ceiling decides a source file's layout, and no page mentions it

`packages/raster`'s font table is split across two constant arrays, and its README says why:

> V8 refuses `array.new_fixed` above 10,000 elements, and the font is 13,932 words. A single
> `const i32[]` does not compile — *"Requested length 13932 for array.new_fixed too large"* — which
> is worth knowing before writing any other large table in wac.

Nothing in `spec/` mentions a ceiling on a constant array. `spec/spec/arrays.md` says a sized array's
length *"may be any `i32`"* and the literal form has no stated limit, so a program that grows a table
past ten thousand entries learns about it from V8, in a message about an instruction its author never
wrote.

**The split then stays in the source for every host.** `--host wasmtime` is the engine with no
JavaScript in it and may well have no such limit, and `design/system/0001` D9 says that host exists
precisely so that *"a wac program does not depend on one"*. Here a program's shape does, and the
dependency is invisible — a reader of `font16.wac` sees two arrays and no reason.

Three places the answer could go, and they are genuinely different:

- **The spec states a floor** every host must meet, and a program that stays under it is portable.
  That is what a language specification usually does with a limit and it means picking a number.
- **The compiler splits large literals**, so the ceiling stops being the program's problem. Cheap,
  invisible, and it makes one host's bug into every host's code generation.
- **`docs/` records it as an engine fact**, which is where `docs/` already keeps *the engine features
  a module needs*, and the program keeps the workaround.

The reason it belongs here rather than only as an issue is the middle option: whether the language is
allowed to know about an engine's limit is a design question, and it is the same one `packages/wacc`'s
lambda cap and the ladder's rung limits keep raising in other forms. `issues/lang/0334a` has the
concrete half.

**And the tree has already answered it twice, differently.** `packages/wacc/test/wac/source_probe.wac`
chunks a string literal at **3000**; `packages/raster/src/font16.wac` splits its table at **8192**;
the limit in the error message is **10,000**. Neither site cites the other and neither cites a
documented figure, because there is not one. So the number to stay under is folklore, and the third
person to need it will pick a fourth.

Worse, one of the two workarounds caused a defect of its own: `issues/lang/0253a` is a chunk boundary
landing inside a multi-byte UTF-8 sequence, which made the generated self-host driver invalid UTF-8
and broke the fixpoint. A bug whose entire cause is an undocumented ceiling being worked around by
hand, in the file that generates the compiler's own driver — which is the strongest argument for the
middle option and the reason it is not simply a documentation gap.

## `try` is documented as an expression and a third of its uses are statements

`GRAMMAR.md` lists *`try` in expression position* with two examples, both `x = try f()`, where the
unwrapped value is the point. Two packages have now used it in shapes no page covers, and they are
the same gap from opposite sides.

**`@/packages/datetime` uses `try` on a `Result<void, E>` six times.**

    try c.expect('-');
    try c.dateTimeBreak();

A statement whose value is nothing and whose entire purpose is the early return. This is *check or
propagate*, and it is what a parser's separator handling looks like in every language that has the
construct. Nothing says whether `Result<void, E>` is even a type — `core/result.wac` is
`enum Result<T, E>` and `Ok(T value)`, so `Ok` at `T = void` is a variant with a payload of nothing,
which `spec/spec/async.md` has an opinion about for `Pending<void>` and no page has for this one.

**`@/packages/rlp` uses two in one expression.**

    Ok(Str(try this.take(try this.longLength(tag - 0xB7), false)))

One line, two early returns, and the second only runs if the first succeeded. Evaluation order,
short-circuiting, and whether the outer construction is started at all are all unstated.

Together they say the same thing: **the description is of the narrow case and the uses are not it.**
Three questions, in increasing order of how much they need deciding:

- **Is `try f();` as a statement legal, and does it require `f`'s error type to be assignable to the
  enclosing function's?** The statement form has no slot to infer from, which is the one place the
  expression form's rule does not reach.
- **What is `Result<void, E>`?** Measured 2026-09-04: it **works today**, cleanly, and
  `return Ok;` runs. And it works *by accident* — `Ok` carries a `T`, no argument is given, and the
  payload defaults, which is `issues/lang/0335a`: a payload-carrying variant written bare is
  accepted at every `T`, so `enum Sh { A, B(string s) }` with `return Sh.B;` emits and traps on a
  null. At `T = void` there is nothing to default and nothing goes wrong; at `T = string` the same
  construction is a bug. So this question and that bug are one thing, and fixing the bug is what
  forces the answer: either `void` is carved out as a type argument whose variant may be written
  bare, or the idiom needs another spelling. `Ok(Unit())` with a one-member struct works today and
  is ugly in every file that has a fallible step returning nothing.
- **Left to right, short-circuit, nothing constructed** — which is what every language with `?` does,
  and *"what every other language does"* is the argument this directory has refused elsewhere, so it
  should be written down rather than assumed.

The first is the one a parser hits immediately. `@/packages/datetime/src/rfc3339.wac` has sixteen
`try`s and **six are statements** — every separator in the grammar. If only the expression form is
legal, each becomes `_ = try c.expect('-');`, which reads as discarding something and discards
nothing.

## An unqualified variant construction is used ninety times and is not a thing today

`return Ok(3);` — a variant constructed without naming its enum — is what every file in this
directory writes. Measured 2026-09-04:

    Res<i32, F> f() { return Ok(3); }         // 1 type error: `a call to Ok`
    Res2<i32, F2> r = Ok(4);                  // 1 type error: `a call to Ok`

`spec/spec/enums.md` gives the bare form for a **type test** — *"`is` accepts a variant name, bare or
qualified by the enum"* — and for a `case` pattern. Construction is `Enum.Variant(args)`, everywhere
in `packages/`. Unqualified, `Ok(3)` is a call to a function called `Ok`, and the diagnostic says so.

**Ninety uses in a `return` position alone**, across ten files, 42 `Ok` and 48 `Err`; the other 53
capitalised names in that position are struct constructions and are fine. Counting the other
positions — a variable initialiser, an argument, an arm of a ternary — would only raise it.

So this is one of the largest additions vision makes and **no page names it.** `GRAMMAR.md`'s table
of eight constructs has *a match arm without `case`* — the pattern side of the same idea — and stops
there, for a mechanical reason worth keeping: the table was built by feeding files to the compiler
and recording the first divergence, and the pattern side is what the *parser* refused while the
construction side parsed cleanly as something else. A construct is invisible to that instrument
exactly when it collides with an existing one.

**What has to be decided is not whether, but how it resolves.** Three shapes, and they are not
equivalent:

- **From the expected type.** `return Ok(3);` in a function answering `Res<i32, F>` has a slot, and
  so does `Res2<i32, F2> r = Ok(4);`. This is what every language with inferred variant construction
  does and it is the one that makes the ninety uses legal. It also does nothing for a call argument
  whose parameter is generic, which `issues/lang/0273a` is already about from the other side —
  *"a slot does not determine a call's type parameters"* is open, and this would need the opposite
  answer.
- **From an import.** `import { Ok, Err } from "core";` brings the arms into scope as names, which
  is how the barrels already export types and makes the collision problem worse — see the entry on
  bare variant names sharing one namespace per file, which already has five renames in four
  packages.
- **Not at all**, and this directory qualifies ninety call sites. Cheap, and it loses the reason
  `match` arms were allowed to drop `case`: that a variant in a position where only one enum can
  appear does not need saying twice.

The first is what the code assumes. It should be written down before it is assumed for a
ninety-first time.

## `u8` is a scalar in sixty-one places here and is an array element type in the language

Measured 2026-09-04 through `bootstrap/ts/ask_wacc.ts`:

| written | today |
|---|---|
| `u8 x = 65;` — a local | **3 type errors**; emits and runs, answering 65 |
| `i32 take(u8 v)` — a parameter | **3 type errors**; emits and runs |
| `struct P { u8 v; }` — a field | **3 type errors**; emits and runs |
| `n as@ u8` — a cast | **3 type errors**; declined, *cast to an unsupported type* |
| `Sl<u8>` with a `T get()` — the `Slice<u8>` shape | **1 type error**; emits and runs |
| `u8[] a; a[0] = 65; return a[0];` — an element | **0**, and the element reads as an `i32` |

`spec/spec/types.md`'s primitive table lists `i8` and `i16` as *"Array element only — no locals,
params, or struct fields"*, and **has no `u8` row at all**; `spec/spec/arrays.md` documents `u8[]` as
a packed array type whose elements zero-extend on read. So the rule that governs `u8` is written for
its two neighbours and not for it, which is `issues/lang/0336a`.

**This directory writes `u8` as a scalar 43 times as a declaration, 16 as a cast target and twice as
a type argument, across 19 files. `packages/`, `tools/`, `spec/` and `bootstrap/` do it zero times.**
`Rgba { u8 r; u8 g; u8 b; u8 a; }`, `void push(this, u8 v)`, `const u8 ERASE = 127`, `Bytes.get(i)`
answering a `u8` — and `Bytes` is `Slice<u8>`, so the most-used type in this directory rests on it.

**The ask is smaller than it looks, and that is the finding.** Every one of the rows above *emits and
runs correctly* for the values probed. A packed element is an `i32` in a register — `array.get_u`
zero-extends — so there is nothing for the code generator to invent; a `u8` local is an `i32` local
that a store narrows. What refuses is the checker, and what it is enforcing is a rule about where
packed types may appear, stated for `i8` and `i16` in a table `u8` is not in.

So the question is not *can the machine do this*. It is:

- **What is `u8` for?** If it is *the element type of a byte array*, the restriction is right and this
  directory should use `i32` for a byte in hand, as `packages/` does everywhere — `Buf.push(this, i32
  v)`, `render(i32 b)`, `glyphIndex(i32 cp)`. That is the shipped answer and it costs the type: a
  parameter that takes a byte and accepts 300.
- **If it is a one-byte integer**, then locals, parameters and fields follow, plus the casts, plus a
  decision about arithmetic — `a + 1` at `u8` either wraps at 8 bits or widens to `i32`, and wac's
  rule is that arithmetic wraps at the operand's width, which would make `u8` the first type where
  that bites in a range a person holds in their head.
- **And `Slice<u8>` needs an answer either way**, because a generic instantiated at a packed type is
  a third case: one type error, not three, and the accessor's `T` return is what draws it.

The reason this is worth deciding rather than papering over: the restriction is *invisible*. Nothing
narrows a `u8` — the value is right, the program runs, and only the checker says anything. A rule
whose violation costs nothing at run time is a rule that gets written round rather than learned, and
sixty-one uses in a directory whose author had read the spec is the evidence.

## The best-argued paragraph in a file is a rule the type could have held

Eight times now, the place a shipped package argues *hardest* has been the place a type would have
said the same thing and needed no argument. It is consistent enough to be worth stating as a way of
reading rather than as six findings.

| package | what it argues, at length | what says it instead |
|---|---|---|
| `mpt` | `ok` and `present` are separate *on purpose* — conflating them "would make a broken proof look like an empty slot, which is the more dangerous of the two" | `enum Proved { Present(Bytes), Absent }` in a `Result` |
| `rlp` | why `bytesOf` **traps** rather than answering empty, with seven `mpt` call sites and the bug each would have had | `Bytes? asBytes()` — the guard is the unwrap |
| `datetime` | three ways to handle a leap second, why each is wrong, and "rejecting says so at the point of use" | a `LeapSecond` member, so the caller with the context decides |
| `abi` | a measured table of `cast` and `ethers` disagreeing about two rules, and why this package stays strict | a fault union, so "refuse this, accept that" is a caller's line |
| `tty` | "four things can happen at once … so this is a record rather than an enum" | one field plus a four-arm `Effect`; three of the four never co-occur |
| `raster` | why `damagedPixels` exists — so the off-by-one does not live in the caller | one `Rect` convention, so there is no conversion to hide |
| `bls` | that Montgomery form "must not leak", and that leaking it gives "an implementation that passes every internal consistency check and disagrees with every test vector" | `Fp` and `Canonical` as two types, at a measured 0.7% of a field multiply |
| `git` | why the comparator skips two columns — "comparing the bytes after the two status columns", nine lines and a `for (i32 i = 3; …)` | `Vec<Entry>` sorted by `.path`, and no 3 |

**The correlation is not a coincidence and it is not carelessness.** A paragraph gets written when
the author can see a way to get it wrong and cannot stop the reader taking it. That is the same
condition under which a type is doing too little: the distinction is real, it is known, it is
load-bearing, and it is being carried in prose because the value could not carry it. So the best
comment in a file is a reliable pointer at its weakest type, and *the better the argument, the more
certain the finding* — which inverts the usual reading, where a well-argued decision is one to leave
alone.

Two consequences worth keeping separate.

**A cost measured once bounds every proposal of the same shape.** The objection to typing these is
always allocation, and it was settled for `@/packages/bls`'s field element without a new benchmark:
`packages/bls/README.md` gives 7.9 ms per verification over *"order 20,000 field multiplications"* —
395 ns each — and `vision/bench/slicecost.wac` measured a fresh three-field struct at 2.6 ns. A
one-field wrapper is bounded by the second, so the answer is **0.7% of a field multiply**, in the
package where the objection should have been strongest. Worth naming because the bench was written
for a slice and answered a question about a prime field: both reduce to one `struct.new`.

**For this exercise:** the fastest way into an unfamiliar package has turned out to be finding the
longest justification in it. Not the `TODO`, not the `Not here yet` section, not the workaround
comment — the paragraph that argues *for* something. Five of the six above were found that way and
the sixth (`abi`) was found by a grep for callers.

**And for the language, which is the part that belongs here:** every row's answer is a sum, a
nullable, or a single canonical representation, and all three exist. So this is not a list of
missing features — it is evidence about what a language costs when the *reachable* shape is a struct
of flags. wac has enums with payloads and `T?` and has had them for months; six packages wrote the
paragraph anyway. Whether that is a documentation problem, an idiom problem, or a sign that the
shipped ergonomics of a sum are worse than a bool is the question, and it is not one this directory
can answer by inventing more syntax.

## A path is a `string` in every package that has one

`@/packages/wac`'s cache path is `home + "/cache/build/" + h.hex() + ".wasm"`, assembled at the point
of use and taken apart by whoever reads it. Neither `vision/std` nor `@/packages/fs` has a type for
one.

**Measured in the shipped tree rather than here: 465 concatenations of a path literal, across 15
packages** — 269 in `tools/`, 51 in `packages/wac`, 40 in `packages/git`, 33 in `packages/wactest`.
This directory does it *zero* times, and that is not a virtue: the bodies of the filesystem code
here are elided, so the count measures what has been written out rather than what the design
avoids.

What makes it worth an entry rather than a shrug is that **the vocabulary already exists and has no
type under it.** `packages/wac` has `stem`, `baseName`, `outStem`; `packages/fs` has mount paths and
a normalising walk; `Files.open` takes a `string`. So there is a set of operations that only make
sense on paths, applied to a type that is *any text at all* — and the failure mode is the one this
directory has been naming everywhere else: `Files.open(name)` and `Files.open(contents)` are the
same call.

Three shapes, and the reason this is a question is that the cheapest one is probably right and the
argument against it is real:

- **A newtype over `string`** — `struct Path { string s; }` — which is the refinement-of-an-integer
  entry one layer up, and inherits its whole problem: nothing in `core` is a refinement of anything,
  and a one-field struct costs an allocation and a `.s` at every use.
- **A real path type with structure** — segments, absolute-or-relative, a normalising join. That is
  what a filesystem package would want and it is a design, not a definition: `@/packages/fs`'s mount
  table already answers *which backing* per path, so the join rules and the mount lookup are the same
  walk done twice.
- **Nothing, and a naming convention.** Which is what happens now, and which works until two strings
  of different kinds meet in one signature — `buildCachePath(… string stem, string target)`, where
  one is a file stem and the other is what the user typed, both `string`, adjacent.

The last is the honest description of today, and it is why this is filed as a question rather than
as a want: **no bug has been found from it.** The evidence is four packages independently building
the same thing out of concatenation and a set of helpers with no shared type, which is a smell rather
than a defect — and the entry exists so that whoever *does* hit the defect finds it already counted.

## Nineteen functions answer `T?` with four or more ways of meaning nothing — 139 sites

The entry above says the best-argued paragraph in a file is a rule the type could hold, from six
instances. Six instances is an anecdote. Here is the population.

Mechanically, over `packages/*/src`: every function whose return type ends in `?`, counting
`return null;` in its body. **Nineteen have four or more; 139 null sites between them**, across
`ssz`, `url`, `git`, `codec`, `bls`, `tls`, `lightclient` and `wacc`. No predicate is in this list —
a predicate answers `bool`, so `T?` is unambiguously *produce a value or refuse*.

    19x  ssz/container.wac       u8[]?  rootAt
    13x  url/host.wac            Host?  parseIpv6
    12x  git/pack.wac            u8[]?  applyDelta
    10x  url/url.wac             Url?   parseUrl
     8x  ssz/container.wac       i32[]? containerSpans
     8x  codec/base64.wac        u8[]?  decode
     …fourteen more at 4 to 7

**Six read, five of them the finding.** `rootAt`'s doc enumerates four malformations — *"a span that
does not match a fixed size, an offset outside the container, offsets that go backwards, a bitlist
without its delimiter"* — and says why they are refusals: *"this reads attacker-supplied bytes: a
light client is handed a `LightClientUpdate` by whoever it is talking to."* `base64.decode`'s
enumerates four canonicality rules and singles out the one *"every lenient decoder drops"*, without
which *"a signature over the text means nothing"*. `applyDelta`'s distinguishes malformed from
truncated and then answers both the same way. `parseIpv6` does not enumerate at all — *"Null on any
syntax error"* — and still has thirteen sites.

The sixth is not the finding and is why the sample matters: `bls`'s `fp2Sqrt` answers `null` for one
mathematical fact — the element has no square root — reached from five places. A count of returns is
not a count of reasons, and roughly one in six here is a single reason with several exits.

## And 139 is the answer to why it has not been fixed

The open question under the entry above was whether this is a documentation problem, an idiom
problem, or a sign that the shipped ergonomics of a sum are worse than a bool. The number decides it:
**nobody retrofits 139 unions.** Any answer that requires going back is not an answer.

So the question worth asking is about the cost at the point of *writing*, and it is measurable. In
this directory, giving `@/packages/rlp` seven named refusals cost:

- seven `struct` declarations, one per reason, most of them one field;
- one `union<…>` declaration naming all seven;
- an import line in the file that raises them;
- eight names in the barrel, because `Err(is LeadingZero):` needs the name in scope at the call site.

Four places and roughly twenty lines, against `return null;` — eleven characters. That ratio is the
whole of it, and it is not about whether the language *has* sums.

Three directions, and they are not exclusive:

- **A union whose members are declared inline.** `union { LeadingZero(i32 at), NotMinimal(i32 at) }`
  as a declaration form collapses eight declarations into one and removes the barrel problem, since
  the members arrive with the union. This is the smallest change that moves the ratio.
- **A default: a `T?` *is* a union of one anonymous reason**, and widening it later should not be a
  rewrite of every call site. Today going from `null` to a fault changes every caller;
  if `T?` were sugar for `Result<T, Nothing>` the callers that only ask *did it work* would not
  change at all.
- **Nothing, and accept it.** Which is defensible for `fp2Sqrt` and indefensible for `rootAt`, and
  the difference between those two is exactly what the count cannot see — so the honest version of
  *nothing* is a convention about which functions owe reasons, and that convention does not exist.

What makes this a language question rather than a style guide: the second direction is a claim that
**`T?` and `Result<T, E>` should be the same construct at different arities**, and the two are
currently unrelated types with unrelated syntax — `x!` and `is null` on one, `match` and `try` on the
other. Every one of the 139 sites is a place where somebody chose the cheap one; under that reading
the choice would not have been between two constructs, and a caller that only asks *did it work*
would not change when the reasons arrive.

## The `bool` half, and the one place collapsing is the design — except in three of its four branches

The entry above measured the `T?` half. The `bool` half is **49 functions with four or more
`return false;`**, and unlike `T?` it cannot be counted mechanically: a `bool` is also how a
*predicate* answers, and a predicate loses nothing by saying no.

Read, from the top eighteen by count, the split is about seven to eleven:

- **Predicates**, where `false` is the whole answer: `isCounted` (*"Whether this `for` is the counted
  loop"*), `returnsOnlyFresh`, `isConstExpr`, `matchFrom`, `readsUnsettledConst`, `awaitInExpr`.
- **Rejections**, where it is not: `validateUpdate`, `matchTypeParams`, `linkFiles`, `linkHandshake`,
  `writeTreeOut`, and the four cryptographic verifiers.

And the four verifiers are the interesting ones, because **for a signature check, collapsing is
supposed to be the design.** `batchVerify`, `aggregateVerify`, `rsaVerifyPss` and
`certVerifySignature` answer `bool` with 33 `return false;` between them, and the standard reason
not to say why is that a verifier which distinguishes its failures is an oracle.

That reason is right and it covers **one** of the branches. Reading `packages/bls`'s `batchVerify`,
its nine are three different populations:

| | branch | who is wrong |
|---|---|---|
| 2 | `n == 0`; `messages.len() != n \|\| signatures.len() != n` | **the caller** — a bug in their own code |
| 5 | a key or signature that is not a point, an infinity key, an infinity signature, a bad pair | **the input**, which may be the caller's own key store or a peer's message |
| 1–2 | the pairing itself | the security answer, and the only one that must be uniform |

Saying *your arrays are different lengths* leaks nothing about a signature; the caller who passed
them has a bug and will find it by bisection. Saying *public key 3 is not a curve point* leaks
nothing either, and it is the difference between a broken key store and a hostile peer. **Only the
last row needs the silence, and it is buying silence for all three.**

So the shape of the question is not *should verifiers say why* — it is:

- **Does a verifier's failure set have two halves?** *This input is not well-formed* and *this
  signature does not verify* are different claims, and only the second is about a secret. A
  `Result<void, Malformed>` answering `Ok` for *verified* and *not verified* alike is the wrong
  split; `Result<bool, Malformed>` is the right one and reads badly enough to be worth naming.
- **And who is the audience?** `packages/tls`'s `certVerifySignature` and `packages/tor`'s handshake
  both need to *log* a rejection differently from a malformed record — that is the operator's
  question, and it is answered today by there being nothing to log.

Worth stating plainly because the argument cuts both ways and this directory has been making one
side of it for a week: everything above has been *distinguish your failures*, and here is the one
family where a false negative on that advice is a security bug. The distinction that survives is
narrower than the advice and wider than the current answer.

## A record stored inline in an array, which `0074`'s answer does not reach

`@/packages/zstd`'s FSE decoder packs three fields into an `i32` by hand —
`(extraBits << 24) | (nbBits << 16) | newState` — with the proof that they fit written in prose:
*"extra bits reach 31 (offsets), state bit counts reach the accuracy log of 9, and a next-state base
is under 512."* Three widths, argued in a comment, checked by nothing.

Everywhere else in this directory that is where a type appears. **Here the type is slower.** A
WasmGC array of a struct is an array of *references*, so `Entry[]` is one indirection per read in a
loop that exists to remove indirections — the file's own measurement is thirteen loads per sequence
cut to six, in *"over half of decode time"*. An array's elements are packed primitives (`i8`, `i16`)
or references, and never inline structs. There is no third option at the runtime, so the packing is
a workaround for **WasmGC** rather than for wac.

**And it is not `issues/lang/0074`**, which is the closest thing filed. That issue wants values with
no identity *exploded into locals*, its evidence is ChaCha20 at 4.7x and `packages/bls` at −64% —
both from moving array elements into registers — and its crux is stated as a lowering rule: *"the
spec text has to say the compiler is required to keep these in locals."* An array of a hundred
thousand entries cannot be in locals. Same want, different lowering, and 0074's answer does not
reach this case.

What is left is smaller than either and is worth having on its own:

    packed struct Entry { u8 extraBits; u8 nbBits; u16 newState; }   // lowers to one i32

A declaration that names the fields, fixes the widths, and compiles every read to the shift and mask
somebody writes by hand today. It changes no representation and no performance — it is the same
`i32` — and it moves a three-line proof out of a comment into something the compiler rejects when a
fourth field is added.

Two things make it a real question rather than an obvious yes:

- **What is the arithmetic on one?** If `Entry` is an `i32` at run time, is `entry.newState + 1` an
  `i32`, and does assigning 600 to a `u16` field trap, wrap or refuse? Every answer is defensible and
  the file being served here wants *refuse at compile time where the value is constant*, which is a
  third thing.
- **How does it interact with `u8` not being a scalar?** `issues/lang/0336a` — a packed type is an
  array element and not a local, parameter or field. A `packed struct` whose fields are `u8` and
  `u16` is asking for exactly the thing that rule forbids, in the one position where the
  representation makes it free. The two questions are the same question from opposite ends, and
  answering either badly makes the other harder.

**And the discriminator this produced is worth keeping separately**, because it decides where the
rest of this directory's proposals apply. `@/packages/bls`'s field element is a wrapper costing one
`struct.new` per *operation* — bounded at 0.7%. This is a wrapper costing one dereference per
*access*. Same proposal, opposite answer, and the question to ask of any of them is which of the two
it is.

## A closed set spelled as a string or an integer gives up a check the language already makes

Measured 2026-09-04: a `match` over an enum **with an arm missing and no `else` is one type error**,
and traps `unreachable` if the module is run anyway. With every arm it is clean. So wac already
gives the guarantee *you have not handled this case*, for free, at every `match`.

Two packages give it up, each by spelling a closed set as something open:

| where | the set | spelled as | what a missing case does |
|---|---|---|---|
| `packages/wac`'s `forCommand` | the twelve commands | `string cmd`, an `if` chain | **returns every grant** |
| `packages/abi`'s descriptor | the nine ABI types | `i32[]` in prefix order | reads past the end of the array |
| `packages/codec`'s alphabets | six, in two sets of two | four `i32` constants | **selects the other set's member** |

(`packages/rlp` looks like a third and is not: its four node forms *partition* the 256 tag values, so
there is no missing case to have. Worth the parenthesis because the shape is identical from outside
and the difference is whether the encoding is total.)

The first is the one that matters, and it is not a language gap — this directory is mostly asking
for something and this asks for nothing. `enum Command` plus a `match` with no default makes a
forgotten command a compile error **today**, and the reason it is not written that way is that the
command arrives as a word from `argv` and nobody converted it at the boundary.

So the question is not *should wac check exhaustiveness* — it does. It is:

**Where should a string become a value, and what makes anyone do it there?** A word from `argv`, a
tag byte off a socket, a type name in a descriptor: each is text or a number at the edge and a closed
set one line in, and the conversion is free. What is missing is any pressure to do it — nothing warns
that `if (cmd == "check")` is a dispatch over a set the program knows, and the cost of not doing it
is invisible until a thirteenth command is added.

Two directions, and the first is not a feature:

- **A convention with a name.** *Parse at the edge, match inside* is the rule; `spec/` has no page
  that says it and no example that shows it. The `Command? commandOf(string)` in
  `@/packages/wac/src/grants.wac` is four lines and is the whole technique.
- **Something that notices.** A lint for an `if`/`else if` chain comparing one variable against three
  or more string literals — which is a dispatch over a closed set written open, every time. Cheap to
  detect and, unlike most lints, it points at a place where the language has a better answer already.

### The third one is worse than a missing case, and it took two files to see

Added 2026-09-04 from the `@/packages/codec` rewrite. Two of that package's three files declare:

    base64.wac:15  export i32 ALPHABET_STANDARD() { return 0; }   // A-Za-z0-9+/
    base32.wac:15  export i32 ALPHABET_STANDARD() { return 0; }   // A-Z2-7
    base64.wac:17  export i32 ALPHABET_URL()      { return 1; }   // A-Za-z0-9-_
    base32.wac:17  export i32 ALPHABET_HEX()      { return 1; }   // 0-9A-V

Two closed sets, the same type, the same two values, the same first name. So
`base64.encode(data, base32.ALPHABET_HEX(), false)` type-checks and produces base64url — and a caller
importing both, which `@/packages/url` and `@/packages/http` both would, has four names in scope
holding two values between them.

**Every other case in this entry is a value from outside the set. This is a value from inside a
different one**, which no default arm and no bounds check can catch, because nothing is out of range
and nothing is missing. It is only visible from a file that imports both, and the package is arranged
so that nothing does.

The remedy is the same and the pressure is different: the first two cases are a text or a tag
arriving at an edge, and this one never leaves the program. So *parse at the edge* would not have
prevented it — what would is the observation that **two files declaring the same constant name are
declaring the same set or they are not**, and nothing anywhere asks which.

The reason this belongs here rather than in an issue: **the cost is not uniform, and that is the
design question.** `forCommand`'s default hands out ambient authority; `abi`'s reads past an array
and traps, which is bad and is bounded. A rule that treats a dispatch over commands and a dispatch
over type tags alike will be ignored where it matters, because it will mostly fire where it does
not — and the thing that separates them is not the shape but what the wrong branch can reach.

## 828 constants are written as functions, and I called it an oddity four times

Four package READMEs here note `i32 NAME() { return n; }` as a curiosity — *"functions returning
literals, third package running"*, *"fourth package, noted and not argued"*. Counted, it is not a
curiosity. Over `packages/*/src`:

| form | count |
|---|---:|
| `i32 name() { return 5; }` — a nullary function returning one literal | **828** |
| `const i32 NAME = 5;` | 197 |
| an `enum` | 47 |

So the function form is the **dominant** idiom by four to one, and it is the older one: a scalar
`const` is in `spec/spec/variables.md` as a basic feature and `const_decl` is in the top-level
grammar. `issues/lang/0032` added constants of *aggregate* type in July; scalars never needed it.

**Seven files use both forms**, which is what makes this drift rather than a capability question.
`packages/tor/src/relay.wac` has 24 functions and 4 consts, and three consecutive lines read:

```wac
const i32 PAYLOAD_LEN = 509;
const i32 RELAY_HEADER_LEN = 11;
export i32 relayDataLen() { return PAYLOAD_LEN - RELAY_HEADER_LEN; }
```

with `export const i32 NTOR_KEY_MATERIAL = 92;` seventy lines further down — so *exported* is not the
distinction either.

**One qualification, now measured.** `packages/wacc` holds 265 of the 828 and **zero** consts, and
its source must compile on wac-L5. Driving L5 directly: `const i32 LIMIT = 509;` at module scope is
**refused** — `unexpected token = before 509` — and so is the exported form, and so is the array
`issues/lang/0285b` is about, with the *same* message. A local `const` is accepted and a nullary
function is accepted.

So L5 has no top-level `const` production at all, and **a third of the population is forced rather
than drifted**: in `wacc` the function form is the only one the top rung can read. That is now
recorded in `0285b`, whose title says "array" and whose defect is wider.

The other **563** are in packages outside wacc's graph, which demonstrably manage both — `tor` has
67 functions and 146 consts.

### Two different questions live under the number

- **For the ones that are a closed set** — wire tags, opcodes, record types — the answer is neither
  form. `packages/tls` compares `suite == 0x1301` at five sites in one file and names it
  `suiteAes128Gcm()`; `packages/regex`'s thirteen `OP_*` and `packages/abi`'s nine `T_*` are the
  same. That is the *closed set spelled openly* entry above, and this count is its denominator.
- **For the rest** — a buffer size, a limit, a magic number with no siblings — `const` and a function
  are the same value and the choice is style. Which would make it a sweep and not a decision, except
  for one interaction.

### The interaction, which is why it is here and not in a style guide

`issues/lang/0269a` is open and recommends **requiring a `switch` case to be constant**, on the
grounds that `spec/spec/control.md` justifies the 32-bit restriction by `br_table`, *"which cannot
dispatch on a value it does not know"*. Under that rule `case RELAY_BEGIN:` compiles and
`case relayBegin():` does not.

So the two forms are not interchangeable after a decision that is already recommended, and 828 sites
are on the side that stops working. Nothing dispatches on one today — there are about 30 `switch`
sites in the tree — so this is a cost that arrives later, which is exactly when a sweep is most
expensive.

**What is actually being asked**: whether the function form is the idiom or the residue. The pages do
not say, both are used, and one open issue is about to make them differ.

## Flattening a union: three behaviours, three consumers, and they want different ones

`../TECHNICAL.md` measures `union<A, B>` lowering to an enum of one-field variants, nesting and all,
and argued for nesting from one consumer. Two more consumers want two other things, and none of the
three is a corner case: grouping a family of faults, stacking a pipeline, and reaching one error type
from two call sites are the three things error unions are for.

**Nesting, from `@/packages/box/src/gunzip.wac`.** `union<SourceFailed, Corrupt>` where `Corrupt` is
itself a union of eight, and `Err(is Corrupt):` is one arm for the whole group — *"it has one
sentence for the whole group and the group is the design, and the alternative is eight arms saying
the same thing."* Under flattening the members become siblings, `Corrupt` is not a name, and the
applet writes eight arms.

**Flattening, from `@/packages/box/src/upper.wac`.** `upperCase<E>` takes a stream failing with `E`
and answers one failing with `union<E, NotText>` — *"the source's error set plus the one thing this
code can be wrong about"*, which is right for one stage. Two stages give

    union<union<NotGranted, NotText>, NotText>

with **`NotText` at two depths**: two variants of two enums, so `Err(is NotText):` matches the outer
one and misses the inner. A caller asking *was the input not text* is right when the second stage
found it and wrong when the first did. Flattening makes the question answerable and the depth
disappear.

**Wrapping, from `@/packages/lightclient/src/validate.wac`.** A third behaviour, added 2026-09-04,
which neither of the two positions has room for. That function calls `@/packages/ssz`'s `verify`
twice — once for the finality branch and once for the committee branch — and a `ProofFault` promoted
into the outer union, nested *or* flattened, **cannot say which of the two produced it**. So the
member carries it: `BadFinalityBranch { ProofFault why; }`. That keeps both facts and gives up the
one-arm match, and it is the only one of the three the language supports today — at four lines per
use, because `try` propagates and cannot map.

    nesting     preserves the grouping        gunzip
    flattening  removes the duplicate         upper.wac
    wrapping    preserves the call site       lightclient

The first two differ in whether the members are **disjoint**. gunzip's are — a source failure and a
corruption are different events, and grouping them is the point. A stacked transform's are not: the
same fault can arise at any stage, and the stage is not what the caller is asking about. Wrapping is
orthogonal to both: it is about the *call site* rather than the members, and it is what you need when
one error type is reached from two places in one function.

(This entry absorbed *A union may contain a union, and flattening it would be wrong*, which said the
gunzip half and nothing this does not. Two entries for one question is the drift `DECISIONS.md`
warns about, in the file that is supposed to be the record.)

**And a fourth case that constrains any rule: the two unions may be declared in two packages.**
`UpdateFault` is `@/packages/lightclient`'s and `ProofFault` is `@/packages/ssz`'s, so flattening
would reach across an import and change a type one package declares because of how another composed
it. Neither position has considered that.

Three ways out, and the middle one is what most languages do:

- **Nest, and give the duplicate a name** — `Err(is NotText)` at depth is a search, and the caller
  writes it. Keeps grouping and makes stacking verbose in exactly the case that stacks most.
- **Flatten, with set semantics** — `union<A, union<B, C>>` is `union<A, B, C>` and a repeated
  member appears once. This is what an error *set* means everywhere it exists, it makes
  `Err(is NotText)` total, and it costs `is Corrupt`, which then has to be spelled as three arms or
  as a named subset the language does not have.
- **Both, distinguished at the declaration** — `union<A, Corrupt>` nests and `union<A, ...Corrupt>`
  flattens, which is a spread and is the honest reading of what the two consumers want. It is also a
  second piece of syntax for a construct that does not exist yet.

What makes this decidable rather than a matter of taste: the two consumers are already written, they
are eleven files apart, and neither is contrived. Whichever is chosen, one of them has to say so in
its own file.

## A capability wrapper enforces its direction only if nobody kept the original

`@/packages/fs`'s `Mount.readOnly(m)` is three lines and is a real improvement over the shipped
design, where read-only is a `bool` that eight operations each have to remember to check: here an
operation that forgot *would have to be written to forget*.

Writing the first caller — `@/packages/ssh/src/session.wac`, the per-session filesystem
`issues/system/0309b` needs — finds what the three lines do not carry. **The server still has to
write the image out**, and the wrapper refuses. So the unwrapped `Mount` exists for the life of the
server, and whether a session can reach it is a property of the program's shape rather than of any
value. `sessionFs(const Mount image)` takes the strong one and could as easily return it.

The shipped `bool` design has the same hole in a different shape: one object, and clearing the flag
is the whole attack surface. The closure design moves it from a **field** to a **reference** — which
is better only if something can say a reference does not escape.

**This is the third arrival of one question from three directions**, which is why it is here rather
than in the package:

- `@/packages/wac`'s `forCommand` answers what a command *should* hold and cannot check it is
  narrower than what the process holds — `issues/system/0337a`;
- `@/packages/ethrpc`'s `call` answers a `JsonValue` a caller may hand to `@/packages/mpt` as a
  verified state root, and *"provided the root came from somewhere else"* is in no type;
- and this: a read-only view whose strong original must exist somewhere unnamed.

All three want the same thing and none of them wants a *type*, exactly. They want **a claim about
where a value can go**: only narrower, only from the light client, only not into a session. A
`Verified<T>` that one module can construct covers the second; the first and third are about
non-escape, which is a different property and the harder one.

Worth stating as one question because three packages reached it independently in three days, and
because the cheap answer — a newtype per case — is three newtypes and does not compose. What they
share is that the *value* is fine and the **reachability** is the invariant, which is the one thing
this language, like most, has no way to write down.

## Standard input and the controlling terminal are one capability and are two things

`cmd | more` reads the text from standard input and the **keystrokes** from the terminal. Every
pager, every `less`, every `git log` in a pipe does this, and it is why `/dev/tty` exists.

`vision/std`'s `In` is standard input, and the shipped `Cli` has one too. So the pager written for
this exercise — `@/packages/box/src/more.wac` — takes one `In`, pages it, and cannot be used the only
way anybody uses a pager. That is not a rewrite decision: there is no second capability to ask for.

**It is the same missing distinction as the mode question above, from the other end.** That entry is
about `In.setMode` changing something that belongs to the terminal rather than to the reader; this is
about *reading* from the terminal rather than from the reader. One program needs both halves and
neither exists, and the shape of the gap is identical: **`In` is named for a stream and is being used
as a device.**

Three ways to draw the line, and the cheapest is not obviously wrong:

- **A second capability.** `Terminal` beside `In` and `Out`, carrying `setMode`, `read` and the size
  — which is what `/dev/tty` is, and what `Page` already is for a browser. It is honest, it is a
  seventh projection, and it makes *is there a terminal* a `Terminal?` rather than a guess.
- **`In` answers whether it is one.** `In.terminal()` giving a `Terminal?`, so the pipe case is
  `null` and the interactive case is the device — which keeps the projection count and puts a
  downcast in the middle of a capability, which is the thing projections were meant to remove.
- **Nothing, and a pager takes two `In`s.** Which is writable today and pushes the question to
  whoever constructs the program — the shell, which does know. It is also how a Unix program that
  opens `/dev/tty` itself behaves, and the reason that is unsatisfying is that *opening* it is an
  ambient reach by name, which is what this system does not have.

The reason it is a question rather than a want: **the third option may be right**, and it is the one
that costs nothing. What decides it is whether *the program* or *its launcher* should know that its
standard input is not a keyboard — and the answer this directory has given everywhere else is the
launcher.

## A capability signature is the last place a value type reaches

Nine of `Page`'s twelve members answered `Ticket<bool>` in this directory until 2026-09-04, and the
first consumer found out why that survived: **the audit that produced `vision/std` compared its
members against the shipped ones and never asked whether the shipped answer was right.** A `bool` in
`Page.render` became a `bool` in `Page.render`, faithfully.

Reading the only host that implements `Page` at all — `packages/platform/host/browser.ts`, since
`native/src` and `native/v8/src` mention it zero times — those operations are declared `void` and
the dispatcher answers `EMPTY`:

    [OP.SET_TEXT]: (p) => { const [a, b] = twoStrings(p); dom().setText(a, b); return EMPTY; },

**Nothing on the other side produces the bool.** And the one failure the host does detect it does
not report either: `drawPixelsIn` *throws* — `"${w}x${h} needs ${w*h*4} bytes, got ${rgba.length}"` —
which reaches a wac caller as a trap. So a capability that cannot fail and one that can are the same
signature, and it answers a third thing.

Fixed here; the shipped surface still has it, and the *method* is the part worth keeping: **a
conformance audit cannot find a flaw both sides share.** The five passes that produced this file were
names, signatures, answered types, prose and history markers — and the third pass asked *did the type
change*, not *is the type right*. Every finding it produced was a divergence. A design flaw copied
faithfully is invisible to all five.

### And the value types stop at the boundary

`@/packages/raster/src/frame.wac` sends a `Tile` — a `Rect` and the pixels, bundled so a caller
cannot pair the wrong rectangle with the wrong bytes — like this:

    ui.drawPixelsIn("screen", t!.at.x, t!.at.y, t!.at.w, t!.at.h, t!.pixels)

Five fields, unpacked in order, at the one call in the program that crosses to a host. The capability
even has **two arities for one operation** — `drawPixels(id, w, h, bytes)` and
`drawPixelsIn(id, x, y, w, h, bytes)`, differing by whether an origin is present, which a `Rect`
makes one call.

Every projection in `vision/std` takes strings, integers and `Bytes`. Not one takes a struct this
directory declared, and `Page.render(Node)` is the single exception — which `std/platform.wac` flags
itself as *"the first capability anywhere to take one"*.

That is not an oversight, and it is the question: **marshalling is defined per scalar**, so a value
type is exactly as far as a host boundary lets it travel. Three positions:

- **It is correct.** A capability is a syscall; syscalls take words; bundling is the caller's and the
  unpacking at the edge is honest about where the guarantee ends.
- **It is the wrong place to stop**, because the boundary is where a mistake is least visible — a
  transposed `w` and `h` crosses as two integers and draws a smear, and it is the one call the type
  system was going to catch.
- **The boundary should carry structs**, which `Page.render(Node)` already does, so the machinery
  exists and the question is only how far to take it — and what it costs a host that must now know a
  layout rather than an argument list.

`Page.render` having done it once is what makes this answerable rather than theoretical. Nobody has
written down why that one and not the rest.

## A `try` inside a larger expression is 21 of 84, and it is lowered nowhere

`TECHNICAL.md` lowers `T x = try e;` and `try for`, shows both running, and concludes from the
nesting cost that *"the transform belongs in a compiler pass over an AST"*. Writing that pass —
`@/packages/wacc/src/desugar.wac` — found the position the worked example did not have.

Counted 2026-09-04 over every `.wac` in `vision/`, with block comments and string literals blanked:

| shape | count |
|---|---|
| `T x = try e;` | 34 |
| **inside a larger expression** | **21**, in six files |
| `try e;` | 16 |
| `try for` / `try await for` | 13 |
| `x = try e;` — a name already in scope | **0** |

The zero carries as much as the twenty-one: **the easy version of the declaration case never occurs.**
Every value-producing `try` here either introduces the name it binds or is buried in an expression,
and both need the enclosing statement rather than the token.

### A temporary needs an order, and the rule is not the obvious one

```wac
Ok(Str(try this.take(try this.longLength(tag - 0xB7), false)))   // rlp/src/decode.wac:70
Proved answer = try w.step(try w.node(root));                    // mpt/src/proof.wac:61
members.push(key, try this.value());                             // json/src/parse.wac:108
(try await br.bits(32)) as@ u32                                  // gzip/src/inflate.wac:144
```

A `match` is a statement and those positions want a value, so the `try` hoists to a fresh local before
the statement. That is ordinary and it is **not order-preserving unless everything to its left hoists
too** — `f(a(), try b())` with an `a()` that writes anything is where getting it wrong is silent. So
the rule is *lift the prefix, not the `try`*: correct, undecidable without the whole expression, and
it pays for temporaries that nothing needed.

### And two positions cannot be hoisted at all

- **`while (try more())`** computes the temporary once and spins on it. The lowering is
  `while (true) { T t = try more(); if (!t) { break; } … }` — a change to the loop, not to the
  expression.
- **`a && try b()`**, and `c ? try d() : e`. Hoisting evaluates `b()` when the language says it must
  not. The lowering has to become an `if`.

Neither occurs in this directory, which is why neither was noticed. The first is named once, as the
case `asyncplan.wac` declines for `await` and `try` inherits for the same reason. **The short-circuit
case is named nowhere, and it is the one a person writes without thinking.**

### What has to be decided

Not whether to allow it — 21 uses, and forbidding it would rewrite six files into temporaries by hand.
What is unwritten is that **the compact form has a cost the page does not mention**: a reader who
writes the `rlp` line above has written two hidden locals and two nested two-arm matches on one line,
and the two positions above are a hole in the construct rather than in the implementation.

## The source text is an output of the compiler as well as an input

`Tok` is an index into the token array, and `@/packages/wacc/src/ast.wac` calls the tree *"a tree of
indices"*. So **every node a pass builds has no token**, and a lowering that synthesises anything —
`try`, `gen`, `union`, all three of the ones vision needs — hits that on its first line.

The shipped compiler already answers it, and the answer is worth writing down because nothing argues
for it anywhere: `packages/wacc/src/asyncsynth.wac` **appends its spellings to the source** and points
synthetic tokens into them. *"The spans are honest about what they are"* — a synthetic token takes the
line and column of the construct it came from. There are 23 zero-argument functions holding the fixed
indices and `synthSlot(k) = synthFixedCount() + 3 * k` for the unbounded ones.

It works. What it means is that the source buffer is mutated by a compiler phase, so *the text* is a
compiler data structure and not merely its input — and a second pass that wants fresh names finds this
out rather than being told. A `try` pass needs no fixed names at all, only the arithmetic half, so it
is the cheapest possible client of a facility nobody has named.

(Those 23 are also 23 more of the *828 constants written as functions*, in the file with the best
reason for it: a `const` at module scope is refused by wac-L5, the rung that compiles the compiler.)

## A typedef written backwards parses, and ten of the eleven cannot show it

`GRAMMAR.ebnf` has `typedef = [ "export" ] , type , IDENT , ";"` — the type first, the new name
second, which is C's declaration order and the opposite of `type X = Y`. So

    export i32 Tok;      // a name `Tok` for `i32`  — right
    export Tok i32;      // a name `i32` for `Tok`  — also parses

and the second one is what `@/packages/wacc/src/ast.wac` said for a week. It declares an alias named
`i32` for an undefined type, in a file whose whole tree is built out of `Tok`.

**Nothing could catch it.** The grammar cannot: both readings are one production. The parse is clean,
the file is self-consistent because nothing else in it names `i32`, and the import checker only spoke
up when a *second* file asked for `Tok` and this one did not export it.

**Eleven typedefs in this directory, and the distribution is the finding.** Ten have a left side that
can only be a type — `union<…>` nine times, `Slice<u8>` once — so a reader cannot get their direction
wrong and neither can a checker. The eleventh is the only one with a bare name on each side, and it
is the one that was reversed. A form is only ambiguous in the cases where it is ambiguous, and here
that is 1 in 11, which is exactly the rate at which nobody develops a habit.

Three ways out, and this is small enough that the cost of arguing exceeds the cost of choosing:

- **Leave it.** The type-first order matches every declaration in the language, and a reversed alias
  will usually be caught by the type checker naming an undefined type.
- **`export Tok = i32;`.** Unambiguous, and a fourth spelling of *bind a name* in a language that
  already has three.
- **Refuse a typedef whose right-hand side names an existing type.** Narrow, catches this exact case,
  and is a rule about what a name may be rather than about syntax — which is the sort of rule that
  turns out to have an exception.

## A shape adopted for a boundary outlives the boundary, because nothing links the two

`packages/ssz/src/container.wac` represents an SSZ type as four `i32`s in a flat table, and — unlike
every other flat descriptor this exercise has met — **it says why in its header**:

> A type is four `i32`s in a flat table, `stride 4`, so the whole thing crosses the JS boundary as an
> `i32[]` and needs no struct marshalling

Nothing crosses that boundary. The tests were TypeScript until commit `71f8299c`, *"ssz: the whole
package to wac, on a shared fixture loader"*, **2026-08-17** — six `*_wac.test.ts` files calling
`sszHashTreeRoot(types: Int32Array, fields: Int32Array, root: number, data: Uint8Array)`. They are
deleted. The only `.ts` left in the package is a SHA-256 oracle that speaks hex lines and has never
seen a descriptor, and no `.ts` anywhere in the repository mentions `KIND_`.

The file is not wrong; it was right when written. **It is findable only because it stated its
reason**, which is the argument for stating reasons made by the one file that did — the other flat
descriptors here (`abi`'s nine `T_*`, `regex`'s thirteen `OP_*`) give none, so nobody can tell whether
theirs has expired too.

What is unwritten is the general shape, and it is the other half of *a capability signature is the
last place a value type reaches*. That entry is about a value type stopping **at** a boundary. This is
the boundary reaching **back**: choosing the in-memory representation of a type three files behind it,
for a program that no longer has the boundary. Both are consequences of marshalling being per scalar,
and neither has anything that notices when the pressure goes away.

The nearest existing check is the entry on *"this exists because the language cannot"* being a claim
about causation — right eleven times in seventeen. A claim about a boundary is the same kind of claim
and nothing tests it either. **A reason written into a comment has no expiry and no owner**, and this
is the case where knowing the date it expired took one `git log`.

## `isValidMerkleBranch` takes its own argument twice, and its newer sibling puts it back together

```
bool isValidMerkleBranch(u8[] leaf, u8[] branch, i32 depth, u64 index, u8[] root)
bool isValidNormalizedMerkleBranch(u8[] leaf, u8[] branch, u64 gindex, u8[] root)
```

A generalized index is one number holding two facts: the depth is the position of its leading bit and
the path is every bit below. The first function takes them apart, needs them to agree, and its first
statement after the size checks is `if (branch.len() != depth * CHUNK) { return false; }` — a guard
that exists only because a caller can pass a depth the branch does not have. The second takes the one
number, splits it with `floorLog2` and `subtreeIndex`, and calls the first.

**Both forms are in the package and the newer one is the older one reunited.** That is not an
argument that has to be made; it is a change that already happened and stopped one function short. A
`Gindex` with `depth()` and `onRight(d)` as methods makes it one function, and the
surplus-leading-zeros rule that justified the second becomes a comparison of the branch's length with
the index's depth, checkable inside.

### And the `bool` is answering six questions, one of which is a security property

`false` means: a leaf that is not 32 bytes, a root that is not 32 bytes, a branch that is not `depth`
chunks, a fold that lands somewhere else — and, in the normalized one, a branch too short for the
index, or **a surplus that is not zero**. The last is described in its own comment as the rule that
stops a prover attaching an unrelated subtree below the field being proved, and it returns the
identical `false` as a caller who passed a 31-byte leaf.

One of the six answers the question the function is for. The other five are the caller having made a
mistake, and a light client that cannot tell them apart logs *"invalid proof"* when its own slicing is
off by a chunk. Two of the six stop existing if a chunk is a type; the rest are a `Result`.

This is the same shape as `Page` answering `Ticket<bool>` — a `bool` carrying a failure it cannot
name — arriving in our own code, in the one place in the repository where the distinction is a
security boundary rather than a diagnostic.

## A fixed-length byte view — six packages, and this entry owns the count

`Bytes` is `Slice<u8>` and its length is a runtime field. Six rewrites reached the same wall from six
directions. **The list lives here and nowhere else**, because five of them had written their own
ordinal and no two agreed:

| package | the value | how it is spelled |
|---|---|---|
| `@/packages/ens` | an Ethereum address | `Bytes` of twenty, `got.get(0).asWord()!.from(12)`, a magic 12 |
| `@/packages/raster` | a tile's pixels | a field short, arrived at the same day from another direction |
| `@/packages/bls` | a field element | `u32[] limbs`, where every operation assumes `LIMBS == 12` |
| `@/packages/ssz` | a merkle chunk | a struct wrapping a `Bytes` whose length was checked once |
| `@/packages/tor` | an onion address's checksum and key | two bytes and thirty-two, both `Bytes` |
| `@/packages/crypto` | a digest | `Digest32`, whose entire value is *32 because of where it came from* |

`@/packages/mpt` is **not** one, though `@/packages/bls` names it. Its nibbles are a `u8[]` and it
never asks for a bound; the citation was written without checking and is the reason this entry now
holds the list.

**The ask is smaller than dependent types and bigger than anything on the pages.** `Slice<T>` already
has `len` as a field; the request is for it to be in the type when it is known — `Slice<u8, 32>`.
Then `Chunk` is a typedef, `Chunk.of` is a cast the compiler checks, and the check survives in the
one place bytes arrive from outside instead of being re-derived in every function that receives them.

`@/packages/bls` adds the sharpest version: **the missing bound is on the *inside* of the type**
rather than on a parameter. A nine-limb array type-checks into an `Fp` and reads past its end on the
first multiply, and no caller did anything wrong.

What has to be decided is whether that is one feature or two, because a *sized* slice and a slice
whose size is a type parameter are different amounts of work — and every one of the six wants only
the first.

### Tested, 2026-09-05, and it survives — which three other asks did not

Three feature requests written into package files this week were retired by asking *name a caller and
say what it would do differently*: an overlay needed no language change, five preconditions wanted
things already on the list, and a refusing `slice` had no caller who would use it. This one was put
to the same test and it holds, in a sharper form than the entries stated.

**It does not remove checks; it moves them to where bytes enter.** `Chunk.of(Bytes)` checks a length
and answers a `Result`. With `Slice<u8, 32>` that becomes `Slice<u8, 32>.of(Bytes)` in `core` — the
same function, one layer down. The gain is real and is not what the entries claimed: **written once
instead of once per package**, at the boundary rather than at every function that receives the value.

**It removes fault members from public surfaces, and the number is five.** Counted over `vision/`:
thirteen fault structs are about a length, and five exist *only* because a fixed width is not in a
type — `ssz`'s `WrongLength` and `NotAChunk`, `crypto`'s `BadKeyLength` and `BadSignatureLength`,
`tor`'s `WrongKeyLength`. The other eight stay: `bls`'s `WrongArity` is two runtime lengths agreeing
with each other, `gzip`'s `LengthMismatch` is a trailer against a count, `abi`'s `LengthOverruns` is
an offset, `codec`'s `ImpossibleLength` is data-dependent, and `std`'s `WrongSize` is `w * h * 4`.
`tor`'s `WrongAddressLength` is fixed at 56 and would need sized **strings**, which is a second
feature and not this one.

**And the strongest form is arithmetic, which no entry mentioned.**
`@/packages/ens/src/answer.wac` writes `got.get(0).asWord()!.from(12)` — twelve bytes into a
thirty-two-byte word, giving twenty — and calls the `12` *"a slice with a magic 12"*. With sized
slices `from(12)` on a `Slice<u8, 32>` is statically a `Slice<u8, 20>`: no check anywhere, the
arithmetic is the type, and the magic number is checked against both widths at once.

That is the case that is not about constructors at all, and it is the one where the alternative is
not *a check somewhere else* but *nothing*. Whatever is decided about the rest, **the arithmetic is
the argument**.

### Two counts, which is why the numbers drifted

*Declaring a fixed-width wrapper* and *wanting the length in the type* are different questions and
five files answered whichever they had in mind:

- **four declare a wrapper** — `ens`'s `EthAddress`, `ssz`'s `Chunk`, `bls`'s `Fp`,
  `crypto`'s `Digest32`;
- **six want the feature** — those four plus `raster` and `tor`, which ask without declaring
  anything, because a tile's pixels and two checksum bytes are not worth a struct each.

### Why the count is here

Five files each wrote *third*, *fourth* or *fifth package*, and they were computed at five different
times from five different lists. `DECISIONS.md` has the rule — *"a rule written twice is a rule that
drifts"* — and `@/packages/wac`'s README already applied it to a number, for the same reason:

> The number was here and is not, for this file's own reason. … Two numbers for one measurement in
> two files is exactly the *"a rule written twice is a rule that drifts"* this file opens with,
> applied to a count rather than a rule. So the count lives in one place and this entry points at it.

An ordinal is worse than a count, because it also encodes an *order* and reads as evidence of
accumulation. Six packages arriving independently is the finding; which arrived fourth is not.

## A table rather than arithmetic is a bet on which document the code is checked against

`packages/codec/src/base32.wac` states its reason for a design choice, which is rare enough to be
worth the entry on its own:

> Five bytes become eight digits, so a short final group can be 1, 2, 3 or 4 bytes and pads to
> 6, 4, 3 or 1 `=` respectively. Those numbers are not a pattern anyone remembers, so they are a
> table rather than arithmetic: `PAD_FOR` and `DIGITS_FOR`, indexed by the number of leftover bytes.

**RFC 4648 §6 states those four numbers in a table.** So the code is four lines a reviewer reads
beside four lines of the RFC, and a transcription error is visible without understanding anything.

The `@/packages/codec` rewrite makes the three bases one algorithm parameterised by bits-per-digit,
and the four numbers become `lcm(8, bits) / bits` and a subtraction. That is one implementation
instead of three, 365 lines instead of a formula's dozen — and **a formula agrees with the RFC or
does not, all at once.** A reviewer can no longer check it by reading; they can only test it.

Neither is a spelling of the other and neither is wrong. What decides it is *which document the code
is answerable to* — a specification with a table wants a table, and a specification with a
construction wants the construction. Nothing in a signature, a type or a test carries that fact, so
it is re-argued per file by whoever is writing.

Worth having here rather than as a note in one package because the bet recurs. Every *"a table
rather than arithmetic"* in this repository is the same one, and the two halves of the choice are
usually made by different people a year apart: the person writing against the RFC picks the table,
and the person unifying three copies picks the formula, and the second one is not told what the first
one was optimising for. The comment above is the only place in the tree where they were.

The narrow version of the question, which is answerable: **is there anywhere to record "this is a
transcription of §6, check it line by line"?** A spec tag would do it — `spec/` already has
`[§wac-…]` markers pointing the other way, from code to the language definition, and this is the same
mechanism pointed at somebody else's document.

## Source-to-source is viable exactly when the transform only removes

`TECHNICAL.md` ruled out a source-to-source desugarer for `try`, and the reason it gave is not the
one that decides it:

> a source-to-source desugarer is the wrong target. Its output for that function is unreadable, and
> unreadable output is not a minor cost for a tool whose purpose is to let people run the proposal —
> every diagnostic, every line number and every stack frame would point into it.

**`packages/ts` is a source-to-source transform that does not have that problem**, and it holds the
property over 22 real files byte-identically against `ts.transpileModule` —
`design/system/0009` D1:

> type syntax is replaced with **spaces**, never deleted, so every line and column of the output
> matches the input and a stack trace from the result points at the TypeScript that produced it.

The difference is one word. **Erasure only removes**, so the output is the input with spans blanked
and every position survives — which is also why newlines inside an erased range are kept. A
desugaring **adds**, and there is no arrangement of added text that leaves the surrounding columns
where they were.

So the rule is not *source-to-source is unreadable*. It is:

- **length-preserving → source-to-source is fine**, and the diagnostics need nothing;
- **not length-preserving → a source map**, which is a second artefact every downstream tool has to
  consult. A different cost, not a smaller one, and the reason to prefer a pass over an AST is that
  a pass needs no artefact rather than that its output would be ugly.

The conclusion stands and its argument changes, which matters because the argument is what gets
reused. *Unreadable output* would also rule out the erasure this repository already depends on for
every capability call — `packages/ts` produces the bridge — and it does not.

### And the property is worth being a type

D1 holds today because every write in a 924-line file is careful, and it is checked at the end by the
differential. `@/packages/ts/src/blank.wac` makes it structural: a buffer whose only mutation is
`blank(from, to)`, which cannot change the length and cannot touch a `\n`. A stripper that erased by
deleting would not compile. `packages/ts/src/bundle.wac` writes into the same buffers and re-derives
the rule, and would inherit it instead.

(An earlier version of this paragraph called the bundler *unwritten in both trees*. It is 544 lines
in the shipped one — see the note below.)

That is the small version of a question this directory keeps meeting from the other side: **a design
decision written in a doc and held by discipline, where a type could hold it.** Every instance so far
has been found by writing the consumer. This one was found by reading two files written the same day
that contradicted each other.

## A value type is the only way to take an operator away

Every value type this directory has proposed *adds* something checkable: a `Rect` pairs four numbers
that must agree, a `Chunk` holds a length that was verified once, a `Tile` pairs a rectangle with its
pixels. `@/packages/webrtc/src/tsn.wac` is the first that removes.

SCTP's transmission sequence numbers wrap at 2^32, so the ordering on them is not the one `<` gives.
`packages/webrtc/src/sctp.wac` says so and provides the right one:

    export bool tsnBefore(i32 a, i32 b) { return (a - b) < 0; }

Ten call sites on nine lines of one file, all correct — checked, and six of the ten are written
`!tsnBefore(…)`. **At every one of them `a < b` was available and would have compiled.** The comment
above the helper exists because the wrong comparison is one character shorter than the right one.

Make it `struct Tsn { u32 v; }` and `a < b` does not compile, because comparison operators are not
defined on structs. The only ordering in scope is the RFC's.

### Which makes the general claim sharper than *use a newtype*

`i32` is not dangerous here because it is imprecise. It is dangerous because **it comes with an
ordering, and the ordering is wrong** — and the language attaches wrapping arithmetic and the
comparison operators to one type when they are two independent facts. Any wrapping counter has this
shape: a sequence number, a version, a slot in a ring, a TCP or QUIC packet number.

Three things follow, and only the first is settled:

- **A struct wrapper is a complete answer today.** No feature is needed; `Tsn` is nine lines and
  removes the hazard entirely. The cost is that every arithmetic use goes through a method.
- **It is the only answer.** wac has no operator overloading and no way to declare *this type has no
  `<`* on a primitive, so a program that wants `i32`'s arithmetic without `i32`'s ordering has to
  leave `i32`. Whether that is right is not obvious — it is one of the few places where *the wrapper
  is free* is measurably almost true (`@/packages/bls` measured a one-field struct at 2.6 ns against
  a 395 ns operation) and where the wrapper is also load-bearing.
- **Nothing points at the sites where it matters.** A wrapping counter held in a machine integer is
  greppable — a helper named `…Before` or `…After` that subtracts and tests the sign — and no tool
  looks. The eight files of `packages/webrtc` have exactly one such helper and it is correct; the
  question is what would have said so if it were not.

### And the wrapping entry cuts both ways

`wrapping is the only arithmetic, and at 64 bits there is no way to notice` is about a bug that
hides. `tsnBefore` **requires** wrapping: the subtraction wraps the same way the counter does, and a
language that trapped on overflow would need a second spelling here. One entry, two directions, and
only one of them was written down.

## `try` cannot map, so wrapping a callee's fault costs a `match` — and wrapping is a third answer

`try` propagates when the callee's error set is *contained in* the caller's — `TECHNICAL.md`'s entry
on it requiring the error to be in the set rather than equal to it. Eighty-four uses in this
directory and it is one token every time.

`@/packages/lightclient/src/validate.wac` is the first place an error has to **change shape**:

```wac
match (provesFinality(finalizedLeaf(update), finalityBranch(update), attested!)) {
  Err(why): { return Err(BadFinalityBranch(why)); }
  Ok(_):    { }
}
```

Four lines, twice in one function, for the propagation that is one token everywhere else. There is
no `try f() else Wrap`, no `?` with a map, and no combinator — `Result` in this directory has `try`
and nothing else.

### Why it is wrapped rather than nested, which the flattening question has no position on

The obvious composition is `union<…, ProofFault> UpdateFault`: disjoint members, and
`Err(is ProofFault):` as one arm for *the peer's proof was bad*. That is the **good** case of the
nesting argument — and it is wrong here, because there are **two** branch checks in the function and
a `ProofFault` promoted into the outer union cannot say which one produced it.

So the members carry it: `BadFinalityBranch { ProofFault why; }`. Three behaviours, not two:

- **nesting** preserves the grouping — `@/packages/gzip`'s eight-member `Corrupt`;
- **flattening** removes the duplicate — `@/packages/box/src/upper.wac`'s stacked transform;
- **wrapping** preserves the *call site*, which is what matters when one error type is reached from
  two places in one function.

Wrapping is the only one of the three the language already supports, and it is the one that costs
four lines per use. It is also the first case where the two unions are declared in **two packages**,
so a flattening rule would have to reach across an import — which neither position has considered.

### Half of it already exists, and the half that does not is the one that came up first

`@/packages/tor/src/onionaddr.wac` wrote the **first use** of `arm_value = expr | "continue" |
"break" | "return" , [ expr ]` — a control-flow arm in a `match` used as an expression, one of the
ten constructs found on the vetted pages that no rewrite had touched:

```wac
Bytes raw = match (decode(a.toBytes(), Alphabet.Base32Lower)) {
  Ok(b):    b,
  Err(why): return Err(NotBase32(why))
};
```

Three lines instead of four, and the value goes where the value goes. **But it only helps when a
value is being bound.** `validate.wac`'s two sites are propagating rather than binding — there is no
`raw` to name — so the arm buys nothing there, and the four-line `match` stands.

So the construct that exists covers the initialiser case and the ask is still a `try` that maps. That
narrows the question usefully: it is not *add a way to handle a Result inline*, which the language
has; it is **a way to change an error's type while propagating**, which is the one shape `try` is
defined not to do.


## Where a fault union ends, and whose fault its members are

Two answers from one composition, `@/packages/lightclient/src/branch.wac` over `@/packages/ssz`.

### It terminates, and the rule is not a judgement call

`validate.wac` stopped naming failures at one level and said the argument for going further *"does
not obviously terminate"*. It does. Below `verify` there is a loop of `sha256` and a comparison, and
neither has a way to fail that a caller could act on differently — **a hash does not refuse**.

So: **a fault union ends where the next thing down cannot fail in more than one way.** That is
checkable rather than aesthetic, and it could not be found from `validate.wac` alone — it needed the
package below to exist. Which is an argument for rewriting a *stack* rather than a package: the
question *have I named enough failures* is answered one level down, every time.

By that rule `verifies` should not stop either — `packages/bls` distinguishes an empty key list, a
point off the curve and a pairing that disagreed — and that is a different package again.

### And the same five faults are a bug in one caller and an attack in another

`@/packages/ssz`'s README sorts its own: *"One of the six answers the question the function is for.
The other five are the caller having made a mistake."* True for the caller `ssz` imagined — a program
building a proof out of a structure it holds, where a ragged branch means it sliced wrongly.

**A light client is handed the branch by a stranger.** Then every one is a fact about the peer:
`NotAChunk` is a 31-byte node on the wire, `BranchTooShort` cannot reach the root, and
`SurplusNotZero` is **an attack** — a prover attaching an unrelated subtree below the field it is
proving, which is why `sync-protocol.md` refuses rather than slicing.

So *caller error* versus *the answer* is not a property of the fault. It is a property of **where the
argument came from**, and no signature in either package records that. One caller wants all five
reported to whatever scores peers; the other wants four of them to be traps.

`Result<T, E>` says what can go wrong and nothing says whose fault it is — and that decides whether a
call site logs, traps, or drops a peer. The narrow question: is that a *type* distinction at all, or
is it what a capability boundary already means — everything arriving through one is untrusted, and
everything a program computed itself is its own?

## A conversion at a package seam is an adoption cost, not a conversion cost

`packages/codec` is RFC 4648, checked against the normative §10 vectors, and `encode` answers `u8[]`.
Base64 output is ASCII by construction — there is no byte sequence it can produce that is not text.

`packages/tor/src/directory.wac` **hand-writes a second base64 encoder**, twenty lines with its own
alphabet literal, in the file that imports `packages/codec`'s *decoder* at line 28. Filed as
`issues/system/0339a`. The dating is what makes it evidence rather than an anecdote:

| | |
|---|---|
| `packages/codec/src/base64.wac` created | `38e8f343`, 2026-07-31 |
| `string.fromBytes` added | `4eb39a6e`, 2026-07-31 |
| `directory.wac` written — the import **and** the hand-rolled encoder, one commit | `aa250c02`, 2026-08-03 |

Three days apart, and `string.fromBytes` is used inside the hand-rolled version's own last line. The
whole function is `string.fromBytes(encode(bytes, ALPHABET_STANDARD(), false))`, and all six call
sites want a `string` — a map key and a URL path segment.

**Nobody writes twenty lines to avoid one conversion.** They write them because a signature that
answers the wrong type reads as a function for somebody else, and the cost of a seam is paid in
whether the package gets used at all rather than in the call. That is a different quantity from the
one anybody estimates when choosing a return type, and it is invisible afterwards: the tree contains
a correct codec, a correct duplicate, and no record that one was written because of the other.

### Which the callers can settle, and it is not symmetry

Two of `packages/tor`'s decode callers hold **bytes** — `hsdesc.wac` and `hsintro.wac` slice a block
out of a document — and only `onionaddr.wac` starts from a string. Every encode caller wants a
string. So the pair the callers ask for is asymmetric:

    string encode(Bytes data, Alphabet a, Padding pad)
    Result<Bytes, CodecFault> decode(Bytes text, Alphabet a)

and imposing symmetry on it, in either direction, would be a preference rather than a finding.

### The open part

`../QUESTIONS.md` already has *which byte type a capability speaks, now that the widening is
one-directional*. This is the same question one layer up, and the layer matters: a capability has one
implementation and a decision can be made once, and a **package** has as many callers as it acquires,
each of which can quietly decline it.

Three ways to notice, and none exists:

- **Nothing detects a re-derivation of an imported package's other half.** `0314b` finds
  byte-identical duplicates by hashing and `0325a` found five `itoa64`s by name; neither would find
  this, because the copy is not identical and is not called `encode`.
- **Nothing records why a signature was chosen.** `u8[]` out is defensible — it composes with a
  `Buf` — and the file does not say whether that was weighed.
- **Nothing asks a package who declined it.** A caller that imports one export of a five-export file
  is the cheapest possible signal, and it is greppable.

## A value whose guarantee comes from how it was made — one feature, seven witnesses

**This entry owns the list.** It absorbed *A type only its own file may build*, *A value whose
guarantee comes from how it was made* and *A digest that knows what it digested*, which were three
entries for one request and each carried its own partial list — the drift `DECISIONS.md` warns about,
in the file that is supposed to be the record.

Seven types in this directory are trustworthy only because of the code that built them, and none can
say so:

| type | the guarantee | established by |
|---|---|---|
| `@/packages/crypto`'s `Digest32` | it is 32 bytes | it came out of a hash; there is no other constructor |
| `@/packages/ts`'s `Prefix` | nothing in the input starts with it | something walked every token and looked |
| `@/packages/http`'s `Headers` | at most one `Content-Length` | a framing check ran over the whole collection |
| `@/packages/git`'s `Rule` | `pat` has had its `!` and trailing `/` removed | the parser did it |
| `@/packages/ssz`'s root | this is a `BeaconState`'s, not a `SyncCommittee`'s | which function produced it |
| `@/packages/quic`'s transcript | it hashed the handshake messages, not the frames | `transcriptOf`, and nothing else |
| `@/packages/quic`'s `PacketKeys` | these are the client's, not the server's | which `Side` was passed |

### It is one feature with two halves that are useless apart

**A private constructor.** wac has no visibility inside a module — `export` is the only control and
it is per declaration — so a type is private to a file or public to everyone, and *public with a
constructor that is not* cannot be written. `Digest32(someBytes)` is an ordinary struct construction.

### Tested 2026-09-05, and the ask is not a private constructor — it is a package

Counted, with comments stripped, how many files *other than the declaring one* use each of the seven
in code:

| type | other files | who they are |
|---|---|---|
| `Digest32` | 7 | four `crypto` siblings that **legitimately make digests**, plus `ssz` and `quic` |
| `Chunk` | 5 | three `ssz` siblings, plus `lightclient` twice |
| `Headers` | 2 | both `http` siblings |
| `Prefix` | 1 | the `ts` barrel — a re-export, not a construction |
| `Rule` | 1 | the `git` barrel — the same |
| `Transcript` | 0 | nobody |
| `PacketKeys` | 0 | nobody |

**A file-private constructor does nothing for five of the seven.** `Transcript` and `PacketKeys` have
no other user at all; `Prefix` and `Rule`'s only other mention is a barrel re-exporting the type. For
those four the guarantee is already held by the file being the only place, which is what the entry
said was *the arrangement* and turns out to be *the mechanism working*.

**And for the two it does help, file-private is the wrong grain.** `sha256.wac`, `keccak.wac`,
`hmac.wac` and `hkdf.wac` all construct a `Digest32` and all should: they are the hashes. A
constructor private to `digest.wac` forces four files into one. What is wanted is *only this package
may build one*, and `ssz` and `quic` — the two that should be refused — are exactly the ones outside
it.

So the request is **a module boundary larger than a file**, which wac does not have in any form. A
package is a directory, a barrel and a convention in `wac.json5`; it is not a language construct, so
there is nothing for a visibility rule to be relative to. That is a much larger ask than *a private
field*, and it is the honest one:

- **A private field or constructor**, file-scoped — cheap, and answers two of seven, one of them
  wrongly.
- **A package as a language thing**, with visibility relative to it — answers both real cases, and is
  a feature the language has so far managed without.
- **Nothing.** Four of the seven are already safe by accident of layout, and the two that are not are
  guarded by `Chunk.of` and `Digest32`'s absence of a byte constructor, which is a convention that
  has held.

The measurement that would move it: has anything ever constructed one of these wrongly? Nothing has,
and the directory is four days old, so the honest reading is that the evidence is thin and the
feature is larger than it looked.

**A phantom parameter.** `Digest32<Transcript>`, where `T` appears in no field, so a tag says *what
this was a hash of* rather than *how wide it is*. `sha256` cannot know a `T` — the objection
`@/packages/ssz` was declined on — so the tagging happens in a constructor, which is the caller's.

Which is why they are one feature: **a phantom parameter without a private constructor says
nothing**, since anyone can write `Digest32<Transcript>(bytes)`; and a private constructor without a
phantom parameter cannot separate two values of one shape. Rows 1–4 want the first, rows 5–7 want
both, and no row wants only the second.

### Counted 2026-09-05: eleven sites were claimed and three of them are a different feature

Four files after this entry each incremented an ordinal — *the eighth site*, *the ninth*, *the tenth*,
*the eleventh* — against the seven above, and I wrote all four without once asking what the tag would
name. Enumerated:

| site | the tag would say | known at each call site? |
|---|---|---|
| rows 1–4 | which function built this | — (they want the constructor half) |
| `@/packages/ssz`'s root | `BeaconState` or `SyncCommittee` | **yes** |
| `@/packages/quic`'s transcript | it hashed the handshake | **yes** |
| `@/packages/quic`'s `PacketKeys` | client or server | **yes** |
| `@/packages/page`'s `Page` | this program built it, or was handed it | **yes** — a renderer and a harness are different programs |
| `@/packages/zstd`'s `SeqTables` | which **frame** | **no** — frames come off a stream |
| `@/packages/wacc`'s `Program` | which **file** a `Tok` indexes | **no** — a resolver holds two at once |
| `@/packages/ts`'s `blank(Bytes)` | which **array** the slice views | **no** — it is a field of the receiver |

**The discriminator is whether the distinguishing thing is known where the value is made**, and by
that test three of the eleven are not phantom-parameter cases at all. A type parameter can name a
type; it cannot name *this frame*, *this program*, *this array*. Those want a singleton or a
dependent type, which is strictly larger than the feature this entry is about and is not on the
pages.

`@/packages/fs`'s `Mount` is a fourth and was found independently, in its own words: *"which mount
this is is a runtime fact rather than a type argument"* — the same conclusion, reached from the other
end, and never counted here.

**So the count was doing work the enumeration would not have done.** Eleven sites reads as *a feature
with overwhelming demand*; eight-of-one-feature-and-three-of-a-larger-one reads as *a feature worth
having and a second one worth naming*. `@/packages/zstd/src/block.wac` even said so at the time —
*"the first where the tag would be a **runtime** value rather than a static one"* — and I recorded
the observation and incremented the counter anyway.

Third time in this directory a bare ordinal has hidden something, after the fixed-length byte view
and the sentinel count. The rule was written down after the first: **a claim that names its subject
is self-checking and a claim that only counts is not.** It has now been broken by the same author
three times, which suggests the rule is not the fix — writing the table is.

### The cost of not having it is not uniform, which is the part to decide on

- `ssz`'s mismatched root **compares `false`** — wrong, and a test sees it.
- `quic`'s mistranscribed handshake **produces keys nobody shares**, which *"decrypts as noise and
  looks exactly like a wrong Diffie-Hellman"*.
- `http`'s unchecked `Headers` is a **request smuggling** difference.

Cheap in four places and load-bearing in three, and the three are the ones where the failure is
invisible.

### Measured: 45 comments stand in for it, and they are two different asks

Counted 2026-09-05 over `packages/` excluding tests — comments claiming a check happened elsewhere or
holds *by construction*:

    45 total
     5 preconditions — "the caller has already checked …"
    40 invariants   — "… by construction", about a value this code made

`@/packages/zstd/src/block.wac`: *"The caller has already checked the block fits in the frame."* And
`@/packages/tls/src/asn1.wac` names the failure mode of the whole class: *"the same check written
once per call site and forgotten at one of them."*

**The split matters because the two want different features** — an invariant wants the private
constructor above, and a precondition wants something else. Forty against five says the entries were
about the common case.

### And the five were read, and none wants anything that is not already here

| | what it says | what answers it |
|---|---|---|
| `zstd/src/block.wac` | *"The caller has already checked the block fits in the frame"* | `Slice`, in `core` today |
| `zstd/src/sequences.wac` | *"Bounded by the caller, which has already checked …"* | the same |
| `ssh/src/wire.wac` | *"a caller can parse a whole message and check once at the end"* | `try` |
| `tls/src/asn1.wac` | *"the same check written once per call site and forgotten at one of them"* | `try` |
| `wacc/src/wapyparse.wac` | *"The caller has already checked that the word after `async` is `def`"* | a witness value — this entry |

Two want a type that exists and did not when the code was written; two want a construct already
proposed; one is this entry. **The branch closes.** Written up in
`@/packages/zstd/src/block.wac`, where the precondition becomes the argument type and the comment
has nowhere left to go.

**The middle pair is worth more than the closure**, because it is the strongest case *against* `try`
in the tree and both files make it in their own words. `wire.wac` keeps a latch so *"a caller can
parse a whole message and check once at the end, instead of testing after every field"*; `asn1.wac`
keeps a shared one so a failure two levels down is visible without *"the same check written once per
call site and forgotten at one of them."*

Both are describing manual propagation, which is what `try` removes — the per-field test is one
token and forgetting it is the compile error the second quote fears. So the objection is to a
`Result` **without** `try`, and neither file could have known that. What survives is smaller and
real: a latch answers harmless defaults and keeps parsing, so a caller inspects a whole malformed
structure; `try` stops at the first fault. For a certificate parser that is a design choice about
whether you want the first error or the shape of the input, and `@/packages/tls` is the one package
here that might want the second.

## A value one layer too high makes the capability that needs it undeclarable

`@/packages/tty`'s README states a symptom and calls it the clearest evidence the exercise has found:

> **What is missing is anything that *selects* one.** `sshd` constructs `Line.create()` and never
> changes it, the browser terminal likewise, and there is no `stty` for a program to ask with. So an
> editor still cannot have a keystroke at a time — not because the discipline cannot do it, but
> **because nothing can say so.**

Measured: `Line.cbreak()` and `Line.noEcho()` appear nowhere outside `packages/tty` itself. **The
missing capability shows up as a missing program** — `@/packages/box` has sixty-four applets and no
pager.

The cause turned out to be one line of layering. `Mode` — two bools, `canonical` and `echo` — was
declared in `@/packages/tty`, because the line discipline is what a mode *does* and that is where it
was first needed. The call that was missing is `In.setMode(Mode)`, and `In` is a capability in `std`,
**below every package**. So a `Mode` declared in a package is a type the capability layer cannot
name, and the member could not be declared at all.

Nobody had failed to write the call. The call was not writable, and nothing said so — the file that
needed it imported two names from `"std"` that `"std"` did not have, and a file-level import check
sees `"std"` and is satisfied.

### Which is a rule, and the rule is not "put shared types in `core`"

The type is not shared between *packages*; it is shared between a package and a **capability**. What
decides where it goes is which layer has to *name it in a signature*, and that is always the lowest
one — so:

**a value that appears in a capability's signature must be declared at or below the capability layer,
whatever layer first needed it.**

That is checkable, and it was checked the same day. `vision/std/platform.wac` has **49 funcref
members**; the types appearing in their signatures are `string`, integers, `Bytes`, `Result`,
`Ticket`, `AsyncGenerator`, `Vec`, `Node`, and types the file itself declares. Every one of those is
`core` or `std` — below the capability layer — **except `Child` and `Grant`**, which were declared in
`@/packages/sh/src/exec.wac` and named in `Proc.spawn`'s signature by a file that imports nothing
from a package. One member of forty-nine, so the rule held and the two types came down rather than
the rule going.

That one mattered more than a dangling name, because **the same rule is what justifies a hole three
entries of this file complain about**: `Files.open` answers `Result<…, NotGranted>` and cannot answer
`@/packages/fs`'s `Fault`, on the grounds that `std` is below the packages. It is, for `Fault`. It
was not, in one signature — so the rule was being enforced against one caller and quietly broken for
another, and only the caller it was enforced against had noticed.

**`Page.render(Node)` is not the exception**, which `std/platform.wac` implied twice and this file
repeated. `Node` is declared in `core/jsx.wac`, below `std`. What is true of it is a *different*
claim — that it is the first capability to take a **struct** rather than scalars — and the two were
easy to conflate because one file made both.

Nothing enforces the rule and nothing would have to: a package type in a `std` signature is an import
from a package into `std`, which is a cycle. What is missing is only that an unresolvable name in a
signature was not an error — the file-level import check sees `"core"` and is satisfied, and the
name-level one only reads import lists, not uses.

### And it is a different fault from the one it looks like

`Mode` moving fixed **declarability**. It did not fix **ownership**, and the two are easy to
conflate: `setMode` is on `In`, and the mode is a property of the *terminal* that `In` and `Out` are
both views onto, so `in.setMode(cbreak)` still silently makes every `out.write` containing a `\n`
wrong. That is the ambient-mode entry, still open, and the reason to keep the two apart is that the
first was invisible — a symptom that reads as *nobody wrote it* — while the second was written down
in three files before anybody moved anything.

## A name used in a signature and imported by nobody is caught by nothing

Two checks read this directory's imports. One asks whether the file an import names exists; the other
asks whether it exports the names asked for. **Neither looks at what a file uses.**

`Vec` appeared in two of `std/platform.wac`'s capability signatures and was never imported. `Child`
and `Grant` appeared in a third and were declared in a package that `std` cannot import from. Both
were invisible: the file-level check saw `"core"` and was satisfied, the name-level one read the
import list and found nothing wrong with it.

A third check — resolve every capitalised name a file *uses* against what it declares, imports, or
can reach as a bare enum variant — found **eight more files** in a directory the other two had
passed:

| | |
|---|---|
| `fs/src/mount.wac` | `Map`, eight uses, never imported |
| `http/src/request.wac` | `Result`, and `BadTarget`/`BadVersion`, which exist in its own `./fault.wac` |
| `quic/src/endpoint.wac` | `Ticket` three times, `AsyncGenerator` |
| `wactest/src/assert.wac`, `test.wac` | `Result` eight times between them, `Map` three |
| `stream/src/scalars.wac` | `Decoded`, `Truncated`, `Malformed` — all exported by `@/packages/unicode` |
| `tor/src/verdict.wac` | `AuthorityCert`, declared nowhere at all |
| `gzip/src/inflate.wac` | `AsyncGen`, a name for nothing, and `Buf` |

### An invented name stands in for a decision

`AsyncGen<u8[]>` is the one worth the entry. Renaming it to the type that exists turned one
unresolved name into **two errors it had been hiding**: `AsyncGenerator<Y, R>` takes a yield type
*and a return type*, and the return type is where a source's failure lives — which that signature had
no `E` for. So `gunzip` had quietly been declared over a stream that cannot fail, in a package whose
entire subject is malformed input.

That is the general shape and it is not about spelling. A name that resolves to nothing is usually
standing in for a question nobody answered, and it type-checks against **whatever the reader
imagines**, which is always the easy case. The two existing checks are the wrong instrument for it
because an import list is a statement of intent and a signature is a statement of fact.

### And it surfaced a hole in `core`

`gunzipBytes` is *the whole member, for a caller that has the whole member*, and it needs a stream
over a value this program already holds. `core` has no way to make one — `Vec.items` is the same idea
over a container and there is no `once(x)`.

**One caller wants it, and the first draft of this entry said three.** The other two were named from
memory and neither survived a minute's checking: `@/packages/box/src/cat.wac` fixed its doubled loop
two versions ago and says so — *"there is one `copy`, one call site per source"* — and what it still
wants is a one-element **collection**, `Vec.of("-")`, which is a different ask; `@/packages/wactest`
does not mention `AsyncGenerator` at all. Recorded rather than quietly corrected, because this entry
is about an instrument finding what reading does not, and an unchecked claim inside it is the exact
failure it describes.

Four lines, and the failure type is the interesting part: `AsyncGenerator<Y, R>`'s `R` is not
optional, so a source that cannot fail must still name a failure. `Result<void, never>` is the
honest answer, and then every consumer's `union<E, …>` acquires an uninhabited arm — so
**`union<never, Fault>` has to reduce to `Fault`**, or every buffer-in caller in the tree answers a
union with a member nobody can construct. `never` is *"a type with non-trivial semantics, asserted in
one doc comment"*; this is the case that makes the assertion load-bearing rather than decorative.

## A chain that names its predecessors stays right; a bare ordinal drifts

Not a language question, and it is here because this file is where the counting happens and the
counting has been wrong.

Audited 2026-09-04: 493 countable claims across `vision/`. Two families, opposite outcomes.

**The one that drifted.** *A fixed-length byte view* had five files each writing a bare ordinal —
third, fourth, fifth, fourth — computed at five different times from five different lists. No two
agreed, one cited a package that never made the request, and that citation was then copied into a
sixth file. *A sentinel drawn from the value's own range* had the same shape at smaller scale: one
file's list named the same instance twice and its ordinal was one too high.

**The one that held.** *The Nth thing left alone* runs to eight — `json`'s lazy object index, `Buf`'s
field layout, `regex`'s flat class arrays, `bignum`'s limbs, `raster`'s pixel layout, `datetime`'s
calendar, `zstd`'s fused table, `git`'s capability — across five files written days apart, and
**every one is correct.** `regex` says third and names two; `bignum` says fourth and names three;
`datetime` says sixth and names five; `zstd` says seventh and names six; `git` says eighth and names
seven.

The difference is the whole finding: **a file that writes the list cannot be wrong by more than one,
because writing it is checking it.** A bare ordinal is a claim about work the reader cannot see,
made by a writer who did not look either.

So the rule, and it costs a clause:

- **Write the list, or point at the file that has it.** Never the number alone.
- **An ordinal is worse than a count**, because it also encodes an order and reads as evidence of
  accumulation. *Fifth package* sounds like a trend; *six packages* is a list. Six arriving
  independently is the finding — which arrived fourth is not, and is what five files were spending
  their credibility on.
- **Two questions will get one number.** *Declaring a fixed-width wrapper* is four packages and
  *wanting the length in the type* is six; every file answered whichever it had in mind and wrote it
  as though there were one.

### A third family, checked and sound — and it says which claims are safe

*The first consumer X ever had* appears 22 times. Six were checked by finding every file that uses
the construct and ordering them by the commit that added them:

| claim | other users | verdict |
|---|---|---|
| `@/packages/tls` is `secret`'s first consumer | `crypto`'s `hkdf`, `hmac` — both later | holds |
| `@/packages/wactest/src/within.wac` is `coroutine`'s | none | holds |
| `@/packages/wacc/src/walk.wac` is the brace pattern's | `desugar.wac`, later | holds |
| `@/packages/server/src/halfclose.wac` is `Socket.closeSend`'s | the declaration only | holds |
| `@/packages/sh/src/pipeline.wac` is `Proc.run`'s | the declaration only | holds |
| `@/packages/tor/src/onionaddr.wac` is `@/packages/codec`'s | the barrel only | holds |
| `@/packages/fs/src/mount.wac` is the `Files` projection's | four, all later | holds |

**Seven for seven**, where the ordinals were five for zero. The difference is not care; it is shape.
*First consumer of `secret`* names the thing to grep for, so writing the claim and checking it are
the same action. *Fifth package to want a fixed-length array* names nothing — the set has to be
reconstructed from memory, and memory is what produced the number in the first place.

So the operative rule is narrower and more useful than *check your counts*:

> **A claim that names its subject is self-checking. A claim that only counts is not.**

`DECISIONS.md` already has the rule for prose — *"a rule written twice is a rule that drifts"* — and
`@/packages/wac`'s README already applied it to a number. What is new is the measurement: the same
directory, three families, and the two that name something are the two that survived.

## "Three lowerings" is two lowerings and a code generator

`TECHNICAL.md` costs `union`, `gen`/`yield` and `try` together and concludes *the desugarings are
easy and the parser is the work*. Writing two of the three as passes says otherwise, and the
difference is not size.

| | rewrites | needs |
|---|---|---|
| `try` | a statement list into a nested one | statements |
| `union` | a type into an enum of one-field variants | types |
| `gen` | a function into a struct **and** a function | **declarations** |

`@/packages/wacc/src/desugar.wac` is the first, written and complete. `@/packages/wacc/src/genlower.wac`
is the third and **stops at a signature**, because a generator's lowering adds a *top-level
declaration* to the module — a struct with a resume tag and one field per local that outlives a
suspension. That changes the export table, the type table, and the order things are checked in.

The shipped compiler does exactly this and has for a while: `packages/wacc/src/asyncsynth.wac` is
where the 23 synthetic-name constants live, and it is called a **plan** rather than a rewrite. So the
naming was right before the reason was written down: a pass that emits declarations cannot be
expressed as a tree-to-tree rewrite, so it produces a description and something else emits from it.

None of that argues against the feature. It argues that the three were costed as one kind of thing
and are two kinds, and that the parser is not the only work.

### And `yield` needs no inference where `await` does

`packages/wacc/src/asyncplan.wac` declines a bare `await e;`, exactly:

> **Both are the shapes that name the ticket's type** … the only way to know `X` from the AST alone
> is to have it written. `T x = await e;` says `T`, and `return await e;` says the function's own
> return type. A bare `await e;` says neither, so it is declined here rather than guessed at.

**`yield e;` always names its type, because `gen<Y>` is in the signature.** So the case that forces
`async` to refuse two of its three statement shapes does not arise for a generator at all: every
`yield` in a body yields the `Y` written once at the top, and a bare `yield e;` is the ordinary form
rather than the declined one.

Which inverts the intuition the pair invites. `gen` looks like the harder feature — it suspends *and*
produces a value — and it is the easier lowering, because the extra thing it does is the thing that
is declared. `async` produces nothing and must infer where `gen` reads. If either is to land first,
that is an argument for the one nobody would have picked.

### A third site for `never`, and the one where it is not a convenience

A synchronous `gen<Y> R f()` blocks on nothing, so its machine answers `Step<never, Y, R>` and its
caller's `match` has two arms. Same operation as `union<never, E>` reducing to `E`.

The difference here is that the code is **generated**. An unreachable `Waiting` arm that a person
writes is a dead branch they can see; one the compiler emits has to *do* something, and the only
honest thing is `trap` — so declining the rule puts an unreachable trap inside every generator in the
program. Three sites now: `Step`, `union`, and this. Only the third has no acceptable fallback.

## Two answers to *invent a name that cannot collide*, in one repository, neither aware of the other

`@/packages/wacc/src/desugar.wac` needed fresh names for hoisted temporaries and found the compiler's
answer: `packages/wacc/src/asyncsynth.wac` **appends the spellings to the source** and points
synthetic tokens into them, with 23 zero-argument functions holding the fixed indices. The entry
above records the consequence — *the source text is an output of the compiler as well as an input* —
and that nothing anywhere argues for it.

The other answer was in the tree the whole time. `packages/ts/src/bundle.wac` invents exactly one
name, the module prefix, and **searches the input to prove it absent**: `hygienicPrefix` starts at
`$m` and adds a `$` until no module has an identifier beginning with it. `design/system/0009` calls
this the whole of its hygiene — *"the hygiene is in the one name the bundler invents … and every
other identifier in the output is the one its author wrote."*

They are not variants of one technique:

| | append to the source | search and prove absent |
|---|---|---|
| cost | O(1) per name | O(input) per prefix, re-lexing every module |
| can it fail | no | in principle — a real arm, and unreachable by hand-written code |
| what it touches | mutates the source buffer | nothing |
| what a reader sees | a span pointing into text nobody wrote | a name with a `$` in it |

**Neither file mentions the other**, and the one with the surprising consequence is the compiler's.

### Which does not mean the compiler should switch

Appending is O(1) and a compiler invents a name per hoisted local per function; searching is
O(input) and a bundler invents **one**. So the technique is a function of how many names you need,
and that is the rule neither file states because neither had a reason to compare.

What is open is narrower and is about the *language* rather than either implementation: **there is no
way to ask for a name that cannot collide**, so every pass that needs one picks a strategy and lives
with its consequence. Three positions:

- **Nothing** — each pass chooses, which is today, and the cost is that the choice is invisible until
  somebody reads both files.
- **A hygiene primitive**, as a macro system would have: a `fresh` that is guaranteed distinct from
  every source identifier by construction rather than by search or by append. That is a compiler
  facility, not a language one, until a program can generate code.
- **Say the two are the same problem and pick one per arity** — the honest reading of the table
  above, and it would live in `docs/` rather than in a spec.

The measurement that would settle whether it matters: how many passes in `packages/wacc` invent a
name. It is 23 fixed plus one arithmetic scheme in `asyncsynth.wac`, and nobody has checked whether
any other pass wants one.

## A closed set you cannot enumerate is a closed set you cannot tabulate

Every enum this exercise introduced replaced a table of integers or characters — nine `T_*` in
`@/packages/abi`, thirteen `OP_*` in `@/packages/regex`, eight control characters in
`@/packages/tty`, porcelain's alphabet in `@/packages/git`. Each swap was right and each is argued in
its package.

`@/packages/git/src/prompt.wac` is the first consumer that has to **count** by one, and it cannot.

A prompt shows *how many of each kind*, so it wants a count per `Change`. `Map<Change, i32>` is out:
`DECISIONS.md` says references are comparable but not hashable, and the `Map.create()` entry above
already records this file's `Map` taking no hash where the tree's takes two funcrefs. Three ways
round it, each giving something up:

- **A field per variant.** The flat table this directory has met four times, and the first where it
  is *forced* rather than inherited from the code being rewritten. Adding a variant means adding a
  field and nothing relates the two lists.
- **An array indexed by the variant's ordinal.** Needs the ordinal to be nameable, and
  `spec/spec/enums.md` gives `match`, `is` and construction and no way to say *the index of this
  variant* — which is precisely what makes an enum a closed set rather than a small integer with
  names on it. The property is the one this loop wants to borrow for a moment.
- **Key on the character the enum replaced.** `Change.code()` exists for *formatting* and the first
  aggregating consumer reaches for it as a **key**. The enum is intact and the character is back one
  layer down, where the type system is no longer looking.

The third is what the file does. The enum was not wrong — a swapped `Added` and `Deleted` is still
impossible, which is what it bought — but **tabulating is what the second consumer of any enum
does**, and four packages have introduced one with no way to do it.

### And a fifth package declined the enum for exactly this reason, in writing

`packages/tor/src/pathsel.wac` has three circuit positions and does **not** make them an enum:

> Not an enum because the weights are indexed by it and the arithmetic is clearer with a number; the
> three constants exist so nothing has to remember which is which.

So the cost is not only that tabulating by an enum is awkward. It is that **a package with a table
declines the enum**, in advance and deliberately, and then carries the check the enum would have
made for free — `if (position < 0 || position > 2) { trap; }`, on a value that has three legal states
and is an `i32`.

That is the same trade the other four made in the other direction, and it is the strongest form of
the question: given a closed set that indexes something, the language offers a type that cannot index
or an integer that cannot be checked, and four packages took the first while the one whose wrong
answer costs anonymity took the second.

### Tested 2026-09-05, and it is answerable today — the index goes on the table, not the enum

Six packages here introduced an enum replacing a table of integers or characters. Asked of each
whether any consumer needs to *index or count* by it rather than `match` on it:

| | wants to tabulate | what it does instead |
|---|---|---|
| `@/packages/abi`'s `AbiType` | no | `isDynamic`, `fixedSize`, `chunkLimit` are methods — dispatch |
| `@/packages/regex`'s ops | no | the VM `match`es |
| `@/packages/tty`'s `Sig` | no | `Sig.number()` is a method |
| `@/packages/codec`'s `Alphabet` | no | `bits()`, `groupDigits()`, `digit()` are methods |
| `@/packages/git`'s `Change` | **yes** | a count per variant, for a prompt |
| `@/packages/tor`'s `Position` | **yes** | indexes a twelve-number weight table |

**Two of six**, and both want an *index*, not a map and not a `values()`.

And both are answerable without a feature: **put the index on the type that owns the table.**
`@/packages/tor`'s `Weights.at(Position, Role)` already has the shape — the `position * 4 + role`
arithmetic belongs to `Weights`, and inside it one `match` per dimension turns each enum into its
number, **once**, not per call site. `@/packages/git`'s counts are the same: a `Vec<i32>` of seven and
an `add(Change)` with one `match` in it.

So the cost of a closed set with no ordinal is **one `match` in the table's owner**, and
`@/packages/tor` declined the enum rather than pay it — which its comment states as *"the arithmetic
is clearer with a number"* and which is a smaller cost than that reads. The check it then carries,
`if (position < 0 || position > 2) { trap; }`, is bigger than the `match` it avoided.

### Which leaves the three options weaker than they looked

- **`Map<K, V>` with a compiler-supplied hash for payload-free enums.** Nobody in this directory
  wants a map keyed by an enum; the two real cases want a dense index and would use an array.
- **An `ordinal()` or a `values()`.** Both weaken the closedness that is the point — an `ordinal()`
  is a number a caller can do arithmetic on, a `values()` is a list whose order becomes an interface
  — and neither is needed once the index lives on the table.
- **Nothing, and say so.** This is now the recommendation rather than the fallback, with the *say so*
  part carrying the weight: the rule is *an enum that indexes a table gives the table a method, not
  the enum an ordinal*, and it is one sentence that would have saved `tor` a trap.

## Three predictions that a file would say nothing, three wrong

Not a language question. It is here because it is a fact about **how this directory decides what to
write**, and the deliverable is the list of findings, so a rule that suppresses findings is worth
one entry.

Three package READMEs predicted that a file was not worth rewriting. All three were tested on
2026-09-04 by writing it. All three were wrong, and each was wrong differently:

| | the prediction | what writing it found |
|---|---|---|
| `http` | *"`headers.wac` … the same code with a different error type, and copying them here would say nothing"* | the one place a `Map` would be the **wrong** type, and a security property with it |
| `json` | *"`stringify.wac` is not rewritten because nothing in it changes"* | a design justified by a limitation that lifted **before the same file adopted the replacement** |
| `gzip` | *"`zstd` … it is not rewritten because it would find nothing new"* | a `Buf` invariant spanning three files and held by a sentence |

**The half of gzip's that held is the useful control.** It predicted that gzip's `Read.Failed`
argument carries over to zstd unchanged, and it does, word for word. So the failure is not *READMEs
are unreliable*. It is narrower:

**A prediction about a file is reliable about the thing the writer was looking at and unreliable
about everything else.** gzip was looking at error handling and was right about error handling.
`json` was looking at *what the rewrite changes* and its stringifier changes nothing about error
handling — and carries a stale necessity claim, a sentinel, and a re-derived float classification,
none of which was the subject.

Which suggests the cheap rule, and it costs nothing to follow: **a claim that a file has nothing in
it is only worth making about a file you opened.** All three of these were written from the package's
shape rather than from the file, and each is one `sed -n 1,40p` from being right.

The measurement that would say how much this cost: how many files this exercise skipped on a
prediction. `packages/README.md`'s table says which packages were rewritten and not which files, so
nobody can currently answer it.

## An order that is derivable from the data, imposed on the caller instead

`packages/git/src/ignore.wac` matches `.gitignore` rules, and its header states the contract:

> the order is the whole contract: **later rules win**, so a caller appends `.git/info/exclude`
> first, then the root `.gitignore`, then each nested one as it descends.

The signature is `ignored(const Vec<Rule> rules, string path, bool isDir)`. A `Vec<Rule>` cannot say
any of that — which is the ordinary *a list whose order matters* — and this is worse, because **the
order is derivable from data the list already carries.**

Every `Rule` has a `base`, the directory its ignore file sat in. Git's precedence is *deeper file
wins*, then *later line wins*. So the required order is `(depth of base, line number)`, and `base` is
already a field. Two facts about ordering are present in the value, one is imposed on the caller, and
nothing checks that they agree — so a caller that appends a nested `.gitignore` before the root one
is silently wrong on exactly the paths the nested file exists for.

**A `Rules` type that can only be built by adding a file's rules with its base** fixes it: the
ordering becomes the type's business and a hand-built list stops being possible, which is the point.
The cost is one indirection and the loss of `Vec<Rule>` as the interface.

### Which is a general shape, and this directory has been finding the other half of it

Every other *ordering* finding here has been about a list whose order carries information nothing
else has — `@/packages/http`'s headers, where `Via` order is the record of a path, and
`@/packages/ssz`'s chunks. Those are irreducible: the order **is** the data.

This is the opposite and is the case worth separating: the order is a *derived* fact, the inputs to
deriving it are in the elements, and the caller is asked to do the derivation by hand. That is not a
list-ordering problem at all. It is a **constructor that should exist and does not**, and the reason
it does not is that `Vec<T>` is right there and takes anything.

### Counted, and the answer is a rule rather than a feature

Swept `packages/` for functions taking a list whose doc mentions order — 101, most of them `u8[]`
where *order* means endianness. Three take a list of **structs whose required order is a function of
a field**, and they answer the question three different ways:

| | who puts them in order | and |
|---|---|---|
| `git/src/ignore.wac`'s `ignored` | the caller, by contract | nothing checks it |
| `wacpkg/src/lock.wac`'s `writeLock` | the callee — `LockEntry[] sorted = sortedByName(entries);` | a caller cannot get it wrong |
| `git/src/tree.wac`'s `writeTree` | the caller, **deliberately** | with a reason, and the reason is right |

`writeTree`'s reason is what settles it:

> The entries are written in the order given. This does **not** sort them, because sorting is a
> decision about what the caller meant: git's order is by raw name with a subtree treated as though
> its name ended in `/`, and a caller that has entries from a parsed tree already has them in that
> order. Re-sorting here would silently rewrite a tree that round-tripped.

So **derivable does not mean should be derived**, and the deciding fact is not the type system:

- **A canonical order** — one right answer, fixed by the format — should be derived by the callee.
  `writeLock` does. A caller that hands over an unsorted list is not saying anything.
- **A preserved order** — the input's order is itself data — must not be. `writeTree` keeps it, and
  re-deriving would mean re-implementing git's exact comparison, where being slightly wrong silently
  rewrites a tree that had round-tripped.

`ignored` is the first kind and behaves like the second. Git's precedence — *deeper file wins, then
later line wins* — is canonical, `base` is already a field, and the caller is asked to do it anyway.
**One of three, and it is the one where the order is canonical and the callee declines it.**

Which means the ask is not `Sorted<T, K>` and not a private constructor. It is a question a reviewer
can put to any function taking a list: **is this order canonical or preserved, and does the code
agree with the answer?** Two of the three say which in their doc. The one that does not is the one
that is wrong.

## Is a fault a value that describes what happened, or one that can be shown to a person?

Three shapes are in this directory and nothing has stated them as a choice.

- **Carry an offset.** `@/packages/rlp`'s faults and `@/packages/sh/src/arith.wac`'s do. Cheap, and
  the fault is **not self-sufficient**: rendering bash's *error token* — *"the rest of the input from
  where the offending thing began"* — needs the expression back, so a caller that kept the fault and
  dropped the input has a fault it cannot print. Every caller keeps the fault, because that is what a
  `Result` is for.
- **Carry the text.** Self-sufficient, and it copies a slice of input into a value that may outlive
  it — free on an error path and not on a hot one.
- **Carry a rendered message.** `@/packages/wac/src/grants.wac`'s *nine reasons, one empty string* is
  this from the other side: self-sufficient, and it has given up on being matched.

The narrow question is the title, and it decides the other two. If a fault describes what happened,
an offset is right and rendering is a function taking the input; if it is a thing to show a person,
the text has to be in it.

### And the arithmetic evaluator shows why `try` is more than a tidier channel

`packages/sh/src/arith.wac` reports a division by zero at the position the **divisor** started, and
says why that cannot be read off the cursor:

> this is recorded at the failure rather than derived from `at` afterwards — by then the divisor has
> been consumed.

`@/packages/rlp` argued for replacing a sticky error field with `try` on the grounds that a dropped
check becomes a type error rather than a discipline. True, and not the whole of it. **A sticky field
plus a code has to be written in the right order; a payload cannot be written in the wrong one**,
because there is nowhere to put it later — `Err(DivisionByZero(At(divisorStart)))` is constructed
where the information exists or not at all.

That is the argument for errors being *values* rather than *codes*, made by a case where the
information is a position the parser is about to lose. rlp did not need it and did not state it.

## A key and an order are different things, and the answer is a library type

`sort -n` needs two comparisons over the same lines, and `packages/box/src/lib/lines.wac` has both:

- **the key**, `cmpNumeric` — *are these the same line for `-u`*, where `1` and `01` are;
- **the order**, `cmpNumericThenBytes` — *which comes first*, total, so equal keys fall back to the
  whole line.

The shipped doc says which is which and why:

> `cmpNumericThenBytes` is the comparison a sort wants; this one is the *key*, and `-u` is where the
> difference shows. … uniqueness is the key's, so `1` and `01` are one line, and the survivor is the
> first in input order rather than the first in byte order.

The order **refines** the key: `cmpNumeric(a, b) != 0` implies `cmpNumericThenBytes(a, b)` has the
same sign. That relation is the whole contract between them, it is what makes `sort -nu` correct, and
it is written nowhere but two function names and a paragraph. Hand the sort the *order* and then drop
adjacent equals and `1` and `01` both survive — unequal under the order, equal under the key.

**Every sorting library has this hole.** `sortBy` takes one comparator, `distinctBy` takes a key,
nothing takes the pair and nothing checks the refinement.

### And the answer is a library type, which is why the entry is here

    struct SortSpec<T> { fn<i32(T, T)> key; fn<i32(T, T)> tieBreak; }

with `order()` composing them and `sameKey()` exposed for `-u`, so a caller cannot reach the order
when it wanted the key. **The language has to add nothing.** What it cannot do is check the
refinement, which is a property of two functions.

**This entry said *the first finding in 125 entries* and that was wrong.** It is not even the first
this week: *An order that is derivable from the data, imposed on the caller instead*, two entries
earlier and by the same hand, concludes that the ask is *"not `Sorted<T, K>` and not a private
constructor"* but a question a reviewer can put to a signature. A crude scan of all 127 finds at
least eight entries reaching a convention or a review rule rather than a language change, and two
reaching a library type.

Which is the fourth bare ordinal over an unnamed set I have written today, after three corrections
and one entry — *a claim that names its subject is self-checking; a claim that only counts is not* —
recording the rule. **The rule is not self-enforcing**, and the reason is visible in the sentence it
was written into: *the first in 125 entries* is doing rhetorical work, and the check would have cost
one grep.

What stands without a count: the answer here is a library type, the language has to add nothing, and
a list that mostly reaches *the type could say it if the language allowed* is worth reading with that
distinction in mind.

### The saturating key, which fixes a bug by moving it

`leadingNumber` is `i64` and saturates, and the shipped reason is a measured bug:

> In i32 it wrapped: `sort -n` over `4294967296 1 2147483648 -1` answered `2147483648 -1 4294967296
> 1`, and `-nu` merged `4294967296` with `0` because both keys came out the same — a distinct line
> silently dropped.

The bug was *two distinct lines getting the same key*, and the fix gives two distinct lines the same
key — every integer past `i64` max is now one key. What changed is the threshold and the
monotonicity: wrapping breaks the order, saturation does not. So the fix is right for `sort` and the
class of bug survives it for `-u`, which the file says: *"GNU compares those exactly, which needs
arbitrary precision"*.

`@/packages/bignum` is in this tree and is unreachable from a sort key, because **a key that
allocates is a key you cannot compare in a loop.** That is the real constraint and it is a
performance fact shaping a correctness one, which is the pairing this directory has otherwise only
met in `@/packages/zstd`.

## This file does not say what it concludes, and 109 of 127 entries cannot be read by a grep

`../README.md` already says it: *"`QUESTIONS.md` is a hundred and twenty-seven entries and getting
longer, which is the exercise working and is not a document anybody can read to find out what it
concluded."* That is a statement about length. The measurable version is worse and is about shape.

An entry can reach one of three conclusions, and they want different things from a reader:

- **change the language** — a feature, a rule, a syntax;
- **write a library type** — the language allows it and nobody has written it;
- **adopt a convention** — no code changes at all, and the answer is a habit or a review question.

Classified by the stock phrases each tends to use — `scratchpad/verdicts.py`, and it is deliberately
crude:

    127 entries          (this one not yet written)
      library          2
      convention       8
      language         8
      unclassified   109

**109 is the finding.** Not that those entries have no conclusion; most do, in a sentence somewhere
in the middle. It is that the conclusion is prose, in a different place each time, so nothing can
collect it — which is exactly the problem the attribution half of the quotation entry has, arriving
at the level of the whole document rather than a citation.

The consequence is concrete. Somebody deciding what to *do* with this directory has to read 127
entries to find the eight that ask for nothing and the two that ask for a library. And a writer
cannot tell either: this entry exists because the one before it claimed to be *the first* library
conclusion in 125 entries, and the counterexample was two entries away and by the same hand.

### The fix is a line, and it is not a schema

Each entry ends with one line naming its verdict and what would settle it:

    > **Verdict:** language — a length in a slice's type. Settled by: `spec/spec/types.md`.
    > **Verdict:** library — `SortSpec<T>`. Settled by: writing it in `core`.
    > **Verdict:** convention — parse at the edge. Settled by: a page in `spec/` and nothing else.

Not a schema, not a front-matter block, not a tool: one line in the shape the file already uses for
everything else. What it buys is that the *next* count of anything in this file is a grep instead of
a memory, which is the failure this directory has now recorded four times in one day.

Not done here for 127 entries. Doing it retroactively would mean deciding 109 verdicts in one pass,
which is the kind of bulk judgement that produces the numbers this entry is about.

### Started 2026-09-05, by the author of each entry rather than in bulk

`scratchpad/verdicts.py` reads an explicit `> **Verdict:**` line and falls back to the stock-phrase
guess, so the gap between *stated* and *guessed* measures how far the retrofit has got:

    138 entries, 5 with a stated verdict, 133 guessed or unread
      library        2      (was 1)
      convention    12      (was 10)
      language      11      (was 12)
      unclassified 113      (was 115)

Five, and only five, because the rule this entry set is that a verdict is the author's — these are
the ones written this week, whose conclusions are first-hand. Deciding the other 113 in one pass is
exactly what it warned against.

**And the first five already caught the guess being wrong, in an instructive direction.** *Writing
one elided body closed the `Map.create()` contradiction* had been classified `language`, because it
contains the phrase *"the language does not"* — quoting `DECISIONS.md` on hashing. Its verdict is
**library**: `Key<K>` is written, in `core`, and the language limit is the entry's *premise*.

> **A grep for *the language cannot* finds entries that mention a language limit, not entries that
> ask for a language change.** In an entry about working within a limit, the limit is the first thing
> said and the conclusion is the last.

One of one is not a rate. What it is, is a mechanism: the guess and the statement disagree in a way
that says *which* the guess gets wrong, and it is the same direction `../README.md`'s sample found
by hand — **the list reads as more of a language wishlist than it is.** Two instruments, independent,
same lean.

## An ordering between `if`s: eight in the tree, four load-bearing, two shapes among them

`packages/tor/src/pathsel.wac` warns about its own control flow:

> The order of those four tests matters. A relay with both flags must take the "both" weight —
> checking Guard first and returning would give a Guard+Exit relay the guard-only weight, which is
> how exit capacity leaks into the guard position.

Swept for the shape — `if (A && B)` followed by `if (A)` or `if (B)` in one run of statements, where
a later test is implied by an earlier one. **Eight sites in `packages/` and `tools/`, hand-checked,
four of them load-bearing:**

| | what the order encodes | removable |
|---|---|---|
| `tor/src/pathsel.wac` | a **classification** — four states of two flags | yes, by an enum |
| `ssh/src/knownhosts.wac` | a **precedence** — `!pattern` vetoes a match | yes, by an absorbing fold |
| `url/src/host.wac` | a **latch** — the IPv6 zero-run state machine | no |
| `wacc/src/parse.wac` | **longest match** — `</` before `<` | no |

The other four are benign: the first branch returns an error the second would reach anyway, or the
conditions are disjoint in practice.

**`knownhosts.wac` is the one nothing says anything about**, and it is security-relevant. A
`known_hosts` host field is a comma-separated pattern list where `!pattern` vetoes; the code is
`if (hit && negated) { return false; } if (hit) { any = true; }`. Swap them and a negated pattern
sets `any` and the veto never fires, so a host the file explicitly refuses is accepted. `pathsel`
carries a warning; this carries the comment `// an explicit veto` and nothing about order.

### Two shapes, two fixes, and neither is *be careful*

- A **classification** becomes an enum, and a `match` has no first arm — so there is no wrong order
  to put the arms in.
- A **precedence** becomes a fold with an absorbing element: `Vetoed` absorbs, `Matched` beats
  `Silent`, `Silent` is the identity. Associative and commutative, so the loop can run in any order
  and the answer is the same. **The hazard does not become checkable; it stops existing.**

And two that are not hazards at all: a latch *is* a state machine and longest-match-first *is* what a
lexer does. In both the ordering is the algorithm, and removing it would mean writing a different
one.

So the reviewer's question is the same one the list-order entry reduced to, at control flow instead
of data: **is this order a rule about the data, or a rule about the search?** The first is removable
and the second is not. Two of the four here are the first kind, and only one of those two says so.

## 78 `bool` functions collapse 405 refusals, and 17 of them are verifications

This directory has made the *a `bool` answers more than one question* argument five times — `Page`,
`lightclient`'s `validateUpdate`, `ssz`'s branch check, `git`'s `ignored`, `codec`'s `null`. Counted
2026-09-04, over `packages/` excluding tests: a `bool`-returning function with three or more
`return false` sites.

    78 functions,  405 refusals collapsed
    17 of them are verifications,  106 refusals

The seventeen span `tls`, `crypto`, `bls`, `tor`, `ssh`, `webrtc`, `ssz` and `lightclient`. The two
already rewritten here are the largest and the smallest but two — `validateUpdate` at 23 and
`isValidMerkleBranch` at 3 — so the finding is not two witnesses, it is seventeen.

**Most of the other 61 are fine.** `isConstExpr`, `inBraces`, `looksNormal`, `canStream` are
predicates: *no* is the answer, and the reasons are internal. What separates a verification is that
its `false` is reached by three different kinds of thing.

### Three kinds wearing one answer, and `ed25519Verify` has all three in six lines

    pub.len() != 32          a caller's bug — this program built a bad key
    sig.len() != 64          malformed input — a peer sent something that is not a signature
    scLessThanL(s) == 0      a strictness policy — see below
    ptDecode(pub) is null    malformed input
    ptDecode(rBytes) is null malformed input
    ptEquals(left, right)    the answer

A caller logging *"signature invalid"* on the first is debugging the wrong program. One that drops a
peer on the last and on `BadR` alike cannot tell a corrupt link from a hostile one.
`@/packages/lightclient/src/branch.wac` found this split across two packages; here it is inside one
function.

### And one of the six is a policy, which is the part that is not merely lossy

`S ≥ L` is required by RFC 8032 §5.1.7 and the shipped comment says why — *"without it, S and S+L
both verify and a signature is no longer a unique token"*. Ed25519 is the well-known case where
implementations differ about exactly this class of rule: canonicality of `S`, canonical point
encodings, small-order points, cofactored versus cofactorless.

**A `bool` makes that disagreement invisible.** Two libraries can both answer `false` for one
signature and disagree about which rule refused, and a third can answer `true`. Where that costs is a
system with more than one implementation deciding the same question — a consensus, a federation, a
client and a server that must agree which messages exist. A signature one side accepts and the other
refuses is a partition.

Naming the refusal does not make implementations agree. It makes the disagreement **findable**: a
differential can report *A said `NonCanonicalScalar`, B said `Ok`* rather than *A said no, B said
yes*. The first is a bug report; the second is a mystery.

### What would say *this rule is ours, not the format's*

`union<Malformed, Strictness, DoesNotVerify>`, nested — the flattening entry's mechanism used to
encode **the provenance of a rule** rather than a family of faults. Third use of nesting found here
and the first where the grouping answers *who decided this*, which is the question a second
implementation actually has.

## An unobservable check is unobservable because the answer is a `bool` — and one author proved it

Two packages have a guard that no test can see, and the second one **measured** it rather than
arguing.

`packages/lightclient/src/store.wac`'s `validate_light_client_update` names its own weakest point:

> ## Three of these checks cannot be observed from outside
>
> Deleting any one of them changes no verdict on any input … each is subsumed by a later
> cryptographic check … But **an unobservable check is exactly the kind that rots unnoticed**, so it
> is named here as one.

`packages/bls/src/verify.wac` has five infinity guards and did the experiment:

> Refused outright — but **not** because the Ethereum fixtures require it, which is what this said
> before somebody deleted the line and watched them all still pass. … The **one** infinity guard in
> this file that a test can see is `aggregatePubkeys`'s … Deleting this one, or `aggregateVerify`'s
> per-key copy, changes no fixture … All three stay: defence in depth is the point, and now the
> comments say which is load-bearing.

The reason is arithmetic and it is worth reading: `pk = O` reduces the pairing identity to
`e(−G₁, sig) == 1`, which holds only for `sig = O` — and the infinity-*signature* guard answers
first. So the guard is correct and no input can distinguish a build with it from one without.

### The claim, and it survives the second witness

**Name the refusals and four of the five become observable.** Delete `verify`'s
`g1IsInfinity(pk)` and an infinity key reaches the pairing, which fails, so the answer is
`Err(DoesNotVerify)` where it was `Err(InfinityPublicKey)`. Two different answers, so a test can
catch the mutation — a test that asserts *which* refusal, which is a test a `bool` gives no way to
write.

Five guards: **one observable today, five with a named refusal.** The cost is six union members in a
package that already has six ways to fail.

**What it does not buy**, and the shipped file is careful where this directory has not been: the
guards are defence in depth, so making them observable does not make them *necessary*. Four of the
five remain arithmetically redundant. What changes is that a later edit removing one has to remove a
test with it, rather than passing quietly — which is the entire content of *rots unnoticed*.

### And the thing neither a type nor a test provides

`bls`'s author deleted a line, ran the fixtures, saw them pass, and **wrote down which guard was
load-bearing**. Nothing in this tree does that automatically — `tools/mutate.ts` exists and this is
what it is for — and no type would have produced the sentence. The finding is worth separating from
the `Result` one: naming refusals makes the mutation *detectable*, and somebody still has to run it
and write the answer where the next reader will be.

## A trapping bound is right for two reasons and `core` states one

`core/slice.wac` traps on a bad range and says why: *"the bounds come from a scan the caller just
did."* `core/vec.wac` states the other side of the same rule — `pop` and `last` answer `T?`
*"because unlike `a[i]` the caller usually does not already know there is one."*

The rule is good and the reason covers five of the eight `slice` call sites in this directory. The
other three take **input-derived** bounds, which is the case the reason does not cover:
`@/packages/abi`'s `blobAt` reads a length word out of attacker-controlled data,
`@/packages/rlp`'s `take` reads one off the wire, and `@/packages/zstd`'s block size comes from a
three-byte header. A trap there would be a denial of service where a refusal is wanted.

**So a refusing variant looked like the missing piece, and it is not.** All three check the bound
first, and all three produce a fault carrying numbers:

    Err(LengthOverruns(at, n as u64, end - at - 32))
    Err(Truncated(this.at, n, this.src.len() - this.at))

A nullable `take(lo, hi)` answers `null`, which cannot say how far over the length ran. It would
replace a good diagnostic with a worse one and leave the hand-written check exactly where it is.

### The rule, restated to cover both

**A trapping bound is right when the caller either knows the bounds or wants to describe why they
were wrong.** Only a caller who would be content with *no* needs the nullable form, and there is not
one in this directory.

That is why `Vec.pop` is nullable and `Slice.slice` is not, and it is a better statement of the same
principle than *the caller usually knows*: the deciding question is not what the caller knows, it is
**what the caller would do with the failure**. Three of the three input-driven callers here would
throw a `null` away and write their own message.

### Which makes it the third feature request retired by checking rather than granted

- *An overlay needs a language change* — it needs a mapping the reader computes, which exists.
- *The five preconditions want something new* — two want a type that exists, two want `try`, one is
  another entry.
- *A slice that refuses is the missing piece* — no caller wants it.

All three were written into a package file the day before they were checked, and each cost one grep.
Worth recording together because the pattern is now the most reliable thing in this directory: **a
feature that looks missing from inside one file usually has a caller that would not use it.**

## Four proposals have no user in 157 files, and four more have exactly one

The test this directory has been applying — *name a caller* — has an obvious prior question, and
nobody had asked it: **does anything here use the construct at all?** Counted 2026-09-05, with
comments and string literals blanked, over the 157 `.wac` files in `vision/`.

| construct | files that use it |
|---|---|
| `union<…>` | **27** |
| `try` | **22** |
| `gen<…>` | **10** |
| `secret` | 5 |
| `defer` | 4 |
| `never` | 3 |
| `schedule` | 2 |
| a brace pattern | 2 |
| `coroutine e` | 1 — `@/packages/wactest/src/within.wac` |
| `match` as an expression | 1 — `@/packages/tor/src/onionaddr.wac` |
| `Err(is T):` | 1 — `@/packages/box/src/gunzip.wac` |
| a JSX element | 1 — `@/packages/page/src/counter.wac` |
| `@"verbatim"` | 1 — the same file |
| **`auto`** | **0** |
| **a tuple type** | **0** |
| **optional chaining** | **0** |
| **a `[…]` list literal** | **0** |

**The caveat first, because it bounds the zeros:** 80 of the 157 files have an elided body, and
`auto` and a list literal are things that live *inside* bodies. So those two zeros are softer than
they look. Optional chaining and tuple types would appear in signatures, and their zeros are not.

### What the shape says

`union`, `try` and `gen` are the exercise's answer to what it kept meeting — error sets, propagation
and streams — and they are used in a sixth, a seventh and a fourteenth of the directory. Nothing
else comes close.

**And `auto` is the sharpest.** `GRAMMAR.md` recorded it as *"the construct with the widest presence
on the vetted pages and no presence at all in the grammar until now"* — three of the agreed pages
write it, `QUESTIONS.md` has an entry about its widening rule, and **not one rewrite reached for
it.** Five days, forty packages, and the construct that appears most often in the material nobody
wrote code against appears least often in the code.

That is the measurement this whole directory exists to produce, and it took five days to think of
running. A page can propose anything; a rewrite either reaches for it or does not.

### Which is not the same as *delete them*

A construct with no user here has three readings and only the first is fatal:

- **Nothing wants it.** Tuples are the candidate: the entry calls them *"the first structural
  type"*, and forty packages found no place where a struct was too much ceremony.
- **The rewrites are the wrong sample.** Optional chaining is for call sites, and this directory is
  mostly type declarations and elided bodies — 80 of 157. It would show up in application code, and
  `@/packages/page/src/counter.wac` is the only application here.
- **It is used and the count cannot see it.** `auto` and list literals live in bodies, and half the
  bodies are `{ … }`.

The honest next step for each is different, and only the first is a question for a page: **write the
consumer that would use it, and see whether it survives contact.** That is what every other finding
in this file came from.

### All four followed up, 2026-09-05, and the four zeros have four different causes

| | opportunity | cause of the zero |
|---|---|---|
| a tuple type | **64** two-field structs, 34 with both fields at one type | **the construct is wrong for it** — a tuple gives up the names that distinguish them |
| optional chaining | **0** chains; 11 single `x!.` after a null test | **the opportunity does not exist**, and the near-misses each want a value, a fault or a return rather than null |
| `auto` | **32** declarations whose right-hand side already names the type | **the writer did not reach for it** |
| a `[…]` literal | **0** array constructions with arguments | **the situation never arises** |

The two soft zeros are now hard, and they came apart. Restricting to the **77 files with no elided
body** removes the caveat entirely: a list literal has nothing to shorten, and `auto` has
thirty-two `Buf out = Buf.create();`-shaped lines and appears in none of them.

**The `auto` result is the uncomfortable one and it is not about `auto`.** Thirty-two opportunities
and zero uses says nothing about the construct; it says the rewrites were written by transcribing
shipped files, and the shipped tree has no `auto`. Every one of the thirty-two has a counterpart
reading `Buf out = Buf.create();`, and the rewrite kept the shape while changing the type.

Which is a limit of this whole exercise, found by measurement rather than argued: **a construct that
only saves typing cannot be discovered by rewriting.** The method finds things that were *impossible*
or *wrong* — a `bool` that answers six questions, a position where a name was needed — because those
force a change. A construct that merely reads better leaves the transcription intact, so its absence
here is not evidence.

That splits the four zeros into two that are findings and two that are not:

- **tuples and `?.` are findings.** A construct that collapses a distinction finds no users in code
  written to preserve distinctions, and both zeros are that sentence with different subjects.
- **`auto` and the list literal are not.** One has thirty-two opportunities the method could never
  have taken, and the other has none at all — so neither the pages nor the rewrites have said
  anything about whether they are wanted.

### The excuse was tested by writing new code, and it did not hold

`@/packages/git/example/ignorelint.wac` was written for this: a program with **no shipped
counterpart to transcribe** — it reports `.gitignore` rules that can never match, which
`git check-ignore` cannot answer because it is about a path rather than a rule set. Written first,
measured afterwards.

It reached for `Result` and `try`, an enum with payloads, `Vec` and `for … in .items()`, a bare
variant construction, and `const` on five parameters. **It did not reach for `auto`**, and
`Rule r = rules.ordered.get(i);` names `Rule` twice.

So *the rewrites inherited a vocabulary* is not the whole reason, and the honest statement is
narrower: the opportunity has been taken **zero times out of thirty-three**, across forty rewrites
and one application, and this exercise cannot say why. What it can say is that it will not find out
— a construct that only reads better does not force a change in either kind of file.

**And writing new code found something the entries had not stopped happening.** `shadowedBy` and
`ignoredAncestor` both answered `-1`, in a directory whose entry on *a sentinel drawn from the
value's own range* lists seven of them, on the day after the seventh was added, written by the person
who wrote both — and the commit reporting it said **one**, which a sweep the next morning corrected
to two. Both are `i32?` now.

Which is a finding about the exercise rather than the language, and it is the sharper half of this
entry: **naming a shape does not stop a writer producing it.** Two went into the first draft of the
one file written specifically to watch for them, and the count of them was wrong in the same commit.

### Swept the whole directory afterwards, and the third `-1` is not a slip

Three `i32 … or -1` signatures in 158 files. The two above, and
`@/packages/raster/src/font16.wac`'s `glyphIndex` — which is **argued** rather than overlooked:
`surface.wac` names it twice, once as *"`glyphIndex`'s `-1`, which is generated code and stays"* and
once in its own list, *"`i32?` says it, and the font table is generated code."* A recorded decision
is not the same as a habit, and a sweep that cannot tell them apart would have reported three.

### The same audit found a third, and it is the sharpest

Swept vision's own `bool` returns: **55 functions, 12 exported**, and almost all are genuine
predicates — `isOk`, `eq`, `isZero`, `isDigit`, `isLeap`, `before`, `sideEffectFree`. The class this
directory has always said is fine.

One is not. `@/packages/ssh/src/knownhosts.wac` computed a three-state `Say` — `Vetoed`, `Matched`,
`Silent` — and its export answered `return verdict is Matched;`, **collapsing `Vetoed` and `Silent`
into one `false`.** In the file written *because* a veto spelled as an ordered pair of `if`s is a
security hazard, whose whole argument is that a refusal and a non-match are different facts. For
`known_hosts` they are *this key is revoked* and *I have never seen this host*, and an ssh client
does opposite things with them.

The body was right — the fold, the absorbing element, the note about order-independence — and one
line at the boundary undid it, because *whether this list accepts the host* is how the question
sounds when you are writing the signature rather than the loop. It answers the `Say` now.

**Three instances in two days**, and they get worse in order: a `-1` sentinel, a miscount of the
sentinels, and the exact defect a file exists to describe, one function below the description.

**And the sweep's first pass reported nine more that do not exist.** It blanked string literals
before searching, so every `return "…";` became `return "";`. That is the second time an instrument
here has stripped the thing it was looking for — the quotation checker blanked import paths and
reported zero importers of `@/packages/codec`. Worth stating as a rule, since it has now cost two
false readings: **a normaliser that removes noise removes evidence, and the two are told apart only
by knowing what you are looking for.**

## A fault union is bounded above by what its sources can distinguish

Audited this directory against its own findings and the parallel-array sweep came back clean — three
structs with two list fields, none index-correlated except `@/packages/zstd`'s `Fused`, which is
argued at length. **Zero unargued instances of the shape criticised five times in the shipped tree.**

The string-error sweep found six, and five are right: a host's message is a string and there is
nothing else to carry. One was not, and it is the inverse of every other finding here.

`@/packages/http/src/client.wac` declared

    /** The host would not resolve, or the socket would not open. */
    export struct NoConnection { string host; string why; }

and `std`'s capability is

    fn<Ticket<Result<Socket, NotGranted>>(string, i32)>  connect;

**`NotGranted` is the only thing `connect` can say.** A client cannot tell *the name did not
resolve* from *the socket was refused* from *this program may not use the network* — three causes,
one answer — and the fault above invented a field to hold a distinction that never arrives. Five days
spent making faults more precise than a `bool`, and this one was more precise than the data.

### Which is a rule the other entries do not state

**A fault union is bounded above by what its sources can distinguish.** Five members is right only if
five things are separately knowable at the layer that answers. `NoConnection`'s `why` was a sixth
distinction *inside* one of them, invented at the layer that wanted it rather than the layer that
could see it.

That is the ceiling on every *replace the `bool` with a union* argument in this file, and none of them
mentions it. `@/packages/ssz`'s six-member `ProofFault` is fine because six things are visible at the
fold. `@/packages/crypto`'s `ed25519Verify` is fine because six checks run in that function. A fault
naming something its callee never learned is a `string` with a nicer type around it.

### Applied to `std`, and the second instance splits the rule in two

`vision/std`'s `PageFault` has a `NoSuchElement { string id; }`, added in the rewrite that removed
nine `Ticket<bool>`s **for being unproducible** — so the same pass that deleted a `bool` no host
computes added a fault no host reports. Fourth instance in two days of *naming a shape does not stop
a writer producing it*.

But the reason differs from `NoConnection`'s, and the difference matters more than the instance.
`packages/platform/host/entryBrowser.ts`:

    setText: (id, text) => {
      const el = doc.getElementById(id);
      if (el !== null) el.textContent = text;
    },

`setValue` and `setStyle` are the same three lines and `value` answers `""`. **The host detects the
missing element and throws the fact away**, four times.

So a source can fail to report something for two reasons, and only one of them bounds a fault union:

- **It cannot know.** `Net.connect` answers `Result<Socket, NotGranted>`; DNS failure and refusal are
  not separable anywhere below it. `NoConnection { string why; }` was unfixable and is gone.
- **It knows and drops.** `entryBrowser.ts` has `el !== null` in its hand and returns `EMPTY`.
  `NoSuchElement` is three lines away in the host, and is a **request on the layer below** rather
  than an error in the type above.

The rule stands and gains a second half: a fault union is bounded by what its sources *report*, and
where a source knows and does not report, that is a bug in the source rather than a ceiling on the
type. Telling the two apart takes reading the host, which is what neither entry did before writing
its member.

### The ceiling measured: 27 of `std`'s 39 fallible members answer `NotGranted` and nothing else

    39 capability members answer a Result
    27  NotGranted
     9  PageFault        (introduced by this exercise)
     2  WriteStopped     write, writeErr — introduced by this exercise
     1  NotATerminal     setMode — introduced by this exercise

**Every one of the twelve that says more than *refused* was added here.** The other twenty-seven are
one bit: the grant was not given.

Which makes the ceiling structural rather than a slip. A package fault built on those twenty-seven
can distinguish exactly as much as *the grant was refused* — so any member describing **why a
capability failed** is invented, and `NoConnection { string why; }` was not carelessness but the
predictable result of writing a fault type without reading the signature under it.

And it explains which fault unions here are sound. `@/packages/abi`, `rlp`, `codec`, `ssz`, `json`
and `ts` compute every member **from bytes they hold** — `LengthOverruns(at, n, have)` is arithmetic
the package did, not a fact a capability reported — so they are unbounded by `std` and every member
is producible. The ones to check are those whose members describe an *operation* failing, and there
are four packages of them.

### And the sweep that would have found this mechanically does not work

Counted union members never constructed or matched anywhere in `vision/`: **63 of 131**. That number
is not evidence of anything, because 80 of the 158 files have elided bodies and the construction
sites are inside them. Both real inventions were found by **reading the layer below**, not by
counting.

So the rule is not mechanically checkable here, and that is worth saying plainly next to it: checking
it means reading a signature or a host, and this directory's instruments only see the directory.

### And underneath is a `std` finding this makes concrete

`Net.connect` collapsing DNS failure, refusal and a missing grant into one `NotGranted` is the same
shape this directory has spent five days unpicking, and it is worse than a package's: a package can
be rewritten and a capability's answer is what the host gives. The `NotGranted`-for-everything entry
has it in the abstract; this is a caller that wanted the distinction, invented it, and had to give it
back.

> **Verdict:** convention — design a fault union from what its sources can distinguish, not from
> what could go wrong. Settled by: a paragraph in `spec/` or `docs/`, and nothing in the language.

## Replacing a two-field result with a `Result` dropped the field that carried the distinction

The fault-ceiling rule, applied to the second of the four packages whose faults describe an
*operation* failing, found a regression this exercise introduced — and it is the largest of the five
things the self-audit has turned up.

The **shipped** capability is

    export struct FileResult { bool ok; u8[] bytes; string error; i32 fault; }

with ten `FAULT_*` codes, and the `fault` field's own doc says why it is there:

> The message cannot be branched on: "No such file or directory (os error 2)" from Deno, "ENOENT: no
> such file or directory" from Node and a `NotFoundError` from the Origin Private File System are
> three spellings of one fact.

`vision/std` replaced `bool ok` with a `Result` — an improvement — and **threw away the `i32 fault`
beside it.** `Files.read` answered `Result<Bytes, NotGranted>`: one bit, where the shipped capability
reports ten. The `bool` was the redundant half and the code was the payload, and the rewrite kept the
wrong one.

### It was found from two layers up, and the symptom is worse than vagueness

`@/packages/fs`'s `Fault` has nine members derived from those ten codes, and `Mount.onHost` assigns
`files.read` into a slot typed `Result<…, Fault>`. So a **host** mount could only ever answer
`NotGranted` while a **memory** mount — which `fs` implements itself — produced all nine. One
interface, two implementations, **two producible subsets, and nothing saying which**.

And a missing file on a host mount answered `NotGranted`, which is not vague but **wrong**: the grant
was given and the file was not there. A caller matching on the union gets a correct-looking answer
that names the wrong cause.

`Files` answers a `FileFault` now — the nine plus `NotGranted`, which stay apart for the reason
`fs/src/fault.wac` gives: *"`Denied` is the operating system refusing a program that asked;
`NotGranted` is a program that never held the authority to ask."*

### The general shape, which is not about filesystems

**A `Result` looks like an improvement over a struct with an `ok` flag, and carries less if the
struct had a second field.** `{ ok, bytes, error, fault }` is four facts; `Result<Bytes, E>` is two
unless `E` is built to hold the rest. The conversion is mechanical and the loss is silent, because
the resulting signature reads better than the one it replaced.

Which is the counterweight to every *replace the `bool` with a `Result`* argument in this file, and
none of them mentions it: the audit that finds a `bool` answering six questions should also ask
**what was beside the `bool`.**

### Asked it of every shipped struct with a flag, and it paid three more times

Four shipped structs have a flag and three or more fields. `FileResult` is above; the others:

**`Captured { u8[] out; u8[] err; bool truncated; }` — fine, and argued.** `Proc.run` takes a stream
and answers one here, so truncation cannot arise; the rewrite's own note cites the bug the flag
existed for — *"`seq 1 1500000 | wc -c` printed `0` with status 0"*. A field removed because the
design removed its cause.

**`Picked { bool ok; string name; u8[] bytes; string error; }` — two losses.** `vision`'s is
`{ name, bytes }` and `nextFile` answered `Result<Picked, NotGranted>`, with the doc saying plainly
*"not choosing one is `Err`"*. So **a person pressing Cancel was reported as *this program was not
granted the capability***: the ordinary outcome of a file picker, named as an authority failure. Not
vague — wrong, and the line said so without noticing. `PickFault { Cancelled, PickFailed, NotGranted }`
now, and `PickFailed` is where the host's `error` string goes.

**`Stat { exists, isFile, isDir, size, modifiedMillis, isSymlink, isExecutable, fault }` — two facts
dropped.** `exists` → `Err(NotFound)` and `fault` → the `Result`'s error are the conversion this
rewrite is *for*. `isSymlink` and `isExecutable` are **facts rather than flags**, so nothing replaced
them — and they are load-bearing in the shipped tree, where `packages/fs/src/remote.wac` serialises
both over its own wire protocol. Worse, without `isSymlink` **`Files.linkStat` and `Files.stat`
answer the same type with no way to tell which you called**, which is the entire reason `linkStat`
exists.

### And the sweep completed: 17 narrowed structs, 16 of them argued

Compared every struct declared under the same path in both trees — 55 file pairs. **Seventeen lost a
field.** Sixteen are redesigns this directory argues for in the file that made them:

    Headers      names/values/count → Vec<Field>          argued
    JsonObject   slots/count        → Vec<JsonMember>     argued
    Typed        hasLine/eof/signal → Effect              argued
    Line         canonical/echo     → Mode                argued
    Surface      dx0..dy1           → Rect? damage        argued
    Store        six fields         → three               argued: "not rewritten, elided so
                                                          `validate.wac` has something to import"

and four more of the same kind. `Socket`, `Child` and `Sha256` show as total losses because their
fields became funcrefs, which the instrument cannot see.

**One was not argued, and it is the `Picked` above.** So the fact-vs-failure defect has four
instances, all now fixed, and the sweep that would have found them is a field-set diff between the
two trees — which nobody ran until the fourth had already been found by hand.

That is the useful negative: the class is **closed** over same-named structs, and the four were not a
sample of many.

*(Third instrument bug of one family, worth one line: this one read `return x;` lines as struct
fields, after the quotation checker blanked import paths and the sentinel sweep blanked string
literals. All three were regexes applied to structure, and all three produced a confident wrong
number in the direction of the thing being looked for.)*

So the rule has a sharper form than *look beside the flag*: **a conversion to `Result` absorbs the
fields that encode failure and silently drops the ones that encode fact.** `exists` and `fault` are
failure and convert; `isSymlink`, `isExecutable` and a picker's `error` are facts and do not. Three
of the four structs had at least one of each, and the mechanical part of the conversion is exactly
the part that cannot tell them apart.

> **Verdict:** convention — when converting a struct to a `Result`, list the fields it absorbs and
> the fields it drops. Settled by: a review question; the language is not involved.

## Fixing a capability moved a package's taxonomy down a layer

Restoring the fault `std` had dropped had a consequence worth its own entry, because it is the
layering rule doing work rather than being stated.

`@/packages/fs/src/fault.wac` declared nine members — `NotFound`, `Denied`, `Exists`, `IsDir`,
`NotADir`, `NotEmpty`, `ReadOnly`, `Unsupported`, `Other` — written from the shipped `FAULT_*` codes.
That was right at the time: `std`'s `Files` answered `Result<…, NotGranted>`, one bit, so a
filesystem taxonomy had nowhere else to live.

Then `Files` regained the ten codes the rewrite had thrown away, and the nine were **declared twice
in two files for one taxonomy** — the drift this directory has found four times elsewhere, created
here by a fix.

They live in `std` now, and the rule decides it rather than taste: *a value that appears in a
capability's signature must be declared at or below the capability layer*, and they now appear in
eight of them.

### What stayed behind is the interesting half

The **union** stays in `@/packages/fs`. `std` owns the vocabulary — the nine things a filesystem
operation can be refused for — and `fs` owns *which of them a given mount can produce*: a memory
mount implements the tree and can answer all nine, a host mount answers whatever the host reports.

So a fault taxonomy splits cleanly in two, and this directory had not noticed the seam:

- **the members** belong to whoever can report them, which is the lowest layer that observes the
  fact;
- **the union** belongs to whoever answers, and is a claim about *this* implementation's reach.

That is why `Fault` and `FileFault` are different types over overlapping members and neither is
redundant.

### And the last sentence of this entry was wrong, which is the finding

It said the subsets are unions and *"a package can declare one per implementation without touching
the vocabulary."* Tried to write it. **It cannot be written**, and the reason is a decision the same
file argues for.

`Mount` is a struct of funcrefs:

    export struct Mount {
      fn<Ticket<Result<Bytes, Fault>>(string)> read;
      …
    }

with **one** error type baked into every slot. `Mount.inMemory()` and `Mount.onHost(files)` both fill
those slots, so both answer `Fault` — and a per-implementation union has nowhere to go.

The funcref struct is chosen deliberately and the reason is good: *"a method would dispatch on
`Mount`'s own type and there is only one of those. What varies is the lambda in the field."* So **the
decision that makes mounts composable is the one that forbids per-implementation error sets**, and
they are the same decision.

Three ways out, and the third is what the code does:

- **`Mount<E>`**, parameterising the error set. Then `inMemory()` is `Mount<MemFault>`, `onHost()` is
  `Mount<HostFault>`, and a filesystem holding both **cannot have a `Vec<Mount>`** — the mounts are
  different types. That is the existential-type problem, arriving from a two-file package rather than
  from a paper.
- **Erase `E` behind something common**, which wac has no mechanism for and which would give back the
  `NotGranted`-for-everything the whole thread started from.
- **One union that is the superset**, which is `Fault` today. It works, and the cost is that a caller
  matching on it must handle members the mount it holds can never produce — a **dead arm**, which is
  exactly what `never` was introduced for and which `never` cannot help with here, because *which
  mount this is* is a runtime fact rather than a type argument.

So the seam between vocabulary and reach is real, and only the vocabulary half is expressible. The
reach half needs the interface to be a type rather than a value, and this package chose a value on
purpose.

### And the cost is not proportional to the number of implementations

Checked the other big funcref interface, `core/ticket.wac`'s `Ticket<T>`, expecting the same problem
at a much-used type. It is not there, and the reason is the rule:

    Result<T, union<Circular, Stuck>> wait(this) {
      if (this.inWait) { return Result.Err(Circular()); }
      …
      if (this.advance(true)) { continue; }
      return Result.Err(Stuck());
    }

`wait` is a **concrete method**, and **both members are produced by `wait` itself** — `Circular` from
a re-entrancy flag it owns, `Stuck` from `advance` answering false twice. `advance` is the funcref
that varies, and it contributes no members of its own. So every kind of ticket — a host read, a
coroutine, a fake — can produce both, the union is exact, and there is no dead arm.

`Mount` is the opposite: **every member comes from the lambda**, so the union is a superset of what
any one mount can do and a caller writes arms its mount will never take.

So the rule is not *a funcref interface forces one error set* — that is true and is not the cost. It
is:

> **The cost is proportional to how much of the error set the implementations produce, not to how
> many implementations there are.**

An interface whose errors come from the shared wrapper pays nothing however many lambdas fill it. One
whose errors come from the lambdas pays for every member no implementation can reach. And that is
checkable per interface by reading one function, which is how this one was settled.

### There is a second axis, and the rule as stated missed it

Ran the census properly (brace-matched this time): **14 pure funcref-field structs** with two or more
slots and no method bodies. Ten answer only `NotGranted`, which every implementation can produce, so
they are exact. `std/platform.wac`'s `Files` is not, and it fails in a way the rule above does not
describe: it has **one implementation** — the host — and the dead arms are **across operations**.

All twelve slots answer the same ten-member `FileFault`. Reachability per operation is in a table in
`std/platform.wac`; the total is **51 reachable of 80, so 29 arms — 36% — are dead**, and the
sharpest is that `IsDir` is dead for `readDir`, where it is the *happy case*.

So the cost has two axes and yesterday's sentence covered one:

> One error set costs a dead arm for every **(consumer, member)** pair the consumer cannot reach —
> whether the consumer varies by *implementation* (`Mount`) or by *operation* (`Files`).

The fix is the same one `packages/fs/src/fault.wac` already applies at package granularity: **share
the members, vary the union.** The vocabulary reason for merging the nine members still holds; it
never implied one union. The price is twelve hand-written subsets, since `union<…>` has no
subtraction and no subset relation.

### And then the consumer that pays turned out not to exist

Before deciding whether twelve declarations beat twenty-nine dead arms, counted the callers that
would notice:

    match arms naming a FileFault member, across all 160 files:  0
    `match` on any fault union, across all 160 files:            0

Every consumer in the directory `try`s, forwards, or discards. The only reader of the twelve slots is
`packages/fs/src/mount.wac`'s host adapter, which passes each through unexamined.

**So three units of argument about the cost of a shared error set concern a caller this directory has
not written.** The measurement is not wrong and the dead arms are really there, but *nothing pays for
them yet*, and a cost nobody pays is not evidence about a design. The honest state of this question is
that it needs the same test as the last eight — write the consumer — and that the consumer here is a
specific one: something that handles file faults differently per member, which is a `cp` or an `rm`
or an installer, and there is no such program in `packages/box`.

It is the strongest instance so far of a shape this directory keeps finding in itself: `packages/abi`
had no callers, `AsyncGenerator` had no producer, `Slice` existed before any package used it. **An
argument about a surface, made without its consumer, reliably measures the wrong thing** — and here
it took three units to notice, because each one refined the previous one's answer instead of
questioning its subject.

*(The census that would have found the others did not work: a regex over `export struct … { … }`
mis-attributed names across declarations, so it reported `NotFound` with twelve funcrefs when it
meant `Files`. Fourth instrument bug of the same family — a regex applied to structure — and the two
interfaces examined here were chosen by knowing about them rather than by sweeping.)*

### 137 union members that nothing discriminates

Three units argued about the cost of one error set being shared, and the third found `FileFault` has
no exhaustive consumer, so a fourth wrote one — `@/packages/box/src/cp.wac` — and it changed the
design on contact. That makes the question askable for every union rather than one, and
`tools/specparse.ts --tokens` makes it cheap. **On the token stream, not a regex**, because four of
this session's instrument bugs were regexes over structure and that flag exists for exactly this,
with a comment saying so. I had not used it once.

    37 union declarations, 60 `match` blocks with arms

    discriminated — some `match` covers the members:      7  —   37 members
    reached as a group — one arm names the union itself:  1  —    8 members
    neither:                                             29  —  129 members

The seven are `Decoded` (utf8), `Invalid` (tor), `Event` (platform, 3 of its 7 arms), `FileFault`,
`fs`'s `Fault`, and the two-member `Fault` in each of `gzip` and `zstd`. Two of those seven are one
result counted twice — `fs`'s `Fault` and `FileFault` have identical member lists, so a `match` on
one scores both — so it is really **six**, and `FileFault`'s consumer is one day old.

The thirty include every fault vocabulary this directory is pleased with: `RequestFault` (10),
`mpt`'s `ProofFault` (10), `UpdateFault` (9), `Corrupt` (8), `TimeFault` (8), `AbiFault` (7),
`RlpFault` (7), `BlsFault` (6), `VerifyFault` (6). Each was designed by asking what can go wrong, and
each is unread.

**Published first as 4 of 29 and 117 members. Three bugs, all in one script, all found by reading a
file the script had scored as unconsumed and seeing it match by hand.**

1. *Keyed by name.* `unions[name]` — and `gzip` and `zstd` both declare `Fault`, `mpt` and `ssz` both
   declare `ProofFault`. Eight declarations collided away.
2. *One arm spelling.* It knew `Member:` and not `Err(is Member):`, which is the grouped-by-type
   match six READMEs here argue for and exactly one file uses.
3. *The wrapper counted as an arm.* `Ok` and `Err` went into the label set, so `L ⊆ members` failed
   for every union reached through a `Result` — which is all of them. That one is not noise: it is a
   test that could only ever have passed for unions matched *outside* a `Result`, so the first census
   was structurally incapable of finding what it was looking for.

### And the first of the thirty callers, written the same day

`@/packages/server/src/refuse.wac` consumes `RequestFault`'s ten members. Two predictions were
written down before the code:

> **`RequestFault` will earn its ten.** A server answers a malformed request with a status and a
> decision about the connection, and those differ per member.

> **`@/packages/gzip`'s `Corrupt` will not earn its eight**, because only the printed sentence
> distinguishes them, which is the payload rather than the identity.

The first held: three of the ten get a status the other seven do not — `BadMethod` 501, `BadVersion`
505, `TooLarge` 431 — so it is not a `BadRequest { string why; }` with extra steps. **First union in
this directory to meet a caller and come out unchanged.**

What the table said that I had not predicted is the other column. `close` is `true` ten times out of
ten, and I had put it in expecting it to be the interesting one. The reason is not about framing: a
server that could not parse the request line does not know where the request ended, so there is
nothing to resume from, and every member is detected before the message boundary is known. So the
column I added because it looked sharp is a constant, and the one I added because a response needs it
is the discriminating one.

> **A table of ten rows and two columns is the smallest thing that can disagree with you about which
> column matters.** A union with no caller cannot disagree at all, which is the whole of the number
> above.

The second prediction held and my reason for it was wrong twice. `ChecksumMismatch` and
`LengthMismatch` are detected *after* the whole stream is decoded and the bytes are already written,
where the other six are detected before or during — so a caller writing to a file has to decide
whether to delete its output, and that is the `close` column again in a package with no such column.
And `BadMagic` is the only member meaning *this is not a gzip file* rather than *this is a broken
one*, which a type-sniffing caller wants apart. So `Corrupt` earns a two-way split it does not have,
and *a caller will not distinguish the eight* was right about the caller that exists and wrong about
why.

**One mechanical cause found and measured away.** Writing `refuse.wac` failed to import eight of the
ten members: `packages/http/src/http.wac` exported `RequestFault` and two of its members, so a caller
outside the package could name the union and not take it apart. That is a real barrier and it is
**1 of 21** barrel-exported unions here — a slip, not a pattern. Which matters, because it rules out
*the members were not reachable* as an explanation for the other 137. They were reachable, and
nobody called them.

*Third instance, 2026-09-05:* `@/packages/server/src/routes.wac` could not import `writeValue`, so
`@/packages/json` could parse and could not print **from outside**. Unambiguous, and found by the
first caller.

*And a fourth that I got wrong the same hour, then measured properly.* I also reported that the file
could not write `Str(x)`, because the barrel re-exports `JsonValue` without its arms — on the
strength of my own name checker flagging `JsonValue.Str`. **That is a documented false positive of
that tool**, listed in its own header among the thirteen it cannot see: *"a qualified variant,
`Alphabet.Base32Lower`, where the enum is imported and the arm is not"*. Qualified construction needs
only the enum. I read the flag and not the tool.

Measuring what is actually true is better than what I claimed:

    variant constructions in vision:   bare 190 in 48 files    qualified 30

**86% bare**, which this directory chose deliberately. And:

    barrels: 29.  Barrels exporting an enum or union without its arms/members: 24.

So a caller outside any of those twenty-four must use the 14% spelling or reach past the barrel. That
is a real cost and a different one from what I said — not *the type cannot be used*, but **the barrel
silently withdraws the idiom the directory picked**. Two of the twenty-four are partial —
`http/Parsed` exports 1 of 3 arms and `wac/Command` 1 of 12 — which is the tell that nobody decided
this: a rule would not produce two-thirds of one enum.

> **A barrel that exports a type must export everything needed to use it in the way this codebase
> writes it.** Not *take it apart or put it together* in the abstract — the arms matter because the
> bare form is the idiom, and `writeValue` matters because a parser that cannot print is half a
> package.

Every instance was found by the first caller from outside. None by reading the barrel, which is what
makes it a pattern rather than slips: a barrel is complete against *did I export the types*, and that
is the wrong question.

### Second caller, and the hypothesis the first one suggested is wrong

`refuse.wac` earning its ten suggested a rule, written down before the next file:

> A fault union consumed by a **protocol** caller earns its members; one consumed by a **decoder**
> caller does not, because every member of a decode failure means *reject this input*.

`@/packages/lightclient/src/sync.wac` is the protocol half. Nine members, three answers, and the
boundaries are not where severity would put them: `NotRelevant` is **not a fault** — the peer did
nothing wrong and neither did we — `WrongPeriod` is a fault about **us**, and the other seven are
statements about **the peer**. So the union earns its members, and what it discriminates is not *how
bad* but **whose fault it is**.

**Third appearance of that axis in three days, and the first where the union carries it rather than
the caller.** `cp` needed *operand or run* and passed a `Side` by hand; `refuse` needed *does the
connection survive* and got a constant; here it falls out of the member. And it is luck:
`UpdateFault`'s members are named after **where the check failed**, and for this protocol where a
check fails and whose fault it is happen to coincide. `WrongPeriod` is the proof — the one member
named for the peer's state whose answer is about ours.

**`NotRelevant` should not be in the union.** An update that is well-formed, correctly signed and
older than our store is the *normal* answer to *give me updates from period N*. Putting it in
`UpdateFault` runs the happy path of a range sync through `Err`, and a sync that logged one line per
`Err` would report a healthy sync as hundreds of failures.

> **A union collects what a function can answer other than the value it promised, and *normal but
> uninteresting* is not that.**

Same shape as `Exists` being a failure for `mkdir` and the goal for anything idempotent, and the
clearer instance: there `Exists` is a real failure for one caller, here `NotRelevant` is a failure for
none.

**And the decoder half broke before it could be tested.** `@/packages/rlp`'s `RlpFault` has seven
members all carrying `i32 at`, which is what made it look like the uniform case. It is not:
`Truncated`, `NotSelfEncoded`, `ListOverrun` and `TooLong` are **structural** — there is no value —
and `LeadingZero`, `NotMinimal` and `Trailing` are **canonicality**: the value decoded, and the bytes
were not its canonical encoding. A block validator must refuse all seven because consensus requires
canonical RLP; an inspector, a debugger or a reader of a legacy database wants the value and a
warning. The shipped package decides for both by refusing, correctly for the caller it has, and
nothing in the type records that a decision was made.

So the hypothesis is wrong as stated and what it was reaching for survives narrower:

> A fault union earns its members when **more than one kind of caller exists**. `RlpFault` looked
> like the uniform case because this repository has one RLP caller and it is a validator.

Which is a claim about *this tree*, not about decoding, and it predicts the twenty-eight unions still
without callers split by how many kinds of consumer they will have rather than by what layer they sit
at. Checkable; not checked.

**A third state the census did not have, now measured.** `Err(is Corrupt):` in `gunzip` names a
union as one arm, which is neither *unread* nor *discriminated*. Adding it: **7 unions
discriminated (37 members), 1 reached as a group (8), 29 neither (129)** — so the headline drops
from 137 to 129 and gains an honest middle.

And a *fourth* state the census still does not have, which is what `sync.wac` actually does:
`BadFinalityBranch { ProofFault why; }` nests `@/packages/mpt`'s ten-member union and the caller
answers `Drop` without ever naming `ProofFault`. That is **reached by containment** — a member of a
consumed union carries it — and it is not visible to any arm-based count. The right way to measure it
is transitive closure over member types, which this script does not do, and saying so is better than
letting 129 read as exact.

### Third caller, and the narrowed hypothesis holds

`@/packages/datetime/src/lenient.wac` writes **three** callers of one eight-member union, because the
test the last entry proposed is *how many kinds of caller exist*. RFC 3339 timestamps arrive from
three directions that want different strictness: an HTTP `Date` header, a log line, and something a
person typed.

| | header | log | typed |
|---|---|---|---|
| `LeapSecond`   | Accept | Accept | Accept |
| `NoOffset`     | Reject | **Accept** | **Explain** |
| `Trailing`     | Reject | **Accept** | Reject |
| `NoSuchDate`   | Reject | Reject | **Explain** |
| `OutOfRange`   | Reject | Reject | **Explain** |
| `BadSeparator` | Reject | Reject | **Explain** |
| `NotDigits`    | Reject | Reject | Reject |
| `EmptyFraction`| Reject | Reject | Reject |

Six of eight rows are not constant and the three columns are pairwise different, so a
`BadTimestamp { i32 at; }` could serve exactly one of these and the other two would parse the
message. The hypothesis holds, and it explains the two earlier results without special pleading:
`RequestFault` earned its ten because a server and a client are two kinds, and `RlpFault` looked
uniform because this tree has one RLP caller — imagine an inspector rather than a validator and the
structural/canonicality split appears.

**A prediction it makes, untested:** the twenty-nine unions with no caller should divide by how many
*kinds* of consumer they will have rather than by size or layer. `CodecFault` (5) has one kind and
should turn out over-specified; `PageFault` (3) has two and should not.

### The other half of an error design, four times

`forHeader`, `forLog` and `forTyped` differ by **how much the caller may lose**, which is nowhere in
`TimeFault` and cannot be: the same `NoOffset`, same parser, same payload, is a protocol error, a
normal log line and a hint.

Fourth instance in four days, same shape at four sizes:

  * `cp.wac` — *operand or run*, passed as a `Side` parameter.
  * `refuse.wac` — *does the connection survive*, which turned out constant.
  * `sync.wac` — *whose fault*, which the members happened to encode.
  * `lenient.wac` — *how much may be lost*, which is three whole functions.

> **A fault says what went wrong, and every caller also needs to know what that means for it, and the
> second thing is not a function of the first.**

Three of the four supply it by hand; the fourth coincided by luck. This is not an ask for a feature —
it is the argument that a fault union is *half* of an error design, and this directory has written
twenty-nine of the halves and one of the wholes. The other half has a shape, a per-caller table over
the members, and all five files that have one spell it as a `match` returning an enum: a lookup table
written as control flow, five times in five files, because a union member cannot carry attached data.

**And `Take.Accept` claims a value the type has thrown away.** *Accept* means the parser recovered
something usable, and by the time a caller sees a `Result<Time, TimeFault>`'s `Err` there is no
`Time`. The honest shape is an `Err` that carries what was recovered — a `Result` whose error half
has a payload worth keeping — and this directory has not written one in 165 files. Same absence as
`cat.wac`'s *a read that fails halfway is indistinguishable from one that ended*, and the first time
it is the error side that has the value.

### Fourth caller: the prediction was wrong, and the rule that replaces it is better

The entry above named two cases to check the caller-counting rule against, and the first one
falsifies it. `@/packages/codec/example/strictness.wac`:

> `CodecFault` (5) has one kind — a decoder either accepts base64 or does not — and should turn out
> over-specified.

Base64 has two kinds of caller and they were in front of me. A JWT segment is base64url **with the
padding removed** (RFC 7515 §2); MIME requires it (RFC 2045). Two specifications, one alphabet,
opposite answers about `BadPadding`. One row of five differs — thin, but not thin in the way
*over-specified* means, because it is the same partition `@/packages/rlp` has:

  * **Structural** — `NotADigit`, `ShortGroup`, `ImpossibleLength`. There are no bytes. Every caller
    refuses and a caller that wanted not to could not be given anything.
  * **Canonicality** — `BadPadding`, `NonZeroTail`. **The bytes are there.** The text was not their
    canonical encoding, and whether that matters is the caller's question.

> **A decode fault union earns its members at the structural/canonicality boundary and almost nowhere
> else.** Structural members are interchangeable to every caller and differ only in the message.
> Canonical ones are where callers disagree, because a value exists and the question is whether to
> hand it over.

Better than the rule it replaces on three grounds: it is about the members rather than about how many
consumers this tree happens to have; it explained `RlpFault` after the fact and `CodecFault` before
the file was written; and it says which member to read first in the twenty-eight unions with no
caller.

**And it retires the caller-counting rule properly rather than quietly.** `TimeFault`'s three callers
do differ on six rows of eight — but the six are `NoOffset`, `Trailing`, `NoSuchDate`, `OutOfRange`
and `BadSeparator`, every one a case where a date was recovered and the question is whether to hand it
over, and the two constant rows are `NotDigits` and `EmptyFraction`, the structural ones. **Same
boundary. I read it as caller-counting because there were three columns.**

**Which makes `BadPadding` the first member here that a caller should not be able to receive.** The
fault is carrying a policy question backwards: unpadded base64url is not an error being tolerated, it
is the specified input format, so the decode should not have failed for that caller at all. The shape
that removes it is a decoder parameterised by what it accepts — `decode(text, alphabet,
Padding.Optional)`, which `@/packages/codec`'s `Padding` almost is — and then `BadPadding` is not
*allowed*, it is **impossible**. That is the `Mount` dead arm from the other side: the caller does
know at compile time which decoder it configured, so a `decode` whose fault type depended on its
padding argument would remove the arm. A return type computed from an argument value; not in
`GRAMMAR.md`, and the third distinct place this directory has wanted one.

**The cost, stated because it is the argument against all of this.** `forMime` is five arms all
answering `Refuse`. It exists so that a sixth member of `CodecFault` fails to compile there — a
**completeness assertion spelled as a function**. `cp.wac`'s `policy` had two dead arms and this has
five constant ones, and they are the same thing: a `match` over a union is the only exhaustive
construct here, so anything wanting exhaustiveness must be one even with nothing to decide. The
alternative is a default arm, which is exactly what makes adding a member silent.

### Fifth caller, and the three mechanisms that account for all five

`@/packages/page/src/mount.wac` settles the second half of the prediction. `PageFault`'s three
members meet a renderer and a test harness, and one row of three differs — so the union earns
`NoSuchElement`. But not for either reason this thread has proposed. There is no recovered value for
a lenient caller to accept, and it is not caller-counting. What the two differ about is:

> **whether the thing that failed is something this program wrote.**

The renderer put that id in the tree, so a missing element is its own bug. The harness was handed a
page somebody else built, so a missing element is a fact about the page. Same member, same payload,
and the difference is which side of a boundary the *caller* sits on.

Named, it accounts for all five callers without straining:

| mechanism | the question the members answer | seen in |
|---|---|---|
| **recovery** | a value exists — hand it over or not? | `CodecFault`, `RlpFault`, `TimeFault` |
| **response** | what outward artefact does this become? | `RequestFault` (a status), `UpdateFault` (a peer policy) |
| **provenance** | did this program produce the thing that failed? | `PageFault`, and `FileFault` in `cp.wac` |

The third row is what this thread kept finding and could not name. `cp`'s `Side` **is** provenance —
*is this about the operand I was handed or the run I set up* — passed by hand because the fault cannot
know. `refuse.wac`'s constant `close` column is response with nothing to vary. `sync.wac`'s *whose
fault* is provenance that coincided with the member names.

**And the three differ in whether the union can carry the answer.** Recovery can: *is there a value*
is a property of the member. Response can: a status code is a fact about the fault. **Provenance
cannot, ever**, because it is a fact about the call site — which is why three of the five callers had
to supply their axis by hand and the fourth only looked like it did not.

Falsifiable, which is the point of writing it this way: a union whose callers differ on provenance
will always need something the union cannot hold; one whose callers differ on recovery or response
will not.

**Third instance of *normal but uninteresting is not a fault*.** `forHarness` answering `Ignore` for
`NoSuchElement` asks *is the error banner showing* with a call that fails, when both answers are
normal. After `NotRelevant` and `LeapSecond`, and the first where the fix is a `?` — `Result<Element?,
PageFault>` — rather than a redesign.

### Sixth caller: provenance is the producer's to record, not the caller's to supply

The taxonomy's falsifiable claim was *a union whose callers differ on provenance will always need
something the union cannot hold*. `@/packages/ts/src/report.wac` tests it on the sharpest provenance
case available — a bundler, half of whose input is its own output, so a `NoSuchModule` in a generated
barrel is a bug in the bundler and the same fault in a user's file is a bug in the user's program.

The prediction holds and the two callers disagree on three of four members — but the disagreement is
**total**, and both functions are constants. A constant classifier is the tell: neither is
classifying, each is asserting a blanket answer. `cp`'s `policy(Side, FileFault)` at least *used* the
member.

**And the fact needed is not about the call site.** It is *is `from` a file the user wrote or one this
bundler generated*, which is a property of the string inside the fault, decided against a set only
the bundler holds. `NoSuchModule { spec, from }` carries `from`, so the data is right there, and
nothing can decide it — *generated* is not a property of a path, it is a property of whether this run
made it, and that lives in the module table and is gone by the time a caller has a `Result`.

So the axis cannot be a caller's parameter here. It has to be recorded when the fault is raised:
`NoSuchModule { spec, from, fromGenerated: bool }` — the union carrying provenance after all, because
the **producer** knows.

> **Provenance cannot be recovered by a caller and can be recorded by a producer.** Every earlier
> instance had a caller who happened to know — `cp` knew which argument it passed, the renderer knew
> it built the page — so the axis looked like caller knowledge. It is not. It belongs to whoever
> raised the fault, and the four earlier cases were the ones where the caller happened to have it
> too.

That refines the third row of the taxonomy rather than breaking it, and it makes the ask concrete:
not *a way for a caller to tag a call*, but **a convention that a fault records what only its producer
can know**. The reason nothing here does is that a fault union is designed by listing what can go
wrong, which is a producer thinking about causes rather than about what a reader will need.

**Fourth instance of an `Err` that should carry what was recovered.** A bundler that wanted to retry
`NoPrefix` with a different prefix — which is exactly what that member invites — cannot, because by
the time it knows the fault is its own it has returned. After `datetime`'s `Take.Accept`, `cat.wac`'s
halfway read and `codec`'s `BadPadding`.

**And then the fix was applied, and the obvious shape of it was wrong.** The entry above proposed
`NoSuchModule { spec, from, fromGenerated: bool }` — a flag on the fault. Writing it out, the member
that breaks it is `Cycle`:

    export struct Cycle { Vec<Source> path; }

**A cycle is not one path.** A fault-level flag would have to say *which* module it was about, and
there is no such module — the ring is the fault. So the flag collapses to `anyGenerated`, computed
where the fault is raised, and a caller wanting *which one* cannot ask.

> **Provenance attaches to the thing that has an origin, not to the fault that mentions it.** The four
> members mention one path, one path, a list of paths, and none. A fault-level flag has to pick one
> of those four shapes and is wrong for the other three.

So `@/packages/ts/src/bundle.wac` makes the *path* a type — `struct Source { string path; Origin
origin; }` — and every member then carries as many origins as it has paths, with `NoPrefix` carrying
none, which is right: it is the one member with no path and the one that needed no new data. The two
constant classifiers in `report.wac` collapsed into one `blameFor` that reads its payload in three of
four arms, and **nothing about the callers changed to make that possible** — only the producer did.

Same shape as `@/packages/wacc/src/decl.wac`'s `Program { Decl[] decls; Tok path; }` from the other
end: there a `Tok` is meaningless without its file, here a path is meaningless without who wrote it.
**Both are a scalar that was always half of a pair, and in both the fix is a type rather than a
field.** The cost is that the type change propagates — `Module.path` is `Module.at` and every consumer
sees a `Source` where it saw a `string` — which is the right cost and not a small one.

*And a new bound found while writing it:* `Origin` has two arms and wants three. A module the **user**
generated — a build step's output this bundler merely read — is neither `UserWrote` nor `Generated`
by this run, and blaming either party is wrong. Two arms is what the bundler can distinguish, which is
*a fault union is bounded above by what its sources can distinguish* arriving on an enum.

### A cursor carries its input and its position; a fault carries the position alone

Two findings a day apart said the same thing — a `Tok` is meaningless without its file, a path is
meaningless without who wrote it — and both were fixed by making the scalar a type. Swept the
directory for the general case, on the token stream:

    structs carrying a position (`at`, `offset`, `from`, `line`, `col`, `index`):   62
      ...that also carry the thing it indexes:                                       7
      ...that do not:                                                               55
        ...and the name says it is a fault:                                         35

The seven are `Slice { of, from, len }`, `Scan { src, at }`, `Parser { src, json5, at, depth }`,
`Walk { nodes, used, path, at }`, `Reader { src, at }`, `Received { bytes, from }` — **six cursors**
— and `Module { at, text, imports }`, which only joined the column an hour earlier, when `Source` was
introduced for a reason nobody had connected to this.

> **A cursor is built to be read from, so it holds both halves. A fault is built to be raised, so it
> holds only the half the raiser had in a local variable.**

**Corrected 2026-09-05, by a value that is neither.** `@/packages/http/src/proxy.wac`'s
`ProxyReply.Established(i32 at)` — *the first byte that belongs to the tunnel* — is a **success**
carrying an offset into a buffer the caller must keep, and the framing above does not cover it. The
numbers already said so and I did not read them: of the 55 that carry a position and not its subject,
**20 are not named like faults.** I reported the 35 and treated the rest as noise.

> **A position is meaningless without the thing it indexes, wherever it appears.** Cursors get it
> right because they were built to be read from; every other producer writes down the half it had in
> a local variable, and *fault* was a coincidence of where I looked.

`Established(Bytes tail)` is also better for a reason independent of the rule: the caller does not
want the offset, it wants the bytes, and every use of `at` in the shipped file is
`slice(got, at, got.len())` — the slice the arm could have handed over.

### And the twenty turned out to be trees, plus the same `Span` invented three times

Went and read them. **The fault/non-fault split was never real** — my classifier was a regex over the
struct's *name*, and it puts `OffsetOutOfRange`, `NonZeroTail`, `LeadingZero`, `DivisionByZero` and
nine more in the non-fault column while calling `Timestamp { millis, offset }` and
`Mapping { from, spec, to }` positional at all. So *35 faults and 20 others* was one bad split, not
two populations.

The real division is three groups, and the one I had not looked at is the largest:

**Tree nodes.** `Expr { ExprKind kind; Span at; }`, `Stmt { StmtKind kind; Span at; }`,
`Decl { DeclKind kind; Span at; }`, `Hoisted { Tok name; Ty type; Span at; }`,
`ImportDecl { at, spec, names, namespace }`, and `Token { kind, start, len, line, col }`. **Every AST
node in this directory carries a position and no file.** That is `@/packages/wacc/src/decl.wac`'s
`Program { Decl[] decls; Tok path; }` entry, and it is not one entry — it is every node in three
trees.

**Three `Span` types, in three packages, none carrying a subject.**

    packages/wacc/src/ast.wac      Span { i32 line; i32 col; }
    packages/ts/src/bundle.wac     Span { i32 from; i32 to; }
    packages/regex/src/regex.wac   Span { i32 from; i32 to;  Bytes of(const this, Bytes input); }

The third one is the evidence. **It has a method that takes the missing half as a parameter** —
`of(input)` — so the type knows exactly what it needs and asks its caller for it at every call. A
`Span` that held its `Bytes` would have `of()` with no arguments, and the reason it does not is that a
span is built by a scanner that has the input in a local and does not think to put it in the value.

So the general statement, which no longer mentions faults at all:

> **Anything that names a position in something is half a value, and the half it drops is the one its
> producer had in a local variable.** Faults, success arms, tree nodes and spans; 55 of the 62 in this
> directory, and the seven that get it right are cursors, which are the only things built to be read
> from rather than written down.

### Two of the three `Span`s are deleted, and the limit is in the third change

`@/packages/regex`'s and `@/packages/ts`'s are `Bytes` now — `core`'s `Slice<u8>` is `{ of, from,
len }`, so a slice is a span that brought its subject, and `from` survives for a caller that wants
the offset. Nothing else in either package moved. `@/packages/wacc`'s `Span { line; col; }` stays,
because a line and a column are a **rendering** of a position rather than a position, which is what
`@/packages/json`'s `render` computes from a slice.

It also answered an ask that had been open in `@/packages/ts`'s README — *a `Span` for `blank(from,
to)`, two `i32`s that must agree* — and the way it answered is the finding. `blank(Bytes span)` gets
`from <= to` and `to <= len` free, because **making the slice is the check** and a caller cannot
build a bad one.

> **What it does not get is that `span.of` is the receiver's own array.** A slice pairs a position
> with *an* array; it does not pair it with *the* array the receiver means, so
> `blank(otherFile.slice(0, 3))` type-checks.

That is the honest limit of this whole argument, and an existing ask found it rather than the sweep.
For a fault being rendered it does not bite — one array is in play and the slice is a view of it. For
a **mutation** it does: the receiver has an array of its own, so the question stops being *where* and
becomes *where in what of mine*, which a slice answers confidently and wrongly. Closing it wants a
slice whose array is a type parameter, which is the phantom-parameter ask at its eleventh site and the
first where the tag would name a **value** rather than a type.

### And the consequence is that not one fault here can render itself

Every diagnostic function in the directory, without exception:

    say(const Blame b, BundleFault f)          @/packages/ts/src/report.wac
    say(string path, FileFault f)              @/packages/box/src/cp.wac
    say(string name, ArgFault f)               @/packages/box/src/lib/args.wac
    say(const Rules rules, const Finding f)    @/packages/git/example/ignorelint.wac
    say(string what, Invalid why)              @/packages/tor/src/verdict.wac

**Five for five take the fault plus the thing it is about**, and I wrote four of them without
noticing. `at: 47` cannot be drawn as a caret under a line without the text, so a `Truncated { at,
want, have }` is exactly as useful as its caller's memory of what it was parsing — and the caller's
memory is a parameter, unchecked, threaded by hand.

This is the fourth time this file has recorded *paired values with nothing holding the pair* and the
first time the pair has been counted. It is not four coincidences; it is one shape with 35 instances,
and the four entries were each looking at one of them.

**The fix is the one both earlier instances already used, and it is not a `Span` type.** A `Span {
from, to }` is two positions and no source — `@/packages/regex` has exactly that and it is in the 55.
What worked twice was giving the *scalar* the thing it needs: `Tok` needs its `Program`, a path needs
its `Origin`, and an `at` needs its input. The general form is a slice: `Bytes at` rather than
`i32 at`, which `core/slice.wac`'s `Slice { of, from, len }` already is and which every one of the six
cursors is holding the pieces of.

Cost, stated because it is the reason nobody has: a fault that carries a `Bytes` keeps the whole input
alive for as long as the fault exists, and a parser that raises one per malformed record in a stream
would retain every record it rejected. That is a real objection to putting it in `Truncated` and not
to putting it in `ParseError`, and the difference is how many of the fault get made — which nothing in
the type says.

**Tried on one, then counted the rest.** `@/packages/json`'s `ParseError` went from `{ i32 at; Reason
why; }` to `{ Bytes at; Reason why; }` — a zero-length slice at the fault *is* the pair, since `Bytes`
is `Slice<u8>` — and it bought `render(const ParseError e)`, the first diagnostic in this directory
that takes one parameter. It cost **one line**, because `fail` is the only place that parser
constructs one, and the file says that is not a general result.

So how general is it? Counting construction sites of the 51 faults that carry a position and no
source:

    construction sites per fault:  0 → 23   1 → 18   2 → 5   3 → 2   4 → 1   5 → 2

**The maximum in the directory is five and the median of those that are constructed at all is one.**
The whole change is 48 edits, and the five largest — `Truncated` (rlp), `OutOfRange` and
`BadSeparator` (datetime), `LengthOverruns` (abi) — are all raised from inside a cursor that already
holds the source, so each edit is `this.src.slice(this.at, this.at)` and nothing else. *Twelve raise
sites would be twelve edits* was the worry and the number is five.

Two caveats, both real. **23 of the 51 have no construction site here at all**, because their
producer's body is `{ … }` — so the count is a lower bound and is only honest about the 28 that are
built. (Measured since: 262 of 580 function bodies here are elided, 45%, not the *most* this file had
been saying.) And the sweep first said 81 sites: **32 of those were `match` arms**, `OutOfRange(_, _, _):`
counted as a construction, a 40% inflation concentrated in exactly the faults this directory has been
writing callers for. Distinguishing them is one token — whether a `:` follows the closing bracket —
and it is the fifth instance of *the enumeration is only as good as its parser* in two days.

### *A lookup table written as control flow*: claimed five times, counted fifteen

Five files each said *the Nth time a lookup table has been written as control flow* and none listed
the others. Counted — a `match` of three or more arms where every arm is exactly one `return`:

    15 blocks in 11 files

    arms exactly `return X ;` (3 tokens)      10 blocks    a pure member-to-constant map
    arms that read a payload or parameter      5 blocks    a real classifier

The split is what the count hid. The ten are `Member: return Constant;` with no computation anywhere
in the block — `@/packages/codec/src/alphabet.wac` (7 arms), `@/packages/git/src/status.wac` (7),
`@/packages/wac/src/buildcache.wac` (7), `@/packages/lightclient/src/sync.wac` (9),
`@/packages/datetime/src/lenient.wac` (8, three times), `@/packages/codec/example/strictness.wac`
(5, twice), `@/packages/page/src/mount.wac` (3, twice). The five are classifiers and are not the
complaint: `cp.wac`'s `Side` ternary, `refuse.wac` building a `Refusal`, `knownhosts.wac`'s fold,
`report.wac` reading `from.origin`.

**Three of the ten predate the error-union thread** — `alphabet`, `status`, `buildcache` — so this is
not an artefact of a fortnight spent writing callers on purpose. It is what an enum with no attached
data does to every package that has one.

The ask is unchanged and is now sized: **a union member or enum arm cannot carry data**, so every
per-arm fact is a function, and a function over a closed set with constant results is a table spelled
as control flow. Ten of them, 61 arms between them.

*Fourth enumeration of a bare ordinal in two days, and the fourth to change the finding.* After the
fixed-length byte view, the sentinel count and the phantom parameter. The pattern is consistent
enough to state as a rule about this directory rather than about any one claim: **an ordinal above
three has been wrong every time it has been checked here, and checking it has never failed to
sharpen the entry.**

**Two more the same afternoon; six for six.**

*`@/packages/git`'s README said `A path is a string`, and this is the fifth package to build one with
`+`, quoting `r.workTree + "/" + e.path`.* Both halves wrong, and the promoted entry above already
said so: this directory does it **zero** times, because the filesystem bodies are elided, and the
quoted expression is from the shipped walk. The shipped tree has `+ "/" +` and neighbours **265 times
across 25 packages**. So the ordinal counted vision packages that had *mentioned* the shape and
presented it as a count of occurrences.

*`@/packages/http/src/response.wac` said `the fifth time a caller has had to hand back something it
already told the callee once`.* Seven, and they are **three different problems the count merged**:

  * *the callee could compute it* — `say(const Blame b, BundleFault f)`, where `b` is `blameFor(f)`.
    A code smell.
  * *the value already carries it, for most members* — `say(string path, FileFault f)`, and **seven
    of `FileFault`'s ten members have a `path`**. The caller supplies it because three do not, so **a
    union whose members almost agree on a field makes every caller carry that field alongside.** New,
    and the fix is in the union rather than in the language.
  * *nothing has it* — `write(r, headOnly)`, `policy(Side, FileFault)`, `say(const Rules, const
    Finding)`, `say(string what, Invalid why)`. **Four**, and only these are the missing-pairing
    question.

So of the six enumerations, three shrank the ask (phantom parameter 11→8, hand-back 7→4, byte view),
two grew it (lookup table 5→15, path 5→25 packages) and one changed its subject. **None left the
claim as it was**, which is the strongest form the rule has: it is not that counting is unreliable,
it is that the act of listing is where the distinction lives.

## A field most members carry, and the two partitions a union cannot both have

*2026-09-05.* `@/packages/box/src/cp.wac`'s `say(string path, FileFault f)` passes a path the fault
mostly has — seven of `FileFault`'s ten members carry one. Swept for the shape:

    unions where a field is carried by MOST members and not all:   14
    unions where EVERY member carries one:                          2

The two are `@/packages/sh`'s `ArithFault` (all three have `at`) and `@/packages/http`'s
`ProxyUrlFault` (all five have `url`), and for those `f.at` would read it — except that **field access
on a union is not in the language and nothing here had asked for it.**

*And the demand for that feature is thin, which is worth saying before proposing it.* Both unions
were written in the last two days and both by the same hand — `arith.wac` on 2026-09-04,
`proxy.wac` on 2026-09-05 — so *two unions want it* is close to *I wrote two unions that want it*.
The fourteen below are the real evidence, because they are spread across `abi`, `tor`, `box`,
`codec`, `wacc`, `ssz`, `std`, `fs`, `http`, `mpt`, `ethrpc` and `datetime`, and most predate this
week.

**What makes the feature worth proposing anyway is that it and the design rule check each other.**
If `f.at` compiled only when every member had an `at`, then adding `ImpossibleLength { i32 len; }` to
`CodecFault` would have broken every reader — loudly, at the moment the whole-input fault was mixed
into a union of point faults. So the feature is not only a convenience: **it is the only mechanism
that would make the mixing visible**, and without it the rule is a thing to remember. The cost is the
same fact from the other side — a member added without the field breaks readers at a distance — and
that cost *is* the check. Which is unusual enough to state plainly: this is a feature whose
inconvenience is its whole value.

The fourteen are more interesting, and every near-miss is a position or a subject: `at` in 6 of
`AbiFault`'s 7, 4 of `CodecFault`'s 5, 7 of `TimeFault`'s 8; `node` in 8 of `mpt`'s `ProofFault`'s 10;
`path` in 7 of `FileFault`'s 10; `id` in 6 of `Event`'s 7. Reading the odd members out:

  * `CodecFault`'s `ImpossibleLength { i32 len; }` and `AbiFault`'s `NotWholeWords { i32 len; }` — a
    fact about the **whole input**, which has no position in it.
  * `FileFault`'s `Unsupported`, `OtherFault`, `NotGranted` — about the **operation or the system**,
    not about the path.

> **A union where most members carry a position and one does not is mixing two kinds of fault: point
> faults and whole-subject faults.** The odd member is not incomplete; it is a different question, and
> the shared field is the tell.

### And splitting one on that line found the cost of nesting

`@/packages/codec`'s is now `union<AtByte, AboutInput>`, and `@/packages/codec/example/strictness.wac`
already contained a **different** partition of the same five members — structural versus canonicality,
which is where its two callers actually differ. They are orthogonal:

    |              | AtByte                   | AboutInput       |
    | structural   | NotADigit, ShortGroup    | ImpossibleLength |
    | canonicality | BadPadding, NonZeroTail  | —                |

> **A union with two useful partitions can spell one of them.** The members are a set, the grouping is
> a tree, and there is no way to say *these four share a field* and *these two are where callers
> disagree* about the same five values.

Same shape as `Mount`'s funcref struct forbidding per-implementation error sets: a decision that buys
one thing forecloses another, and the foreclosure is invisible until somebody wants the second. Here
one file wanted both.

**And the honest reading is that the split may be the wrong one.** The caller reason has two callers
behind it; the field reason has none — nothing here reads `at` off a `CodecFault`. Choosing a grouping
for a use nobody has, over one two functions demonstrate, is the ordering this directory argues
against everywhere else, and it is recorded rather than quietly reversed because the *conflict* is the
finding and either choice would have hidden it.

> **Verdict:** language — field access on a union whose members all carry that field. Settled by:
> `spec/spec/types.md`. The partition half of this entry is a **convention** and wants no feature:
> do not mix point faults with whole-subject faults in one union.

## Writing one elided body closed the `Map.create()` contradiction and two blockers

*2026-09-05.* `core/map.wac` was four signatures and a long note about a contradiction it had noticed
and not resolved: `create()` takes nothing here and two funcrefs in the tree, and `DECISIONS.md` says
the language does not hash for you. The note offered two ways out and called the choice a real
question.

Writing four lines of `put` settled it in one:

    void put(this, K key, V value) {
      i32 h = ???(key);

**There is no `???`.** The surface was not a simplification of the shipped signature; it was a
signature with no body, and nothing noticed for a day because nobody wrote one.

**And the third way out is neither of the two the note offered, because the note was reasoning about
the signature.** One argument or two is not the problem; two loose funcrefs are *two values that must
agree and nothing says so* — `Map.create(hashBytes, stringEq)` type-checks. So:

    export struct Key<K> { fn<i32(K)> hash; fn<bool(K, K)> eq; }

Fourth *value type where two things must agree* here, after `raster`'s `Rect`, `ssz`'s `Chunk` and
`ts`'s `blank(from, to)`, and the first where the two things are **functions**.

### The piece nobody asked for, that two files had already written by hand

`Key.by(inner, project)` — *use this key, on this part of that value* — is four lines and closes two
recorded blockers:

  * `@/packages/git/src/prompt.wac` wanted `Map<Change, i32>`, wrote three paragraphs on why it could
    not have one, and settled for `Map<u8, i32>` keyed on `Change.code()` — *"and that is the
    character"*. It is `Key.by(Key.bytes(), (Change c) => c.code())` now, and the character is an
    implementation detail of one `Key` instead of the type of the map.
  * `@/packages/box/src/lib/args.wac` records that *"`u8` is not a key"*. Same fix.

> **The workarounds named the missing operation.** `by` was not found by asking what `Key` should
> have; it was found by writing the map's body, which meant reading the two call sites that had
> worked around its absence — and both were the same projection, spelled by hand, in packages that
> did not know it.

Which is a sharper form of this file's standing advice. *Write the consumer* is how most entries here
were tested; this is *write the thing the consumers worked around*, and the workarounds turn out to be
a specification for it.

> **Verdict:** library — `Key<K> { hash; eq; }` and `Key.by`, written in `core/map.wac`. Settled by:
> the code, which exists. **Second library verdict in this file**, after *a key and an order are
> different things* — worth saying because the entry that claimed to be the first was wrong about it.

## Two states with the same fields are two types, and the residue is a linear value

*2026-09-05.* `@/packages/http/src/headers.wac` was the largest all-elided file here — ten
signatures — and its *could not be written* list ended with:

> The type wants two states, *building* and *checked*, and they are the same fields. … **a value
> whose guarantee comes from how it was made**, with no way to say so.

Written out, it works and needs nothing new. They are two types: `Building` pushes and cannot be
read, `Headers` reads and cannot be pushed to, `done()` is the only bridge and the only place the
framing rule runs, and **there is no `Headers.create()`**. A parser holds a `Building` and physically
cannot ask it a question whose answer is not yet true.

Second instance of `@/packages/ts`'s `Blanked` — *a buffer you can only blank* — and the first where
the withheld operation is **reading**. Which is the more useful direction: a write-only type stops
you corrupting a value; a readable-only-when-valid type stops you *believing* one.

### And the residue is the ask, sharpened

`done()` holds a `Vec<Field>` and must produce a `Headers` holding a `Vec<Field>`. `Headers(this.fields)`
moves a reference, and that is fine **only because the `Building` is dropped immediately** — nothing
stops a caller keeping it and pushing more, into the `Vec` the `Headers` now holds.

> So the guarantee is *the framing rule ran at some point*, not *this is valid now*, and the
> difference is one retained reference.

Two ways to close it and only one is worth asking for. A **copy** is O(n) per message on a server's
hot path. A **linear `this`** — `done` consumes the `Building` — costs nothing at runtime and is the
same ask as `@/packages/box/src/cat.wac`'s stream ownership and `Ticket`'s `inWait` re-entrancy flag:
*a value that may be used once*. Third site, and the first where the alternative is not *be careful*
but *pay a copy*, which is what makes it a language question rather than a style one.

*And the entry it replaces was right about the problem and wrong that it had no answer.* The two
states were writable all along; what was not writable is the handover. Fourth time here that a *could
not be written* turned out to be a *could be written, and here is the smaller thing that could not*
— after `Map.create`, the `Span` deletion and `blank(Bytes)`.

> **Verdict:** language — a linear `this`, so `done()` consumes the `Building`. Settled by:
> `spec/spec/types.md`. The two-state split itself needed nothing and is already written.

## A funcref is a cost exactly when it is a constant

*2026-09-05.* `@/packages/box/src/lines.wac` recorded that `Slice` has no `eq`, so equality is spelled
`cmpBytes(a, b) == 0` — a three-way comparison answering a yes/no question, twice per iteration of
`@/packages/box/src/applets/diff.wac`'s inner loop. Written into `core`, and the witness count was
wrong in the usual direction: **four, not two.** This file, `diff.wac`, `@/packages/tor/src/onionaddr.wac`
which wrote two `get`s instead, and `core/map.wac`, which declared its own `bytesEq` while arguing
about hashing and never noticed it was a fifth site for something else.

The length check alone is most of the win: two slices of different lengths are unequal in one
comparison, and `cmpBytes` **cannot** know that, because a three-way answer must say which is smaller
and that needs the bytes.

### And it had to take a comparator, which resolves a contradiction between two entries

`Slice<T>` cannot ask `T` whether two of them are equal — no traits, no constraints on type
parameters — so `eq(other, same)` is the only spelling. Which puts two entries in this file directly
against each other:

  * `core/map.wac` on `Map.create(hash, eq)`: *two arguments at every call site that are the same two
    functions almost every time* — a burden, and the reason `Key<K>` was invented.
  * `@/packages/box/src/lines.wac` on `sortWith(cmp)`: *a wrapper saving one argument, for one caller
    that does not want it, is a name that documents nothing* — not felt as a cost at all.

Both are right, and the difference is one property:

> **A funcref parameter is a cost exactly when it is a constant.** `sortWith` is called with the
> comparator the caller chose, and it is the point of the call. `Map.create` is called with the same
> two functions every time, and they are noise. The question is never *is a funcref a burden*; it is
> *does the caller have one to hand, or is it repeating a default*.

Which also says when `Key`-like bundling is the fix and when it is ceremony: bundle the constants,
leave the choices as parameters. `Slice.eq`'s comparator is a choice — `u8` equality for bytes,
something else for a `Slice<Field>` — so it stays a parameter, and `bytesEq` is the bundled constant
beside it.

*And that free function is itself a finding.* `Bytes` is `Slice<u8>`, an **instantiation**, and a
method cannot be added to one instantiation of a generic struct — `Slice<T>.eq` is the only place a
method can live and it does not know `T` is `u8`. So the specialisation that needs no comparator has
to sit beside the type. `core/map.wac`'s `Key<Bytes> bytes()` — a static whose type parameter is
fixed — is the mirror of it, and both are the cost of `export Slice<u8> Bytes;` naming a type rather
than being one.

> **Verdict:** library — `Slice.eq` and `bytesEq`, written in `core/slice.wac`. Settled by: the code.
> The *funcref-is-a-cost-when-constant* rule is a **convention** and needs nothing. Third library
> verdict in this file.

## When a value keeps one bit of an N-way answer, check which bit it kept

*2026-09-05.* `packages/http/src/incoming.wac` parses a response, and RFC 9112 §6.3 gives **five**
rules for where its body ends. The shipped `Incoming` records one of them: `bool closeDelimited`,
*"true when rule 5 applied … a caller that wants to reuse the connection cannot, and this is how it
finds out"*.

It kept the rule a caller could already work out. A caller that saw the socket close knows rule 5
applied. What it cannot reconstruct is **rule 1** — and rule 1 is the one the file's own header calls
the client-side version of smuggling:

> a HEAD response carries the Content-Length the GET would have had and *no bytes*. A client that
> believes the header waits for a body that is never coming, and then reads the next response's bytes
> as this one's.

The evidence for rule 1 is a `Content-Length` header still sitting there saying something false, so
nothing outside the parser can tell. `@/packages/http/src/incoming.wac` makes it a `Framing` enum with
four arms and `NoBody(HeadRequest)` distinct from `Length(0)`.

> **When a value keeps one bit of an N-way answer, ask whether the bit it kept is the one the caller
> could have worked out.** Here it is, and the four it dropped are not.

### And two functions in one package take the same missing type as an argument

`parseResponse(input, method, eof, maxBody)` has one message and three pieces of context from three
places — the socket, *the caller's own previous request re-encoded as bytes*, and a configuration
nobody in the signature owns. `Asked` and `Limits` name two; `eof` deliberately stays a bare `bool`,
because *the connection has closed* is a reading of the socket at the instant of the call and
wrapping it would say it is data.

`method` is the interesting one. It is the **request**, and `@/packages/http/src/response.wac`'s
`write(r, headOnly)` takes the same fact for the same reason — *the request's method, remembered*.
Two functions in one package, written from opposite ends, both taking a request they have no type
for.

`struct Exchange { Request sent; Incoming got; }` is what both want, and it is not a language gap:
this package's `Request` is a **server**'s parse of an inbound request, and a client's outbound
request is built by `./client.wac` as bytes and never exists as a value. **A package with two halves
that meet only through `u8[]`**, which is a decomposition problem and wants no feature.

> **Verdict:** convention — give the client half a `Request` value and let `read` answer an
> `Exchange`. Settled by: writing it in `@/packages/http`; the language is not involved.

*Done the same day, and the verdict held.* One `Request` now serves both halves, with a `Method`
enum instead of `Bytes`; `read` takes the request that was sent and answers an `Exchange`; `write`
takes it too. **`Asked` and `headOnly` are both deleted** — *which method* is a field, and a caller
cannot pass the wrong one because it does not pass one. A type moved and two parameters removed, and
nothing added to the language.

**And placing `Exchange` found something the entry had not.** It cannot live beside `Request`:
`request.wac` would import `incoming.wac` and `incoming.wac` import it back. A type that pairs two
others must live with one of them or in a third file — and here the choice is made rather than taken,
because **the two halves are not symmetric.** Reading a response needs the request; building a request
needs nothing from a response. So it goes on the side that already depends.

Worth writing down because the *symmetric* case has no answer: two types that genuinely need each
other want mutual imports, and a language without them forces a third file whose only content is the
pair. Nothing here has hit that yet.

*Also found while wiring the barrel:* it re-exported `statusHasBody`, **a function nobody had
written** — the shipped package has one and vision's `response.wac` never did. It is `Status.hasBody()`
now, on the arm, for the same reason `reason()` is; and `Other(c)` has to answer by arithmetic on the
hundreds digit, which is **the one place the open-set escape hatch has to guess.**

## A required field is a property of construction, not of the value

*2026-09-05.* `packages/http/src/outgoing.wac` — the last source in that package nothing here had
predicted anything about — makes `Host` a **parameter** rather than a header, *"because a request
without one is not a message a server has to accept"*. The same package's parser leaves `Host` in the
headers, because a server reads what arrived.

Same fact, two shapes, and neither is wrong: **on the way out it is an obligation and on the way in
it is data.** `@/packages/http/src/outgoing.wac` puts it on the builder — `Draft.host` is a field,
`seal` writes it into the headers, and the parsed `Request` stays uniform.

> **A required field is a property of construction, not of the value.** Once built it is a header
> like any other; before built it is the thing without which there is no value. Put it in the builder
> and the parsed type stays uniform.

Fourth instance of *a value whose guarantee comes from how it was made* — after `Prefix`, `Digest32`
and `headers`' own framing check — and the first where the obligation is a **field** rather than a
whole-collection rule.

### And it showed `Building` is not one type

`@/packages/http/src/headers.wac` split headers into `Building` (push, cannot read) and `Headers`
(read, cannot push), and `Building.done()` runs the check a **parser** needs: at most one
`Content-Length`, not alongside `Transfer-Encoding`. A **writer** needs the opposite check over the
same field list — *none of them at all, because I am about to add them* — and the identical pushes.

So `Building` is not *a headers under construction*; it is *a headers under construction for a
purpose*, and the purpose decides the exit check. Two `done`s rather than two types, because only the
gate differs. Which is a small generalisation of the two-state entry and a real one: **the states are
not `building` and `checked`, they are `building` and `checked against something`.**

> **Verdict:** convention — one builder type, one exit check per purpose. Settled by: writing it,
> which is done. The language is not involved.

### The shipped file states this discipline and does not hold it

Filed as `issues/system/0342a`. `Outgoing.set` accepts any header name and `write` emits every one
the caller pushed *and then adds its own*, so `set("Content-Length", "0")` on a request with a body
puts two on the wire — the input this package's own parser refuses. Latent: `Outgoing` has no
production caller. The file's opening paragraph is right about the rule and the type does not have
it.

## Twenty-one type names are declared twice, and three barrels publish one name from two files

*2026-09-05.* This file has an entry called *Three type names are declared twice, and `union` is the
reason it matters*. Swept it properly:

    exported type names declared in more than one file:  21
    ...of those, inside a single package:                 3 — `http`'s `Incomplete` and `NoHost`,
                                                              `git`'s `Rules`

**The within-package ones are the sharp case, because a barrel then publishes one name twice**, from
two different files, which cannot be right whatever the two types are. Nothing checked it: every name
resolved, so the dangling reader was content.

And one of the three is not a collision at all. `git`'s `Rules` is declared in `status.wac` **and**
`ignore.wac` with the same meaning — *the lowest-precedence ignore rules, parsed* — because two files
in one package each needed the type and each wrote it. One import removes it.

### Two of the twenty-one I created this week, and the checker caught them before I did

`http`'s `NoHost` (`proxy.wac` and `outgoing.wac`, both mine) and `core`'s `Key` against
`std/platform.wac`'s. And a third by a change three files away: `@/packages/server/src/routes.wac`
declared `enum Method { Get, Post, Head, Other }`, `@/packages/http` grew a `Method` the same week,
and `routes.wac` imports `Request` — so `Route.method` and `Request.method` became **two types of one
name with one meaning, in one file**. Both resolved, so nothing said a word.

So the check is now in `scratchpad/dangling.py`: *a barrel publishing one name twice*. It found four
more the moment it ran, all in `http`'s barrel, all from my edits ten minutes earlier — `Request`,
`Response` and `write` from duplicated export lines, and `NeedMore`, where **the rename I had just
made to fix a collision created another one.**

### And chasing that last one found something worth more than the collision

`NeedMore` collided because I had renamed `incoming.wac`'s `Incomplete`. Looking at why it existed:
`read` answered `Result<Exchange, ResponseFault>` and the struct was a leftover that nothing referred
to. Which is the collapse `@/packages/http/src/request.wac`'s `Parsed` exists to refuse, in the same
package, one file away:

> The obvious collapse is `Result<Request?, RequestFault>` with a null meaning *keep reading*, and it
> is exactly the cute encoding `vision/README.md` refuses: two of the three outcomes would share a
> constructor and a caller could handle the failure, forget the null, and quietly treat a partial
> message as a whole one.

`read` answers a three-arm `Received` now, mirroring `Parsed`. **The argument was already written, in
the neighbouring file, and I wrote the `Result` anyway** — and the thing that caught it was a name
count, not the argument.

> **A duplicate name is worth checking for reasons that have nothing to do with names.** It is the
> cheapest signal that two files have solved one problem twice, and in three of the seven cases here
> the second thing found was larger than the first.

### The fourth case, and the second thing was much larger

`BadPublicKey` and `DoesNotVerify` are each declared in **both** `@/packages/bls/src/verify.wac` and
`@/packages/crypto/src/ed25519.wac` — two packages, two shared names, one problem. Both are
`Result<void, XFault> verify(pub, msg, sig)` and both put `DoesNotVerify` in the fault union.

**`DoesNotVerify` is not a fault.** A signature that does not check out is the *answer* to *does this
check out*, so the ordinary result of a verifier arrived through `Err` — and a caller writing
`try verify(…)` propagates **signature invalid** as an error indistinguishable from **this is not a
signature**. For a consensus client those want opposite responses: drop the message, or stop trusting
the peer.

Third instance of *normal but uninteresting is not a fault* after `lightclient`'s `NotRelevant` and
`datetime`'s `LeapSecond`, and the first where conflating the two means something. `ed25519.wac`'s own
doc comment made the argument and then did the other thing — *"the honest answer, and the only one of
the six that is about the signature"*, on a member of the fault union.

`enum Verified { Valid, Invalid }` lives in `@/packages/crypto` and both verifiers answer
`Result<Verified, XFault>`. It also sharpens `bls`'s mutation argument: deleting an infinity guard now
moves the answer from `Err(InfinityPublicKey)` to `Ok(Invalid)` — **across the `Result` boundary**, so
a caller that only wrote `try` notices.

### And it found that eleven packages have no barrel at all

`Verified` had nowhere to be imported from: `crypto` has no `src/crypto.wac`, and every consumer
reaches into its file layout — `@/packages/crypto/src/keccak.wac`, `…/sha256.wac`, `…/digest.wac`,
from three packages.

    packages with no `src/<name>.wac`:  11 of 40
    box, crypto, ens, fs, gzip, page, quic, ssh, tls, wacc, wacpkg

**So the four barrel findings recorded here were all about the 29 that have one.** The other eleven
have the same problem in a worse form: not *a name the barrel forgot*, but **no boundary to forget it
at**. `crypto`'s is written — and writing it forced one judgement a path import never asks for:
`chachaBlock` and `aesEncrypt` are deliberately *not* exported, because a caller who wants a cipher
wants the cipher, and today they are reachable by path with nothing recording that they should not be.

> **Verdict:** convention — a package gets a barrel **when something outside it imports the
> package**, and the export list is where *what this package is for* gets decided. Settled by:
> writing the three that were needed; the language is not involved.

*The verdict said **eleven** when it was written, and that was wrong.* Going to write them found that
**eight of the eleven have no consumer outside the package at all** — so the missing barrel is not a
gap there, it is the absence of a boundary nobody has needed yet, and writing eight export lists
nobody imports is the ceremony this directory argues against everywhere else. I generalised from the
one case (`crypto`) that had consumers.

**And the other two were broken imports that nothing had reported.**

    packages/box/src/gunzip.wac:  import { Fault, SourceFailed, Corrupt } from "@/packages/gzip";
    packages/ssh/src/session.wac: import { Mount, Fault } from "@/packages/fs";

Neither package had a `src/<name>.wac`. They went unseen because the directory's own import checker
**fell back to globbing `src/*.wac`** when a barrel was missing, so a barrel-form import of a
barrel-less package resolved against the union of that package's files. The fallback is removed: a
specifier naming a package means that package's barrel, and nothing else.

> **A lenient resolver hides a missing boundary, which is the one thing a resolver is asked about.**
> The glob was answering *could this name mean anything here*, and the question was *does this name
> mean what it says*.

### And writing `fs`'s barrel found that importing a vocabulary does not publish it

`packages/fs/src/fault.wac` imports the nine fault members from `"std"` and declares `Fault` over
them — so it exported a **type whose arms were not reachable through it**, and the new barrel asked
for them and got nothing.

That is *24 of 29 barrels export a union without its arms* one level down, at a file rather than a
barrel, and the mechanism differs in a way worth keeping: a barrel omits arms by **forgetting** them;
this omitted them because **it never had them to export**. They arrived by `import`, and an import is
not an export.

*Swept for the rest, and there is one:* `@/packages/http/src/proxy.wac`'s `ProxyFault` has
`NotGranted` as an arm, imported from `"std"` and not republished. Fixed. **One hit in 178 files is
the honest size of this finding** — worth naming because a caller cannot match an arm it cannot name,
and not worth more than a sentence, which is what an enumeration is for.

> **Verdict:** convention — one name per exported type per package, checked by a barrel walk.
> Settled by: the check, which is written. The language is not involved.

## The subject belongs at the level where it is not repeated

*2026-09-05.* Three days of *a position is meaningless without the thing it indexes* — 55 values
counted, `@/packages/regex`'s `Span` and `@/packages/ts`'s deleted in favour of `Bytes`, and
`@/packages/json`'s `ParseError` given a slice. `@/packages/wacc/src/lex.wac` is where the arithmetic
goes the other way.

A 4,000-line source is roughly **40,000 tokens**. `Bytes` is `Slice<u8>` — a reference and two `i32`s
— and under wasm GC a struct is a heap object, so a token carrying one is **one allocation per
token**: forty thousand against zero for two lanes of a flat array.

So the rule was right and silent about the thing that decides:

> **The subject belongs at the level where it is not repeated.** A fault is rare, so the fault carries
> it. A `Match` has ten groups and one subject, so either works. A token stream has forty thousand and
> one, so it goes on the stream — `Lexed { Bytes src; Token[] tokens; }`, one field, and every token
> is one `slice` away from being a `Bytes` without paying for a reference.

That also settles a disagreement this directory had with itself. `@/packages/ts/src/token.wac` met the
same flat quintuple, converted it, and called the flat form *a habit by the third occurrence* —
comparing it to `ssz`'s, which had a reason that expired, and `abi`'s, which gave none. **The third
occurrence had a reason and it is not the reason either of the other two had**, which is why counting
occurrences did not find it.

### And what remains is a habit, separately

Two things were merged in the shipped shape and only one is a cost:

  * *a token is five integers with no name* — `tokens[i * 5 + 2]` is a length because a comment says
    so, and seven accessors exist to give five fields names. That **is** the habit, and `Token[]`
    fixes it.
  * *a token holds a span rather than a slice* — the allocation argument, and it stays.

`Token[]` was hedged as *right **if** inline records in arrays exist*, and that hedge was wrong: the
entry above is not open on the point that matters. It says *"never inline structs. There is no third
option at the runtime"*, and `packages/wacc/src/emit.wac` confirms it — a struct element type is
emitted as `0x63`, the **nullable reference** form. So `Token[]` is 40,000 heap objects today, not
conditionally, and the flat `i32[]` is correct rather than merely safe.

**I asked a question this file had already answered, one screen away.** Fifth time this week that the
directory contained its own answer; the tell each time is a claim that names an open entry without
reading it.

### And one runtime limit has two workarounds, of which one has a proposal

The inline-record entry proposes `packed struct Entry { u8 extraBits; u8 nbBits; u16 newState; }`,
lowering to one `i32`. That fits `@/packages/zstd`'s three narrow fields and cannot fit a token's
five, because `start` alone wants a whole word on a file of any size.

    fields narrow enough to share a word   →  a packed struct  →  proposed
    fields that are not                    →  parallel lanes   →  nothing

**Which means some parallel arrays are the workaround for a runtime limit, and this directory has
counted them as a style failure five times.** The five: `@/packages/abi`'s descriptor,
`@/packages/ssz`'s, `@/packages/ts`'s token quintuple, `@/packages/wacc`'s, and `http`'s `Headers`.
The two token tables are high-cardinality and forced; the other three are tens of entries and are
habits. So *five parallel arrays and the fifth is deliberate* was three habits and two forced, and
the count could not tell them apart because **cardinality is what decides and nothing was counting
it.**

### And the proposal that reaches both is one this repository already has, at another scale

`issues/lang/0074` — *values with no identity: tuples, or value structs* — is filed for **locals**. Its
evidence is ChaCha20 at **4.7x** from moving sixteen state words out of a `u32[16]` into locals and
`packages/bls` at −64%, and its crux is a lowering rule: *"the spec text has to say the compiler is
required to keep these in locals."*

The inline-record entry says 0074's answer does not reach an array of a hundred thousand entries, and
it is right about the *lowering*. It is not right about the **declaration**. Both cases need one thing
said once:

    value struct Token { i32 kind; i32 start; i32 len; i32 line; i32 col; }

*This type has no identity.* From that: a local is registers (0074's case), a narrow array element is
a packed word (`@/packages/zstd`'s), and a wide array element is parallel lanes
(`@/packages/wacc/src/lex.wac`'s) — **three lowerings, one property**, chosen by the compiler from the
widths and the context rather than by the author from a table.

> **The two entries were kept apart because they were compared by lowering — locals versus arrays —
> and they agree on the only thing a declaration can say.** A language feature is a promise about
> meaning; *which registers* and *how many lanes* are what a compiler is for.

The honest limit: `tokens[i].kind = k` must write a lane and `Token t = tokens[i]` must materialise
five values with no object behind them. Both follow from *no identity* and neither is free to
implement. What **is** free is stopping the author choosing — today `zstd` writes shifts and masks and
`wacc` writes five lanes, and two hand-written encodings of one idea is the cost the declaration
removes.

> **Verdict:** language — `value struct`, which is `issues/lang/0074` with arrays added to its scope
> rather than a second feature. Settled by: `spec/spec/types.md` saying a type has no identity, and
> the lowering rules following from it. **This entry and 0074 should be one issue**, and the reason
> they are two is that each was filed from the case in front of its author.

### The two unresolved names in that file are the measurement

`packages/wacc` may not import `core` — `wvec.wac` states the rule: the top rung of the bootstrap
cannot read `core/vec.wac`, because its `fold` takes a lambda and that rung has none. So `Bytes` and
`Result` are unavailable to the package whose lexer is the argument above, and the file uses them
anyway and says so. The name checker's floor is 15 rather than 13 for that reason.

> **A package's dependency rule is set by the weakest rung of the thing that builds it**, and the cost
> lands on types that have nothing to do with the constraint — one lambda, in a function this package
> would never call, three files away.

> **Verdict:** convention — put the subject on the collection when the elements outnumber it.
> Settled by: `Lexed`, which is written. The language is not involved.

## `never` is the empty union, and saying so closes three entries

*2026-09-05.* `never` appears in seven places in this directory and none of them says what it **is**.
This file records it as *a type with non-trivial semantics, asserted in one doc comment*. The
semantics is one sentence:

> **`never` is the union of nothing.**

From which, by the subset rule a union needs anyway:

  * *assignable to everything* — `{} ⊆ S` for every `S`. Not a special case in the checker; the
    degenerate case of a rule it already has.
  * *`union<never, E>` reduces to `E`* — `{} ∪ S = S`. This file lists that as an open operation.
  * *`@/packages/wacc/src/genlower.wac`'s `Waiting` arm has to be deleted* — a `match` over
    `Step<never, Y, R>` has two arms because the third's payload type is the empty union and no value
    of it exists.

Three open questions, one definition, and the definition is a sentence rather than a rule.

## What vision's types cost the checker: one clause, and it cannot be a `bool`

`@/packages/wacc/src/check.wac` is about forty lines of the shipped 10,539:
`assignable(C c, string want, string got)`, shared by **26 call sites**.

**The premise I started with was wrong.** The shipped header says a returned name must have the
declared type *exactly*, so I expected `union<A, B>` to be *subtyping added to a language with none*.
It is not. `assignable` already has **five clauses** — nullable widening both ways, nullable-into-base,
struct inheritance, a generic child into a parent, a variant into its enum — and *exactly* is about
rung 3's slice, not the language. Vision adds a clause to a relation that exists.

And every clause there carries the miss it was added for: *"the sweep found it forty times over"*,
*"missed because nothing in the spec corpus assigns a child to a parent"*. **So the cost of a sixth
clause is not the clause; it is that the five before it each took a measured miss to find.**

### The part that is not three lines

`try f()` in a function declared to fail with `E2` is legal exactly when the callee's `E1 ⊆ E2` — the
same relation. When it is not, the checker must say **which member**:

    try: `parseProxy` can fail with `PortNotDigits`, which this function does not declare

`assignable` answers `bool`, and has never needed to say why not, because **none of its five clauses
can fail partially**: a `string` is not an `i32` and there is nothing to enumerate. A union is the
first relation in this language where failure has a **witness**.

> This file already counts *78 `bool` functions collapsing 405 refusals*, of which 17 are
> verifications. A relation is a different case with the same symptom: a verifier throws away *which
> rule refused* and wants an enum; a **relation** throws away *which element* and wants the element.
> `Ty? missingFrom(…)`, not `Reason refused(…)`, and the two look alike.

So `assignable` stays a `bool` and gains a sibling — 26 callers want the predicate and one wants the
witness — and nothing can say the two agree. `missingFrom(c, w, g) is null` **iff**
`assignable(c, w, g)` is a law, the fourth here after `hash`/`eq`, `combine`'s associativity and
`Key`'s.

### And what the clause does not cost

Ordering (subset makes `union<A, B>` and `union<B, A>` the same type), `never` (§above), and the
nullable interaction — `union<A, B>?` falls out because the existing clauses **recurse**. That last
is a property of how that function was written rather than of unions: a cascade of recursing `if`s
composes with a new clause, where a `switch` on a pair of type kinds would have wanted a row per
combination.

### The `Ty`-is-a-string worry was wrong, and the reason gave the answer

The paragraph above first said the checker throws a type tree away, so union subset would mean parsing
`union<A, B>` on every comparison. Both halves are off.

The AST **does** have a tree — `packages/wacc/src/ast.wac` declares `struct Ty` with `Arr(Ty elem)`,
`Nullable(Ty inner)`, `Funcref(Ty ret, Ty[] params)` — and `typeOfTy` renders it to a name **on
purpose**:

> A generic instantiation spells itself. `Box<i32>` and `Box<f64>` are different types and the model
> here is that a type *is* its canonical name, so the name has to carry the arguments … **Invariance
> then costs nothing: two instantiations differ exactly when their names do.**

A model, not a shortcut, and the five clauses live inside it: identity is string equality, and
assignability is a relation over names computed by **asking the context** — `c.isStruct(want)`,
`descendsFrom(c, got, want)` — or by small suffix surgery, `withoutNull`.

So the question is not *tree or string*; it is which of those a new clause needs.

  * `withoutNull` works because `?` is a suffix. A union's members are a **set**, and no surgery on
    `"union<A, B>"` beats parsing it.
  * But a union is **declared**, exactly as a struct is, so the context can hold it.
    `c.unionMembers(name)` is a lookup, and `descendsFrom` is the precedent — four of the five
    existing clauses already ask `c` a question.

**The clause is a lookup, not a parse, and the cost is one table** — the one structs already have.
Canonicalising a union's name (members sorted and deduplicated) then makes equality free as it is for
everything else, and only the subset test consults the table.

What survives from the wrong version is the shape of the lesson: *the cost of a vision feature is
decided by a representation choice made years earlier for another reason.* Still true. It happens the
choice here — a type is its canonical name, and the context answers questions about names — is the
one that makes this cheap rather than the one that makes it expensive, and I assumed the opposite
without reading why the choice was made.

> **Verdict:** language — union subtyping as subset, `never` as the empty union, and a witness form of
> the relation for `try`. Settled by: `spec/spec/types.md` for the meaning, and in
> `packages/wacc/src/check.wac` a sixth clause plus one declaration table.

### The lesson about the instrument

The lesson is narrower than *check your tools* and it is about this session specifically: moving the
census from a regex to a token stream fixed one family of instrument error — strings, comments,
nesting — and I treated that as having fixed them all. **The three that survived were about the
language rather than the lexing**, and a token stream has nothing to say about which identifier is a
union member and which is a `Result` constructor. Same family as *assert the property, not one
spelling*, one level up.

**The honest limit, and why it does not dissolve the number — measured 2026-09-05, and the caveat was
overstated.** *Most bodies here are `{ … }`* is what this said, repeatedly, without counting. Counted:

    function-like declarations in vision:            580
      body `{ … }`:                                  262   (45%)
      body with statements:                          318   (54%)
    files where every function is elided:             23 of 121

**The majority have real bodies.** So *a consumer missing because no bodies exist* is a weaker
defence than it was given, which makes the number below stronger rather than weaker: 318 written
bodies, and almost none of them consumes a fault union. But sixty `match` blocks *are* written, in
the files where a body was written because the body was the argument — and almost none is about a
fault union. So the measure is not *vision has no code*:

> **Where a body was written to make a point, the point was almost never about consuming a fault
> union — and the vocabularies were designed anyway.**

The four exceptions are the shape of the answer. `Decoded` and `Invalid` are matched because
classification is what those two files are about. `FileFault` was matched once, deliberately, to test
the three entries above it, and **the test changed the design**: `cp` needs *is this about the operand
or about the run*, which is not a member and cannot be one, so `policy` takes a `Side` the union
cannot supply.

n=1, and a clean one: the only fault union here that has ever met a consumer turned out to be missing
an axis, and thirty lines of use is how that was found. There is no reason to expect better of the
other thirty. The cheapest next thing this directory could do is not another vocabulary — it is
thirty short callers.

**And it puts a number on the rule above.** *An error type with no exhaustive consumer costs nothing*
was written yesterday about one union. Measured: **129 of 174 members cost nothing, because nothing
reads them, and 8 more are read only as a group.** That is not an argument that they are wrong. It is that nothing here has been in a
position to find out, and five days of design have produced a vocabulary whose cost and benefit are
both still entirely theoretical.
