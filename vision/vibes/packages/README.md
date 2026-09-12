# Vision packages

Whole packages rewritten in the language `vision/` proposes, to find out what it is like to write
something real in it rather than ten lines of something.

---

## This code is much less vetted than the examples

`SHOWCASE.md`, `IDIOMS.md` and `TECHNICAL.md` are agreed one entry at a time, and an entry only
lands once it reads the way a wac program should. **Nothing in here has been through that.** It is
written alone, in bulk, at whatever the language looked like that week.

So the traffic is one-way. An entry on the pages may be cited here; **nothing here is evidence for
anything there.** A spelling that appears in this directory has not been agreed just because it
appears a lot — familiarity is exactly how an unvetted spelling would leak into a vetted one, and
this sentence is the thing standing in the way of that.

Read it as a sketch by one person, not as a decision.

## Nothing compiles, with one exception that is the point of the exception

These are `.wac` files and no compiler accepts them. They use features that do not exist —
coroutines, unions, nested nullables, `schedule` — and they will keep using them as more are
proposed. `wac build` on any of them fails, and that is not a bug to fix.

Nothing in the repository walks this directory. `laneRoots` is `packages` and `core`; the Deno
walks root at `packages`, `harness` and `tools`; and `tools/docsOnly.wac` treats everything under
`vision/` as documentation whatever the extension is, so a change here does not make a push look
like a code change.

**`../bench/slicecost.wac` does compile, and runs.** It is not a rewrite; it is a measurement of
today's language standing in for the proposed one, because a `Slice<u8>` compiles to a struct that
can be written today. A proposal whose cost can be measured in the shipped language should be, and
that file is where that goes — by hand, since scheduling it would make this directory code.

## Imports pretend this directory is the root

A file writes `@/packages/bytes/src/buf.wac`, not `@/vision/packages/…`. The code is meant to read
like the thing it proposes rather than carry its own scaffolding in every header, and the
corresponding real package is always at the same path with `vision/` taken off the front.

Where a rewrite needs something from `core` or `std` that does not exist yet, it is written into
[`../core/`](../core/) or `../std/` — mirroring the real layout, where both sit at the repository
root and are imported as `core/vec.wac` and `std/platform.wac` rather than by path.

`../wac.json5` is what makes `@/` resolve to `vision/`. It is empty, which is a valid manifest —
its presence is the whole question `@/` asks.

**And an import naming a file this directory did not write out means the real one, unchanged.** That
is most of them: a rewrite writes the two or three files its argument is about and imports the rest,
so `@/packages/crypto/src/sha256.wac` in `tls` resolves to nothing here and means
`packages/crypto/src/sha256.wac`. Ten imports were in that state on 2026-09-04.

The rule is worth stating because **the same syntax means two different things** depending on whether
the target was rewritten, and nothing said so. It is also checkable, which is the point: a dangling
import is fine when the real file exists one level up and is a typo when it does not. Checking that
found one — `gzip`'s `./bitreader.wac`, a filename invented for a `BitReader` that is a struct inside
the original `inflate.wac` rather than a module beside it.

`vision/` is excluded from the repository's link guard, so this is the check that replaces it, and it
is a script somebody runs rather than a test — nothing walks this directory.

## These are redesigns, not translations

A rewrite is free to change the decomposition, the public surface and the shape of the answers. The
point is what the language makes possible, and holding the old design fixed would hide most of it.
Each package's own README says what changed and why.

## They go stale, and then they go

Vision moves and these do not move with it. Each one records the date it was written and what it
was written against. **One that falls far enough behind is deleted rather than patched** — a
half-updated package is worse than no package, because it reads as current.

## What they are actually for

The value is not the code. It is the list of things that could not be written: a construct the
language has no spelling for, a rule that turns out to be unusable at scale, a hole nobody notices
in ten lines. Each package's README ends with that list, and the real ones become entries in
`../QUESTIONS.md`.

## What twenty of them found, which no one of them could

Ten things recur, and none is in any single package's list.

**The constructs ran out at nine.** Packages one to nine each wanted something the language has no
spelling for. Packages ten to fifteen wanted nothing new — every construct `regex`, `crypto`, `sh`,
`box`, `wacpkg` and `gzip` reached for was already filed or already invented. That is a result, not
an exhaustion: the missing-construct question has been answered as fully as writing more packages
will answer it, and what kept turning up afterwards was measurements. The two findings below that
came after it are both measurements, and one of them is a construct being turned *down*.

