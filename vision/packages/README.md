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

## Nothing compiles

These are `.wac` files and no compiler accepts them. They use features that do not exist —
coroutines, unions, nested nullables, `schedule` — and they will keep using them as more are
proposed. `wac build` on any of them fails, and that is not a bug to fix.

Nothing in the repository walks this directory. `laneRoots` is `packages` and `core`; the Deno
walks root at `packages`, `harness` and `tools`; and `tools/docsOnly.wac` treats everything under
`vision/` as documentation whatever the extension is, so a change here does not make a push look
like a code change.

## Imports pretend this directory is the root

A file writes `@/packages/bytes/src/buf.wac`, not `@/vision/packages/…`. The code is meant to read
like the thing it proposes rather than carry its own scaffolding in every header, and the
corresponding real package is always at the same path with `vision/` taken off the front.

Where a rewrite needs something from `core` or `std` that does not exist yet, it is written into
[`../core/`](../core/) or `../std/` — mirroring the real layout, where both sit at the repository
root and are imported as `core/vec.wac` and `std/platform.wac` rather than by path.

`../wac.json5` is what makes `@/` resolve to `vision/`. It is empty, which is a valid manifest —
its presence is the whole question `@/` asks.

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

## What thirteen of them found, which no one of them could

Four things recur, and none is in any single package's list.

**The constructs ran out at nine.** Packages one to nine each wanted something the language has no
spelling for. Packages ten to thirteen wanted nothing new — every construct `regex`, `crypto`, `sh`
and `box` reached for was already filed or already invented. That is a result, not an exhaustion:
the missing-construct question has been answered as fully as writing more packages will answer it,
and what kept turning up afterwards was measurements.

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

**Authority is per-instance, and per-function authority stops at the module edge.** `sh` found that a
capability cannot cross *into* a spawned child, because a child is a separate instance and a
reference does not cross one. `box` found that it cannot be subdivided *within* a module: 63 applets
all take `(Core, Cli, Fs, Args)` and ten never mention `fs`, because one module has one grant set.
Same fact, opposite directions. Both `SHOWCASE.md` entries about authority describe the inside, and
nothing tells a reader where the inside ends.

## What they propose adding, and where each one lives

Six things were invented rather than found, on the operator's licence to invent according to the
principles. They are scattered across the files that needed them, which is where the argument for
each is; this is the index.

| proposal | where | the argument, in one line | the cost |
|---|---|---|---|
| `Slice<T>` / `Bytes` | [`../core/slice.wac`](../core/slice.wac) | two arguments that must travel together and must not be swapped is a struct — a correctness argument, not a cost one | a view retains the array it was cut from, and a struct is heap-allocated: O(1) allocation for an O(n) copy against `bytes`'s `slice`, but a **loss** against a triple, which allocates nothing |
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
- **Weakened.** A slice is a WasmGC struct and therefore an allocation. *No copy* is true, *nothing
  allocated* was not, and against a `(bytes, lo, hi)` triple — which allocates nothing — it is a
  loss. The case stands on not being able to mix one buffer's bounds with another's, which is
  correctness rather than cost.
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

**A generic parent before anything ticket-shaped.** `struct AllOf<T> : Ticket<T[]>` is
`expected '{', found '<'` today. `AllOf`, `AnyOf`, `Generator`, `AsyncGenerator` and `SysTicket` all
need it, so the whole coroutine and ticket design does not parse without it.

**Re-export before the duplicate it is for can go.** `itoa64` and `utoa64` exist twice in library
code because unifying them touches forty import lines, which is why `fmt`'s barrel cannot be
written. `wac-mono 0072` is *closed* and is about `wc`'s counts being `i32`; it names the `itoa64` duplication only as an obstacle to its own fix. Nothing is open for re-export.

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
