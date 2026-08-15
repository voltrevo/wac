# 0002 — bound function references, and closures

- **Status:** accepted 2026-08-13 — every `fn[]` becomes a pair; building
- **Opened:** 2026-08-11
- **Written by:** agent-c
- **Scope:** **wacc only.** The reference compiler is bootstrap-bound and is not to grow this.

## What is missing

Two things, and they are not the same size.

**A bound method reference.** `spec/tour.wac` says it plainly: *"an INSTANCE method reference is the
underlying function with the receiver as an explicit first parameter — because there are no closures,
`c.inc` (a method already bound to an object) cannot exist as a value."* So a caller that wants "this
method on this object" passes two things and the callee has to take two things. Static methods cannot
be referenced at all.

**A closure.** `fn[…]` values never capture. `spec/spec/funcrefs.md`: *"No closures — function
references cannot capture variables from enclosing scope."* Every piece of state a callback needs is
a parameter it was handed.

## Why this is being written down now

Because the workarounds have become load-bearing, and each one is a place the language is paying for
the absence in a currency it did not choose.

- **`packages/box`'s applets.** Its README's own account: an applet reads `cli.readChunk()` and writes
  `cli.write(…)`, *"and wac has no closures, so it cannot be handed a substitute world: a fake
  capability has nowhere to put what it collected. So the host holds the child's world instead."*
  Capturing output means going through the host rather than through a value.
- **`packages/git`'s thin-pack completion.** `completePack` appends bases rather than taking a
  callback to fetch them, and the comment says why: *"which is also why it needs no callback: wac has
  no closures."* The algorithm was shaped by the language.
- **`Shell.askInterrupt`.** A funcref *and* an `anyref` context, threaded together by hand — which is
  a closure, spelled out in two parameters, at every call site.
- **Web authoring.** This is the one that turns a papercut into a wall. Markup syntax for wac is
  under discussion, and every JSX-shaped thing rests on `onClick={() => …}` — a function value that
  captured its environment. Without closures the model has to be Elm's rather than React's: markup by
  id, handlers by selector, one event loop, a `match` over messages. That is a *legitimate* design and
  wac's exhaustive `match` suits it well, but it should be a choice rather than a consequence.

## The two tiers, because they can land separately

**Tier one: bound references.** `c.inc` as a value, and static methods referenceable. This needs a
representation that carries a receiver alongside a function — one struct, two fields, no escape
analysis, no allocation questions beyond what struct creation already answers. It closes most of
`askInterrupt`'s shape and all of the method half.

**Tier two: real capture.** A lambda that reads locals from its enclosing scope. This is the one with
the hard questions:

- **What is captured, and how?** By value is simple and surprising for anyone expecting reference
  semantics; by reference needs a cell, and cells need a lifetime story. wac has no linear memory and
  no pointers, so a captured local becomes a field of a generated struct — which is the standard
  answer and interacts with `const` in a way that must be decided rather than discovered.
- **What does it do to `const`?** wac distinguishes `const this` from `this`, and issue 0060 closed
  recently on *"a value a const method built is not const"*. A closure that captures a `const`
  binding and is then called from a mutating context is exactly the seam that produced that bug.
- **What does it do to the bindgen?** `packages/wacc/tools/waccBindgen.ts` already declines *"a
  funcref nested inside another signature"* because the dispatcher would have to hand JavaScript a
  WasmGC reference. A closure is a funcref with a captured environment, which is strictly harder to
  cross. `issues/lang/0103` is the bindgen work and this would widen its job.
- **What does it do to the corpus?** Every package here is written in a language without closures.
  Adding them changes no existing program, which is the good news — and means the feature arrives
  with no users and no differential, so its first tests have to be written rather than inherited.

## What would adjudicate it

The reference compiler cannot, and that is the novelty. Every language feature so far has had the
reference as an oracle: two implementations, same input, compare. **This one is wacc-only by
instruction**, so the differential that has settled every previous question is not available.

What is left:

- `spec/cases/` — the specification is the contract, and a case that says what a closure does is
  binding on whichever compiler claims to implement it. This is the mechanism the spec already uses
  for behaviour the reference gets wrong (`0115`, `0116`).
- **the corpus, once something uses it.** A feature nothing in the repository uses is a feature
  nothing tests. The honest first milestone is one real caller — `Shell.askInterrupt` collapsing from
  a funcref-plus-context pair into one value would be a good one, because the before and after are
  both in the tree.

## Decided, 2026-08-13: every `fn[]` value becomes a pair

