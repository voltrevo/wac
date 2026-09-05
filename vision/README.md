# Vision

What wac is for, what it should read like, and the small decisions already taken.

---

## What wac is for

Systems programming where **authority is a value**: a program does exactly what it was handed and
nothing more, and that is a fact about its type rather than a sandbox around it.

The same module runs in a browser, on Node, on Deno, on wasmtime and natively, without being
rebuilt — so where a program runs stops being something the program knows.

Enough language to write the stack in rather than a program on top of one: the compiler that
compiles it, the shell that runs it, the cryptography that carries it.

Reject cute code that hides bad edge cases. A convenience that does the right thing in the common
case does the wrong thing silently in the rest: `async` does not adopt a ticket the body returned,
`await` does not take a non-ticket, `T?` does not flatten. Each of those is another language being
helpful, and each one turns a mistake into a program that runs.

---

## What is in here

Three tiers of examples, and one page of rules.

**`SHOWCASE.md`** — the examples worth showing first. Each is the best possible spelling of its
behaviour, and each one is a reason to use the language.

**`IDIOMS.md`** — ordinary wac, spelled the way wac spells it. Also the best possible spelling of its
behaviour; none of them is on its own a reason to use the language.

**`TECHNICAL.md`** — one detail of the language per entry, with the outcome shown. Not always the
best way to write the thing: an entry here is written to pin the detail down. Read together these are
meant to be enough to implement the language from.

Add to that one freely. A technical entry is scrutinised for being correct rather than for being
worth showing; the other two tiers are selective and this one is not.

Correct means intended to be correct: that the entry can be implemented sensibly, and that it does
the thing wanted.

**`DECISIONS.md`** — small decisions already taken. One rule each, with enough of the reason that it
can be revisited; a rule without its reason is one nobody can argue with.

**`QUESTIONS.md`** — what is still open. Deliberately loose: no numbering, no fixed shape, nothing
for a guard to walk.

**`GRAMMAR.md`** — where this syntax stops being parseable by the syntax that exists. The odd one
out: it is **generated** rather than agreed. `tools/visiongrammar.sh` runs today's compiler over
every `.wac` under `vision/` and reports where the parser refuses, so it is a diff of two grammars
derived from the code. Delete it and re-run the tool rather than editing it.

**`GRAMMAR.ebnf`** — the same additions as *productions*, patched over `spec/spec/grammar.md`, and
the only thing here that a machine can act on. `tools/specparse.ts` applies it and parses every file
under `vision/` with the result; every one of them does. That is the opposite claim from `GRAMMAR.md`'s,
which is a list of what today's parser refuses: **a list of absences cannot say it is complete, and a
grammar that accepts everything can.** Where the two disagree, this one is checkable and the prose is
the argument for it.

**`bench/`** — the other odd one out, and odd in the opposite direction: it is written in **today's**
language and it runs. A proposal with a runtime cost should have a number rather than an argument,
and where a proposed type compiles to something writable today — `Slice<u8>` to a three-field struct,
`i32?` to a synthesised one-field box that already exists — today's compiler can supply it. Run by
hand; `tools/visiongrammar.sh` skips the directory, since asking where the parser refuses vision
syntax has nothing to say about a file that deliberately does not use any.

An example belongs to one tier at a time and moves between them freely. The line between the first
two is worth showing rather than defining: a server, and an import written from the project root, are
both the best spelling of what they do.

The examples and the decisions have opposite lifecycles, and the difference is not an oversight. **An
example is kept and marked `done` when it lands** — it is a picture of how the language reads, and
that stays true afterwards. **A decisions entry is deleted once it reaches `spec/`** — the
spec is the test, since an implementation can have a bug, and a rule written twice is a rule that
drifts. **A question is deleted once it is answered**, and the answer has to land somewhere first.

## Every shipped package now has a counterpart here

Measured 2026-09-04, after `@/packages/webrtc`: `ls packages` against `ls vision/packages` leaves one
name on each side. `packages/platform` is here as `vision/std`, because a capability surface is not a
package; `vision/packages/page` is here and not there, because it is a consumer written to find out
what `Page` could not express.

