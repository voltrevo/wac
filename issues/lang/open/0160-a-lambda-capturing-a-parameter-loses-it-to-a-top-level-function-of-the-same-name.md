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
that had nothing to do with it. Distinct from [0159](0159-arithmetic-on-a-string-operand-silently-deletes-the-function.md),
which needs no lambda and no collision.
