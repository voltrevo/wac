# 0122 — wacc's locals have no block scope, so a name outlives the braces it was declared in

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** compile error (a missing one — wacc accepts a program the reference refuses)

## Reproduction

```wac
export void f() { { i32 q = 1; } i32 r = q; }
export void g() { for (i32 i = 0; i < 3; i++) { } i32 r = i; }
```

Expected: `undefined variable 'q'` and `undefined variable 'i'`, which is what the reference answers,
at the use.
Actual: wacc accepts both.

Found by a grid of twenty-six statement-shaped programs against the reference; twenty-three agreed.

## Why it is not a two-line fix

`check.wac`'s locals come from **`declareAll`**, a pre-pass that walks the whole function body and
declares every local before any of it is checked — a `Block` recurses into it, an `If` declares both
arms, a `For` declares its init and its body. There is no scope stack: `clearScope` resets
`nameCount` to `globalCount` between *functions* and nothing narrows it within one.

The pre-pass is why the checker can answer a name's type wherever it appears without ordering the
walk, so removing it is not the fix either. Two shapes that would work:

1. **A high-water mark per block.** Record `nameCount` on entering a block and restore it on leaving.
   Cheap, and wrong with the pre-pass in place, because the pre-pass has already declared the inner
   names by the time the checking walk reaches the outer block — the mark would be taken after they
   exist.
2. **A scope tag per declared name**, written by `declareAll` (which knows the nesting it is
   recursing through) and compared at each use against the path the checking walk is currently on.
   Additive: the name table keeps answering types exactly as it does, and one more array answers "is
   it in scope here".

(2) looks right and is why this is an issue rather than a patch — it is a change to the shape of the
name table, and picking wrong is a rewrite rather than an edit.

## What it costs today

Only diagnostics: a program that relies on the leak is one the reference refuses, so nothing in this
repository can depend on it — the corpus sweep is clean. What is missing is the *error*, on a rule
every C-family programmer expects and a whole class of typos hits (using a loop variable after the
loop). `errUndefinedName` exists and fires; it just cannot see that a name has gone out of scope.

## Adjacent, and deliberately not fixed here

The same grid found wacc **stricter** than the reference in one place: two structs of the same name
in one file is `duplicate name at file scope` here and accepted there. That looks like wacc being
right and is left alone; it is noted so the next person running this grid does not read it as a
regression.
