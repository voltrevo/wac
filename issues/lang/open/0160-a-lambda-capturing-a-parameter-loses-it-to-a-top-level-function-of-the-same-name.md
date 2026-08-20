# 0160 — a lambda capturing a parameter loses it to a top-level function of the same name

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct Box {
  i32 v;
  void then(this, fn[void(i32)] f) { run((i32 id) => { f(id + this.v); }); }
}
void run(fn[void(i32)] g) { g(1); }

i32 f(string s) { return s.len(); }        // ← unrelated, different type, different arity

export i32 main() { Box b = Box(2); b.then((i32 n) => {}); return f("abc"); }
```

Expected: `f` inside the lambda is `then`'s parameter, which is what it is one line earlier and outside
a lambda.

Actual: it resolves to the file-level `f`, `wac build` exits 0, and the module is rejected by the
engine. Renaming the file-level `f` to anything else makes it valid, which is the whole diagnosis.

Take the lambda away and the capture is correct — `void then(this, fn[void(i32)] f) { f(1); }` beside
the same top-level `f` compiles and runs. So it is the lambda's scope chain, not the parameter's.

## What it costs

It reaches across a module boundary, and that is what makes it hard to find. `Pending<T>.then` in
`packages/platform/src/platform.wac:276` is

```wac
void then(this, fn[void(T)] f) {
  …
  this.sched!.on(this.id, (i32 id) => { f(this.resolve(id)); }, this.drop);
}
```

so **any** file that imports `platform.wac` and happens to declare a top-level function named `f` —
the obvious name for a one-line helper — produces a module the engine refuses. Nothing in the failing
file is wrong, nothing in `platform.wac` is wrong, and the reference's message names neither:

```
Compiling function #295:"$lambda$518:29" failed: not enough arguments on the stack for drop
```

`wac`'s own message is honest but not locating — "rejected by the engine — this is a compiler bug
rather than a fault in the program" — and `wac test` says the same, so a test file whose only sin is a
helper called `f` reports as a compiler bug with no line.

Only `f` collides today, because `f` is the only capture in the graph most files import. Anything with
lambdas over parameters is one helper name away from the same thing.

## Notes

Suspect name resolution inside a lambda body: the enclosing function's parameters look like they are
consulted after file scope rather than before, or not at all, so a same-named declaration anywhere in
the linked module wins. If that is right the fix is in the resolver and neither the closure conversion
nor the emitter needs to change.

Two cheap guards worth having whichever way it is fixed: the emitter should refuse a call whose
argument types do not match the callee rather than emitting it — that would have turned this into a
compile error at the line — and `platform.wac`'s parameter could be named `onValue`, which does not fix
the bug but takes the whole repository out of its way.

Found while porting `packages/tor/test/dird.test.ts` to wac; it cost an afternoon of bisecting a file
that had nothing to do with it. Distinct from [0159](../closed/0159-arithmetic-on-a-string-operand-silently-deletes-the-function.md),
which needs no lambda and no collision.

## Narrowed — 2026-08-20 (agent-a; not claimed, reproduction only)

Still reproduces exactly as filed, and the rename control still holds: the program builds the moment the
top-level `f` becomes `gg`. What follows is evidence about *where* it is not, which should save the next
person the afternoon it cost me.

**The engine's complaint, in full:**

    Compiling function #13:"$lambda$3:42" failed: not enough arguments on the stack for drop
    (need 1, got 0)

So the lambda body emitted **nothing** where a value was due, and the statement's `drop` underflowed.
That is the signature of a call that resolved to nothing at all — not of a call to the wrong function,
which would have left a value on the stack.

**The Notes above suspect the resolver consults parameters after file scope. In the emitter it does
not.** `emit.wac`'s `Construct` arm — which is where a bare `f(...)` lands, because "a funcref called by
its name is a `Construct` too" — checks in this order, with a comment saying so:

1. `env.localType(lraw)` — a local of funcref type
2. `env.captureAt(env.emittingLambda, lraw)` — **a captured one**
3. `env.funcAt(cname)` — a declared function

So the local and the capture are both consulted first. The order is right.

**And `funcAt`'s bail is not the site.** I instrumented `if (at < 0 || env.funcIndex[at] < 0) { return; }`
with a distinguishing message and it never fired on this program — so the fall-through to the declared
`f` is not what emits nothing.

**The capture mechanism itself works, including for this name.** With a probe on the capture path,
building wacc's own source reports `f` captured inside a lambda with `lty=fn[void(bool)]` and compiles
it. So `noteRead`/`noteCapture` are not simply broken for a parameter called `f`.

Which leaves the interesting question: what does the walk record for `f` when a **top-level `f` also
exists**? `noteRead` searches `walkNames` innermost-first and captures only if the name is found below a
lambda's mark, so the parameter should win — but the collision is the only variable between the failing
and passing programs. My guess is the capture is recorded with the *wrong type* (or the walk's entry for
the name is the file-scope one), and `isFuncrefType(lty)` then fails so the branch is skipped; I did not
get evidence for that and it is a guess, flagged as one.

**Why I stopped here.** Every probe declines something in wacc's own source, so each iteration costs a
seed build that the probe itself breaks — `seed:bootstrap` to recover. And `issues/lang` says to prefer a
precise reproduction over patching under whoever is porting. This is that.

**One thing worth doing regardless**, and it is the issue's own suggestion: the emitter should refuse a
call whose argument types do not match the callee rather than emitting it. That would have turned this
into a compile error at the line instead of an invalid module — and it is the same principle as
`issues/lang/0170a`.