**The pull toward `Result` is wrong when the outcomes are peers.** Twice a redesign wanted to
collapse three named cases into `Result<T?, E>`, and twice it was wrong for the same reason.
`http`'s `Parsed` is *complete, refused, not yet* and `regex`'s `Searched` is *found, absent, gave
up* — in both, two outcomes that share a constructor let a caller handle one and silently treat the
other as it. `regex`'s original comment says so in as many words: the budget answer *"is deliberately
not the same answer as 'no match'"*. A `Result` is right when one arm is a failure and wrong when
both arms are answers.

**Three times the right answer was to change nothing, and each was guarded by a comment that read
like a limitation.** `json`'s lazy object index (measured: 32 members and 15 lookups), `Buf`'s
public `len` field and one-byte `reserve`, and `regex`'s flat class arrays — whose comment says *"wac
has no generics-free way to hold a list of structs"* and which turns out to be a layout choice, since
`Vec<Range>` compiles today and would box a struct per range in a matcher's inner loop. **A comment
written in the language of a workaround is worth checking before it is treated as one.**

**`box` was measured and never written, so `Out` had no consumer in code.** Two applets now do:
`echo(Out out, Args a)` against the shipped `echo(Core, Cli, Fs, Args)`, which is the ten-that-never-
touch-`fs` argument in a signature rather than in a count; and `cat(Out, In, Files, Args)`, which
genuinely reads files and is four capabilities becoming four *narrower* ones. Writing `cat` found the
thing a count could not: `Socket.recv` answers a `Read` — `Data | End | Failed` — and `In.read`
answers bare bytes, so *end* is an empty array. A read of zero bytes is end for a file and not yet
for a pipe, and `cat`'s pump cannot tell them apart. Two capabilities in one file, one with a sum and
one with a sentinel, twelve lines apart.

**A projection with one consumer has that consumer's shape, and the second one finds out how.**
`Files` was short by two methods. `Net` is two of the host's nine and both are streams, because its
only consumer was `server`, which listens — and `std/platform.wac`, the file `vision/std` is a
rewrite of, has a paragraph saying exactly why those are the wrong two: *"QUIC needs none of them. A
QUIC server answers many peers from one socket, and a connection is identified by its connection id
rather than by an address."* Short by a **shape** rather than by a method, which is the worse of the
two. The grant does not split, so this is not an argument for an eighth projection — it is an
argument about how the seven were built.

**Nothing in the proposal has a build story, and eighteen packages did not notice.** No vision page
mentions the ladder, a rung or the bootstrap. `bootstrap/README.md` says the constraint in one
sentence — *"every feature beyond what those 37,873 lines use is a feature the rung below has to pay
for too"* — and five rungs stand between a construct landing and `packages/wacc` being allowed to
use it. `wvec.wac` is what one lambda in `core/vec.wac` cost: a second growable list inside the
compiler, still there. The four things wacc's source would reach for first — `Result`, `try`, a
container, a ticket — are four of the things this proposal adds, and landing them does not give them
to the compiler.

**And an audit for second consumers found a rewrite that had missed its own construct.** `T??` had
one — `url/query.wac`, whose header says *"the first place in the tree that needs `T??`"*. Looking
for a second found `json`, which had already been written: `JsonValue? get(key)` collapsed *no such
key* with *this is not an object*, and its doc comment said so without noticing — *"and null for
everything else"*. One is an ordinary optional field; the other means the caller is wrong about the
document's shape. The package where missing-versus-null is most famous had a two-level answer and
wrote one level.

**Every package named its error union `Fault`, which is exactly wrong for the feature unions exist
for.** Three type names are declared twice across the nineteen — `Fault` in `fs` and `gzip`,
`BadMethod` in `gzip` and `http`, `Truncated` in `gzip` and `unicode`. Nominal typing keeps them
distinct and imports are per-file, so nothing breaks; what breaks is *composition*. `union`'s whole
argument is that `http`'s `ResponseFault` is `union<RequestFault, BadStatus>`, an error set built
over another module's — and a program reading a gzipped file over HTTP has three `Fault`s in scope
and no way to write a `match` naming members from two of them. `http` is the only package that named
its union after its subject, and it is the only one that composes.

