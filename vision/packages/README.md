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
| `secret` | [`crypto/src/secret.wac`](crypto/src/secret.wac) | `const` is already a taint that propagates; point the machinery at a second property | it would refuse AES, and it inherits `issues/lang/0315a` |
| `Grant` as an enum | [`sh/src/exec.wac`](sh/src/exec.wac) | a caller writes what it means and no `GRANT_ALL` is kept in step by hand | intersecting two lists is a loop where `a & b` is an instruction |

Every one of them has a cost written beside it in its own file, and two of them —`secret` and the
barrel — have a reason **not** to take them yet. That is deliberate: a proposal with no cost stated
has not been thought about, and this exercise is in no position to be believed on enthusiasm.

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

---

| what | written | against |
|---|---|---|
| [core](../core/) | 2026-09-04 | tickets, coroutines, `union`, nested `T?` |
| [std](../std/) | 2026-09-04 | `Sys` as a value, no singleton |
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
