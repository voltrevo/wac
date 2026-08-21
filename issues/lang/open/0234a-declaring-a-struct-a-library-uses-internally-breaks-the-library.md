# 0234a — declaring a struct whose name a library uses internally breaks the library, from one file

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** no error from `check`, and `build` declines a program that is correct

## Reproduction

Two files. `one.wac` declares a struct and never uses it; the entry imports a *function* from it and
also imports a library.

```wac
// one.wac
export struct Arm { i32 x; }
export i32 one() { return 1; }
```

```wac
// agg.wac
import { one } from "./one.wac";
import { dumpTypeErrors } from ".../packages/wacc/src/api.wac";
export i32 main() { return one() + dumpTypeErrors("export i32 g() { return 1; }".toBytes()).len(); }
```

    $ wac check agg.wac
    agg.wac: 19 file(s), no diagnostics

    $ wac build agg.wac -o m
    wacc: cannot emit agg.wac — a call to dumpTypeErrors, declined: a call to checkProgram,
          declined: a call to checkModule, declined: a call to checkExpr, declined: a call to
          typeOfExpr, declined: untyped member

Nothing in `agg.wac` mentions `Arm`. Nothing in the library's *surface* mentions it either — `Arm` is a
struct `packages/wacc/src/ast.wac` declares and `check.wac` uses internally. Deleting the one line
`export struct Arm { i32 x; }` makes the program build.

**So a program can break a library it imports by declaring a name the library uses privately**, and
the compiler says nothing until emission, where the reason is five levels from the cause.

## Which names, measured

The same two-file shape with the struct renamed, against `packages/wacc/src`'s own exports:

| name | result |
|---|---|
| `Arm` | declined — `untyped member` |
| `Param` | declined — `untyped member` |
| `Stmt` | declined — `a type this emitter names only while emitting` |
| `Case` | builds |
| `Expr` | builds |
| `Ty` | builds |
| `Decl` | builds |
| `Method` | builds |
| `Program` | builds |

Three of nine. So it is not "any name the library declares" — something distinguishes these three, and
that is the thing to find. Two hypotheses died on inspection: it is not "appears as a struct field
rather than an enum payload" (`Decl[] decls` is a field and `Decl` builds; `Case[] cases` is a payload
and `Case` builds), and not "the library imports it explicitly" (`emit.wac` imports `Program`, `Expr`
and `Ty` and not `Case`, which cuts across the table both ways).

`Stmt`'s message is the uninformative one — *"a type this emitter names only while emitting"* — which
`emitDeclineFiles`'s own docstring records as having *"cost four wrong guesses in a row"*. So one of
the three cannot currently say what happened even at the leaf.

## Why this is not `issues/lang/0154`, and how they relate

`0154` is the same family and a different mechanism, which is why this is filed separately rather than
appended:

- **0154 is a collision that is *detected*.** `keyAt` sets `env.ambiguous`, the build refuses, and the
  message names the name and — since 2026-08-21 — the files that declare it. Its open question is
  whether the linker should *qualify* instead of refusing.
- **This one is not detected at all.** No ambiguity is flagged; a declaration is chosen and the
  consequence appears as a failed member lookup in a third file. And it takes **one** declaration
  beside the library's, where 0154's shape takes two — so 0154's *"two declarations are the status quo
  and are fine"* does not hold for these three names.

Anyone fixing "the linker guesses" wants this page; anyone deciding "qualify or refuse" wants that one.

## Why it matters more than the file count suggests

Every one of these names is an ordinary word. A program that imports a compiler library and happens to
declare `struct Arm`, `struct Param` or `struct Stmt` — a parser, a formatter, anything in the same
domain — fails to build for a reason that names none of its own code. The workaround (rename your
struct) is only findable once you know the rule, and `wac check` reports the program as clean, so the
first sign is a build that declines something the author did not write.

It is also the strongest argument on the table for `0154`'s qualifying option: a library's internal
type names are currently part of its consumers' namespace whether the library exports them or not.

## Where to look

`Env.keyAt` in `packages/wacc/src/emit.wac` — the two `candidates > 1` sites set `ambiguous`, and the
question is why these three names reach neither, given that a second declaration exists. The
instrument that would answer it in one run rather than by reading: log `(file, name, candidates,
importedCandidates)` for every lookup of the target name, and compare `Arm` against `Case`. Four
hypotheses about this cluster died to two-minute experiments; the fifth should be measured too.

**Two things about building that instrument, learned by trying.**

