# fs — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/fs`: 3,087 lines, of which `src/fs.wac` is 1,511. Two files are
written out — [`src/mount.wac`](src/mount.wac), which is the whole argument, and
[`src/fault.wac`](src/fault.wac).

---

## Why this one, and it is not the reason I expected

`fs` is the only consumer the `Files` projection in [`../../std/platform.wac`](../../std/platform.wac)
has ever had. Splitting `Sys` into seven groups was argued from a count of the host's fifty
capabilities and from `box`'s applets, and never once written against. A filesystem is the case that
should pay for it, so that was the plan.

It does pay for it, in one line: `Mount.onHost(Files files)` where the shipped `Fs.onHost(Cli cli, …)`
takes a capability that can open a socket. That is the whole of it, and it is a smaller result than
the one the package's own header handed over.

## The header names a language limitation, and half of it has lifted

`packages/fs/src/fs.wac` opens by explaining why it is one concrete type with a mount table rather
than an abstract filesystem with two implementations:

> wac will not do it: `override` is a source-level check and **dispatch is static** — a `Circle` in a
> `Shape` variable answers `Shape.name()` — so a base-typed `Fs` would always run the base's bodies.
> The language's own idiom for varying behaviour is a funcref plus explicit state (`Shell.external`
> is one), and **a funcref cannot capture a filesystem because there are no closures**.

Both measured, 2026-09-04:

    dispatch: static      a Circle in a Shape variable answers 1, not 2
    capture:  works       a lambda reading an enclosing struct, stored in a funcref field,
                          called through it, returns what the captured field says

**The first holds. The second is out of date.** Lambdas landed 2026-08-16 — `spec/cases/0188` and
eleven cases after it, with `0191 a lambda captures by reference` settling this one. `fs.wac` was
created 2026-08-05, when the sentence was true, and last edited 2026-08-30, a fortnight after it
stopped being. **`packages/fs/src` contains no lambda anywhere.**

So the mount table is a workaround for a constraint that half-lifted three weeks ago, and the design
its own header says it wanted — *"a funcref plus explicit state"* — is writable today with the state
*captured* rather than explicit. That needs nothing from vision at all.

## What the closure buys, concretely

The shipped `Fs` branches on a `Backing` enum inside every operation, so every operation knows about
every backing and a third one means editing all of them. A `Mount` of funcrefs inverts that: a
backing is built once, in one place, and the operations do not know how many exist.

Two things fall out that the tag cannot express:

- **`Mount.readOnly(inner)` is three lines.** Shipped, read-only is a `bool` on the mount that eight
  operations each have to remember to check; here it is a wrapper, and an operation that forgot
  would have to be written to forget.
- **`Mount.empty()` is a mount.** The sealed session's filesystem stops being a special case of the
  memory backing and becomes a value like any other.

The cost is a funcref field per operation per mount against one tag for all of them, and a call that
is not inlined. A `readFile` is microseconds and
[`../../bench/slicecost.wac`](../../bench/slicecost.wac) puts a per-call indirection at nanoseconds,
so this is squarely the case where that trade is right — which is worth saying because `gzip`'s
window is squarely the case where it is not, and the two are in the same directory.

## And the closure removes a predicate the tag forced into the public surface

Added 2026-09-04, after `vision/std` grew `Files.open`. The shipped `Fs` has no streaming read and
its own comment says why:

> The one thing a caller needs to know to choose how to read: the host has a streaming capability —
> `openInput` redirects standard input to a file and `readChunk` pulls it a piece at a time, so a
> large file on disk never has to be held whole — and this filesystem does not. A memory image is
> already in memory, so reading a node whole costs nothing it has not already paid, and there is
> nothing to stream *from*.
>
> Exposed rather than a `read` method that decides, because the decision is about which capability
> the caller may use afterwards, and only the caller knows what it is going to do with it.

So `isHostPath` is public, and **every caller that wants to stream has to branch on the backing** —
which is the tag problem this package's whole argument is about, surfacing in the API rather than
inside an operation. A `Mount` of funcrefs cannot have it: `open` is a field, a host mount fills it
with the streaming capability, and a memory mount fills it with a lambda that yields its bytes as one
chunk. The caller gets an `AsyncGenerator` either way and never learns which it got.

The second paragraph is the interesting half, because it is an honest defence of the predicate and it
is answering the wrong question. *Only the caller knows what it is going to do with it* is true, and
what the caller does with it is **choose an implementation** — which is the one thing a capability is
supposed to have already chosen.

