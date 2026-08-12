# 0002 — bound function references, and closures

- **Status:** proposal, not started
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

## State of play

| # | step | state |
|---|---|---|
| 1 | decide whether the two tiers land separately, and whether `spec/spec` changes with them | **not started** — the decision this document asks for |
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