That is coverage rather than completeness, and the difference matters. **Three of the forty are
deliberately almost empty** — `zstd` is a note and no code, `tls` is one file of eleven functions,
`webrtc` is two files of eight — because their difficulty is a compression format, a key schedule and
a transport protocol, and a protocol says the same thing in wac that it says anywhere. Reaching that
conclusion three times is itself a result: **the language questions are not evenly distributed over
the code, and they are densest where a package describes its own data.**

Where they are densest, measured by what the rewrites promoted: a descriptor written as a flat table
(`abi`, `ssz`, `ts` — three), a closed set spelled as an integer (`wac`, `abi`, `codec`, `regex`,
`tty`, `webrtc`), a failure spelled as `null` or `bool` — **fourteen packages here declare a fault
union that replaces one**, which is the single most repeated change the exercise made — and two or
more scalars that must agree with no type to pair them (`raster`, `ssz`, `ts`, `webrtc`).

## Eight asks put to one test, and six of the eight changed

Added 2026-09-05. The exercise produces feature requests, and by the fourth day it was producing them
faster than anybody could weigh them. One question turned out to separate the good ones from the rest:

> **Name a caller, and say what it would do differently.**

Thirteen have been through it. **Seven survived — five of them changed under the test — one changed
shape, one was answered outright, three were retired, and one the test could not judge**, and every one of the retirements had been
written into a package file the day before, each costing one grep to check.

| ask | result |
|---|---|
| a fixed-length byte view | **survives, sharpened** — the argument is *arithmetic*, not constructors: `from(12)` on a `Slice<u8, 32>` is statically a `Slice<u8, 20>`, and no entry had said so |
| `try` | **survives, and now measured** — its best counter-argument, two sticky-error latches in `ssh` and `tls`, turns out to be an objection to `Result` *without* `try`; and `core/result.wac` shipped 2026-08-18 with **zero users in `packages/*/src`** across 38 files written since, against **ten hand-written parse-result types in three designs** |
| a private constructor | **changed shape** — file-private helps two of seven types and would force four `crypto` files into one; the ask is a **package**, which wac does not have |
| an overlay for `@/` imports | **retired** — needs a mapping the reader computes, which `Res` already has for git dependencies |
| a `slice` that refuses | **retired** — all three input-driven callers check first and produce a fault carrying numbers; a `null` would be a worse diagnostic |
| an `ordinal()` for enums | **retired** — two of six enums want to index at all, and both are answered by putting the index on the table's own type |
| what `defer` means | **answered** — all five uses want it on every exit including `try`; the trap half is observable in one of five and is a question about `std`, not the language |
| a brace pattern for enum payloads | **survives, narrowed** — six of thirteen arms in the one consumer are served by `(_)` today; the unarguable part is *subset* binding, which is one arm |
| an unqualified variant construction | **survives** — 186 sites in 24 files, and the directory is **split about it by the hour**: the six files that write `Result.Ok` were all created in one thirty-four-minute window and everything after is bare, with no page recording the change |
| a value type to take an operator away | **the test cannot see it** — `tsnBefore`'s ten call sites are all correct and `a < b` was available at every one, so *what would a caller do differently* answers *nothing* for an ask whose whole value is that nobody has been wrong yet |
| a refinement of an integer | **survives, and the compiler already emits one** — `string.fromCodepoint`'s prologue checks the scalar rule and traps, in every compiled module; five other files re-derive the same four comparisons and answer five different ways |
| `==` on a user type |  **survives, and its evidence is self-generated** — six equality methods here against the shipped tree's three, because the shipped tree has almost no value types and compares `u8[]` with a free function; the surface grows with the value types the proposal adds |
| a type for paths | **survives, inverted** — of 77 shipped signatures with a path beside another `string`, the 40 a `Path` separates are pairs nobody confuses and the **37 it cannot** — `rename(from, to)` — are where the mistake is free |

**And the thirteenth row is the boundary rather than a result.** Three asks — a value type to take an
operator away, a type for paths, `codec`'s two alphabet sets — all answer *the caller does nothing
differently*, and all three would be wrong to retire: their value is that the **next** caller cannot
get it wrong. The test cannot distinguish *the caller is currently wrong* from *the caller is
currently right by discipline*, because the answer to *what would it do* is the same. The complement
is cheap and greppable — **is there a comment doing this type's job?** — and `QUESTIONS.md` records
where that marker is present and where it is not.