**A primitive with one consumer is a primitive nobody has composed.** `schedule` had exactly one —
`Sys.drain` — and `wactest`'s `isolate.wac` is the second. The first breaks the second: `drain` says
`schedule this.pending.push` and then drains `this.pending`, so inside a scope that has already
retargeted, it drains the wrong queue, finds it empty and answers zero while the caller's work sits
undrained. The two existing consumers of `schedule` cannot be used together. It also turned up that
`schedule` and `defer` are asking one question — what unwinding does to a scope-scoped side effect —
which two separate entries had been asking separately.

**A proposal tested only on its motivating example is untested, and the parser said so first.**
`secret` had two uses and both were inside the file proposing it. The TLS key schedule is ten arrows
of *secret in, secret out*, and the qualifier has no return position, no field position and no way to
declassify — which `finishedVerify` needs, because a Finished message is a secret turned into bytes
that go on the wire on purpose. The first of the three was found by `specparse` refusing
`export secret u8[] deriveSecret(…)`: the grammar came from the proposal, so the refusal *is* the
proposal answering, and it is the first time the parser has settled a design question rather than a
spelling.

**A package's stated language limitation had half-lifted three weeks earlier.** `packages/fs` is one
concrete type with a mount table because — its own header — dispatch is static *and* "a funcref
cannot capture a filesystem because there are no closures". Measured: the first is true, the second
has been false since lambdas landed on 2026-08-16. The file was created eleven days before that and
last edited a fortnight after it, and `packages/fs/src` contains no lambda anywhere. The design its
header says it wanted is writable today and needs nothing from vision.

That is the seventeenth package and the first whose finding is entirely about the *shipped* language.
It is also the first rewrite written **after** `../GRAMMAR.ebnf` existed, so it is a prediction
rather than a summary — the grammar was not touched, and the one thing it refused was mine:
`fn<async …>`, where `[§wac-async-lambda-slot-9wq4nkz]` says the slot names the ticket. Inventing a
spelling for something that already has one is this directory's oldest habit, seven times before,
and the first time anything caught it.

**Sixty-four failure paths in the largest package answer one bit each, and one of them carries a
reason.** `tor` is 16,291 lines and was counted rather than rewritten. Thirteen result types are
`bool ok` plus payload; 64 refusals collapse into them — eleven of them in one 47-line function
that a *relay* uses to refuse an EXTEND2, where a truncated payload and a duplicated identity are
different facts about the peer. The single exception, `Verdict`, is a sum type written by hand: a
boolean, two integers, a string, and a ternary at the call site testing `stale != ""` as the tag.
Somebody needed two reasons kept apart and built one out of an emptiness test.

**But nobody has complained**, and that is the half worth keeping beside it. `gzip` has a filed
issue about exactly this loss and `tor` has none, so the measurement supports the *demand* and not
the *harm*. Every other finding here is one or the other and this is the first that separates them.

**A proposed type can be declined, and the fifteenth package is the first to do it.** `gzip`'s
window meets `Slice<T>` in the one loop where it loses: a DEFLATE match is 3 to 258 bytes and mostly
short, `../bench/slicecost.wac` prices a fresh view at 2.6 ns on the v8 host, and the shipped `Window` had already
measured the same thing from the other side — wrapping that loop in a `Buf` cost 14-23%. The rule
that falls out is general: **a view for what leaves, indices for what stays.** And taking the copy
out of the one call where a view *does* pay produced a bug — a view of a buffer that is then
compacted in the same call — which is the mirror image of the failure `slice.wac` names. That file's
rule is retention, holding something too long; this is overwriting it too soon, and a view type has
both.

**Authority is per-instance, and per-function authority stops at the module edge.** `sh` found that a
capability cannot cross *into* a spawned child, because a child is a separate instance and a
reference does not cross one. `box` found that it cannot be subdivided *within* a module: 63 applets
all take `(Core, Cli, Fs, Args)` and ten never mention `fs`, because one module has one grant set.
Same fact, opposite directions. Both `SHOWCASE.md` entries about authority describe the inside, and
nothing tells a reader where the inside ends.

