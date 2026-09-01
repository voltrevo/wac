# 0295 — a generic instantiated only inside a lambda is never monomorphised

- **Status:** closed
- **Closed:** 2026-09-01 by agent-b
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b (2026-09-01)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** compile error — *a value of a type this emitter cannot write: U*, naming a type parameter

## Reproduction

```wac
struct Box<T> {
  T v;
  Box<T> of(T v) { return Box<T>(v); }
  Box<U> mapish<U>(const this, fn[U(T)] f) { return Box<U>(f(this.v)); }
}
export i32 main() {
  Box<i32> b = Box.of(1);
  fn[bool()] c = () => b.mapish<bool>((i32 x) => x > 0).v;
  return c() ? 1 : 0;
}
```

    wacc: cannot emit … — a value of a type this emitter cannot write: U

**The control is one line.** Add a call at statement level and both compile:

```wac
  Box<bool> top = b.mapish<bool>((i32 x) => x > 0);   // ← this alone fixes the one below
  fn[bool()] c = () => b.mapish<bool>((i32 x) => x > 0).v;
```

So it is not the call, the lambda argument, the type parameter's position, or the method having a
lambda in its own body — each of those was varied and compiles. It is **where the only instantiation
is**. The walk that records instantiations does not descend into lambda bodies, so `mapish<bool>`
is never monomorphised and the emitter is left holding the letter.

## How it was found, and what it costs

Prototyping the `async` lowering for `design/lang/0014` step 4:

```wac
cli.readFile("README.md").linkedTo(core).map<i32>((FileResult b) => b.bytes.len())   // fine
fn[Pending<i32>()] g = () => cli.readFile(…).map<i32>(…);                            // refused
```

`Pending<T>.map<U>` is the most-reachable instance of this: it is the only way to transform a ticket,
and a callback is exactly where transforming one is natural. Any program that maps a ticket **only**
inside a `then` — which is the ordinary way to write one — meets this.

It also matters to that design directly. A lowering that emits continuations as lambdas emits
generic calls inside them, so every one would meet this; that is one of the things pushing step 4
toward emitting a state machine rather than rewriting the AST.

## Notes

Not chased to the walk. `findLambdasExpr` in `packages/wacc/src/emit.wac` is the pass that *does*
descend into lambdas, and it was extended for `Await` on 2026-08-30 for the mirror-image reason — a
lambda written inside an `await` would have gone unrecorded. Whatever records instantiations is a
different walk with the same blind spot, and the two are worth comparing: one of them already knows
that a lambda body is code.

Related but not the same: `issues/lang/0142` (a lambda inside a generic emits an invalid module) and
`0277b` (a lambda inside a method with its own letters), both closed. Those are about a lambda
*inside* the generic; this is about the generic inside the lambda.

## Confirmed, and the "only" is load-bearing — agent-b, 2026-08-31

Adding a second call to the same instantiation *outside* the lambda makes the program compile:

```wac
Box<bool> outside = b.mapish<bool>((i32 x) => x > 0);   // <- added
fn[bool()] c = () => b.mapish<bool>((i32 x) => x > 0).v;
```

So the instance is emitted perfectly well; what fails is *discovering* it. The pass that records
which instantiations exist — `genericFuncInstance`/`genericCallInstance`, in what `emit.wac:7682`
calls "the discovery walk" — does not reach expressions inside a lambda body, so a generic used
nowhere else is never monomorphised and `U` survives to emission.

`collectArrayTypes` at `emit.wac:13813` does descend into `lamBody`, so the pattern for doing it is
already in the file; the discovery walk is the one that does not.

**It refuses rather than mis-emitting**, which is worth noting beside `issues/lang/0300a`: that one
wrote a module the engine rejected. This says *a value of a type this emitter cannot write: U* and
stops, which is the better failure of the two.

### The gap is real and the obvious fix does not reach it — agent-b, 2026-08-31

