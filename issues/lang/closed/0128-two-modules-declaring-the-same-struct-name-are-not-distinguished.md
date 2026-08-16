# 0128 — wacc does not distinguish two modules' structs of the same name

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

Three files.

```wac
// a.wac
export struct S { i32 v; }
export i32 takesA(S s) { return s.v; }
```

```wac
// b.wac
export struct S { i32 v; }
export S makeB() { return S(7); }
```

```wac
// main.wac
import { takesA } from "./a.wac";
import { makeB } from "./b.wac";
export i32 confuse() { return takesA(makeB()); }   // b's S handed to a's S
```

Expected: `type mismatch`, which is what the reference answers.

Actual: wacc reports nothing and the module fails to validate —

```
CompileError: Compiling function #0:"confuse" failed: call[0] expected type (ref n…
```

Both shapes were tried: `struct S { i32 v; f64 extra; }` in `b.wac` and the identical
`struct S { i32 v; }`. **Both behave the same** — no diagnostic, invalid wasm — so the checker is
not comparing shapes and getting it wrong, it is not comparing at all. The emitter does distinguish
them, which is why the module refuses to load rather than silently working.

## Why it is loud, and still worth fixing

The failure is a `CompileError` naming a `call[0]` index, so nothing silently corrupts. That puts it
in the same class as `issues/lang/0123` — a missing check whose consequence is an unloadable module
and a message that names neither the call nor the types — rather than in `0127`'s class, where a
wrong answer came back and looked plausible.

Worth doing anyway because the message is useless to whoever hits it: it points at a wasm function
index, and the actual mistake is two imports away, in a name that appears identical in both places.

## Enums have it too — tested 2026-08-14

```wac
// ea.wac                                   // eb.wac
export enum E { A(i32 x), B }               export enum E { A(i32 x), B }
export i32 takesE(E e) { … }                export E makeE() { return E.A(7); }
```

`takesE(makeE())` across the two: reference says `type mismatch`, wacc says nothing and the module
fails to validate with the same `call[0] expected type`. So the enum half of this is **not** fixed —
`packages/wacc/README.md` records a related enum bug as found and fixed, and it was a different one.

## Generics could not be tested this way, and the reason is a lead

The same shape with `export struct Box<T> { T v; }` in two files is declined by the harness before it
reaches a module:

    a call to makeBox, declined: a construction of Box<i32> with 1 of 2 fields

**`Box<T>` has one field in both files.** A count of two matches neither declaration, which is what a
name-keyed table would produce if two same-named generics were merged rather than kept apart — the
same conflation this issue is about, surfacing in the instantiation metadata instead of in a call.

That is a guess from one message and it is worth chasing rather than believing: it may equally be the
bindgen declining for its own reasons and reporting a count from somewhere unrelated. Whoever takes
this should reproduce it without the harness in the way.

## Sized, 2026-08-14 — structural, not a missing comparison

Checked rather than assumed, having mis-sized four other issues today in the other direction.

`assignable(C c, string want, string got)` compares **strings**, and its first line is
`if (want == got) { return true; }`. Two structs named `S` are equal there by construction. But the
comparison is not where the information is lost — it was never present: the struct table is
`string[] structNames` with `structAt(name)` looking names up, and **no column for the declaring
file**. Nothing downstream of that can tell the two apart.

So the fix is one of:

- a `structFile` column beside `structNames`, and a lookup that takes the importing file into
  account; or
- qualified names in the table, which is what `packages/wacc/README.md` means when it says a type
  here *is* its canonical name — and that decision is load-bearing, because it is what lets
  unification be one string comparison instead of a second representation of types.

Either touches `structAt` and its callers. This is the expensive kind of issue, unlike
`issues/lang/0125`, which was cheap because the knowing was already done. Here nothing is.

## Where this has been before

`packages/wacc/README.md` records the same shape, found and fixed for **enums**: *"enums resolved by
name where identity was meant, which only two files declaring the same enum name could expose."*
Structs look like the remaining half of that. Enums were not re-tested here; whoever takes this
should, along with generic instantiations of a same-named generic.

## How it was found

A deliberate hunt for cross-module type identity, chosen because the README above says it has
produced bugs before and because it is invisible to a single-file corpus — the sweep of 10,013
generated programs that rung 3 reports is single-file by construction.

## The rename machinery looks like the fix and is not — 2026-08-15

Still reproduces exactly as filed: reference *"type mismatch: expected S, got S"*, wacc silent, module
declines.

`check.wac` already has a per-file renaming table — `addRename(from, to)` / `c.renamed(name)` — built
for `import { Dup as DupB }`, and `declareModule` runs every declaration and every signature through
it. So the obvious cheap fix is: while declaring an imported file, rename the type names it declares
*itself* to something qualified, and let its recorded signatures carry that.