**And once, the issue tracker had already priced the construct.** `gzip`'s `issues/system/closed/0102`
withdrew a promise it could not keep and wrote down what a real fix would take: *"every read site
propagates it … threading a status back through every symbol read"*. That is a description of `try`,
written by somebody who was not proposing one. It is the only finding here where the argument for a
vision construct was made in the repository before vision existed — and the honest form of it is
narrow: the issue was decided on whether the work was worth doing, which nothing here touches. The
language changes the price, and the price is what was written down as the obstacle.

## What they propose adding, and where each one lives

Six things were invented rather than found, on the operator's licence to invent according to the
principles. They are scattered across the files that needed them, which is where the argument for
each is; this is the index.

| proposal | where | the argument, in one line | the cost |
|---|---|---|---|
| `Slice<T>` / `Bytes` | [`../core/slice.wac`](../core/slice.wac) | two arguments that must travel together and must not be swapped is a struct — a correctness argument, not a cost one | a view retains the array it was cut from, and a struct is heap-allocated: O(1) allocation for an O(n) copy against `bytes`'s `slice`, but a **loss** against a triple, which allocates nothing — **measured at 2.6 ns a view** in [`../bench/slicecost.wac`](../bench/slicecost.wac), so 45% at an eight-byte call and nothing at a kilobyte |
| an explicit barrel | [`../core/core.wac`](../core/core.wac) | `export` marks what leaves a file; a package needs a second level | lands in `check.wac`'s export table, not the resolver — and wants its own diagnostic, as code 210 did |
| a named type | `export union<A, B> Fault;`, `export Slice<u8> Bytes;` | one form whether the type is a union or an instantiation | distinct type or alias is undecided |
| `try await for` | [`stream`](stream/), [`server`](server/) | a loop over a failing async generator has to say both things | three keywords on one head — but no new lowering: `asyncplan.wac` already states a suspension in a loop, and the desugaring must put the step in the body since a condition may not suspend |
| `secret` | [`crypto/src/secret.wac`](crypto/src/secret.wac) | `const` is already a taint that propagates; point the machinery at a second property — and it is literally the same machinery, a fourth parallel flag array beside `nameConsts` and `nameAliasOnly` | it would refuse AES; and constness is a flag on a *name*, not part of the type, so `0315a`'s five leaks are one fact and `secret` would inherit them by construction |
| `Grant` as an enum | [`sh/src/exec.wac`](sh/src/exec.wac) | a caller writes what it means and no `GRANT_ALL` is kept in step by hand — legibility, not representation | the host decodes grants as `Val::I32`, so a `Vec<Grant>` cannot cross; the wire format stays an integer and the enum puts a conversion in front of it |

Every one has a cost written beside it in its own file, and two — `secret` and the barrel — have a
reason **not** to take them yet.

**All six have now been read against the code that would implement them, and the reading changed
five.** That is the highest-yield thing this exercise has done, and it is worth saying what the
changes were, because they did not point one way:

- **Re-aimed.** A package entry point cannot be a manifest field the resolver reads — `path.wac` has
  no filesystem — so it is a mapping the *reader* supplies, which `Res` already does for git
  dependencies.
- **Split.** Re-export turned out to share nothing with the entry point: it lands in `check.wac`'s
  export table, not in path resolution at all.
- **Weakened, then measured.** A slice is a WasmGC struct and therefore an allocation. *No copy* is
  true, *nothing allocated* was not, and against a `(bytes, lo, hi)` triple — which allocates
  nothing — it is a loss. [`../bench/slicecost.wac`](../bench/slicecost.wac) puts **2.6 ns** on it,
  which is 45% of an eight-byte call and invisible at a kilobyte. The number bounds the cost rather
  than rescuing it: the case stands on not being able to mix one buffer's bounds with another's,
  which is correctness.
- **Weakened.** `Grant` as an enum does not change the wire format: the host decodes `Val::I32`.
  Legibility, not representation.
- **Made structural.** `secret` really is the same machinery as `const` — a flag per name, and
  `nameAliasOnly` is the precedent for a second. But a flag in the scope table is not part of the
  type, which is why `0315a`'s five leaks are one fact, and why `secret` would inherit them by
  construction.
- **Strengthened.** `try await for` needs no new lowering. `asyncplan.wac` is built for a suspension
  inside a loop and says so; what is new is the generator, not the loop.

