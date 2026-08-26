# 0010 — a method's own type parameter has to come from the slot, because a lambda states no return type

- **Status:** proposed — a decision is wanted before the implementation, not after.
  **2026-08-26: the operator's constraint is that inline lambdas must chain**, which rules out A
  as recommended below — see [D](#d--synthesise-the-lambdas-return-type-from-its-body--agent-b-2026-08-26)
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

**D**, added 2026-08-26, is below: synthesise the lambda's return type from its body. It was not
considered here because the note took *"a lambda states no return type"* as given — which is true of
what the author writes and not of what the compiler can work out.

## What the restriction costs, measured

Option A's limit is "a call whose result is not written down cannot infer". That is worth a number
rather than a worry, and the analogous rule already exists for generic *statics*, so the number is
available today.

Across `packages/` and `spec/` — 448 wac files:

| shape | count |
| --- | --- |
| a generic owner's static in a slot: a declaration, a parameter, a return, a field | **209** |
| a generic owner's static whose result is used directly as a **receiver** | **0** |

Two candidates for the second row turned out to be my regex reading an argument position as a receiver
— `lists.getOr("xs", Vec.create()).get(0)` is `Vec.create()` in a *parameter's* slot, with the `.get(0)`
on `getOr`'s answer.

So "the slot" is not a narrow place: it is every position that names a type, which is most of them, and
the repository never once needs the position that has none.

**But the shape with no slot is exactly what chaining is.** `p.then(f).then(g)` is a receiver position,
which is why the 0 above should not be read as reassurance: the restriction is invisible in the code
that exists and would become visible in the new feature's most idiomatic form. What it costs is
therefore a naming convention in new code — `Pending<Foo> made = p.then(f); made.then(g);` — rather
than any change to what is already written.

## Recommendation

**Superseded 2026-08-26 — read D below before acting on this.** The operator's constraint is that
inline lambdas must chain, and A cannot meet it: every link of a chain but the last sits in receiver
position. The recommendation as written stands only if that constraint is dropped.

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

## D — synthesise the lambda's return type from its body — agent-b, 2026-08-26

Added because the operator's constraint is that **inline lambdas must chain**, which rules out A as
recommended: under A every link of `p.then(f).then(g).then(h)` except the last is in receiver
position, so a three-link chain needs two named intermediates rather than one. That is not a middle
case, it is every case but the last, and the reason is structural — `then<U>` on `Pending<T>` returns
`Pending<U>`, so the receiver's `T` does not appear in the return type and the wanted type tells you
nothing about what the receiver was. Information flows outside-in for exactly one hop.

**The premise this note rests on has an exception, and it is written in the spec two files away.**
`spec/spec/funcrefs.md` `[§wacc-lambda]`:

> Parameters carry their types; the return type comes from the `fn[…]` it is used as, **which the
> language always supplies because there is no `var`**.

`then<U>` is precisely the case where the language cannot supply it — so the justification for taking
the return type from the target has stopped holding. But the first clause is the one that matters:
**parameters always carry their types.** A lambda body is therefore typeable on its own, and
`Foo.create()` is *"a call to a function or method whose return type is declared"*, which
`spec/spec/generics.md` already lists among the types that are evident.

So `(i64 at) => Foo.create()` has the type `fn[Foo(i64)]` from its own syntax. `U` is then read off
the argument by ordinary argument-directed inference, and chains of inline lambdas work at any depth:

```wac
Pending<Foo> made = p.then((i64 at) => A.create())
                     .then((A a) => B.of(a))
                     .then((B b) => Foo.from(b));
```

**What this buys over the other three.** It meets the constraint A cannot. It adds no syntax, unlike
B — the information B would have the author write is already derivable from what they wrote. It does
not touch the `<` ambiguity that rules out C. And it leaves `spec/spec/generics.md`'s
argument-directed rule *intact* rather than carving a second source of inference into it, which is A's
real long-term cost: every later reader has to learn two places a type parameter can come from.

It also dissolves the ordering problem the section above found. A has to *reach back* — binding `U`
from the wanted type happens after the point where `nothing here wants a function, so this lambda has
no type` fires, so an implementation must arrange the slot before typing the argument. Synthesis types
the argument first, which is the order a checker already wants, and that diagnostic stops being
reachable for an annotated lambda.

### What it costs

**A synthesis mode, which does not exist.** Lambdas are typed only in checking mode today, against a
target; that diagnostic is the absence of a synthesis mode rather than a deliberate refusal.

**Synthesis must not replace checking where a target exists.** `() => 42` synthesises `fn[i32()]`, and
against a target of `fn[i64()]` the literal must still be checked as `i64`. Synthesise only when there
is no target and every program that compiles today compiles identically — which is what makes this
additive rather than a change to 310 existing lambdas.

**Bodies that cannot synthesise keep the current path.** One returning `null`, or calling through a
funcref, has no evident type; those keep the target-type rule and the existing refusal. The two paths
coexist, so this is strictly more programs accepted.

**A join rule for block bodies with more than one value-return** is the only genuinely new typing rule.
Measured across `packages/` and `std/`: **310 lambdas, 149 block-bodied, 20 returning a value, and 3
with more than one value-return.** All three have targets today, so none of them would need synthesis —
the rule is for code that does not exist yet, which is the right time to choose it.

**One compiler, not two.** The tag is `§wacc-lambda` rather than `§wac-`: the reference has no lambdas,
so this is wacc alone.

**The spec sentence quoted above has to change**, from *the return type comes from the `fn[…]` it is
used as* to that plus *or is synthesised from the body when the body's type is evident*. A deliberate
amendment rather than a quiet one, which is why it is here and not in a commit.

### What would settle it

Not checked, and each could change the answer:

1. **the join rule's shape** — whether two value-returns of different types are an error or unify, and
   what that does to `null` in one arm;
2. **`Pending<T>.then` as it stands** is `void then(this, fn[void(T)] f)`, so the value-returning form
   is new declaration as well as new inference, and the two want designing together;
3. whether synthesis interacts with capture — a lambda whose body reads a local whose type is still
   being inferred, which wac's no-declaration-inference rule should make impossible but which nobody
   has argued through.

## Not recommended: leaving it refused

The terminal form — `then` returning nothing — is landed and useful, and `drain` composes fine
without chaining. But `Pending<T>` is how every capability in this repository answers, so "a
continuation that produces a value" is the first thing anyone will reach for after the first one, and
today it is a refusal with no workaround short of a free function.

## What a caller sees today — agent-a, 2026-08-21

This note says calling such a method is *"refused by name"*. Measured, it is refused in two different
places depending on how the call is written, and neither message is the one that phrase suggests.

**The inference form**, which is what the note is about:

```wac
struct Box<T> {
  T v;
  Box<U> map<U>(const this, fn[U(T)] f) { return Box<U>(f(this.v)); }
}
Box<i32> c = b.map((i32 x) => x + 1);
```

    error: nothing here wants a function, so this lambda has no type
      --> n.wac:7:22
       |
     7 |   Box<i32> c = b.map((i32 x) => x + 1);
       |                      ^

That is this note's own analysis arriving from the argument's side: `U` is unknown, so the parameter
type `fn[U(T)]` is unknown, so the lambda has no slot to take a type from. Worth having in the note
because **option A has to reach back to it** — binding `U` from the wanted type of the call means the
lambda's type becomes known *after* the point where this diagnostic fires, so whatever implements A has
to arrange the slot before typing the argument, not merely record it.

**The explicit form** is refused somewhere else entirely, and this is the part worth knowing before the
decision:

```wac
Box<i32> c = b.map<i32>((i32 x) => x + 1);
```

    error: initialiser does not match the declared type
      --> m.wac:7:25
       |
     7 |   Box<i32> c = b.map<i32>((i32 x) => x + 1);
       |                         ^ expected Box<i32>, found bool

`found bool` because the parse is a comparison chain — `(b.map < i32) > (…)` — which is exactly what
`spec/spec/generics.md` says angle brackets are: *"type syntax only — the same ambiguity with
less-than"*. So the message is not wrong. It is also the message a person gets for writing the thing
this note's option C would introduce, and it names neither the rule nor the intent; `issues/lang/0235a`.

**Neither refusal is the "a method with its own type parameters" decline** that `emit.wac` records for
these methods (`issues/lang/0160`'s guards). That one is the *emitter* declining to emit the method at
all; both refusals above happen in the checker first, so a reader chasing this will not see it.
