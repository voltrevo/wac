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

## Where the corrections already landed

- `spec/tour.wac` said `THERE ARE NO CLOSURES` in capitals in section 15 while section 17, 113 lines
  below, said wacc has them. It also listed `async` as absent. Fixed.
- `spec/spec/imports.md`, `packages/fs/src/fs.wac` and three sites in `std/platform.wac`. Fixed —
  the last three needed `wac task gen:core` and a reseed, since that file is embedded in the
  compiler as `coretext.wac`.
- `core/README.md` and `packages/wacc/README.md` had already been corrected by whoever was editing
  them, which is how the remaining ones stood out.
