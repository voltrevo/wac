# 0023 — `emitCall`'s direct-call branch is unreachable

- **Status:** closed
- **Fixed in:** 6d1625e
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** not implemented (dead code that looks live)

`emitCall` has a branch commented `// Direct function call: funcName(args)`, guarded
by `e.callee.kind === "ident"`. It never runs. The parser calls any `ident(...)` a
*construction*, so an ordinary call to a plain function is emitted by
`emitConstruct`'s fall-through instead.

## Reproduction

Not a wac program — a compiler-side observation. Add to that branch:

```ts
if (name !== "") throw new Error("reached");
```

and the whole suite still passes: 993 tests, 0 failures. Nothing reaches it. Every
call shape was tried — a plain call, a call through a local funcref, an inline
`(C.inc)(c)` method reference, and a call through an element of a funcref array.

Expected: either the branch is reachable, or it is not there.
Actual: it is unreachable, and reads as the obvious place to change call emission.

## Notes

This has already cost time once. While fixing 123ac4c — bare function names being
resolved through a global map, so two files each declaring a private `helper` bound
to the same function — I applied the fix to this branch first, confirmed it changed
nothing, and only then found that the live path is in `emitConstruct`. Anyone
touching call resolution will do the same thing, because this is where you would
look.

Two ways out, and the choice is a design one:

- **Delete it**, and note in `emitConstruct` that it handles calls as well as
  construction. Smallest change; leaves the surprise in the parser.
- **Have the parser distinguish them**, emitting `call` for an `ident(...)` that is
  not a known struct name, so `emitCall` becomes the single place calls are emitted
  and `emitConstruct` only constructs. More invasive, and the parser would need the
  struct names, which it does not currently have — that is presumably why it works
  the way it does.

Whichever, `typeOfExpr`'s `"construct"` case has the same shape and the same reason,
so the two should move together.


## Resolution (agent-a)

Verified dead before removing it, and more thoroughly than reported: a `console.error`
tripwire (a `throw` breaks TypeScript's narrowing further down the function, which is worth
knowing if anyone repeats the experiment) produced **zero** hits across wac's 998 tests
*and* wac-mono's 190, the latter including the wacc parser differential over 61 real files.
So it is not merely untested-by-the-suite; nothing in either repo reaches it.

Took the first option — deleted — for the reason the report implies rather than states: the
second option needs the parser to know struct names, and the parser deciding
construction-versus-call by name would just move the same ambiguity, since a name that is
neither a struct nor a function has to be handled somewhere either way.

What is left in its place is the point of the change: a comment where the branch was,
saying that direct calls are emitted by `emitConstruct` and *why* the parser produces
`construct` for `ident(...)`, plus the specific note that this branch existed, was
unreachable, and cost time during 123ac4c. `emitConstruct`'s comment now says it owns every
direct call rather than describing itself as a fall-through, and `typeOfExpr`'s matching
case is cross-referenced.

No new test. The behaviour the deleted code was reaching for — a bare name meaning what the
calling file says — is already covered by `§wac-samename-private-k9fw3nm` from 123ac4c, and
that is the test that would fail if someone re-added a branch resolving names globally. A
test asserting the *absence* of code would pin the current structure rather than any
behaviour.
