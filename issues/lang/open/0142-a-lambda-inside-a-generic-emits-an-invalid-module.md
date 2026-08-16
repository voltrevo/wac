# 0142 — a lambda inside a generic function emits an invalid module

- **Status:** open — it declines now instead of emitting; **supporting** it is the remaining work
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

## The cheap half is done — 2026-08-16

It declines now:

```
wacc cannot compile … — a lambda inside a generic, which is emitted once per instantiation
```

`findLambdasInProgram` asks `bodyHasLambda` of every *generic* declaration — a yes-or-no run of the
real walk into a throwaway `Env`, so nothing it finds reaches the emitter's tables and there is no
second traversal to disagree with the first — and `frontOf` declines when the answer is yes.

**All three declaration forms**, pinned in `packages/wacc/test/lambda.test.ts`, asserting the message
*names the generic*: "failed to load" was the symptom of the bug and would satisfy a test that only
asked for a refusal. It says to invert itself when instantiation-aware keys land.

The third — a generic **enum**'s method — was missed by the first pass and behaves differently, which
is why it is worth naming. It never emitted an invalid module: a generic enum's *instantiated* methods
are reached by the blocked walk, where a generic function's body is not. So it already declined, with
the ordinary message — *"a lambda (this module has 0 …)"* — which is true, useless, and points nowhere
near the cause. Same guard, same message as the other two now.

Checking the third arm was not luck: two of the day's defects were "the walk does not reach code the
emitter does", so enumerating what the walk visits against what emission emits is the check that
finds them.

**The same enumeration found a fourth position, and that one is now supported rather than declined.**
A module-level constant's initialiser is emitted in `__wac_start`, and the walk visited no
`ConstDecl` at all — so `const fn[i32()] ANSWER = () => 42;` declined with *"this module has 0"*
lambdas. The wanted type is written on the declaration, so it is the same move the `Var` arm makes one
scope down, and it works: `ANSWER` is a lambda now.

That is the enumeration's actual value — three of the four positions it turned up were defects or
gaps, and none of them had a test, because until today nothing in the repository wrote a lambda
anywhere.

Found by reading the walk rather than by a test: nothing in the corpus writes a lambda inside a
generic, because until today nothing in the corpus wrote a lambda at all.