The operator's answer to the choice set out above: **option 1.** A `fn[…]` value stops being a bare
`ref.func` and becomes `{funcref, env}`.

That settles step 1's inner question and keeps the feature worth having: a bound reference stays
interchangeable with every `fn[]` that already exists, so `Shell.askInterrupt` can collapse and no
caller has to learn a second kind of function value. The cost is the one named above — it reaches the
bind boundary, where `issues/system/0147` measures about 3.4 KB of module per distinct callback
signature — and it is accepted rather than discovered.

### The scheme

Uniform, because a non-uniform one is what a second type would have been:

- **The funcref in the pair has type `(anyref env, …args) -> ret`.** One wasm type per `fn[]` type,
  as today, so the shared type table keeps doing its job.
- **A plain function referenced as a value** gets a generated wrapper of that shape which ignores the
  env, and the pair carries a null env. One wrapper per function actually referenced, not per
  function.
- **A bound method reference** `c.inc` gets a wrapper that casts the env to the receiver's type and
  calls the method. The receiver is *already* the method's first wasm parameter (`emittedSig`), so
  the wrapper is a cast and a tail call rather than a shuffle.
- **A call through a `fn[]` value** reads both fields and `call_ref`s with the env pushed first.

### Where the wasm type indices go, which is the one part that is not obvious

`emit.wac` lays the type section out as arrays, then structs, then signatures, and a signature's index
is `arrayCount + structCount + i`. Structs are pre-declared and fixed; **signatures are allocated
lazily during emission**, and that only works because they are *last* — a lazily grown table cannot
have anything after it, since an index emitted early would move when the table grew.

So a pair's struct type cannot simply be a fourth category. Two things follow, and they are the shape
of the change:

- **The env-taking funcref type is an ordinary signature.** `envSig(fn[R(A,B)])` is
  `fn[R(anyref,A,B)]`, a string like any other, allocated by the existing `sigType`. Nothing about
  the layout changes and a function's *own* wasm type is untouched — which matters, because
  `emittedSig` types every function through the same table and prepending an env there would retype
  the whole module.
- **The pair struct shares the signature table, with a marker.** `pairType(t)` is
  `sigType("pair:" + t)`, and the type-section loop emits a `struct` for an entry that carries the
  marker and a `func` for one that does not. Lazy allocation is preserved, the index arithmetic is
  unchanged, and the two types a `fn[]` needs are allocated together.

That leaves the change as six places rather than a re-layout: `writeValType` (a `fn[]` becomes
`(ref null pair)`), the two default-value emitters, the two `ref.func` sites (which become a wrapper
funcref, a null env and a `struct.new`), the two `call_ref` sites (which read both fields and push the
env first), and the bind boundary's `$bind$fnref_N` / `$bind$callref_N`.

### Step 1's seven edits, with the unknowns closed

Read out of `emit.wac`; nothing here is a guess about what exists.

1. **Wrappers, one per emitted function.** `wrapHelpersAt = outHelpersAt + outHelpers`, and
   `startFunctionAt` shifts past them. A wrapper's signature is `envSig` of the function's own
   `fn[…]` type — reconstructable from `funcReturns[i]` and `funcParamTypes[…]`, which `addFunc`
   already records — and its body is `local.get 1…n; call i`, ignoring local 0.

   **One per function rather than one per function *referenced as a value*, deliberately.** The
   narrow version needs a complete expression walk, and an incomplete one emits a `ref.func` at an
   index that does not exist — silent and catastrophic, the opposite direction from the const
   write-set where incompleteness was safe. Always-emit is correct by construction, and it becomes
   the oracle for a later collection pass rather than something the collection pass has to be trusted
   over. What it costs is module size, which `packages/platform/size/` measures.
2. **`writeValType`**: a `fn[…]` becomes `(ref null pairType(t))` rather than `(ref null sigType(t))`.
3. **The two default emitters**: `ref.null` of the pair.
4. **The two `ref.func` sites** — a bare function name, and `Type.method` — become
   `ref.func <wrapper>`, `ref.null none`, `struct.new pairType(t)`.
5. **The two `call_ref` sites** need the pair twice: `local.tee` into `env.scratch(t)`, then
   `struct.get 1` for the env, the arguments, `local.get` and `struct.get 0` for the funcref, and
   `call_ref sigType(envSig(t))`. The field case cannot emit its object expression twice — that would
   duplicate side effects — which is what the scratch local is for.
