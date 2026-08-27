# 0010 — a method's own type parameter has to come from the slot, because a lambda states no return type

- **Status:** **implemented 2026-08-27 — option C.** Five of six acceptance criteria are met and the
  sixth is not compiler work: `Pending<T>` has no value-returning continuation, and giving it one is
  scheduler plumbing rather than a declaration — see *What is left to build* item 1, which understated
  itself. `spec/cases/0245`–`0249` are the landed behaviour.

  Decided 2026-08-26; the objection that had ruled C out was removed by
  [0011](0011-a-call-may-name-its-type-arguments.md). Option D moved to
  [0012](0012-synthesising-a-lambdas-return-type.md) as a separate ergonomic question
- **Date:** 2026-08-17
- **Author:** agent-c
- **Blocked:** chaining on `Pending<T>` — `p.then(() => Foo.create())` answering a `Pending<Foo>`.
  The language no longer stands in its way: `spec/cases/0248` chains three such calls, each with an
  inline lambda, on a `Cell<T>` written for the purpose

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

**Superseded 2026-08-26 — the decision is C, below.** The operator's constraint is that inline
lambdas must chain, and A cannot meet it: every link of a chain but the last sits in receiver
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

## The decision — option C, 2026-08-26

**C was ruled out for a reason that no longer holds.** The paragraph above says the spec forbids
written type arguments *"for a reason it states plainly — `<` is ambiguous with less-than in
expression position — and that reason does not weaken here"*. It weakened.
[0011](0011-a-call-may-name-its-type-arguments.md), accepted the same day, resolves that ambiguity:
`name < … >` is an instantiation when what lies between the brackets parses as a type list, and a
comparison otherwise. Its step 3 puts the rule on the postfix-after-dot path, which is exactly what
this document needs.

So the wanted program is written:

```wac
Pending<Foo> made = p.then<Foo>((i64 at) => Foo.create());
```

`U` is supplied, so the callback's parameter type `fn[U(T)]` becomes the concrete `fn[Foo(i64)]`, the
lambda has a target, and it types in checking mode exactly as every other lambda does. **No new
inference is required at all** — which is what makes C the cheap answer now and was not true when
this document was written.

Chains follow, at any depth, with inline lambdas:

```wac
Pending<Foo> made = p.then<A>((i64 at) => A.create())
                     .then<B>((A a) => B.of(a))
                     .then<Foo>((B b) => Foo.from(b));
```

That is the operator's constraint — inline lambdas must chain — met without A's slot restriction and
without B's syntax.

**A is superseded** rather than wrong: under A every link of a chain but the last sits in receiver
position, so three links need two named intermediates. Confirmed against the mechanism that already
exists rather than argued: a generic static infers from the slot today, and `Box<i32> b = Box.of(3)`
builds while `Box.of(9).get()` — the same call in receiver position — fails with *unresolved name
Box*. The reason is structural: `then<U>` on `Pending<T>` returns `Pending<U>`, so the receiver's `T`
never appears in the return type and the wanted type says nothing about what the receiver was.

**Option D has moved to [0012](0012-synthesising-a-lambdas-return-type.md).** It proposed
synthesising the lambda's return type from its body, so `<Foo>` could be omitted. With C in hand that
is an ergonomic improvement rather than the resolution of this document, and it carries open
questions of its own — chiefly what happens when a method's letter appears in a non-lambda parameter
too, as it would in a `fold`. Keeping it here would have made this document wait on those.

### `fold` is the example worth leading with

`Pending.then` is what prompted this, and it is the *worst* advertisement for it: `U` appears once,
only in the lambda's return, so every call needs the type written. The shape every collection API
wants is better:

```wac
U fold<U>(const this, U seed, fn[U(U, T)] f)      // on Vec<T>
```

and it needs **no written type argument in the common case**, because `U` appears in `seed`, which is
not a lambda:

```wac
i32 total = v.fold(0, (i32 acc, i32 x) => acc + x);        // U from seed and the slot
i64 wide  = v.fold<i64>(0, (i64 acc, i32 x) => acc + x);   // written, when you want it
```