(**Two doc comments are stacked above `isPlainHost` and the first one belongs to `isHostPath`**,
fifty lines below, which has none. Somebody inserted a method between a comment and its function.
Not fixed here for the same reason `../json`'s misnumbered issue reference is not: `packages/fs/src`
is in the seed app's graph, so a comment move stales every agent's seed, which is out of proportion
to a comment. It should ride along with the next real change to that file.)

## Ten integer codes, and the one that does not belong

The other half is `Change` and `FileResult`: a `bool ok`, an `i32 fault`, a `string message`, and ten
`FAULT_*` functions returning small integers. [`src/fault.wac`](src/fault.wac) is that as a union,
and the argument is narrower than *unions are nicer*.

`FAULT_NONE` is the tenth constant and it is the one that should not exist. It names the **absence**
of a fault and shares a type with every fault, so `c.fault == FAULT_NONE()` is the shape of every
caller and `c.fault == FAULT_DENIED()` with the sense inverted is a bug nothing catches. In a
`Result` the absence is `Ok`, a different arm of a different type, and the comparison cannot be
written.

The members also carry what an integer cannot: `NotFound` takes the path, `Denied` takes the path
and what was attempted, `Other` takes the host's own words — which is what the `string message`
sitting beside the integer has always been for, unattached to the code it explains.

**Worth reading beside [`../tor`](../tor/).** `tor` has 64 refusals collapsing into 13 booleans and
one reason in 16,291 lines: nobody could afford to say why. `fs` says why ten different ways and
cannot make the compiler check any of it. One package gave up on reasons; the other has reasons no
type can hold. Same gap, opposite symptoms, and neither package would describe itself as having a
problem.

## This one was a test of the grammar, and it passed

Every rewrite before this was written before `../../GRAMMAR.ebnf` existed, so *"all forty-five vision
files parse"* was circular — the grammar was fitted to the files. These two were written after it and
**the grammar was not touched**, which makes them a prediction rather than a summary.

It refused exactly one thing, and the refusal was right. The `Mount` fields were written
`fn<async Result<Bytes, Fault>(string)>`, and `async` is a property of a definition rather than part
of a type: `[§wac-async-lambda-slot-9wq4nkz]` says *"a lambda writes no return type, so
`fn[Pending<R>(…)]` is what permits `async` and names `R`"*. The slot is written as the ticket.

That is this directory's oldest habit — inventing a spelling for something that already has one,
seven times before — and **the first time anything caught it.** The other seven survived into a
README and were found by reading the spec weeks later.

## What could not be written

**`fn<Ticket<Result<Bytes, Fault>>(string)>` is three constructors deep to say *reads a path, may
fail*,** and there are six of them in one struct. Correct, checkable, and unreadable. The `async`
spelling I reached for by mistake is what a reader wants and it means something else. Promoted to
[`../../QUESTIONS.md`](../../QUESTIONS.md).

**Whether a `Mount` should be a struct of funcrefs or a struct with one funcref returning a variant.**
Six fields is six words per mount and six lambdas per constructor, and every constructor here writes
all six even when four of them are the same refusal. `Mount.empty()` is six lambdas to say *no*. A
single `fn<Ticket<Reply>(Request)>` would be one field and one lambda with a `match` inside — which
is a syscall interface, and is either the honest shape of a filesystem or a step backwards into
stringly-typed dispatch. Not decidable from one package.

**Path normalisation stayed where it was.** The shipped header says paths arrive already normalised
because `packages/sh`'s `resolve` does it before any capability boundary, and *"this relies on that
rather than repeating it"*. That is a cross-package invariant held by a comment, and neither the
shipped design nor this one can state it in a type. A `Path` distinct from `string` would — and
would touch every caller in the tree, which is why it is a note here rather than a proposal.

**The `Files` projection was missing two of the fourteen**, and now has eight. `rename` and
`linkStat` are in the host's capability set and in the shipped `Fs` and were not in `vision/std`'s
`Files`, because the six were chosen from what the earlier packages happened to need — exactly the
failure mode a first real consumer exists to find. Added.

Eight is still not fourteen, and that is the part worth keeping rather than the fix: **a projection
assembled from its callers is sized by who came first**, and one consumer later it is still that. The
honest version of the projection argument is not *these are the file capabilities* but *these are the
ones somebody has needed so far*, and nothing in `vision/std` says which of the two it is claiming.
