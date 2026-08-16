# 0141 — a lambda cannot be passed to a method, only to a function or a constructor

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
struct Box {
  i32 v;
  Box make(fn[i32()] g) { return Box(g()); }        // a static
  i32 apply(this, fn[i32(i32)] g) { return g(this.v); }
}

i32 plain(fn[i32()] g) { return g(); }

export i32 f() {
  i32 a = plain(() => 1);            // accepted
  Box b = Box.make(() => 2);         // nothing here wants a function, so this lambda has no type
  i32 c = b.apply((i32 x) => x + 3); // the same
  return a + b.v + c;
}
```

## Why

A lambda has no type of its own — `design/lang/0002` takes it from the `fn[…]` it is used as — so
every position that can hold one has to *say* what it wants. Three do: a variable initialiser, a
`return`, and an argument to a plain function or a struct construction (which are the same AST node,
`Construct`). A method call is a `Call` whose callee is a `Member`, and neither the checker nor the
emitter's lambda walk resolves that to a signature, so the argument is offered no type at all.

Both sides need it, and they are the same shape:

- `check.wac` sets `c.expected` for the positions it knows, and a method call is not one — hence the
  diagnostic above, which comes from `errLambdaNoTarget`.
- `emit.wac`'s `findLambdasExpr` threads a wanted type down for the same positions, so even with the
  checker fixed the walk would record no signature and the module would decline.

The emitter already has what it needs — `methodOn(env, owner, name)` and `paramTypeAt` — and the
`Construct` arm shows the shape. The receiver's type is the only new step.

## Why it matters more than it looks

**It is most of the standard library.** `Pending.of(id, resolve, settled, drop)` is a static taking
three funcrefs, and it is how every capability in `packages/platform` answers. So a substitute
capability — the thing closures were wanted for, and `issues/lang/0137` — cannot be written with
lambdas today:

```
.cache/probe/cli.wac:20:29 [check] nothing here wants a function, so this lambda has no type
```

`spec/cases/0193` works because its capability's operations return plain values; the moment one
returns a `Pending<T>` it needs `Pending.of`, and that is a static method.

**0137 is blocked on this**, and so is any real use of closures against an API written in the usual
style. A lambda that can only be passed to a free function is a lambda that cannot be handed to most
of this repository.
