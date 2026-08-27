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