- **It cannot report through `declineFor`, and the failure is immediate.** A probe that declines when
  `keyAt` is asked for `Arm` cannot be seeded at all: wacc's own source uses `Arm`, so the probe fires
  while the compiler compiles itself and `deno task seed` refuses the result and restores the previous
  seed. Any instrument here has to be conditioned on something other than the name — the entry being
  outside `packages/wacc`, say — or has to accumulate rather than decline, which means a field on
  `Env` and therefore two more slots in its positional constructor.
- **The reproduction cannot be moved in-memory as-is.** A four-source imitation of the shape — a
  library file declaring `struct Arm` with a member read through a second file, plus one unrelated
  declaration and an entry importing both — is clean on `dumpTypeErrorsFiles`, `blockedFiles` and
  `emitDeclineFiles` alike, with and without the collision. So the ingredient is something wacc's real
  19-file graph has and a hand-made library does not, and iterating on this needs `wac build` and a
  reseed per cycle rather than the fast in-process route.

### A fifth hypothesis, also dead: it is not declaration order

Source structs are registered under `Env.declare`'s **key**, and `declare` gives the first declaration
of a name the bare name and every later one `name@<file>`:

```wac
string key = name;
if (taken) { key = name + "@" + numText(f); }
```

`structType` then linear-searches `structNames` for the first match, so whichever file declares `Arm`
first owns the bare `Arm` and the other is only reachable as `Arm@N`. That predicts the outcome should
flip with link order — put the library's import first and the library wins the bare name.

It does not. Both orders fail identically:

    import { dumpTypeErrors } from ".../api.wac";   import { one } from "./one.wac";
    import { one } from "./one.wac";                import { dumpTypeErrors } from ".../api.wac";
    → declined                                      → declined

So the entry's import order is not the link order, or the bare-key ownership is not what the failing
lookup uses. Both are worth checking, and the second is the more interesting: if some path resolves a
type by its bare *name* rather than by the key `keyAt` returns, that path is the defect, and it would
explain why only three of nine names are affected — they would be the ones some code reaches by name.

## Root cause, measured: the name is resolved against a *partial* declaration table

The instrument the section above asks for, built and run. It is gated on the link containing a file
whose path holds `PROBE0234`, which is the only way to instrument a name wacc's own source uses — and
it reports through `declineFor`, so the build stops at the first hit.

**The first and only thing that asks for `Arm` is `parse.wac`, and at that moment `ast.wac` has not
been walked:**

    PROBE0234 asker=5 declCount=13
      decls: {key=Arm exported=y fileIdx=1 path=PROBE0234.wac}
      files: 0=agg.wac 1=PROBE0234.wac 2=…/api.wac 3=…/lex.wac 4=…/diag.wac 5=…/parse.wac
             6=…/ast.wac 7=…/print.wac 8=…/check.wac 9=…/emit.wac …

- the asking file is **5**, `parse.wac`;
- the file that declares the real `Arm` is **6**, `ast.wac` — *after* it in the walk;
- `declCount` is **13**, so the table is a fraction of the program's declarations;
- and the only `Arm` in it is the one from **file 1**, the unrelated declaration, which was walked
  early because the entry imports it first.

So `parse.wac` resolves `Arm` to the wrong struct, and **no ambiguity is detectable** — there is
genuinely one candidate at that moment. That is why this never reaches `0154`'s refusal: the second
declaration does not exist yet.

**And the answer is never revisited.** Re-running the probe gated on `declCount > 40` — after
collection is complete — it does not fire at all: nothing asks `keyAt` for `Arm` again. The first,
partial answer is the final one.

### What makes this a bug rather than a design constraint

The same function already knows about this hazard twice, and handles it twice:

```wac
// The *token*, not the key: the parent may be declared further down this file, so the
// name it resolves to is not known until every struct in the program has been declared.
env.structParentToks[env.structCount] = parentTok;
```

and, a hundred lines later:

```wac
// And the fields, for the same reason and with the same timing: a field written with a name this
// file imported resolves only once the file it came from has been walked.
for (i32 i = 0; i < env.fieldCount; i++) {
  if (env.fieldTys[i] is null) { continue; }
  env.fieldTypes[i] = typeOfTyName(env, src, lexed, env.fieldTys[i]!);
}
```

Parents and struct fields are deferred to a pass that runs once every declaration is in. Whatever
record holds this `Arm` is not in either list — and that is the fix: find it and add it to the same
pass, which is why `Expr`, `Decl`, `Program` and `Method` are unaffected while `Arm`, `Param` and
`Stmt` are not.

**A correction to my own first reading of this**, kept because it is the trap: the probe declines, so
the build stops during collection — which means the first run's evidence looked like "field types are
resolved against a partial table" when the deferred pass three lines below would have corrected them.
The probe short-circuited the pass it was measuring. What survives that correction is the finding
above, which is about a record the deferred pass does *not* touch.