The pattern: **a proposal argued from how the code reads is about half right, and which half is not
guessable from the outside.** Four of the six were being sold on a benefit that reading disproved,
and the two that survive intact are the two whose argument was already about correctness.

## What has to land before what

Not a plan — an ordering, and every edge below came out of a measurement rather than a preference.
It is the thing none of the individual findings showed, because each was about one change.

**Null-narrowing before *absence is a type*.** `indexOf` answering `i32?` is 734 call sites, 355 of
which test the `-1` explicitly. With narrowing each becomes a test and a name; without it, a test
and an unwrap at every use. Taking the principle first pays for 355 sites twice.

**Null-narrowing before removing `Option`.** `Option` narrows — `case Some(v)` binds the payload —
and `T?` does not. The tree is already 811 nullables to 86 `Option` mentions, so the migration is
nearly done, and the 21 `case Some(v)` arms left are the only sites that would regress. With
narrowing first, removing `Option` is pure subtraction.

**But narrowing itself needs a sweep.** Unwrapping a non-nullable is an error, so the day
`is not null` narrows, every `if (c is not null) { … c! … }` is a redundant unwrap. 1,445 null
tests, 1,730 unwraps. `issues/lang/closed/0029` hit exactly this shape and got away with it because
`rg` found no users of the idiom it broke; this one has thousands.

**`issues/lang/open/0315a` before `secret`.** Constness is a `bool` per name in the checker's scope
table, not part of the type, which is why its five leaks are one fact. A `secret` built the same way
inherits them by construction, and a laundered `secret` is a key in a log line.

**A generic parent before anything ticket-shaped** — *and this ordering is now mostly gone.*
`struct AllOf<T> : Ticket<T[]>` is `expected '{', found '<'` today, and the entry used to list five
users. `AllOf` and `AnyOf` were deleted when `Ticket` became a struct of funcrefs; `SysTicket` never
existed. What is left is `Generator<Y, R> : Coroutine<never, Y, R>` and `AsyncGenerator`, which are
not inheritance at all — they are names for a partial instantiation, written this way because
`typedef` takes no type parameters. So the ordering constraint is real and its subject changed:
**a parameterised type alias before anything coroutine-shaped**, with the generic parent needed only
if that is refused.

**Re-export before the duplicate it is for can go.** `itoa64` and `utoa64` exist twice in library
code because unifying them touches forty import lines, which is why `fmt`'s barrel cannot be
written. `wac-mono 0072` is *closed* and is about `wc`'s counts being `i32`; it names the `itoa64` duplication only as an obstacle to its own fix. Nothing is open for re-export — but `issues/system/open/0325a` is now open for what the duplication has already done: `itoa64` has **five** definitions, and the three outside library code are re-derivations that all get `i64` minimum wrong, returning the sign alone. The ordering argument no longer rests on a count.

The shape worth noticing: **four of the six are orderings where doing the appealing thing first
costs more**, and none of them is visible from the change it constrains. A list of proposals sorted
by how much they improve the language would put *absence is a type* near the top and null-narrowing
nowhere.

## There is a live design note for the async half, and I did not look

`design/lang/0014 — async and await, over the tickets that already exist` is by agent-c **with the
operator**, in progress, step 0 landed 2026-08-30. It has numbered decisions, and vision re-derived
several of them independently:

| `0014` | vision |
|---|---|
| **D2** — `wait` drives its own chain, and nothing else | `Ticket.wait`'s advance loop, worked out from scratch |
| **D3** — `async T`, not `async Pending<T>` | `async i32 f()` answering `Ticket<i32>` |
| **D4** — returning a ticket is allowed and is not flattened | the `Ticket<Ticket<T>>` entry |
| **D5** — `void` becomes usable as a type argument | `Generator<void, void>`, which I flagged as reading oddly |
| **D7** — a chain that cannot advance is an error, not a hang | `wait` answering `Err(Stuck)` |

Agreement on five decisions reached separately is worth something. **What it cost is two entries in
`TECHNICAL.md` that were wrong in ways the note had already settled.** `Ticket<Ticket<T>>` was marked
*Not yet* and is verified working — D4 says so and the compiler agrees. And *returning a ticket from
an `async T` function is an error* was written as a rule, where D4 says *"an earlier draft made this
an error; the mistake it was aimed at is an ordinary return-type mismatch that needs no special
rule"* — and the compiler's diagnostic is word for word the note's.