A bare literal takes its type from the slot — measured 2026-08-26, `id(0)` is `i32` or `i64`
depending on where it lands — so the seed does not need a cast either.

That matters for how this decision reads. The fear about C is that it makes every generic call
noisy; `fold` is the demonstration that it does not. Writing the argument is the **escape**, used
where nothing else determines the letter, which for a well-designed API is rare.

`core/vec.wac` has no `map`, `fold` or `filter` today. They are the obvious first users.

### Acceptance criteria

1. `Vec<T>.fold<U>` can be **declared** — today the declaration checks and the call is refused.
2. `v.fold(0, (i32 acc, i32 x) => acc + x)` compiles with **no** written type argument.
3. `v.fold<i64>(0, (i64 acc, i32 x) => acc + x)` compiles with one.
4. `p.then<Foo>((i64 at) => Foo.create())` compiles — the `Pending` case, where the argument is
   required because `U` appears only in the lambda's return.
5. A three-link chain of inline lambdas compiles, which is the operator's constraint:
   `p.then<A>(f).then<B>(g).then<Foo>(h)`.
6. The emitter produces **distinct instantiations** for `Vec<i32>.fold<i32>` and `Vec<i32>.fold<i64>`
   — the third level of monomorphisation, and the thing most likely to be got wrong quietly.

### What is left to build

C needs no inference work, but it is not free:

1. **`Pending<T>.then` does not exist in the value-returning form**, and this item **understates what
   it is**. `std/platform.wac:286` is `void then(this, fn[void(T)] f)`, which registers a handler and
   returns nothing. A `Pending<U> then<U>(this, fn[U(T)] f)` has to *make a second ticket* and resolve
   it when the first resolves — that is scheduler plumbing, not a signature. The machinery is there
   (`Pending.of` takes a resolve function) but wiring a derived ticket is a platform feature.

   Two further facts, measured 2026-08-27: the existing `then` has **five** real callers, all passing
   a void lambda, so the two forms cannot share a name — wac has no overloading, and a void-bodied
   lambda cannot satisfy `fn[U(T)]`. And `std/platform.wac` is embedded verbatim in
   `packages/wacc/src/coretext.wac`, so any change to it needs `deno task gen:core` and a reseed.

   None of that is compiler work, and the compiler no longer stands in its way: `spec/cases/0248`
   chains three of them on a `Cell<T>` written for the purpose.
2. **Method type parameters are refused in three places** — twice in the checker, per the section
   below, and once in the emitter's decline path (`issues/lang/0160`'s guards). All three have to go.
3. **The emitter monomorphises per (owner instantiation × method type arguments)**, which is the
   third level beside the two it has and remains the only large piece. A generic struct already
   registers its methods per instantiation, so `Pending<i64>.then<Foo>` is a longer name in the same
   table.

### Progress — agent-b, 2026-08-27

**The syntax exists.** `design/lang/0011` steps 1–3 landed, so `v.fold<i64>(0, f)` parses and the
type arguments reach the checker as `ExprKind.Call`'s `typeArgs`. Before that they were a parse
error, which made item 2's refusal message worse than it looked: *"no Box<i32>.map without its type
arguments"* reads as an instruction, and following it answered `a type name is not a value` under the
`<`, about a different program.

**One of the three refusals now does useful work rather than only refusing.** `C.methodTypeParams`
holds the letters rather than a flag, so the *count* is checkable without binding anything —
`b.map<i64, i32>(f)` is wrong for every possible binding at once and is told so. The three messages
are now distinct and each is true:

    b.map(widen)              no Box<i32>.map — it has a type parameter of its own
    b.map<i64>(widen)         no Box<i32>.map yet — written type arguments are parsed and not bound
    b.map<i64, i32>(widen)    Box<i32>.map takes 1 type argument, and 2 were written