**The pattern in the retirements is one sentence:** a feature that looks missing from inside one file
usually has a caller that would not use it. All three were argued from the file that wanted them, and
none of the three authors — me — had looked at what the callers do with the failure.

**And the ones that survived did not survive unchanged.** Three of the four got sharper under the
test: the fixed-length ask found its real argument, `try` found that its strongest opposition was
aimed at something else, and the path ask found that the population it was filed for is the half a
`Path` type does not help. So the test is not a filter, it is a second draft — and the path row is
the first where the second draft **contradicts** the first rather than sharpening it.

The rest of `QUESTIONS.md` has **not** been through it. That is the honest state, and it is the
obvious next thing: an entry that has not named a caller is a hypothesis.

**And the test has a prior question nobody had asked**: does anything here use the construct at all?
Counted over the 157 files — `union<…>` in 27, `try` in 22, `gen<…>` in 10, and then a long tail:
`secret` 5, `defer` 4, `never` 3, `schedule` 2, a brace pattern 2, and five constructs with exactly
one user each. **`auto`, tuple types, optional chaining and a `[…]` list literal have none.**

`auto` is the sharpest: `GRAMMAR.md` calls it *"the construct with the widest presence on the vetted
pages and no presence at all in the grammar until now"*, and after five days and forty packages **not
one rewrite reached for it.** The construct that appears most often in the material nobody wrote code
against appears least often in the code.

Two of the four zeros are soft — 80 of the 157 files have an elided body, and `auto` and a list
literal live inside bodies. The other two would appear in signatures and do not.

**And the tuple zero has been explained.** Counted what forty packages wrote *instead*: **64
exported two-field structs with no methods**, the exact population a tuple replaces — and **34 of
the 64 have both fields at the same type**. `BranchTooShort { have, need }`,
`ChecksumMismatch { want, got }`, `TrafficKeys { key, iv }`. As `(i32, i32)` every one loses the only
thing that tells its members apart.

Two of them settle it against each other: `std`'s `WrongSize { want, got }` and `ssz`'s
`BadFirstOffset { got, want }` are the same two fields in opposite orders, both correct, and as
tuples they would be one type. **So the zero is not *nobody needed a pair*** — it is that every pair
here is one whose members must not be confused, which is the property a tuple gives up. Five days
spent finding places where position was the bug, and the construct that makes position the interface
found no takers.

**Optional chaining's zero has the same shape.** `?.` shortens a chain, and `x!.` appears eleven
times in 157 files with **not one instance of two forced links in one expression** — there is no
chain to shorten. Every one of the eleven is a single unwrap after a null test where the absent case
has a specific, non-null consequence: a different value, a fault, an early return. `?.` answers
*something was absent* without saying which link, which is the `bool`-that-answers-several-questions
at expression level — the shape this directory spent five days removing from signatures.

So two of the four zeros are explained and neither is an oversight: **a construct that collapses a
distinction finds no users in code written to preserve distinctions.**

**The other two came apart, and one of them is a limit of this exercise rather than a finding.**
Restricting to the 77 files with no elided body removes the caveat: a `[…]` literal has **nothing to
shorten** — zero inline array constructions — and `auto` has **thirty-two** `Buf out = Buf.create();`
-shaped declarations and appears in none of them.

Thirty-two opportunities and zero uses says nothing about `auto`. It says the rewrites were written
by transcribing shipped files, and the shipped tree has no `auto`. **A construct that only saves
typing cannot be discovered by rewriting** — the method finds what was impossible or wrong, because
those force a change, and a construct that merely reads better leaves the transcription intact. So
its absence here is not evidence.

Four zeros, four causes: the construct is wrong for the opportunity (tuples); the opportunity does
not exist (`?.`); the writer could not have taken it (`auto`); the situation never arises (list
literals). Only the first two are findings.

