# 0397a — an import alias inside a field's nested generic instance makes a bogus instance the emitter declines

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Read as Chunk, Result, Ticket } from "core";
struct O { string message; }
struct Holder { Ticket<Result<Chunk, O>> t; }
async Result<Chunk, O> next() { await; return Result.Ok(Chunk.End); }
export i32 f() { Holder h = Holder(next()); return h.t.wait()!.isOk() ? 1 : 0; }
```

Expected: 1. Actual: `wacc declined …: a null in a Result<Chunk,O> slot` — the emitter has an instance of
`Ticket` at `T = Result<Chunk,O>`, with the alias unresolved, and `Ticket`'s `T? answer = null` cannot be emitted
because `Result<Chunk,O>` names no type it knows.

## What isolates it

All of these build: the same program with `Read` imported unaliased; a field of `Result<Chunk, O>` (an instance
whose argument is the alias, one level deep); a funcref field returning `Result<Chunk, O>`; a *local* of
`Ticket<Result<Chunk, O>>`; and `type Piece = Chunk;` used in the field instead. So it is a field's type, a generic
instance two levels deep, and an import alias at the inner level.

Field types are resolved twice (`emit.wac`: once as each struct is walked, and again in `resolveStructRefs`, "a
field written with a name this file imported resolves only once the file it came from has been walked"), and the
second pass corrects `fieldTypes` — so the stale spelling reaches the instance list some other way, before or
beside that fix-up. Not found yet.

## Where it bit

`std/platform.wac` imported `Read as Chunk` (its `Grant` enum had a `Read` variant) and its `Input` handle held
`fn<Ticket<Result<Chunk, HostFault>>()>`. `Grant` went with design/system/0013 step 4 and std imports `Read` plainly
now, so nothing in the tree hits this today; the reproduction above still does.

## And the checker

`std/platform.wac` with `type StreamRead = Chunk;` then said *expected Read, found Chunk* for `Result.Ok(c)` where
`c` is a `Chunk` local and the slot a `Result<StreamRead, …>`: the checker reads the `type` alias through to `Read`
and leaves the import alias as `Chunk`, and calls them two types. Not re-tested since std stopped needing the
alias. A neighbouring checker bug — a declaration imported both plainly and under an alias was registered under the
alias, so the declaring file's own unions named a type the importer did not have — is fixed with case 0847, and may
or may not be this one.

## And the static evaluator — 2026-10-24

A third face of one fault: a type imported **only under an alias** is registered under the alias (`renamed`), but a
`type` another file declares is expanded by the static evaluator in *that* file's spelling. So with
`import { NoSpace as @"$gathered_NoSpace" } from "std"`, std's `type OutputFault = union<NoSpace, …>` expanded to a
union naming `NoSpace` and the importer's own type was `$gathered_NoSpace`: *the error `try` passes on does not
fit*. The compiler stopped writing aliases of its own (gathered errors and the program adapter's `OutputClosed`
import plainly now), so only a program that aliases such a type itself still meets it.
