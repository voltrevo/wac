# 0142 — a lambda inside a generic function emits an invalid module

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-c
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

### The real obstacle is an ordering conflict — read out of the emitter, 2026-08-17

Giving the key an instantiation needs the instantiation *set*, and at walk time it is incomplete.
`Env.instantiate` is called from two places, both lazy: `typeOfTyName`, when a type is named — so
instantiations mentioned in *declarations* are known early — and `genericCallInstance`, at a **call
site**. The second is discovered by the fixpoint `instDirty` drives, which is `settleEmittable`, and
that runs **after** the lambda walk.

It has to run after it, because `settleEmittable` asks `unsupportedExpr` whether each function is
emittable, and that question is answered out of the tables the walk fills. So:

- the walk must precede `settleEmittable`, or nothing can decide whether a lambda is supported;
- the walk must follow `settleEmittable`, or it cannot know every instantiation.

That is the conflict, and it is more specific than "the key collides". The shape of a way out is
already in the tree: the decline path does **not** use the walk's tables — `bodyHasLambda` is a
separate cheap pass that answers yes-or-no. So a split is available — a presence pass before
`settleEmittable` for the refusals, and the real recording pass after it, once instantiations have
settled and before `declTypes` is taken in `emitModule`. There is a window between those two points
and nothing occupies it.

Whether that split is worth its complexity is the decision. It is written down here so the next
attempt starts from the conflict rather than rediscovering it.

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

## The recorded ordering conflict does not survive a measurement — 2026-08-17, agent-c

**Read the section above sceptically before building anything on it.** It says the walk must follow
`settleEmittable` because that is the fixpoint `instDirty` drives, and therefore where instantiations
discovered at call sites arrive. That is wrong twice:

- The fixpoint `instDirty` drives is **`collectInstances`** (`emit.wac`, the round loop that leaves on
  `!env.instDirty && !env.instBuilt`), not `settleEmittable`.
- `collectInstances` is called at the end of **`collectDeclarations`**, which runs at the top of
  `emitModuleOfWith` — *before* `assignGlobals`, and before `findLambdasInProgram`.

So the instantiation set is already settled when the lambda walk runs, and the window the section
proposes building does not need to be built: the walk can key by instantiation where it already is.

Measured rather than re-read: a probe recording `env.instCount` either side of `settleEmittable`, on a
program whose generic is named only at call sites nested three deep, declines if the two differ. It
did not fire. **One program, and one shape of program** — a wider sweep is the thing to do before
relying on this, and the probe is four lines either side of the `settleEmittable` call.

The other half of the section stands and is the actual work: `lambdaAtPos` keys on line and column,
which name one expression per *template* rather than per instantiation. `Env.curInst` is the
discriminator and is already maintained by `pushSubstitution`/`popSubstitution`, so a `lambdaInst[]`
beside `lambdaLine[]`/`lambdaCol[]` would need no change at any of the three call sites — the method
can read `curInst` itself. What still needs care is that a lambda inside a generic becomes *N* hoisted
functions and *N* capture structs, all of which must be registered before `declTypes` is taken.

**The cost is now concrete rather than hypothetical.** `packages/platform/src/frame.wac` wants one
`Pending<T> ready<T>(T value)` and has three copies of it — `readyI32`, `readyBytes`, `readyString` —
because a lambda inside a generic is declined. Every capability in this repository answers through
`Pending`, so the next substitute will want a fourth.

## Closed: supported, once per instantiation — 2026-08-17, agent-c

A lambda inside a generic is emitted now, one hoisted function per instantiation. Four pieces:

- **The key gained the instantiation.** `Env.curInst` already existed and is maintained by
  `pushSubstitution`, so recording it beside the line and column makes the walk and emission agree on
  a three-part key with no second traversal — and *no call site of `lambdaAtPos` changed*, because the
  method reads `curInst` itself.
- **The walk runs twice**, before the emittability fixpoint and after it, skipping instantiations it
  has already recorded. `lambdasRecordedFor` is the guard, and it needs no new table because an entry
  carries its own instantiation.
- **Hoisted bodies are emitted under their substitution.** A lambda hoisted out of a generic still
  says `T`; without the push, one whose return type *is* the parameter emitted nothing and wasm said
  "expected 1 elements on the stack for return, found 0".
- **The instantiation collector walks lambda bodies.** It had no `Lambda` arm at all, so a generic
  called *only* from inside a lambda was never instantiated. Pre-existing and unreachable until now:
  nothing in the tree called a generic from a lambda until `ready<T>` below stopped being three
  concrete copies.

### The ordering conflict is real, and I said otherwise

The section above headed *"The real obstacle is an ordering conflict"* is right. The correction I
appended to it on 2026-08-17 — that the conflict does not exist because instantiations are settled
before the walk — **was wrong**, and it was wrong in the way worth recording: I measured one program,
saw no growth, and wrote the general claim. A four-line program with a lambda capturing inside a
generic grows the instantiation table during `settleEmittable`, exactly as the original analysis said.

What is *not* true is the conclusion drawn from it, that the walk must be split into a cheap presence
pass and a real recording pass. Nothing between the two points needs the lambda tables, so the same
walk runs at both, and the second run records only what the first could not have seen.

### What this does not fix

**A generic taking a funcref parameter** — `T twice<T>(T v, fn[T(T)] f)` — is still declined, with the
same message before this work and after it. There is no lambda in it at all; the funcref arrives as a
parameter. `packages/wacc/test/lambda.test.ts` pins it as its own case so the two are not confused.

### What it was for

`packages/platform/src/frame.wac` had three copies of one function — `readyI32`, `readyBytes`,
`readyString` — because `Pending<T> ready<T>(T value)` could not be written. It is one function now,
and the differential against the host frame passes unchanged with it.

That is also the first step of the promise-like API: `then` has to wrap a caller's typed callback
into an untyped thunk *inside* `Pending<T>`, which is a lambda inside a generic.