**And the `auto` excuse was tested.** [`packages/git/example/ignorelint.wac`](packages/git/example/ignorelint.wac)
is a program with no shipped counterpart to transcribe — it reports `.gitignore` rules that can never
match, which `git check-ignore` cannot answer. It reached for `Result`, `try`, a payload-carrying
enum, `Vec`, a bare variant construction and `const` on five parameters. **It did not reach for
`auto`**, and `Rule r = rules.ordered.get(i);` names `Rule` twice.

So *the rewrites inherited a vocabulary* is not the whole reason. The opportunity has been taken
**zero times out of thirty-three** across forty rewrites and one application, and this exercise
cannot say why — only that it will not find out.

Writing that file also produced the sharper half: **naming a shape does not stop a writer producing
it.** `shadowedBy` answers `-1`, in a directory whose entry on *a sentinel drawn from the value's own
range* lists seven, on the day after the seventh was added, in the one file written specifically to
watch for them.

## What twenty-two subjects found, as patterns rather than as a list

`QUESTIONS.md` is **161 entries as of 2026-09-05** and getting longer, which is the exercise working and is not a
document anybody can read to find out what it concluded. This section is that, and it is deliberately
**not an index**: these are findings about how the design behaves under use, and each stays true
after the question it produced is answered and deleted.

Ordered by how often each one turned up.

**0. And the thing they were derived *into* did not survive contact with them.** `Sys` — one value
holding every projection, so that `sys.files` could be a narrowing of something — was measured on
2026-09-04 and had **one user in fifty-nine files**, which took it for `drain`. Sixteen functions
take a projection directly. The narrowing the bundle existed to provide turned out to be what a
parameter list already does, and the queue it was really holding is where `std/platform.wac` had
already put it: on a capability, because *"the scheduler is a value the host builds at start-up and
hands over with the rest"*. It is gone, and the agreed pages still write `sys.readFile(…)` 22 times —
which is the exercise's sharpest single result and the one thing in it nobody here should fix.

**0c. And what a host does when it lacks a capability is unspecified**, which is the whole of the
portability story once the sets turn out not to vary. The two Rust hosts implement exactly the same
fifty `(owner, field)` pairs; the only axis on which they differ is what happens when a program asks
for something not built. A missing capability is a readable value four times and a trap forty-six,
with two comments in two files giving opposite reasons and both being right about different
capabilities. Filed as `issues/system/0330a`, because it is `design/system/0001` D6's question rather
than vision's — but the projections make it harder, since a projection cannot be partly there and
*take your other route* has nowhere to be written.

**0b. And it was derived from a source that does not exist.** The count the grouping rests on —
50 capabilities, then 62 — is a **union across hosts**. `native/src` and `native/v8/src` mention
`Page` zero times; only a browser provides its twelve. The shipped design has a word for that,
*profile*, and says *"only a browser provides it"* at the capability it applies to; nine projections
have no profile, so a signature now says exactly what a program reaches and nothing about where it
can run. `main(Net, Out, Clock, Tasks)` and `page(Out, Page)` look like the same kind of thing.

**0d. And each audit was a cheaper check standing in for a dearer one, three times.** Comparing member
**names** against the host's produced patterns 0b and 1. Comparing **signatures**, later and member by
member, was a different check with its own yield: seven capabilities silently became synchronous,
`Out.write` lost the `bool` that `box`'s `yes` loops on and that is *"the shape every streaming
transform in this repo takes for its sink"*, and `Result`, `Vec` and `Ticket` rename or drop 108
member call sites the migration table has no row for. Comparing the **types they answer** was a third:
`Stat` is three fields where the host's is eight, and two of the five missing make `Files.linkStat`
and `Files.setExecutable` — both added *by the earlier audits* — unable to express what they are for.

**A diff is only as good as the thing it compares**, and each pass compared what was easy to compare.
The order they were run in is also the order of increasing cost, which is why it happened this way.

**A fifth pass greps the prose for history** — *"it used to"*, *"was … until"*, an issue number —
and each hit is a shape that is the way it is because somebody changed it. Fourteen such members in
`std/platform.wac`, and the rewrite reversed, dropped or hollowed out **five**: a bind address, three
`spawn` parameters, argv's byte type, `Socket.closeSend`, and the distinction between a closed pipe
and a full disk. Not five decisions re-litigated — none was read. Over the twenty rewritten packages
it is 767 markers, and the two looked at so far found `Mount` having no mount table and
**`--allow-run` conferring `--allow-env`**, which is a filed issue against the directory's own first
line.