6. **`$bind$fnref_N`** answers a pair: its trampoline as the funcref, a null env.
7. **`$bind$callref_N`** takes a pair and reads both fields.

The order inside step 1 is forced: wrappers first, because 4 names them; then 2–5 together, because a
value written as a pair and read as a funcref is a module that will not load; then 6–7, because until
they change the boundary hands the module a bare funcref where a pair belongs.

### First attempt at edit 1, and what it corrected — 2026-08-13

Backed out, and worth more for what it established than for what it left.

**Reconstructing a function's wasm signature from `Env`'s tables is the wrong source.** The plan above
said a wrapper's signature is "reconstructable from `funcReturns[i]` and `funcParamTypes[…]`, which
`addFunc` already records". It is not, reliably: `addFunc` keeps only the *declared* parameters,
`funcRecv` holds the receiver, and **two of the four registration sites never set it** — a struct
instance's methods and an enum instance's. Fixing both is a real bug fix in its own right
(`signatureOf` was answering wrong for every generic instance method) and it was still not enough:
96 corpus files emitted invalid modules afterwards, so at least one more class escapes the
reconstruction.

**The authoritative source was already there.** The walk that pre-registers types calls
`emittedSig(env, src, lexed, returnType, params, receiver)` for every function and method, from the
AST, and that is the string the function section writes. So the next attempt registers `envSig` of
exactly those strings in that same walk and emits the wrappers in that walk's order, with its own
function counter — not from `funcCount` and `funcIndex`, which are a different bookkeeping.

**And the cost is settled**, which is the other thing worth having before starting again. One wrapper
per emitted function, measured on the programs in `packages/platform/size/`:

```
cli_only    168,104 -> 170,568     +1.5%
none              668 ->     679     +11 bytes
```

Much cheaper than "one per function is wasteful" implies — a wrapper is a handful of `local.get`s and
a `call` — so the always-emit form is affordable as the correct-by-construction version, and a
collection pass is an optimisation to measure against it rather than a prerequisite.

### The decision step 2 is blocked on: a `§tag` cannot be wacc-only

Everything the emitter needs for `c.inc` is built and green. What stops the checker being changed to
accept it is not code.

`spec/spec/funcrefs.md` carries `[§wac-fnref-nocapture-j4wk8pm]` — *"`c.inc` as a value is a compile
error"* — and `spec/tour.wac` says the same twice, at lines 777 and 791. A `§tag` is tested by
`compiler/wacSpec.test.ts`, which runs against **the reference**, and the reference is bootstrap-bound
and not to grow this feature. So:

- **`spec/cases` can express a wacc-only rule** — `only: "both" | "wacc"` in `spec/cases/cases.ts`,
  written `// only: wacc`, exists for exactly this and its comment says so. Nothing uses it yet.
- **A `§tag` cannot.** There is no scoping in `wacSpec.test.ts`, and its tags are also counted by
  `site/src/next/Checked.tsx` and cited from `compiler/wacCore.ts`.

So making `c.inc` work in wacc leaves the specification saying the opposite, with a green test
asserting the old rule against the reference — a divergence nothing would report. That is worse than
the feature is worth, and it is the same shape as `issues/lang/0052`: a compiler doing something the
spec denies.

Three ways out, and picking one is a decision about the specification's machinery rather than about
closures:

1. **Delete the tag and move the claim to `spec/cases` with `// only: wacc`.** The claim inverts —
   `c.inc` *is* a value — and the reference is not asked. Cheapest, and it makes `spec/cases` the
   home for every wacc-only rule, which `design/lang/0003` already implies.
2. **Give `§tag`s a scope**, so a tag can say which compiler it binds. More machinery, and it puts
   the answer where a reader of `spec/spec` will see it, which is the argument for tags existing.
3. **Leave the tag and narrow it**: `c.inc` is an error *when the slot is not a `fn[…]`*, which is
   still true and testable on both. Preserves the tag and says less than the feature does.

### Chosen 2026-08-15: option 1 — and the premise it rested on was stale

The operator chose option 1. Implementing it found that the choice was between three options one of
which did not need to exist: **`§tag`s are already scoped, by namespace.** `§wacc-` is documented in
`spec/spec/structs.md` as "a clause the seed does not implement", against `§wac-` for "the language
both compilers answer for", and `packages/wacc/test/specTags.test.ts` guards that every such clause is
named by a case or a test. Two clauses already used it.

