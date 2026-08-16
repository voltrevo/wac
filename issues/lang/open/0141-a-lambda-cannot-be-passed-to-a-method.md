# 0141 — a lambda cannot be passed to a method, only to a function or a constructor

- **Status:** open — the checker types all of them now; the **emitter's walk** does not yet type a generic one
- **Claimed by:** agent-c
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


## Half fixed, 2026-08-16 — and the remaining half is generic instantiation

A method call now offers its arguments a type, on both sides and in both shapes:

- `check.wac` reads the method's declared parameter types and sets `c.expected` per argument. An
  instance method's receiver is a *value*, typed by `typeOfExpr`; a static's is a *type name* and is
  its own answer, which `staticOwnerName` says.
- `emit.wac`'s walk does the same through `methodOn` and `paramTypeAt`, taking the receiver's type
  from the walk's own scope for a value and from the name for a static. A method is registered with
  its declared parameters and the receiver is pushed at the call site, so argument `i` is parameter
  `i` — the emitter's blocked walk already relies on that and says so.

`Box.make(() => 2)` and `b.apply((i32 x) => x + 3)` both compile and run.

**What is left is a generic receiver, and it is a different problem.** `Pending.of` is declared
`Pending<T> of(i32 id, fn[T(i32)] resolve, fn[bool(i32)] settled, fn[void(i32)] drop)`. Its second
parameter is written in the template's letter, and this checker does not model instantiation —
`typeOfExpr` already declines to answer for a generic method rather than claiming `T`, with the
reason written beside it. So the wanted type for that lambda cannot be computed, and a generic
receiver is skipped rather than guessed at.

Two of `Pending.of`'s three funcref parameters are *concrete* (`fn[bool(i32)]`, `fn[void(i32)]`), so a
partial answer is possible — type the parameters that mention no type variable, decline the rest. It
would make this issue's headline case work only if `resolve` were also concrete, which it is not, so
it buys little on its own.

**`issues/lang/0137` is still blocked**, for this narrower reason: a substitute capability answers
through `Pending.of`, and that is a generic static.

A test pins both halves — the three positions that work, and a generic one that must still be
refused, with a message saying to update this issue if instantiation is ever modelled.


## The generic half, checked — 2026-08-16

The checker types a lambda passed to a generic static now, and the reason it is easy is worth stating:
**a generic static's return is the owner instantiated**, so the wanted type of the call *is* the
instantiation. `Pending.of` is declared `Pending<T> of(…)` inside `struct Pending<T>`, so a call whose
result is wanted as `Pending<i32>` says `T = i32` outright. No unification, and it is the move the
enum-payload arm in the same function has always made — bind from the slot the call lands in.

Two things had to be true:

- **The wanted type has to reach the call.** It does, through `c.lambdaReturn`, when the call is a
  lambda's body — which is exactly the `() => Pending.of(…)` shape this issue is about.
- **`substituteType` has to reach inside a funcref**, and it did not. It handled a bare parameter,
  `[]` and `?` suffixes, and a nested instantiation like `Option<V>` — but `fn(i32) -> T` fell through
  unchanged, so the lambda was offered a target it could not match. **That was a pre-existing gap
  rather than a lambda one:** a generic struct with an `fn[T()]` field had it too, and every question
  about that field was asked against a type nobody wrote.

Scoped deliberately to *a static on a generic whose return is the owner*. A generic the checker cannot
bind is still skipped rather than guessed at — this adds no inference the checker did not have, it
uses an instantiation the call site already states.

## What is left

**The emitter's walk.** It threads a wanted type down and takes a method's parameter types from
`paramTypeAt`, which answers in the template's letters — so a generic static still records no
signature and the module declines with *"a lambda … in a position the walk does not type yet"*. The
emitter substitutes through a name stack (`pushSubstitution`, `env.subFrom`/`subTo`) keyed to
declaration tokens rather than by rewriting a type string, so this is not the same one-line move the
checker took, and it is the remaining work.

`issues/lang/0137` stays blocked until it lands.