**A fourth pass reads the prose on both sides**, and it is the one that cannot be mechanised: three
hits from the first three capabilities looked at, all of them signatures the earlier passes had
approved. `Ticket.any`'s description contradicted its own code about a tie-break that
`design/system/0001` D12 makes a determinism rule; `Sink` inherited *truncates* and *closing is when
the bytes are on disk* by silence; and **`Net.listen` had dropped the bind address**, which the
shipped design added deliberately after a port-only `listen` made *"the safe configuration not only
unavailable but the one people would assume they already had"*. One parameter fewer is not a missing
member, not a changed return and not an unrepresentable outcome, so nothing before this could see it.

**1. Something derived from a source is narrower than the source, and always in the direction of
whoever consumed it first.** The seven capability projections were argued from a count of the host,
and every one that has been examined was wrong differently — `Files` short by two methods, `Net`
short by a *shape*, `Proc` short by its purpose, standard input with no projection at all, `Clock`
with two of the host's three time capabilities, `Page` with none of twelve. Diffing all 62 host
capabilities against the projections took an afternoon and found four more than nine days of
consumers had — a whole missing group of twelve, the entire streaming half of the filesystem, nine
process capabilities, and two file-permission ones filed under `Cli`. **The check is mechanical and
nobody had run it**, because each gap arrived looking like a surprise rather than like an instance.

The projections went from 38 members to 44 answering it, and 28 host names still have no counterpart
— about ten of those are deliberate renames and the rest is the process half, which nothing has been
written against.

**2. A first consumer finds something, every time, and a construct with no consumer has no
evidence.** `fs` was the first consumer of `Files`; `quic` the second of `Net`; `wactest` the second
of `schedule`, and found that `drain` does not compose with it; `tls` the first outside consumer of
`secret`, and found it has no return position; `within.wac` the first user anywhere of `coroutine`,
and found the bounded wait; `tee` the first of `Files.create`. Against that, six constructs sat in
the grammar for nine days with no user at all, added because they appear on an agreed page — and
`auto`, the most ordinary of them, turns out to have no case: the longest declared type in the tree
is nineteen characters, and the type worth eliding is a *return* type, where `auto` cannot go.

*2026-09-05 adds both halves.* `core/cursor.wac` was written from a **sweep** — `Reader` in five
shipped packages — and its first consumer, `packages/rlp`, disproved one of its own four claims: the
file called `sub(n)` *"the one that makes a length-prefixed format bearable"*, and the first
length-prefixed consumer declined it, because a sub-cursor makes rlp's `ListOverrun` unreachable.
**A sweep says a type is missing and an adoption says which parts of it are** — eleven members
counted, six used, two declined for the format's reasons, three never reached for.

And the second clause inverts. `core/result.wac` shipped 2026-08-18 with **zero users in
`packages/*/src`** across the 38 files written since, while eleven hand-written result types exist in
nine packages. *A construct with no consumer has no evidence* is right about a construct nobody
needed; here the zero **is** the evidence, and what separates the two cases is whether somebody wrote
a replacement instead. Two files written after it landed priced propagation and declined —
`wapyparse.wac`'s errors are a flat `i32[]` and a count, `grants.wac`'s `Parsed` carries a
`string bad`.

**3. A design justified by a limitation outlives the limitation, silently.** `packages/fs` is one
concrete type with a mount table because *"a funcref cannot capture a filesystem because there are no
closures"* — written a fortnight after lambdas landed, and the design its own header says it wanted is
writable today. `secret` is modelled on `const` because the machinery exists, and being a name flag is
exactly what stops it working in return position. Neither had an alarm on it.

