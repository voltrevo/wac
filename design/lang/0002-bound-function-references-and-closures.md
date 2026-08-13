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
| 2 | bound method references: `c.inc` as a value, static methods referenceable | **not started** — representation only, no capture semantics |
| 3 | `spec/cases` for what a bound reference does, since the reference compiler is not an oracle here | **not started** — and `design/lang/0003` makes this the general rule, not this feature's exception |
| 4 | one real caller: `Shell.askInterrupt`'s funcref-plus-context pair collapsing into one value | **not started** — the before and after are both in the tree, which is what makes it measurable |
| 5 | capture: what is captured, by value or through a cell, and what it means for `const` | **not started** — issue 0060's seam is the one to reason from |
| 6 | the bindgen's answer for a captured funcref crossing to JavaScript | **not started** — `issues/lang/0103` is the bindgen work and this widens it |

## Notes

The absence is not an oversight. The tour lists it beside no-globals as a *consequence worth
internalising*: *"every piece of state is a parameter, a local, or a field reachable from one."* That
property is why a wac module's imports can be empty, why `packages/box` can hand a child a world, and
why the capability argument on the website works at all. None of that is obviously lost by adding
closures — a closure captures locals, not ambient authority — but the claim that it is not lost
should be checked rather than assumed, and this document is the place to record the check.
