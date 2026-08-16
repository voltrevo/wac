# 0138 — a lambda in a program with a large import emits an invalid module

- **Status:** open
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

Two files, differing only in whether a lambda is written:

```wac
// works
import { Cli, Core } from "../packages/platform/src/platform.wac";
export void main(Core core, Cli cli) {
  i32 n = 6;
  cli.write(u8[](48 + n, 10));
}
```

```wac
// invalid
import { Cli, Core } from "../packages/platform/src/platform.wac";
export void main(Core core, Cli cli) {
  fn[i32()] six = () => 6;
  cli.write(u8[](48 + six(), 10));
}
```

The second fails to load:

```
Compiling function #78:"Socket.fromLoopback" failed: expected 1 elem
```

and a capturing variant fails differently:

```
Compiling function #69:"reasonOf" failed: call[0] expected type (ref null 38), found array.new_fixed of type (ref 0)
```

Both name functions that have nothing to do with the lambda, which is the signature of an **index**
being wrong rather than a body being wrong.

## What it is not

- **Not capture.** A non-capturing lambda fails too, differently.
- **Not lambdas alone.** Every lambda test in `packages/wacc/test/lambda.test.ts` passes, and
  `spec/cases/0188`–`0193` all answer correctly. It takes a lambda *and* a module of some size.
- **Not a regression against existing code.** No file in this repository writes a lambda, so rung 4
  (412 files), rung 5 (self-host, byte-identical) and the whole suite are green. This is an
  incomplete feature rather than a break — but it means the feature does not work for the case it
  was built for, since anything real imports `platform`.

## Diagnosed — the layout and the numbering disagree about where lambdas go

Not capture, and not size. `lambdaReportLinked` on the failing program says one lambda, no captures,
nothing promoted — so none of the cell machinery is involved. `packages/std/map` imported alongside a
lambda is fine; `packages/platform` is not.

**The failing function is three chained string comparisons** — `this.peer == "127.0.0.1" || … || …` —
and the module says *"expected 1 elements on the stack for fallthru, found 3"*. Three comparisons,
three values left behind: the calls to the string-equality builtin are landing somewhere that is not a
two-argument function.

The conflict is between two numberings that were consistent before lambdas existed:

- **`assignGlobals` numbers every *registered* function consecutively** — `env.funcIndex[i] = next`
  starting at `cbSigCount`. The nine string builtins (` str_eq`, ` str_concat`, …) are registered by
  `addFunc`, so they are numbered immediately after the user's functions.
- **`emitModule` lays functions out as `count`, then the string helpers**, with
  `memHelperAt = cbSigCount + count + stringHelpers` — and `count` now includes the hoisted lambdas,
  which are emitted immediately after the declared functions.

So with one lambda, ` str_eq` is *numbered* at `cbSigCount + userFuncs` and the byte at that index is
now **the lambda**. Every call to a string builtin lands one function early, which is why the failure
names functions that have nothing to do with the lambda and why it needs a module with strings in it.

## What a fix has to reconcile

Moving the lambdas after the string helpers is not enough on its own: `wrapHelpers = count` and a
wrapper's index is `wrapAt + wi` where `wi` is the function's *emission ordinal*, so anything inserted
between the declared functions and the lambdas has to be accounted for in that mapping too. The
options are to number the lambdas as registered functions like the builtins are, or to keep them last
and make `lambdaFirst` and the wrapper mapping agree on the offset.

Whichever, the check is the same and it is one command: build any program that writes a lambda and
imports `packages/platform`.

## The original lead, kept because it is still true of $cap$N


`Env.sigType` returns `arrayCount + structCount + i`, **computed when it is called**. Anything that
grows `arrayCount` or `structCount` afterwards makes every signature index handed out earlier stale.
`design/lang/0002` records this as the reason the pair struct shares the *signature* table behind a
marker rather than becoming a fourth category:

> a lazily grown table cannot have anything after it, since an index emitted early would move when the
> table grew.

Tier two added two things that do exactly what that paragraph forbids:

- `$cap$N` and `$cell$T` are registered into the **struct** table, in `frontOf`, after
  `collectDeclarations` has already registered signatures. That shifts every signature index taken
  before them — which matches the capturing failure, where a *type* is wrong.
- Hoisted lambdas grow `count`, which moves `wrapAt`, `boundAt` and every helper base after them.
  That is by design and the arithmetic is meant to follow — the `expected 1 elem` failure suggests
  something sized or numbered from a `count` taken at a different moment, which is the thing to look
  for first.

**The fix is probably the one the note already describes for pairs:** put the generated structs in the
signature table behind a marker, so they are last and nothing moves under them. Diagnose before
assuming — `emitDeclineLinked` and `lambdaReportLinked` are exported for this, and the failure is
reproducible in one command.

## Why it is filed rather than fixed

Found at the end of a long session, by building for the *native* host — which is the check that found
it, and which no lambda test performs. Filing it with the diagnosis is worth more than a hasty fix to
index arithmetic that every emitted module depends on.
