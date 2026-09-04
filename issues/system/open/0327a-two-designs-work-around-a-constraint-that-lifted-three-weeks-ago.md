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

### The enumeration was short by fourteen, all of them prose

Re-run 2026-09-04 with a wider pattern — `no closures`, `cannot close over`, and
`nominal types and no closures` across `packages/`, `spec/`, `design/`, `docs/`, `tools/`,
`harness/` and `native/`. The nine above were the ones a **source** sweep hits; fourteen more are in
READMEs, an example's header, a test's header and a host's TypeScript, and every one of them is a
sibling of something already corrected:

| where | what it said | verdict |
|---|---|---|
| `packages/fs/README.md` | a funcref cannot capture a filesystem, because there are no closures | the sentence corrected in `src/fs.wac` above, four files away |
| `packages/bytes/README.md` | no closures, so two `Read` declarations cannot convert | the tour §16 correction, uncopied — it is nominal typing |
| `packages/platform/README.md` | no closures, so no adapter can sit between them | same, and the weaker of the two reasons |
| `packages/regex/README.md` | no closures, so wac cannot spell a continuation matcher | spellable now, at an allocation per pattern node; the flat program stays |
| `packages/git/README.md`, `src/pack.wac` | no closures, so a resolver handed in was never an option | the option exists and is still not wanted |
| `packages/sh/README.md`, `test/wac/probe.wac` ×2 | a funcref cannot close over anything | a bare funcref still cannot; `spec/cases/0193` fakes a capability with a lambda |
| `packages/sh/src/exec.wac` ×2 | no closures, so `Fs` cannot be a facade of funcrefs; a funcref cannot reach a shell | the first is this issue's own `packages/fs` finding, restated in another package |
| `packages/wacpkg/src/root.wac` | no closures, so a predicate cannot be passed in | it can, and passing one would put a capability in the resolver — a better reason, now written |
| `packages/platform/host/deno.ts` | "the wac side has no closures — see the note in platform.wac" | that note is one of the three corrected above |

All fourteen corrected, and none of the *conclusions* changed: in every case the design still holds
on a reason that is true. That is the finding, not a bonus — **the wrong premise was load-bearing
nowhere and survived everywhere**, because nothing that runs reads a reason.

The fourteenth, `packages/platform/example/inside.wac`, is corrected by **addition** rather than
replacement, because `insideValue.wac` quotes its sentence in order to answer it. Two design documents —
`design/lang/0001`, `0004`, `0005`, `0009` and `design/system/0001` — are left exactly as written:
they are dated records of what was decided and when, and `design/lang/0002` is the document that
*added* closures. A later sweeper should not reopen them.

**The lesson for the sweep rather than for the code.** A grep over source finds the comment beside
the code and misses the README that argues for it, and the README is what a person reads first. Three
of the fourteen are in the same package as a fix this issue already made. Whatever pattern the next
audit uses, it has to cover prose as a first-class location, not as an afterthought — the same point
`packages/tty/README.md` made the same day from the other end, where a sentence about what the
language cannot do had a five-day shelf life.