`collectInstances` is the discovery pass, and it walks bodies with `canEmit`, whose verdict it
discards: "the registration it caused is the point". `canEmit` has **no `case Lambda`** in its
expression walk, so a lambda body is never entered and an instantiation that lives only there is
never recorded.

**What I tried, and why it did nothing.** Walking `env.lambdaBodies[0..lambdaCount]` inside
`collectInstances`, each with its own `Env.lambdaFile` selected. It changed nothing, because
`findLambdasInProgram` runs *after* `collectInstances` — the registry is empty at that point. The
change is reverted; a walk over an empty array is worse than no walk, because it looks like a fix.

**So this is a pass-ordering problem**, and the two obvious routes both carry risk that wants more
than a reproduction to settle:

- **Run lambda discovery first.** `Env`'s own note says `findLambdas` "runs once, assigns each its
  index", and later passes read those indices, so moving it is not free.
- **Give `canEmit` a `Lambda` case.** Its verdict is used for real decisions elsewhere, not only by
  this pass, and a lambda body walked without its enclosing scope may fail to resolve captures —
  which would make `canEmit` refuse programs that are fine.

**What is established**: the instance emits correctly once discovered (a second call outside the
lambda makes the same program compile), the discovery pass is the right place, and the blocker is
that lambdas are not yet registered when it runs.

**Unclaimed again — agent-b, 2026-08-31.** Diagnosed to the pass, not fixed: the walk over
`env.lambdaBodies` I tried does nothing because `findLambdasInProgram` runs after `collectInstances`,
so the registry is empty. The two ways past that are ordering decisions rather than patches, and
holding the claim while not working it only stops someone else taking them.


## Closed 2026-09-01 — the walk descends into a lambda body now

`unsupportedExpr`'s `case Lambda` is the discovery walk's view of a lambda, and it returned without
ever looking inside. It walks the body now, with the lambda's parameters in scope, and **throws the
verdict away**: a body that genuinely cannot be emitted is already refused by name at emission, and
returning a decline from here would change which programs compile for reasons unrelated to
collecting instances. It descends to record, not to judge.

`spec/cases/0321-a-generic-named-only-inside-a-lambda.wac` pins it, with exactly one mention of
`mapish<bool>` — this issue's own control shows that a second mention outside the lambda makes the
program compile, so a case with two would test nothing. 323 of 323 corpus cases met.

**The first attempt was in the right function and on the wrong side of one `if`.** I put the descent
inside `if (li >= 0 && env.lambdaSigs[li] != "")`, and nothing changed. `li` comes from
`lambdaAtPos`, and during `collectInstances` — the walk this whole change exists to serve —
`findLambdas` has not run yet, so `li` is **-1** and that branch is not taken. By the time it *is*
taken the module is being emitted, and discovering an instantiation then is far too late to
monomorphise it. The descent is before the check now.

That was established by instrumenting rather than reasoning: making the branch return a marker
string changed the compiler's own build, which proved the branch is reached — at emission — while
the reproduction stayed broken, which proved it is not reached in time.

**The instrument cost a toolchain and is worth recording.** A decline in that branch touches every
typed lambda, including in `packages/wac/src/wac.wac`, which the binary carries as its payload — so
the build produced a `wac` that answers *"exports no `build`"*. `bootstrap.sh` then refused to
rebuild, because its `coretext.wac` staleness check runs `wac task gen:core --check` **through the
existing binary**, and a broken binary fails that check for a reason that has nothing to do with
`coretext`. The way out is the one that check documents: with no binary present it is skipped, so
moving both hosts' binaries aside lets the ladder build a compiler from hand-written wasm. Nothing
was lost, and `--no-install` never touched `$WAC_HOME`.

**Not measured:** what this costs. The discovery walk now enters every lambda body in the program
where it used to stop at the boundary, and `collectInstances` runs it up to eight times. The corpus
is unchanged at 10.9s and the suite passes, so it is not visible at this size; a program with many
large lambdas is where it would show.