**4. A capability that is a pair of calls over hidden state does not survive being a value, and the
tree already knows.** `openInput`/`readChunk`/`closeFeed`, `openOutput`/`outputError`/`closeFeed`,
`pushChild`/`popChild`. One of the three has already been given a value —
`packages/platform/src/frame.wac`, made possible by closures — and the other two have not, which is why `tee` buffers a pipe
that `tee` exists to stand in the middle of. The cost of the third is written down in three separate
files and filed against none of them.

**5. Copying a shape reproduces its holes; projecting one does not remove them.** `In.read` said
*end* with an empty array because `readStdin` does, and that was a hole copied rather than invented.
The other direction: `tee -a` cannot be written, and that is not the projection's fault — `openOut`
truncates deliberately and the host has no append, so a faithful projection reproduces a real gap.
Telling those two apart is most of what reading these packages is for.

**6. A question can be dissolved rather than answered, and the reframe is worth more than either
answer.** *Does a capability say end with a sum or a sentinel* had a defensible answer on each side.
Making `In` a stream made the question stop existing, because a generator ending is the loop ending —
and both earlier answers had been arguing inside the wrong frame. Two entries in `QUESTIONS.md` were
merged into one by that, rather than one of them winning.

## The largest thing this directory has not done

*2026-09-05.* Thirty-seven unions are declared here, carrying 174 members between them. Counted on
`tools/specparse.ts --tokens`, after three bugs in the counting script — see below:

    discriminated — some `match` covers the members:      7  —   37 members
    reached as a group — one arm names the union itself:  1  —    8 members
    neither:                                             29  —  129 members

Sixty `match` blocks exist, so this is not *no bodies were written* — bodies are written wherever the
body is the argument. It is that almost none of them consumes a fault union. Every vocabulary this
directory is pleased with is in the twenty-nine: `RequestFault` (10 members), `ProofFault` (10 in `mpt`),
`UpdateFault` (9), `Corrupt` (8), `TimeFault` (8), `AbiFault` (7), `RlpFault` (7).

The one that met a consumer changed shape the same day. `FileFault`'s only caller is
[`packages/box/src/cp.wac`](packages/box/src/cp.wac), written to test three entries in
`QUESTIONS.md`, and it needs *is this fault about the operand or about the run* — which is not a
member, cannot be one, and had not come up in five days of designing members.

So the honest summary of the error-handling work here is that its cost and its benefit are both still
theoretical, and the cheapest way to change that is short callers rather than another vocabulary.
`QUESTIONS.md` has the measurement and the caveats.

### Five of them written, four predictions made, two falsified

`RequestFault` (10 members), `UpdateFault` (9), `TimeFault` (8, three callers), `CodecFault` (5, two)
and `PageFault` (3, two). Each caller was preceded by a written prediction, and two of the four were
wrong — *`CodecFault` has one kind of caller* and *a fault union earns its members when more than one
kind of caller exists*, both falsified by files written to test them.

What came out is a taxonomy of **why a member earns its place**, and it is falsifiable:

| mechanism | the question the members answer | can the union carry the answer? |
|---|---|---|
| **recovery** | a value exists — hand it over or not? | yes, it is a property of the member |
| **response** | what outward artefact does this become? | yes, a status code is a fact about the fault |
| **provenance** | did this program produce the thing that failed? | **no, ever** — it is a fact about the call site |

Three of the five callers had to supply their axis by hand, and all three were provenance. So:

> A fault union is **half** of an error design. The other half is a per-caller table over the
> members, and it is the half nothing here can express: all five files write it as a `match`
> returning an enum, which is a lookup table spelled as control flow.

The decode unions split cleanly on the first row — `NotADigit` and `ShortGroup` are **structural**,
there are no bytes, and every caller refuses; `BadPadding` and `NonZeroTail` are **canonicality**, the
bytes are there, and that is where callers disagree. `RlpFault` and `TimeFault` partition the same
way once you look for it.

**Published first as 4 of 29 and 117 members, which was wrong three ways over.** The script keyed
unions by name, so eight collided away — two packages both declare `Fault`. It knew only the arm
spelling `Member:` and not `Err(is Member):`, which is the grouped-by-type match six READMEs here
argue for and one file uses. And it counted `Ok` and `Err` as arm labels, so the subset test failed
for every union reached through a `Result` — which is all of them, making the first count
structurally biased rather than merely noisy. Moving from regex to a token stream removed one family
of instrument error and I assumed it had removed them all; the three that remained were about the
*language*, not the lexing.