So this note's *"a `§tag` cannot [be scoped]. There is no scoping in `wacSpec.test.ts`"* was true of
that one file and false of the mechanism, and it made option 2 look like machinery to build when it
was machinery to use. Option 1 was carried out in the better form it allows: the rule stays a tagged
clause in `spec/spec/funcrefs.md`, inverted — `[§wacc-fnref-bound]`, "`c.inc` is a value of the
receiver-less signature" — with `spec/cases/0176` as its oracle. Nothing was deleted from the prose,
which was the whole argument for option 2.

**What it took, once the decision was made.** Two edits in the checker — `boundMethodType`, and the
refusal narrowed to statics reached through a value — and two in the emitter: `typeOfE` answering the
receiver-less signature, and a `Member` in value position emitting the pair with the receiver as its
env instead of a `struct.get`. The bound wrappers, the pair type and the four registered signatures
were all already there from step 1, exactly as this note said.

**Three things the first attempt got wrong**, each caught by running it: the pair's fields go
`{funcref, env}` and I pushed the receiver first; a field and a method may share a name, so the field
has to be asked about first; and `boundRefAt` looked only at the object's own type, so an *inherited*
method type-checked and then failed to emit — a blocked module, loud rather than wrong, and still a
hole. It walks parents now.

### The order it lands in

1. **The representation, with no new syntax.** Every existing `fn[]` becomes a pair, every existing
   call site reads it, the bind boundary builds pairs from its trampolines with a null env. Nothing a
   program can write changes, so **the whole suite is the test** — and that is the only increment
   with an oracle that strong, which is why it goes first and alone.
2. **Bound method references**, once (1) is green: `c.inc` as a value, and static methods
   referenceable. This is the first thing a program can say that it could not before, so it is the
   first that needs `spec/cases`.
3. **`Shell.askInterrupt`** collapsing from a funcref-plus-`anyref` pair into one value — the caller
   this note names, with the before and after both in the tree.
4. **Capture**, which is tier two and still has every question this note lists.

The size measurement matters at each step and is cheap to take: `packages/platform/size/` already
holds programs that isolate the capability boundary, and `issues/system/0147` records what they
weigh today — 668 bytes with no capabilities, 168,104 with `Cli`. A representation change that moves
those is one to know about before step 2, not after step 4.

## The decision this document is asking for

Not "should wac have closures" — the request is already made. It is:

1. **Do tier one and tier two land separately?** I would argue yes: bound references are a
   representation change with no capture semantics, and shipping them first buys most of the
   ergonomics while the hard questions stay open.
2. ~~**Does `spec/spec` change, or only `wacc`?**~~ **Answered, by `design/lang/0003` — the spec
   targets wacc and the reference becomes a seed.** So the specification is where a wacc-only feature
   gets written down, and `spec/cases` is its oracle rather than the differential. That decision
   landed while this document was being written and settles the question it was asking: closures are
   specified first and built second, and the tour's section 17 is revised when they land rather than
   left describing a language only one compiler implements.

## What tier one actually costs — read out of the emitter, 2026-08-13

This note calls tier one "a representation that carries a receiver alongside a function — one struct,
two fields, no escape analysis, no allocation questions beyond what struct creation already answers".
The first half is right and the last clause is the part to check, because of what a `fn[…]` value *is*
today.

**It is a bare `ref.func`.** Not a struct, not a pair — `emit.wac`'s comment beside the shared type
table says why that works: "every function's wasm type is now this signature's entry in the shared
table, rather than one type per function… that is what makes `ref.func f` storable in a `fn[...]`
local". A `fn[]` local holds one wasm value.

And **a method's receiver is already its first wasm parameter** — the same file, on `emittedSig`. So
`C.inc` is emitted as `fn[i32(C)]`, and a bound `c.inc` used as `fn[i32()]` differs from it in
*arity*. There is no `ref.func` that is the second: wasm has no partial application, and a funcref
cannot capture.

So a bound reference needs two words where a `fn[]` value is one, and the decision in step 1 is
sharper than "do the tiers land separately":

1. **Every `fn[]` value becomes a pair** — a struct of `{funcref, env}`, with plain functions getting
   a generated wrapper that ignores the env, and every call site becoming a field read plus
   `call_ref`. Uniform, and it is what most compilers do. It is also a change to the **bind
   boundary**, which is where the cost lives: `issues/system/0147` measures that boundary at about
   **3.4 KB of module per distinct callback signature**, and `$bind$fnref_N` exists precisely to turn
   a host function into a bare funcref of the right type. That machinery is built on the
   one-value representation.
