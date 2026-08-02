# 0061 — enum variants should be qualified rather than file-scope names

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** missing feature
- **Symptom:** compile error

`spec/spec/enums.md` makes a variant name a file-scope name, so two enums in one file cannot share
a variant and a variant cannot share a name with a struct or function:

```wac
enum Shape { Circle(f64 r) }
enum Hole  { Circle(f64 r) }   // error: duplicate name 'Circle'
```

`[§enum-variant-name-collision]` pins it. This asks for the alternative the spec considers and
rejects: variants reachable only as `Shape.Circle`, with no file-scope name.

## The spec's argument, and why I think it comes out the wrong way

> The alternative — variants reachable only as `Shape.Circle`, with no file-scope name — would
> avoid the collision and keep an enum of seventeen variants from claiming seventeen names. It is
> rejected because a variant would then not be a type, and being able to write `Circle c` is worth
> more than the namespace saved.

The benefit is real — `f64 direct(Circle c)` compiles today, and narrowing a payload to its own
type is worth having. But **it does not depend on the file-scope name.** `Shape.Circle c` in type
position keeps every bit of it, at the cost of nine characters, and qualified type names are
already the spelling used to construct one. The trade the spec describes is between the collision
and the feature; it is really between the collision and a longer spelling.

The other half of the justification is that the file-scope name "is what lets it be used as a
type", and separately that bare names work in `match` arms. Match does not need it either: an arm
is always in the context of the subject's type, which the compiler knows, so `case Circle(r):`
can resolve against `Shape` without `Circle` existing anywhere else. Swift resolves `.circle` this
way and Rust requires the qualification precisely because it has no such context.

## What it costs in practice

Measured across this repo's consumer, `wac-mono`, at 21 enums and 112 variants:

| variant | enums wanting it |
|---|---|
| `Ok` | 7 |
| `Bad` | 5 |
| `Incomplete` | 5 |
| `If`, `While`, `For`, `Named`, `Unknown`, `Match`, `Malformed` | 2 each |

Seven enums want `Ok`. They coexist only because they are in seven different files, and nothing
records that as a constraint. The largest enum claims 18 file-scope names.

Two consequences follow, and the second is the one that worries me:

**Good variant names are generic**, and they are generic *because* construction is already
qualified. `Status.Ok`, `Verdict.Ok` and `Opened.Ok` all read correctly at the point of use. The
namespace pressure is therefore highest exactly where the naming is best.

**The rule is per-file, so it couples name resolution to file layout.** Merging two files that
each compile can produce a collision in code neither changed, and splitting a file can silently
resolve one. Every other reason to merge or split a file is unrelated to naming, so this shows up
as a surprise during a refactor rather than at the point of the decision. wac-mono has ten pairs
waiting for exactly that.

## Reproduction

```wac
export enum Status { Ok, Bad }
export enum Verdict { Ok, Unknown }   // error: duplicate name 'Ok'
```

Expected: both declared, used as `Status.Ok` and `Verdict.Ok`.
Actual: `duplicate name 'Ok'`.

## Notes

Not a small change: it is a spec decision with a pinned test, and 21 enums plus their match arms
in wac-mono would need the qualified form in type position. Worth saying that plainly rather than
filing it as a defect — the current behaviour is deliberate, documented and argued for, and this
is a disagreement about the trade rather than a report that something is broken.

If the collision is kept, the error message could carry the reason. `duplicate name 'Ok'` does not
say that an enum variant is a file-scope name, and the second time it happens the reader is
looking for a struct they did not write.
