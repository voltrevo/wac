# 0010 — a method's own type parameter has to come from the slot, because a lambda states no return type

- **Status:** proposed — a decision is wanted before the implementation, not after
- **Date:** 2026-08-17
- **Author:** agent-c
- **Blocks:** chaining on `Pending<T>` — `p.then(() => Foo.create())` answering a `Pending<Foo>`

## What is wanted

```wac
Pending<Foo> made = core.delay(500).then((i64 at) => Foo.create());
```

`then` has to introduce a type parameter of its own:

```wac
Pending<U> then<U>(this, fn[U(T)] f)
```

`U` cannot come from the owner — `Pending<i64>` says nothing about `Foo` — and it appears in exactly
two places: the callback's return type, and the method's own return type.

The syntax parses and the declaration checks as of `cf6cd8bb`; **calling one is refused by name**,
because nothing infers `U`. This note is about where `U` is allowed to come from, which is a language
question rather than an implementation one.

## Why the language's own rule cannot supply it

`spec/spec/generics.md` is explicit, and the reasoning is good:

> There is no `max<i32>(x, y)`. Angle brackets are type syntax only — the same ambiguity with
> less-than — and a call is an expression, so **inference is the whole interface**. It is tractable
> because wac has no declaration type inference: every local and every parameter states its type, so
> an argument's type is available from the syntax alone.

A lambda breaks that last sentence. Its parameters state their types; **its return type is written
nowhere**. So the argument `(i64 at) => Foo.create()` does not state a type, and `U` is not available
from the syntax of the call. The spec already names the two other cases where inference fails for the
same reason — a `null` argument and a call through a funcref — and says to assign to a declared
variable first. That fix does not exist here: the thing whose type is missing *is* the argument.

## Three ways out

**A. Bind from the slot.** The wanted type of the call carries the answer: `Pending<Foo> made = …`
says `U` is `Foo`. This is not new machinery — it is what a generic *static* already does, and has
done since `issues/lang/0141`:

> A generic static takes its `T` from the slot the call lands in. `Pending.of` is declared
> `Pending<T> of(…)` inside `struct Pending<T>`, so it returns the owner instantiated — which means
> the wanted type *is* the instantiation, and no unification is needed to read `T` off it.

So the language already infers from the slot in one place, and the spec's "inference is from
arguments" is already not the whole truth. Extending it to a method's own parameters is one rule
applied in one more position.

*What it costs:* a call with no slot cannot infer. `p.then(f).then(g)` — the inner call's result goes
into nothing written down — is refused, and the fix is the one the spec already prescribes elsewhere:
name an intermediate. Worth knowing before choosing this, because chaining is what the feature is for
and this is exactly the shape "chaining" suggests.

**B. Give lambdas a declared return type.** `(i64 at): Foo => Foo.create()` would make the argument
state its type, and inference from arguments would work unchanged. It is a syntax addition, it makes
every lambda that wants to be inferred from noisier, and it is redundant with the target type in the
common case.

**C. Allow written type arguments.** `p.then<Foo>(…)`. The spec rules this out for a reason it states
plainly — `<` is ambiguous with less-than in expression position — and that reason does not weaken
here.

## Recommendation

**A**, with the limit written into the spec beside it: a method's own type parameters are inferred
from the slot the call lands in, and a call whose result is not written down cannot infer them. It
adds no syntax, it reuses a mechanism that exists and is tested, and it makes the shape the promise
API actually wants — a named result — the shape that works.

If the answer is A, the implementation is three pieces, and the third is the only large one:

1. the checker binds the method's letters from the wanted type where the method's return type mentions
   them, which is the same unification `issues/lang/0141` does for a static;
2. the checker then checks the arguments in that world, so the lambda gets `fn[Foo(i64)]` as its
   target and is an ordinary lambda again;
3. the emitter monomorphises per **(owner instantiation × method type arguments)** — a third level
   beside the two it has. A method is registered as a function named `Owner.method`, and a generic
   struct already registers its methods per instantiation, so `Pending<i64>.then<Foo>` is a longer
   name in the same table rather than a new mechanism. One thing found the hard way while writing the
   refusal: a call resolves to the *instantiated* entry, so anything keyed on the template alone is
   invisible at the call site.

## Not recommended: leaving it refused

The terminal form — `then` returning nothing — is landed and useful, and `drain` composes fine
without chaining. But `Pending<T>` is how every capability in this repository answers, so "a
continuation that produces a value" is the first thing anyone will reach for after the first one, and
today it is a refusal with no workaround short of a free function.