2. **Bound references get a type of their own**, leaving `fn[]` alone. Cheap to emit and it costs the
   thing the feature is for: a bound reference that is not interchangeable with a `fn[]` cannot be
   passed to anything that already takes one, so `Shell.askInterrupt` — this note's own first caller —
   would not collapse.

That is the trade to decide, and it is not the one the "no allocation questions" sentence implies.
Nothing here says which way; what it says is that tier one reaches the bind boundary, so it is not
free of the questions tier two was supposed to be carrying alone.

**Not attempted.** This is read out of `emit.wac` rather than measured by trying it, which is the
weaker kind of evidence — see `issues/system/0147`, where a measurement and a recommendation made
from reading the same code came out opposite ways round.

## State of play

| # | step | state |
|---|---|---|
| 1 | decide whether the two tiers land separately, and whether `spec/spec` changes with them | **decided 2026-08-13** — separately, and every `fn[]` value becomes a pair. See *Decided* above for the scheme and the order |
| 2 | bound method references: `c.inc` as a value, static methods referenceable | **done, 2026-08-15** — `c.inc` is a value of the receiver-less signature, inherited methods included, and a bound reference goes anywhere an `fn[…]` goes. `spec/cases/0176` is the oracle under `// only: wacc`, the clause is `[§wacc-fnref-bound]`, and a *static* reached through a value is still refused. Was: **the emitter half is done; the language half is blocked on a spec decision.** Every `fn[…]` value is now a `{funcref, env}` pair, and a bound wrapper — the env cast to the receiver rather than dropped — exists for every function. What is not done is the checker accepting `c.inc`, because `spec/spec/funcrefs.md` says it is an error under a `§tag`, and a `§tag` cannot be scoped to wacc the way a `spec/cases` entry can. See *The decision step 2 is blocked on* |
| 3 | `spec/cases` for what a bound reference does, since the reference compiler is not an oracle here | **not started, and the mechanism is confirmed to exist** — `only: "both" \| "wacc"` in `spec/cases/cases.ts`, written `// only: wacc`. Nothing uses it yet, which is why it greps like an absence. `design/lang/0003` makes this the general rule, not this feature's exception |
| 4 | one real caller: `Shell.askInterrupt`'s funcref-plus-context pair collapsing into one value | **done, 2026-08-15.** `Shell` holds `fn[bool()]? askInterrupt` and nothing else; `sshd.wac` says `sh.askInterrupt = keys.arrived`. Two fields became one, the `anyref` and its `as!` downcast are gone, and five sites that asked `interruptCtx is null` ask the funcref itself. Canaried: an `arrived` that always answers false fails the ssh suite, so the path is exercised rather than merely compiled |
| 5 | capture: what is captured, by value or through a cell, and what it means for `const` | **not started** — issue 0060's seam is the one to reason from |
| 6 | the bindgen's answer for a captured funcref crossing to JavaScript | **not started** — `issues/lang/0103` is the bindgen work and this widens it |

## What the first caller actually showed — 2026-08-15

The collapse is smaller than the note implies and says more.

`keystrokeArrived(anyref ctx)` opened with `Keystrokes k = ctx as! Keystrokes;` — a downcast that
existed only because the language could not carry a receiver. As a method on `Keystrokes` it is
`bool arrived(this)`, and the cast is not replaced by anything: it was the cost of the workaround
rather than of the problem. The struct it belongs to was already there, which is the tell that this
was a closure written by hand.

**Two fields became one, and the null case got sharper.** `interruptCtx is null` was the test for "no
terminal, so nobody to ask", with `askInterrupt` holding a `neverInterrupted` null object beside it —
two representations of the same absence, either of which could have been the one somebody checked.
There is one now, `askInterrupt is null`, and `neverInterrupted` is deleted rather than kept as a
default nobody reaches.

**What it does not show** is anything about capture. `keys.arrived` captures a receiver that the
caller already had in hand; no local escapes, no lifetime question arises. Tier two is untouched and
every question this note lists about it is still open — which is the argument for the tiers landing
separately, now with a caller behind it rather than an expectation.

## Notes

The absence is not an oversight. The tour lists it beside no-globals as a *consequence worth
internalising*: *"every piece of state is a parameter, a local, or a field reachable from one."* That
property is why a wac module's imports can be empty, why `packages/box` can hand a child a world, and
why the capability argument on the website works at all. None of that is obviously lost by adding
closures — a closure captures locals, not ambient authority — but the claim that it is not lost
should be checked rather than assumed, and this document is the place to record the check.
