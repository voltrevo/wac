# 0142 — a lambda inside a generic function emits an invalid module

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
T pick<T>(T a, T b) { fn[bool()] first = () => true; return first() ? a : b; }
export i32 f() { return pick(42, 0); }
```

```
Compiling function #1:"pick<i32>" failed: not enough arguments on the stack for local.set (need 1, got 0)
```

The checker accepts it, and the module does not load.

## Why

`findLambdasInProgram` walks a declaration only when it has no type parameters — `Func` and
`StructDecl` both guard on `typeParams.len() == 0`. So a lambda inside a **generic** function or a
generic struct's method is never recorded: no signature, no hoisted function, no entry in the position
table. At the expression site the emitter emits nothing for it, and the surrounding function's stack
is short by one.

**It should at least decline.** `unsupportedExpr` has an arm that refuses a lambda it cannot find, and
that is what makes every other unsupported shape honest — but the blocked walk skips generic bodies
too, so nothing ever asks the question.

## Why the skip is not simply wrong

A generic is emitted **once per instantiation**, so a lambda inside one is not one hoisted function but
*N* — one for each instantiation, each closing over that instantiation's types. And the position key
the walk records — the lambda's line and column — is the **same for every instantiation**, so
`lambdaAtPos` cannot tell them apart. That key is what `issues/lang/0139` and the whole design rest on:

> a line and a column name exactly one expression in a linked program

which stops being true the moment the same expression is emitted more than once.

So this is not a matter of deleting a guard. Either the key gains the instantiation, or lambdas inside
generics stay unsupported.

## The cheap half, which should happen regardless

**Make it decline instead of emitting.** An invalid module is the one outcome worse than an honest
refusal, and `issues/lang/0138` was the same shape: a compiler that accepts a program and then hands
back something that cannot load. The blocked walk covering generic bodies — or the lambda walk
recording generic ones purely so `unsupportedExpr` can find them and refuse — turns this from a defect
into a named limitation.

Found by reading the walk rather than by a test: nothing in the corpus writes a lambda inside a
generic, because until today nothing in the corpus wrote a lambda at all.
