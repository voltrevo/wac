# 0043 — type-check template bodies, treating type parameters as permissive unknowns

- **Status:** open
- **Claimed by:** agent-a
- **Reported by:** the operator, via agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** not implemented

A generic template is only checked when it is **instantiated**, against substituted types. A
template nobody instantiates is never checked at all, and a mistake in one that has nothing to do
with its type parameters is not reported until someone uses it.

This is Stage D of the generics design, which called it "a middle path worth knowing about" between
checking nothing and adding constraints.

## What it should catch

```wac
struct Vec<T> {
  T[] data;
  i32 n;

  void oops(this) {
    i32 x = "hello";              // checkable now — nothing to do with T
    this.n = this.n + 1;          // checkable now
    this.data.noSuchMethod();     // not checkable — depends on what T is
  }
}
```

The first two are errors at the definition, whatever `T` turns out to be. The third cannot be
decided until `T` is known and must be deferred.

## How

Type-check each template once with its parameters bound to an **opaque type**: one that unifies with
itself and with nothing else, and that permits any operation whose result does not need to be known.
Anything structurally wrong independently of `T` is an error at the definition; anything requiring
`T`'s identity defers to instantiation, exactly as today.

The design's assessment, which still holds: this catches typos in generics nobody has instantiated,
which is most of what constraints would have bought, with none of the machinery.

## What makes it more than a flag

- **Suppressing the errors the mode would spuriously produce.** An opaque `T` fails almost every
  ordinary check — it is not numeric, has no fields, has no methods — so the pass needs a clear rule
  for which diagnostics to withhold rather than a list of exceptions. Getting that wrong in the
  permissive direction wastes the feature; getting it wrong the other way makes valid templates
  unreportable.
- **Errors must not be reported twice.** A template checked at its definition *and* at each
  instantiation would report a genuine `T`-independent mistake once per instantiation. The
  definition-time report should suppress the instantiation-time ones, or they should be
  deduplicated by (file, line, col, message).
- **It interacts with 0042.** That issue may reorder the resolver so identities are known before
  substitution; this pass wants to run on the template, before any substitution, and the two should
  be designed together rather than sequenced by accident.

## Why it is worth doing

Not urgent — no template in the tree is uninstantiated today, so nothing is currently unchecked in
practice. It becomes worth doing as soon as a library exports a generic that its own tests do not
exercise, which is exactly what a container library looks like.

The sharper argument is the one this project keeps relearning: a feature's own tests use whatever is
already in scope, so they exercise the paths the author was already thinking about. Definition-time
checking is the compiler doing that job instead, and it does not get bored.