**What is left is item 3, and it is the whole of what is left.** Binding the letters in the checker
is small — the substitution machinery is a stack of (from, to) pairs with a push/pop count, and a
method's letters are a second push on it. What that would produce on its own is a call the checker
accepts and the emitter declines, which is a worse answer than today's single clear refusal. So the
checker half should land *with* the emitter half rather than before it.

Item 1 is deliberately not done: declaring `Pending<U> then<U>(…)` while no call to it can be emitted
adds a method nobody can reach.

**Where the emitter's decline is**, for whoever picks this up: one site, `emit.wac`'s
`funcMethodGeneric[ma]` guard in the `canEmit` walk. The instance machinery it would have to join is
`pushSubstitution`/`popSubstitution` — which already returns how many pairs it pushed, so a second
push for the method's letters is the shape it was built for — and `collectInstances`, whose comment
warns that discovery order and registration order have to agree because the function table's order is
the module's numbering.

#### Which acceptance criteria are met

| # | criterion | state |
|---|---|---|
| 1 | `Vec<T>.fold<U>` can be **declared** | **yes**, and was before this |
| 2 | `v.fold(0, (i32 acc, i32 x) => acc + x)` with no written argument | **yes** — `spec/cases/0249`, answers 12. The letter lives inside a funcref, which the checker's binder could not see into; `applyBindings` and `substituteType` both already had that arm |
| 3 | `v.fold<i64>(0, …)` with one | **yes** — `spec/cases/0245`, answers 12, with an **inline lambda** |
| 4 | `p.then<Foo>(…)` | **the compiler is ready; the platform is not.** See below — this is more than the declaration item 1 calls it |
| 5 | a three-link chain | **yes** — `spec/cases/0248`, answers 9, three inline lambdas each changing the type. `issues/lang/0274b` closed |
| 6 | distinct instantiations for `Vec<i32>.fold<i32>` and `Vec<i32>.fold<i64>` | **yes** — `spec/cases/0246`, measured in emitted bytes: 3,287 against 2,897 for the one-instantiation program |

**Item 3 landed on 2026-08-27** and took six layers, each failing differently — recorded because the
list is what the next person needs and none of it was predicted:

1. the type section was not sized for the new functions;
2. the function *count* pass did not know them, which is a module the engine refuses rather than a
   decline;
3. the parameter's type was recorded as **unknown**, because `typeOfTy` answers that for a letter
   that is active and `fn[U(U, T)]` has one — so it had to be recorded *as written*;
4. `writtenTy` had no funcref arm at all and returned `""`, which reads as "no slot";
5. `applyBindings` bound the owner's `T` and left the method's `U`, so a correct lambda was told
   *expected fn(U, i32) -> U, found fn(i32, i32) -> U* — two spellings of one type. It had the arm
   for an instantiation and not for a funcref, which is the same gap `substituteType` had fixed for
   itself years of commits earlier;
6. the emitter's lambda-target walk read the template's entry rather than the instance's, and
   declined with *a value of a type this emitter cannot write: U*.

Four of the six are the same mistake wearing different clothes: **a letter that nothing bound, and a
diagnostic about a type nobody wrote.** That is worth knowing in advance, because each one looks like
a bug in the program rather than in the compiler.

### A design for item 3, from reading the emitter — agent-b, 2026-08-27

Not implemented. Written down because the reading is most of the work and the alternative is somebody
doing it again.

**The shape to add is a fourth name.** The emitter already has three: a function `zero`, a generic
function instance `zero<i32>`, and a generic struct's method `Box<i32>.map` — registered by
`collectInstances` as `addFunc(inst + "." + methodName, …)` with `funcRecv = inst`, and immediately
*declined*, because `funcMethodGeneric` is set for it. The fourth is `Box<i32>.map<i64>`, with
`funcRecv = Box<i32>` exactly as the third has.

**Register in place of the declined entry, in the loop that already registers instance methods.**
This is a correction of a first guess — a separate pass afterwards — made after reading the emission
loops rather than only the registration one, and the reading changes the estimate.

