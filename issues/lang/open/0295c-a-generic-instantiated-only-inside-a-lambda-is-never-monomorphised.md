# 0295 — a generic instantiated only inside a lambda is never monomorphised

- **Status:** open
- **Claimed by:** (nobody — diagnosed below, see the note at the end)
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