It works on the reproduction and it is unsound one step out, which is worth writing down so the next
person does not have to find it:

**The renames are keyed by the file being declared, and a type mentioned in that file's signatures may
belong to a different one.** `a.wac` importing `Read` from `core` and returning it records whatever
`c.renamed("Read")` says while *a* is being declared. That is correct today because a's table only
holds a's own declarations — but the moment `core`'s `Read` is itself renamed for a collision, a's
mention of it resolves to the wrong entry. The mechanism has no way to say "this name, as that file
meant it", which is the whole of what is missing.

So the two options in *Sized* stand, and the second is the one that matches the emitter: `emit.wac`
already qualifies — `env.canonType` — which is exactly why the module fails to validate rather than
silently working. The checker is the half that does not.

### A cheaper thing that is not the fix, and is worth its own decision

The emitter knows both canonical types at the call it is emitting. It could decline with a source-level
message — *"S from b.wac where S from a.wac was expected"* — instead of writing a module that fails to
validate with a `call[0]` index. That does not make wacc agree with the reference and does not close
this issue; it converts an unloadable module and a useless message into a compile error naming the
two files, which is most of what the *"why it is loud, and still worth fixing"* section above asks
for.

Not taken here: it is a second place that decides what a type is, and this issue exists because there
is already one too many.

## Where it is, read out of the checker — agent-c, 2026-08-16

Still reproduces: `diagnoseGraphRendered` over the three files above answers **no diagnostics at
all**, against the reference's `type mismatch`.

The checker cannot express the distinction, which is why this is not a missing comparison so much as
a missing *type identity*.

- `C.declareStruct` (`check.wac`) opens with `for (…) if (this.structNames[i] == name) { return; }` —
  a second declaration of a name already present is dropped on the floor. That early return is
  **correct** for the common case, a struct reaching a file twice through re-import, and it is the
  same line that loses b.wac's `S`. So it cannot simply be deleted: the two cases have to be told
  apart, and a bare name cannot tell them apart.
- `C.declareFunc` records `funcReturns[i]` and `funcParamTypes[…]` as **plain type-name strings**.
  `takesA(S)` and `makeB() -> S` therefore both carry `"S"`. Even with both structs registered, the
  signatures that meet at the call site are byte-identical, so no comparison at the call could
  succeed either.

So the fix is a qualified type identity that survives crossing a file — a declaring-file key, or an
identity index the way the emitter already has one — rather than a check to add at the call. The
emitter distinguishes them (`@typeIndex` keys, which is why the module fails to validate rather than
silently working), so the two halves disagree about what a type *is*, and that is the thing to
reconcile.

That also explains the generics note above, and predicts the enum half has the same cause rather than
a parallel one: `enumOf`/`canonType` resolve through the same flat name table.

## Fixed, 2026-08-16

**By synthesising the alias the program did not write.** `spec/cases/0117` is these same two modules
and it works, because there both are imported *with aliases* — and this checker's type identity is a
name, so an alias is exactly what makes two `S` into two types. When neither is imported by name
there is no alias, both land under `S`, the first wins, and the two signatures that meet at the call
are byte-identical.

So `checkFilesWith` now gives a type that arrives only through a signature a per-file synthetic name.
`typeOfTy` already resolves every type name through `renamed`, which is what makes one `addRename`
reach the signatures as well as the declaration; and these names are already `markUnnameable`, so
nothing can write one and it never reaches a diagnostic. The message is the ordinary
*"argument does not match the parameter's type"*, pointing at the argument.

**The condition is the whole of it.** Renaming every such type is wrong and the corpus said so
immediately: `packages/tor` declares `Link` in `link.wac`, `bootstrap.wac` puts it in `Session.link`
without declaring it, and `hsfetch.wac` imports `fetchOverCircuit` without importing `Link` — so a
blanket rename gave the parameter a name the field did not have and reported three working files
(`rung 3: no false alarm`, code 5). A name is renamed only when **another file in the graph also
declares it**, which is what makes it ambiguous in the first place. `typeDeclaredElsewhere` answers
that from the programs already parsed for the whole graph and never parses one itself —
`issues/lang/0133` is why.

**The enum half had the same cause, not a parallel one.** The issue recorded it as untested and
suspected separately; `declareEnum` and `declareStruct` key the same kind of flat name table and
`canonType`/`enumOf` resolve through it, so the one fix covers both. `spec/cases/0186` is the struct
case and `0187` the enum case, both `refused`, and the reference meets both.

**Not covered:** the generics shape, which the issue records as declined by the harness before it
reaches the checker. That is a separate obstacle and is still open ground.
