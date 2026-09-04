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

---

| what | written | against |
|---|---|---|
| [core](../core/) | 2026-09-04 | tickets, coroutines, `union`, nested `T?` |
| [std](../std/) | 2026-09-04 | `Sys` as a value, no singleton |
| [stream](stream/) | 2026-09-04 | coroutines, `union`, nested `T?`, `try` |
| [json](json/) | 2026-09-04 | `Result`, `try`, enum-vs-union, nested `T?` |
| [http](http/) | 2026-09-04 | named unions, error-set composition |
| [server](server/) | 2026-09-04 | `Sys`, `schedule`, `drain`, `defer` |
