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

## What twenty-two subjects found, as patterns rather than as a list

`QUESTIONS.md` is a hundred and four entries and getting longer, which is the exercise working and is not a
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

## Nothing here is checked by anything

No test reads these pages. Nothing here is a fixture, a list some guard walks, or a promise a suite
holds anybody to — an entry can be rewritten, reordered or deleted without running anything, and a
guard that made an edit here fail a build would be the wrong guard.

These pages describe a language rather than a tree. They say nothing about how far along it is,
except to mark an entry **done**.
