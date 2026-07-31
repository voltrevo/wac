# 0043 — type-check template bodies, treating type parameters as permissive unknowns

- **Status:** closed
- **Fixed in:** ab9d3b6
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** the operator, via agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-generic-template-check-2wkq7nm`
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


## Resolution (agent-a)

Implemented. Each template is checked once with its parameters bound to a struct that has no fields
and no methods, so `i32 x = "hello"` inside an uninstantiated `Vec<T>` is now an error at the
definition.

Both hazards the issue named turned out to be real, and one more:

**Choosing what to withhold.** Suppression is by name — a diagnostic mentioning a type parameter is
withheld — which is coarse but errs permissive, and a false negative only restores the status quo
while a false positive would make a valid template unreportable. My first attempt also suppressed
anything mentioning `this`, which swallowed most of a method body: `this.n = this.n + "x"` went
unreported. Fixed by registering the template *itself* as a struct entry so `this` resolves, after
which no `this` suppression is needed at all.

**Double reporting.** Real, and worse than predicted: three copies for two instantiations, since the
template pass and each instantiation all report it. Fixed by deduplicating diagnostics on (file,
line, col, message), which is more honest than suppressing the instantiation pass — two
instantiations *can* fail differently and those messages differ. That dedup is general rather than
generics-specific and may quietly improve other cascades.

**Not predicted: a template naming another template.** `struct Wrap<T> { Box<T> inner; ...
this.inner.get() ... }` reported "struct 'Box' has no method 'get'", because `Box<T>` is not a type
until `T` is known. Diagnostics naming any template are therefore deferred too. The cost — a genuine
mistake involving `Box` inside a template is missed — is the same bargain as any `T`-dependent code.

## What would sharpen it

The suppression is textual. A principled version would mark types as opaque in the checker and have
`errAt` consult that, so withholding is a property of the *check* rather than of the message. That is
the part to revisit if this pass ever withholds something it should report; it is written this way
because the coarse version is verifiably safe in the direction that matters.