## Not one fault in this directory can render itself

*2026-09-05.* Swept for scalars that are half of a pair, after finding two of them a day apart:

    structs carrying a position:                     62
      ...that also carry the thing it indexes:        7   — six of them cursors
      ...that do not:                                55
        ...and the name says it is a fault:          35

> **A cursor is built to be read from, so it holds both halves. A fault is built to be raised, so it
> holds only the half the raiser had in a local variable.**

The consequence shows up in every diagnostic function here, five of five: `say(string path,
FileFault f)`, `say(string name, ArgFault f)`, `say(const Rules rules, const Finding f)`,
`say(string what, Invalid why)`, `say(const Blame b, BundleFault f)`. Each takes the fault **plus the
thing it is about**, because `at: 47` cannot be drawn as a caret under a line without the text.

Four entries in [`QUESTIONS.md`](QUESTIONS.md) had recorded *paired values with nothing holding the
pair* separately. They are one shape with 35 instances.

## How much of this is written out

*Measured 2026-09-05, because *most bodies are elided* had been asserted here for a week without a
count.*

    function-like declarations:            580
      body `{ … }`:                        262   (45%)
      body with statements:                318   (54%)
    files where every function is elided:   23 of 121

A body written `{ … }` means *the same as the original, not repeated here* — it is not a stub. So the
directory is a little over half written out, and the elisions cluster: 23 files are entirely
signatures, and they are the ones whose argument is about a **type** rather than about what a function
does — `core/map.wac`, `crypto/src/sha256.wac`, `datetime/src/civil.wac`.

It matters because it is the caveat attached to most measurements here. *Nothing consumes these
unions because nothing has bodies* is the objection to
[the 129 unread union members](QUESTIONS.md), and at 54% written it is a weaker objection than it was
given credit for.

## What the list is, measured

*2026-09-05.* The product of this directory is the *What could not be written* sections. Counted for
the first time:

    371 items, in 118 files.  Median 3 per file, max 11.

**Four have been tested this week by attempting them, and all four turned out writable** —
`Map.create`'s contradiction, `regex`'s `Span`, `ts`'s `blank(from, to)`, and `headers`' two states.
Each left a smaller residue that *was* real. But those four were chosen because they looked
writable, so the rate says nothing about the list.

So five were taken mechanically — every 74th — and read:

| # | item | what it is |
|---|---|---|
| 1 | *An abstract method has no spelling* | **a language gap**, and measured: a subtype that never overrides a trapping method draws no diagnostic |
| 75 | *`Alphabet.digit(v)` takes an `i32` in `0 .. 2^bits` and nothing says so* | **a language gap** — an integer refinement, already a named recurring ask |
| 149 | *`render` walks from the start of the document to count lines* | **a design note.** O(n) per fault; the line table that fixes it is writable and nobody wrote it |
| 223 | *Nothing about how a grant list crosses* | **an undecided mechanism.** Three open questions about serialisation, named before anyone picks |
| 297 | *`effectivePort` wants `this.port ?? defaultPort(…)` and wac has no `??`* | **a language gap**, verified: no coalescing operator anywhere, and the twelve `??` in this tree are all the `T??` type |

**Three of five are what the heading claims. Two are not** — one is a performance observation and one
is a design question — and they read identically because they share a heading.

Five is a small sample and the split may not hold. What is certain is that the list is **not one
kind of thing**, and a reader treating all 371 as *the language cannot express this* would be wrong
about a meaningful fraction. The fix is not to prune it: a design note and an undecided mechanism are
both worth having. It is that they want different headings, because *cannot* and *did not* and *have
not decided* are three different asks of whoever reads this.

## Nothing here is checked by anything

No test reads these pages. Nothing here is a fixture, a list some guard walks, or a promise a suite
holds anybody to — an entry can be rewritten, reordered or deleted without running anything, and a
guard that made an edit here fail a build would be the wrong guard.

These pages describe a language rather than a tree. They say nothing about how far along it is,
except to mark an entry **done**.