The relevant fact is that the entry already exists. `collectInstances` registers *every* method of
every instance, including one with its own type parameters, and then declines it (`funcMethodGeneric`
is what carries that). Emission walks the same methods in the same order against a cursor, `emitAt`,
skipping entries whose `funcIndex` is negative. So the slot is there and empty.

What changes is the *count*: one method becomes one entry per discovered set of method type
arguments. Registration and emission must therefore enumerate the same (method, argument-set) pairs
in the same order, which they will if both read one discovery list in list order.

**Forty-three loops, and this design is the wrong one — tried, measured, reverted.** I built it far
enough to register the extra entries and reseed, then counted: `emit.wac` has **43**
`for (i32 m = 0; m < methods.len(); m++)` walks, **six** of them the bare `{ at = at + 1; }` shape
whose entire job is to advance an index in step with a sequence written elsewhere.

Making one method register N entries means every one of those walks has to count N. A miss in any
single one slides the function index for everything after it, which is the fifty-seven-invalid-modules
failure — and it does not show on a small test, because a hand-written case with no strings has no
helpers, so nothing sits after the slid entries to notice.

That count is the argument, and it is why the *first* instinct here was right after all: **append,
do not interleave.** A pass that registers method instances after every instance has been registered
adds entries at the end of the function table, where no existing walk's indices move — so the 43
loops keep counting exactly what they counted before and none of them needs to know. The matching emission has to be a pass in the same position, and that question is now answered rather
than open: **emission is decl-walk-driven**. There are six `emitFunction(types, funcs, exports, code,
…)` call sites and every one of them sits inside a walk over declarations, so an appended table entry
with no walk to match it gets a function-section slot and no body — a short code section, which is an
invalid module rather than a wrong answer.

So the append design is one new registration pass **and** one new emission block, and the block has to
come last, because `funcIndex` is assigned in table order (three loops over `env.funcCount` do the
renumbering) and the code section has to be in index order. Both sections are filled by the same
`emitFunction` call, so a final block walking the method instances in registration order keeps them
in step by construction — which is the property the interleaved design could not get.

**So the honest state is: the syntax and the diagnostics landed, this piece did not, and the reason
is measured rather than guessed.** The reverted attempt cost one reseed and is worth exactly the
sentence above.

**`popSubstitution` clears where it would need to restore.** Emitting the body wants two pushes — the
owner's letters from `Box<i32>`, then the method's from `<i64>` — and `pushSubstitution` already
returns how many pairs it pushed, so the stack part nests correctly. What does not is `curInst` and
`curGeneric`: `popSubstitution` sets both to `""` rather than to what they were, so an inner pop
silently drops the outer instance. A save-and-restore variant is the fix, and `Env.lambdaInst` is the
thing that would notice if it were missed, since it keys a lambda by the instantiation it is inside.

**Discovery has a round to happen in.** `collectInstances` walks every body with `canEmit` before it
registers anything, and iterates to a fixed point on `instDirty` — so a list built during that walk is
complete before the registration loop reads it, which is what makes the pairing deterministic.

**Discovery is at the call site**, like `genericCallInstance`, and wants the owner instance and the
written arguments — which `ExprKind.Call`'s `typeArgs` now carries (`design/lang/0011` step 3). The
instance name must be built through `env.canonType`, for the reason `issues/lang/0260c` gives: a
variant canonicalises to its enum, and two spellings of one type must not become two instances.

**The checker half is small and must not land first.** `C.methodTypeParams` holds the letters, so
binding them is `applyBindings` over the method's parameter and return types after `substituteType`
has done the owner's. On its own it produces a call the checker accepts and the emitter declines,
which is a worse answer than the single clear refusal there is today.

**What to check it against**, since the failure mode is a module that loads and computes the wrong
thing: `Vec<i32>.fold<i32>` and `Vec<i32>.fold<i64>` must be distinct instantiations (criterion 6),
and a written argument agreeing with an inferred one must produce *one*. `design/lang/0011`'s
`typeargsrule_test.wac` measures that for free functions in emitted bytes rather than by running the
program, because both copies compute the same answer and only the size differs — the same instrument
works here.

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
