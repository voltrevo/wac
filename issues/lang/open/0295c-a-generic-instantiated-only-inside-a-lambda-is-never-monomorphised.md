# 0295 — a generic instantiated only inside a lambda is never monomorphised

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
