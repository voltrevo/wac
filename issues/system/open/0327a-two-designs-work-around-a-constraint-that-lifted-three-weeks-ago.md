# 0327a — two designs work around a constraint that lifted three weeks ago

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design decision
- **Symptom:** none. Both work. That is why nobody has looked.

## What

**Lambdas landed on 2026-08-16** and capture by reference — `spec/cases/0191`, and
`spec/cases/0193 a capability can be faked with lambdas` is named for the consequence. Measured
again on 2026-09-04, alongside the other half of the claim these designs rest on:

    dispatch: static      a Circle in a Shape variable answers 1, not 2
    capture:  works       a lambda reading an enclosing struct, stored in a funcref field,
                          called through it, returns what the captured field says

Two shipped designs are built on the second one being false. Both said so in their own headers,
which is how they were found; the headers are corrected and the designs are not.

### `packages/fs` — the mount table

> wac will not do it: `override` is a source-level check and **dispatch is static** … The language's
> own idiom for varying behaviour is a funcref plus explicit state (`Shell.external` is one), and a
> funcref cannot capture a filesystem because there are no closures.

`fs.wac` was created 2026-08-05, eleven days before lambdas, and last edited 2026-08-30, a fortnight
after. `packages/fs/src` contains no lambda anywhere.

The consequence is that `Fs` branches on a `Backing` enum *inside* every operation, so every
operation knows about every backing and a third one means editing all of them. A mount built as a
struct of funcrefs closing over its backing inverts that — and two things become expressible that
the tag cannot say: a read-only wrapper around any mount, and an empty mount as a value rather than
as a special case of the memory one. `vision/packages/fs` sketches it.

### `packages/sh` — `Cli.capture`

> A shell has to run a program and keep its output, and in wac it cannot do that by handing the
> program a different `Cli`: there are no closures, so a substitute capability has nowhere to put
> what it collected.

`Cli.capture` exists to solve that, and the paragraph above it explains that `Core.log` had to be
captured alongside `write` because thirty applets send output there. A substitute `Cli` whose
`write` is a lambda closing over a `Buf` is writable now, and `spec/cases/0193` is that program.

**This one is the more consequential of the two**, because the workaround is in the *capability
layer* rather than in one package: every host implements `capture`, and it is a second way to
redirect output beside the one the language now has.

## The decision this needs

Not something to quietly change, which is why it is here rather than in a commit.

1. **Leave both.** They work, they are tested, and "the constraint lifted" is not by itself a reason
   to move working code. The strongest version of this: `Cli.capture` is *the host's* answer and a
   lambda-based substitute would be *the program's*, and a capability layer that can capture output
   without the program's cooperation is a different guarantee.
2. **Move `fs` and leave `capture`.** The filesystem is one package with one owner and the change is
   contained; the capability layer is shared and its churn is everyone's.
3. **Move both**, and `Cli.capture` goes — which is `CLAUDE.md`'s rule as written: *"when nothing
   needs a thing, delete it"*, and what would need it is the question above.

There is a fourth thing that is not an option but is a fact: **the comments were the only record.**
Both designs were reasonable when written and neither carried a marker that would fire when the
premise changed. Whatever is decided here, the general form is worth naming — a design justified by
*the language cannot do X* is a design with an expiry date and no alarm on it.

## Done when

`packages/fs` and `packages/sh` either use closures or say, in a comment that is true on the day it
is read, why they do not.

## And the claim is not two sites, it is a genre

Grepping the tree for *"wac has no …"* and *"wac cannot …"* gives about forty distinct sentences.
Most are true — no tuples, no reflection, no traits, no `var`, no fallthrough, no `\x` escape. Nine
were not, and they had already been corrected in three places by whoever happened to be editing
those files (`core/README.md`, `packages/wacc/README.md`, `packages/bytes/src/buf.wac` — the last
says outright *"This said 'wac has no generics' and that has expired"*).

The nine stragglers, all fixed:

| where | said | why it is wrong |
|---|---|---|
| `spec/tour.wac` §15 | `THERE ARE NO CLOSURES`, in capitals | §17 of the same file already said otherwise |
| `spec/tour.wac` §17 | `async` is absent | it ships — `design/lang/0014` |
| `spec/tour.wac` §16, `spec/spec/imports.md` | no closures means two enums cannot convert | true conclusion, gone premise: it is nominal typing |
| `std/platform.wac` ×3 | no closures | one of them was itself a correction that went stale |
| `packages/fs/src/fs.wac` | a funcref cannot capture a filesystem | lambdas capture by reference |
| `packages/wacc/src/lex.wac` ×2 | no generics; no closures | `wvec.wac` is `WVec<T>`, in that directory |
| `packages/wacc/src/check.wac` ×2 | no map and no growable array of structs | `Map<K, V>`, `Vec<T>`, `WVec<T>` |
| `packages/wacc/src/parse.wac` | no closures | the *rung* has none; the language does |
| `packages/git/src/repo.wac` | no hash map | three files in that package import `core` |
| `tools/wac/mutatesample.wac`, `covledger.wac`, `langfuzz.wac` | no closures over a mutable; no growable array | `spec/cases/0194` writes through a captured array |

**Two of them were right about the constraint and wrong about whose it is.** `packages/wacc` really
cannot use `core/vec.wac`, and the reason is in `wvec.wac`'s own header — the top rung of the ladder
must read wacc's whole graph and the rung below has no lambdas. That is a fact about the bootstrap,
and both comments stated it as a fact about wac. A reader who believes the second one carries it
into a package where it is not true, which is how a wrong reason spreads: it is the *reason* that
gets remembered, not the file it was in.

The three in `std/platform.wac` needed `wac task gen:core` and a reseed, since that file is embedded
in the compiler as `coretext.wac`; the four in `packages/wacc/src` needed a reseed of their own.
