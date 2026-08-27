# 0276b — an **uncalled** method with its own type parameters breaks a large program

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** the emitter declines a program that does not use the method at all

`design/lang/0010` option C landed and every spec case for it *calls* the method. This is what those
cases cannot see: adding a method with its own letters to a **widely used** generic struct stops
programs compiling that never call it.

## Reproduction

Add `fold` to `core/vec.wac`:

```wac
  U fold<U>(const this, U seed, fn[U(U, T)] f) {
    U acc = seed;
    for (i32 i = 0; i < this.n; i++) { acc = f(acc, this.data[i]); }
    return acc;
  }
```

then `wac task gen:core`, `bash tools/seed.sh`, and:

    $ wac app packages/box/src/box.wac -o /tmp/box
    wacc: cannot emit packages/box/src/box.wac — a value of a type this emitter cannot write: U

`box.wac` never calls `fold`. Its whole use of `Vec` is `push`, `len`, `at` and the like. **29 suite
tests fail on this** — all of `harness/appRun.test.ts` and `packages/box/test/*`, which build an app
and were the only things that did.

## What a probe says

The decline message was extended with the substitution state:

    a value of a type this emitter cannot write: U [subs=0 curInst= curGen=]

**No substitution is in force and no instance is current.** So whatever walks `fold`'s body is
walking the *template's* method, not an instance's — and every `case StructDecl` walk in `emit.wac`
guards on `typeParams.len()`, checked mechanically, so it is not one of those.

## What is ruled out, each by building it

None of these reproduce — all compile and run:

- a local generic struct with an uncalled own-letter method, `fn[U(T)]`;
- the same with `fold`'s exact signature, `U seed` and `fn[U(U, T)]`;
- `core/vec.wac` with `fold`, used through a **project** import for `push`/`len`;
- two instantiations, `Vec<i32>` and `Vec<string>`, plus an `Option<i32>` from `at`;
- `Vec<User>` for a local struct — which with the two above is every instantiation `box` uses.

So it is not the shape of the method, not the import spelling, and not any single instantiation. It
needs the larger graph, and `wac app packages/box/src/box.wac` is the smallest reproduction I have.

## The decline site names this exact case, and says what made it unreachable

`emit.wac`'s `writeValType` — the branch that produces this message — carries a comment about
precisely this shape:

> It reached this function from the signature-table entry of a generic *method* nobody calls —
> `Box<U> map<U>(…)` declared and never called — where `U` is the method's own letter and no
> substitution binds it. … `issues/lang/0173a` removed the entry — the method that mentions it is
> declined where it is registered — so nothing produces such a type any more and **this branch became
> unreachable**.

So this is not a new failure mode; it is an old one whose guard has stopped holding. 0173a's fix was
*not to create a signature-table entry* for such a method. Something in `design/lang/0010` option C
creates one again — the obvious suspects being the entries `registerOneMethodInstance` adds and the
types `registerMethodInstanceTypes` registers, except that `box` instantiates none of them because it
never calls `fold`.

**That is the question to answer first: which signature entry mentioning `U` exists, and who made
it.** The comment says the answer used to be "none", so a count of them is a yes/no rather than a
hunt.

## One leak found and closed, and it is not the only one

A probe listing every **registered signature** containing a bare letter, at the moment of the decline:

    [fn[U(U,Mount)]]  [fn[fn[U(U,Mount)](i32)]]
    [fn[U(U,Inode)]]  [fn[U(U,string)]]  [fn[U(U,Proc)]]  …

Those are `fold`'s funcref *parameter* with `T` substituted per instantiation and `U` left, registered
as signature types — and the wrapper shape beside each. They come from the instance-method
registration in `collectInstances`, which resolves a method's parameter and return types and walks its
body **fifteen lines before** it declines the method for having its own letters. `issues/lang/0173a`
made this branch unreachable by declining such a method; the decline was in the right place and the
naming was earlier.

Resolving nothing for such a method — registering a placeholder entry and declining it at once —
removes every one of those signatures. **And box still fails.** So a `U` reaches `writeValType` by
some route other than a registered signature; a *local* of type `U` in the body is the obvious
candidate, since `fold` opens with `U acc = seed;`.

That change is **not** landed: it fixes a real leak and nothing observable, which is not enough to
justify it on its own. It is written down here so the next attempt starts from it. Note also that the
placeholder's return type cannot be `""` — something asks for it and answers *the return type of
`Vec<Mount>.fold`, which this emitter could not work out* — so `i32` stands in.

## And the sigs survive that fix, which narrows it again

With the placeholder change in — the instance-method registration resolving nothing for an own-letter
method — the same signatures are still registered:

    sig[fn[U(U,Mount)]]  sig[fn[U(i32,U,Mount)]]  sig[fn[fn[U(U,Mount)](i32)]]  …

Three shapes per instantiation: the type itself, a receiver-prefixed form, and `fn[…](i32)` — which is
the **env/pair** shape. That triple is what `registerFuncTypes` produces, and every one of its seven
callers guards on `methods[m].typeParams.len()`, checked mechanically.

So `fn[U(U,Mount)]` is being registered **as a function type in its own right**, not as part of
`fold`'s signature — `fold`'s own would be `fn[U(Vec<Mount>,U,fn[U(U,Mount)])]` and that is not in the
list. The candidate is `env.pairType(…)`, which registers the pair struct for a funcref *type*
wherever one is named as a slot.

**And the last two links are mechanical.** `Env.sigType` **recurses into its own parameter types** —
registering `fn[U(Vec<Mount>,U,fn[U(U,Mount)])]` registers the nested `fn[U(U,Mount)]` by itself — and
`pairEverySignature` then pairs every registered funcref signature, which is the third shape.

So one registration of `fold`'s **own** signature produces all three, and the question collapses to:

> who registers the signature of a method that has its own type parameters?

`registerFuncTypes`'s seven callers all guard against it, and the placeholder change stops the
instance registration resolving its types — and it still happens, so the caller is neither. It is
worth finding by trapping in `sigType` on the first type containing a bare letter — which works, and
fires on `box` — but the **native host gives no frames**, so the trap has to be run under Deno, where
`memory: a-trap-with-no-message-still-has-a-stack` says the function shows three frames down.
`harness/waccBuild.ts` is the way in; `waccArtifacts` needs the file map rather than a path.

**The trap also makes the registration visible where the module still builds**, which is the useful
part: it turns a silent leak into a failure. With it in, none of these trip it — they all build:

- `fold`'s exact shape on a local generic struct, uncalled;
- `core/vec.wac`'s `fold` with one, two, and **six** instantiations, including `Vec<u8[]>`;
- a program with `Option` from `at` beside them;
- a **capability** app (`Core`, `Cli`) using `Vec<string>`, which is the shape `box` is.

So it is not the number of instantiations, not the element types, not capabilities and not bindgen on
their own. Something else about `box`'s graph does it, and the trap plus a Deno host will say what in
one run.

## Where to look next

The probe is the thing to extend, not the reading — three probes settled `issues/lang/0274b` and
reading found none of them. What is missing is **which file** the `U` is in: `blockedFiles(paths,
sources, entry)` returns that list, and the decline currently names only the entry. That, plus the
`subs=0` fact, should be enough.

## What was done instead

`fold` is **not** in `core/vec.wac` — it was added to find this and reverted, so the tree is green and
the feature has no user. `design/lang/0010`'s criterion 1 says so.

That is the honest state and it is worth saying plainly: **option C is implemented and cannot yet be
used on a struct anything else depends on**, which is most of the reason to want it.