**The same is true one level down.** `std/platform.wac` already carries a continuation registry with
`off`/`detach`/`run`, and its comments say what vision says: *"this is the only place other code runs
while a program waits"*, *"there is no second stack"*, *"`drain` is written by the program rather
than happening to it"*. Vision's scheduler is not a proposal; it is the shipped design with syntax
over it. That is a better claim than the one the pages make, and a smaller one.

## And the failure mode of the exercise itself

Seven claims that something was missing were wrong, and one claimed a mechanism that does not exist.
Module-level `const`, `trap` with a message, a `static` keyword, a return-type-only type parameter,
string interpolation, `main`'s exit code, `Vec` of structs — all present, all three lines of test
away. `core`'s root does *not* aggregate its files' exports, which I asserted and built an argument
on.

The tool in `tools/visiongrammar.sh` cannot catch this: it reports what today's parser **refuses**,
so inventing syntax is instrumented and believing in an absence is not. What catches it is reading
`spec/spec/grammar.md`, `generics.md` and `strings.md` — and `../GRAMMAR.md` lists which authority
caught which. **The exercise is reliable at finding where a design is awkward and unreliable at
finding whether the thing it wants already exists.** Weigh the two lists differently.

**And there is a one-line root cause.** `spec/` carries **438** tagged claims — the ones checked by
the fence tests, the ones that are true. Before this audit the vision pages cited **none of them**;
the five `[§…]` references now in the tree were all added while correcting something. Every category
of error here follows from that: four entries marked *Not yet* over shipped behaviour, two
contradicting a tagged claim without saying so, seven constructs claimed missing that exist, and one
citation copied from a comment rather than read. A design written beside a tested specification, and
not against it.

## What the parser changed about that

`vision/GRAMMAR.ebnf` and `tools/specparse.ts` landed on 2026-09-04 and moved two of the three
weaknesses above.

**Inventing syntax was already instrumented; now so is inventing a reference.** The parser found
`Found(Match match)` in `regex` — a payload named with a keyword, which parses as nothing and which
no amount of refusal-reporting could see because there was no construct to report. A separate check
over every `import` in `vision/` against every `export` in it (147 names) found `union` being
imported from `"core"` in three files. `union<A, B>` is a type form like `T[]` and `T?`; importing
it is nonsense that reads perfectly well, and it survived because **this directory has never had a
consumer of its own references.**

**And the completeness claim reversed direction.** `GRAMMAR.md` is a list of what today's parser
refuses, derived by subtraction, and a list of absences cannot say it is complete. A grammar that
*accepts* all forty-five files can. That does not make the design right — a recogniser has no
opinion about meaning — but it retires the specific worry that something is being used here that
nobody has written down.

**What is still uninstrumented is the third weakness, and it is the one that mattered most:**
believing a feature is missing when it ships. Seven of those, and the parser is no help — a
construct that already exists parses. The only instrument for it remains reading `spec/`, and the
count of tagged claims cited from these pages has gone from zero to about a dozen, every one added
while correcting something.

---

| what | written | against |
|---|---|---|
| [core](../core/) | 2026-09-04 | tickets, coroutines, `union`, nested `T?` |
| [std](../std/) | 2026-09-04 | `Sys` as a value, no singleton, grouped into projections — and one scheduler across all seven, per `issues/lang/closed/0298c` |
| [stream](stream/) | 2026-09-04 | coroutines, `union`, nested `T?`, `try` |
| [json](json/) | 2026-09-04 | `Result`, `try`, enum-vs-union, nested `T?` |
| [http](http/) | 2026-09-04 | named unions, error-set composition |
| [server](server/) | 2026-09-04 | `Sys`, `schedule`, `drain`, `defer` |
| [url](url/) | 2026-09-04 | nested `T?`, `Result` |
| [wactest](wactest/) | 2026-09-04 | a test's signature, fakes as values |
| [fmt](fmt/) | 2026-09-04 | interpolation as `+`, re-export |
| [unicode](unicode/) | 2026-09-04 | a union instead of two negative markers |
| [bytes](bytes/) | 2026-09-04 | `Bytes` views instead of a copy per call |
| [regex](regex/) | 2026-09-04 | ops as an enum; what to leave alone |
| [crypto](crypto/) | 2026-09-04 | a `secret` qualifier — one proposal, not a rewrite |
| [sh](sh/) | 2026-09-04 | handing authority on, and what cannot cross |
| [box](box/) | 2026-09-04 | 63 signatures measured; where per-function authority stops |
| [wacpkg](wacpkg/) | 2026-09-04 | the two import proposals, against the resolver |
| [gzip](gzip/) | 2026-09-04 | `try` against a closed issue that priced it; a view type declined on a number |
| [tor](tor/) | 2026-09-04 | 16,291 lines counted, not rewritten; 64 failure paths into 13 bits |
| [fs](fs/) | 2026-09-04 | closures instead of a mount table; the first consumer of the `Files` projection |
| [tls](tls/) | 2026-09-04 | the key schedule, as the first consumer `secret` ever had |
| [wactest](wactest/) — [ISOLATION.md](wactest/ISOLATION.md) | 2026-09-04 | test isolation, as the second consumer `schedule` ever had |
| [quic](quic/) | 2026-09-04 | the datagram endpoint, as the second consumer of the `Net` projection |
| [box](box/) — `src/echo.wac`, `src/cat.wac` | 2026-09-04 | two applets, as the first code written against `Out` and `In` |
| [rlp](rlp/) | 2026-09-04 | `try` in place of a sticky error field, and four invented values that are never read |
| [abi](abi/) | 2026-09-04 | a type described as data, where the data is an `i32[]`; `typeLen` disappears |
| [ens](ens/) | 2026-09-04 | the first caller `abi` ever had, and the ceremony it takes to say one type |
| [mpt](mpt/) | 2026-09-04 | `enum Proved { Present, Absent }`; a refinement of an integer, wanted again |
| [bignum](bignum/) | 2026-09-04 | a `const struct`, `u32` shift counts, and a division that answers a `Result` |
| [bls](bls/) | 2026-09-04 | `Fp` and `Canonical` as two types; a one-field wrapper measured at 2.6 ns against 395 |
| [ssz](ssz/) | 2026-09-04 | a flat descriptor chosen for a JS boundary that was deleted on 2026-08-17 |
| [lightclient](lightclient/) | 2026-09-04 | an unobservable check is unobservable *because* the answer is a `bool` |
| [ethrpc](ethrpc/) | 2026-09-04 | the first composition of two rewritten packages, and a fault union across them |
| [datetime](datetime/) | 2026-09-04 | `enum Offset { Utc, Unknown, At(i32) }`; the sixth thing left alone |
| [codec](codec/) | 2026-09-04 | two closed sets spelled as `i32`, holding the same two values |
| [raster](raster/) | 2026-09-04 | `Rect`, `Rgba`, `Tile` — and a value type destructured at the capability |
| [page](page/) | 2026-09-04 | the JSX tree, written to find out what `Page` could not express |
| [tty](tty/) | 2026-09-04 | a mode is a value, and it was one layer too high for the call to be declarable |
| [ssh](ssh/) | 2026-09-04 | a per-session overlay filesystem, as a closure rather than a table |
| [git](git/) | 2026-09-04 | `Change` and `Entry`; the eighth thing left alone, and the first about a capability |
| [wac](wac/) | 2026-09-04 | nine reasons and one empty string; `forCommand` defaults to every grant |
| [wacc](wacc/) | 2026-09-04 | an enum's payload is a struct; the `try` lowering written as the pass |
| [ts](ts/) | 2026-09-04 | source-to-source is viable exactly when the transform only removes |
| [webrtc](webrtc/) | 2026-09-04 | the one value type here that *removes* an operator |
| [zstd](zstd/) | 2026-09-04 | nothing rewritten, and that is the finding |

**This table was 23 rows against 40 packages until 2026-09-04**, and the twenty-one missing were the
ones written after it was last touched — which is what an index maintained by hand does, and is worth
one line here rather than an entry in `../QUESTIONS.md`, because nothing about it is a language
question. Every rewrite from `rlp` onward was missing — half the exercise, in the file that is
supposed to be its index. (`core` and `std` are in the table and are not under `packages/`, which is
right: the column says *what*, not *which package*.)
