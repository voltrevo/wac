# 0002 — bound function references, and closures

- **Status:** accepted 2026-08-13 — every `fn[]` becomes a pair. **Tier one and tier two both land 2026-08-16**; closures capture by reference
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
| 3 | `spec/cases` for what a bound reference does, since the reference compiler is not an oracle here | **done** — `0176` a bound reference, `0181` the by-hand closure lowering, `0188` a lambda as a value, `0189` two lambdas staying two functions, `0190` a lambda reading an enclosing local. All `// only: wacc`. Was *not started*, which was stale from the day `0176` landed |
| 4 | one real caller: `Shell.askInterrupt`'s funcref-plus-context pair collapsing into one value | **done, 2026-08-15.** `Shell` holds `fn[bool()]? askInterrupt` and nothing else; `sshd.wac` says `sh.askInterrupt = keys.arrived`. Two fields became one, the `anyref` and its `as!` downcast are gone, and five sites that asked `interruptCtx is null` ask the funcref itself. Canaried: an `arrived` that always answers false fails the ssh suite, so the path is exercised rather than merely compiled |
| 5 | capture: what is captured, by value or through a cell, and what it means for `const` | **decided 2026-08-16 — through a cell, reference semantics, primitives included**, and **half built**. The lambda syntax, the checker, the walk, the signatures and emission all landed; capture runs *read-only* in nine shapes, and a lambda capturing a name that anything assigns declines with "needs a cell". What is left is the cells themselves — see *The cells, worked out* |
| 7 | the lambda syntax, checker and emission | **done, 2026-08-16** — `=>` lexes, `(i32 a) => a + 1` and `() => { … }` parse into one shape, a lambda is typed against its target with five distinct diagnostics for the ways it can be wrong, and it is hoisted into an ordinary function so the wrapper families cover it. Runs in thirteen positions |
| 8 | capture analysis and the generated struct | **done, 2026-08-16** — free variables per lambda with their types, transitive through nesting, a slab each; `$cap$N` registered in `frontOf`. `lambdaReportLinked` says what it decided, and caught the transitivity and the interleaving bugs |
| 9 | the cells: a captured local becomes one, and the enclosing function's reads and writes go through it | **done, 2026-08-16** — capture is by reference. A captured local lives in a `$cell$T` both sides hold; a captured *parameter* gets its cell at entry, bound to a same-named local that shadows it. Four sites in the enclosing function and three on the lambda's side (read, write, increment). `spec/cases/0191` and `0192` |
| 6 | the bindgen's answer for a captured funcref crossing to JavaScript | **answered 2026-08-16 — it already crosses, in both compilers.** A returned `fn[…]` arrives in JavaScript as a callable and can be handed back in; a closure is the same pair with a capture record in the env, so it crosses on the same path. `compiler/wacBindgen.ts` claimed the opposite in a comment and now has the file's first test for either direction. `issues/lang/0103` is not widened by this |

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

## Tier two: decided 2026-08-16 — reference semantics, through a cell

**Capture is by reference, primitives included.** A closure sees the enclosing binding, not a copy of
it, and writing through the closure is visible outside it.

### The lowering, compiled before it was written down

The whole of tier two, by hand, in what shipped in tier one. It compiles under wacc and answers 5:

```wac
struct Env {
  Cell<i32> n;
  i32 body(this) { this.n.set(this.n.get() + 1); return this.n.get(); }
}

export i32 counts() {
  Cell<i32> n = Cell<i32>();   // the captured local, promoted to a cell
  n.set(0);
  Env e = Env(n);
  fn[i32()] f = e.body;        // tier one gives this for free
  return f() + f() + n.get();  // 1 + 2 + 2 = 5 — the outer n saw the writes
}
```

`Cell<T>` is not invented for this. It is in `spec/tour.wac` at line 593, as an ordinary generic
struct any wac programmer can already write.

**So tier two is a front-end transformation and nothing else.** A capture analysis, a generated
struct per lambda, cell promotion for the locals that are captured, and then the existing
bound-reference path — no new emitter machinery, no new type registration, no change to the pair.
`envSig` prepends an `anyref`, so the env slot already accepts any struct; the bound wrapper casts it
to a receiver and a closure wrapper would cast it to a capture record, which is the same instruction
shape.

**Reference semantics costs less here than it does in most languages.** The usual argument against it
is lifetime: a captured local outliving its frame is a dangling pointer. wac has no linear memory and
no pointers, the cell is a GC struct, and WasmGC keeps it alive exactly as long as something holds
it. There is no escape analysis to write and no story to tell. What by-value would have saved is the
indirection, not the machinery — it needs the same generated struct.

### The two sharp edges the choice creates

**Loop variables.** `for (i32 i = 0; i < n; i++) { fs[i] = () => i; }` — the declaration runs once, so
there is one cell, so every closure reads the final value. That is JavaScript's `var` bug precisely.
The available answers are to make a for-init declaration allocate a fresh cell per iteration, which is
what `let` does and what a reader will expect, or to leave it shared and document it. Undecided, but
the second will be reported as a bug indefinitely.

**`const`, which is the one that is not small.** Under by-value this needed no rule; a copy cannot
launder anything. Under an alias it does: capturing a `const` binding has to yield a cell that cannot
be written, and a `const this` captured into a lambda has to stay `const` inside it.

Stating that rule is easy and enforcing it is not, because **`const` does not currently hold**, and
tier two is entangled with both open items about it rather than merely adjacent to them:

- `issues/lang/0052` — deep `const` is escapable today. The argument position is unguarded, and so is
  a store: `Env e = Env(c); e.c.n = 99;` writes through a `const Counter` with no callee anywhere in
  it. agent-b looked for that route *because of this note* — a by-reference capture lowers to exactly
  `Env(c)`, the capture record is a generated struct and the captured binding is a field. Written by
  hand the escape is at least visible; **generated by a lambda there is no `Env` in the source to
  suggest anything happened.**
- `design/lang/0008` — the proposed answer infers const-ness from what the callee does, and says
  plainly that it has no story for an indirect call: `fn[void(S)] f = mutate; f(s);` is accepted and
  writes, and there is no callee to ask. Its own words: *"it gets worse rather than better with
  `design/lang/0002` — once `fn[]` values are pairs and closures exist, indirect calls stop being
  rare. A rule that is sound for direct calls and silent for indirect ones would be least effective
  exactly where the new feature encourages code to go."*

So the ordering is not free. Tier one has already made every `fn[]` value a pair; tier two would make
indirect calls the ordinary way to write a handler, which is the shape 0008's mechanism cannot cover
and 0052's hole is reachable through. **Landing capture before there is an answer for `const` does
not create the hole, but it does move it from something you have to write `Env(c)` by hand to reach
into something the sugar emits for you.** Whether that is acceptable is a decision, not a detail, and
it belongs with the syntax choice rather than after it.

### What the bindgen actually does, measured

The note said above that a closure crossing to JavaScript is "strictly harder" than a funcref and
would widen `issues/lang/0103`. That is wrong, and both halves were measured on 2026-08-16.

*wacc*, whose `fn[…]` is the pair: a module exporting `fn[i32()] makeBound()` over a `Counter`
returns a value JavaScript can call directly, which keeps its receiver across calls (1 then 2) and
can be passed back into wac and called there. `harness/wacBind.ts` binds with wacc by default, so
this is the path every package already uses.

*The reference*, whose `fn[…]` is a bare funcref: `export fn[string()] pick(bool)` compiles, and the
generated glue wraps the returned reference in a JavaScript closure calling an exported
`$bind$callref_0` shim.

A closure is the same pair with different bytes in the env, so it crosses on the path that is already
there and already generated. **The bindgen is not a blocker for tier two.**

One thing found on the way, and fixed: `cbTsType`'s doc comment in `compiler/wacBindgen.ts` said a
returned funcref "stays unbindable — there is nothing to hand back", forty lines below the comment
describing the shim that hands it back. Nothing tested either direction — the word "funcref" did not
appear in `wacBindgen.test.ts` at all — which is how a sentence about a working feature survived. The
test added with the fix is worth a note of its own: written first with `fn[i32()]` it passed *with
the glue's entire return path deleted*, because V8 hands a bare wasm funcref to JavaScript as a
callable already. It measures the bindgen only with a `string` in the signature, where conversion
makes the wrapper load-bearing.

### Decided 2026-08-16: the syntax, the capture rule, the order, and the loop

**The syntax is a typed arrow.**

```wac
fn[i32()] f = () => n + 1;
fn[i32(i32,i32)] g = (i32 a, i32 b) => a + b;
btn.onClick = () => { count = count + 1; render(); };
```

Parameters carry their types; the return type comes from the target. That is not an inference
exception — `spec/tour.wac` line 135 says *"no inference — the type is always written out"* about
declared types, and a lambda checked against a `fn[…]` it is being assigned to is checking, not
inferring. The zero-argument form is identical to every other language's, which is the form the
motivating case leans on.

**Both bodies, and there is always a target.** An expression body is sugar for a block one —
`() => e` is `() => { return e; }` — and the block form is what a handler will usually want. wac has
no `var`, so a lambda is never written without something to check it against: an assignment names the
`fn[…]`, an argument gets it from the parameter, a `return` from the enclosing function's return
type. There is no third case to decide.

**`return` inside a lambda returns from the lambda.** It is the obvious reading and it is also the
only one available — the enclosing function's frame may be gone by the time a handler runs — but it
has to be *written down*, because a block body is the first place someone can write `return` inside
one function and mean another, and because the rule needs a `§tag` for a case to name. The consequence
worth stating beside it: a lambda has no way to return from its enclosing function, so a body that
wants to stop the outer work has to say so in its answer.

**Capture is implicit.** Free variables are captured; nothing is listed. This is the one place the
feature rubs against *no ambient capabilities*, and it is chosen deliberately: an explicit list would
make `onClick={() => …}` unpleasant enough to defeat the purpose, and a closure captures locals the
caller already held rather than manufacturing authority. The cost is real and worth writing down — a
reader of a function cannot see, at the lambda, that a local is now aliased and may be written after
the lambda escapes. **The mitigation is that a capture is still visible in the lambda's body**, since
the name has to appear there to be captured at all.

**Capture lands before `const` has an answer.** `issues/lang/0052` and `design/lang/0008` stay open,
and this feature makes the hole reachable through sugar rather than through a hand-written `Env(c)`.
Accepted knowingly. What follows is that **0052 and 0008 are now downstream of this note rather than
beside it**: whatever answer they reach has to cover an indirect call, because that is what a handler
is.

**A for-init declaration gets a fresh cell per iteration.** `for (i32 i = 0; i < n; i++) { fs[i] = ()
=> i; }` gives each closure its own `i`, which is `let` semantics and what a reader expects.

The part that phrase leaves ambiguous, and which the implementation has to get right: **the loop still
has to progress.** A cell allocated fresh at the top of each iteration and never written back would
make `i++` update a cell nobody reads again, and the loop would not terminate. The sequence is the one
`let` uses — carry the value into a fresh cell at the top of the iteration, run the body against that
cell, then copy the cell's current value back out before the update expression runs, so `i++` advances
what the next iteration copies in. A closure made in iteration *k* keeps iteration *k*'s cell, and the
write-back is what makes a body that assigns to `i` still affect the loop.

### What the emitter needs, and the one hazard it cannot dodge — 2026-08-16

**A lambda is hoisted into an ordinary function.** That is the whole design: emit the body as a
function like any other, and it lands inside `count`, which means `wrapHelpers = count` gives it a
wrapper and `boundHelpers = count` a bound one, with no new family and no new index arithmetic. The
expression site then emits exactly what a named function reference already emits — `ref.func` the
wrapper, the env, `struct.new` the pair — with the capture record in the env instead of null.

**The hazard the wrappers escaped, and this cannot.** The wrappers are emitted *always*, one per
function, and the note above records why: deciding which functions need one is a complete expression
walk, and an incomplete walk names a function index that does not exist — silent and catastrophic,
which is the failure that produced invalid modules for 96 corpus files. Always-emit was available
there because a wrapper needs no information from the walk.

**It is not available here.** A lambda has to be *found* to be emitted at all, so the walk is
unavoidable — and it must cover every statement form and every expression form, because a lambda can
sit anywhere an expression can. Nothing in `emit.wac` walks both today: `unsupportedExpr` recurses
over 24 expression kinds and does not walk statements at all.

So the rule for whoever writes it: **count and record in the same walk, and let emission read the
table rather than walk again.** Two walks that agree almost always is the bug — a lambda counted in
one order and emitted in another names the wrong function index, and the module either fails to
validate or, worse, calls the wrong body. One pre-pass that assigns each lambda its index and stores
its parameters and body on `env` removes the question entirely; emission then looks up by index and
cannot disagree with a walk it does not perform.

The capture analysis is the same walk's second job: the free variables of each lambda body, which are
what the generated struct holds. A name is free when it resolves outside the lambda's own parameters
and locals — the checker already builds exactly that scope in `checkLambda`, so the two are solving
the same problem twice unless the emitter is given the answer.

#### The walk has to carry a wanted type, and that is not obvious until you try

**Done, 2026-08-16:** the walk itself (`findLambdas`), exhaustive over statements, expressions and
lvalues, recording into `env`. `emittedSigOf` is extracted so a signature can be built from a return
type *name*, since a lambda writes no `Ty` and every `Ty` carries a token — the same seam the checker
needed `c.lambdaReturn` for.

**What is left is not the emission but the signature, and it is due earlier than emission.** A
hoisted lambda is a function, so its signature type has to be in the type section — and `declTypes`
is snapshotted before any body is emitted, with a guard that declines a module whose table grew after
it. So each lambda's `fn[…]` must be registered in the *pre-pass*, which means the pre-pass has to
know it.

The parameters are declared, so they are free. **The return type is not**: `design/lang/0002` takes it
from the target, and the target is a fact about the *context* — the declared type of the variable, the
callee's parameter, the enclosing function's return. So `findLambdas` needs to thread a wanted type
down exactly as `emitExprAt` already threads `want`, and for the same reason.

Deriving the return type from the body instead does not work, and the failure is quiet: `() => 42`
would give `i32` from the literal, and a target of `fn[i64()]` would then have a hoisted function
whose signature disagrees with the pair type the expression site builds. That is the literal-is-
polymorphic problem this compiler already solves everywhere else by passing the wanted type down, and
it is why the emitter must do the same here rather than asking `typeOfE` what the body returns.

#### Capture reuses the bound wrapper, and needs a scope in the walk — 2026-08-16

**Landed:** lambdas run. A lambda is hoisted into an ordinary function, lands inside `count`, and the
expression site emits the same `{funcref, env}` pair a named function reference does — `ref.null any`
for the env, since nothing is captured yet. Eleven positions run, `spec/cases/0188` and `0189` state
it, and `emitDeclineLinked` exists because the blocked walk reports a *different* `Env` from the one
emission uses, so a decline raised during emission had no way to name itself.

**Capture needs no new emitter machinery either, and that is the useful part.** Tier one's *bound*
wrapper already does exactly what a closure wrapper needs: cast the env to a receiver and call. So a
capturing lambda is the hoisted function emitted **with the generated capture struct as its
receiver**, referenced through `boundAt + ordinal` instead of `wrapAt + ordinal`, with the constructed
struct in the env. Non-capturing stays as it is. Nothing new is emitted; the two cases differ by which
of two wrapper families they name.

**What it does need is a scope in the walk.** A lambda's free variables are the names its body reads
that its own parameters and locals do not declare — and the *types* of those names, because they are
the generated struct's fields. Both are due in the pre-pass, since the struct is a type and the type
table may not grow after `declTypes`. The enclosing function's locals do not exist then: they are
built per body during emission, which is the same timing wall that leaves an assignment target
untyped today.

The way through is that a local's type is written down. `Var(type, nameTok, init, isConst)` carries
it syntactically, so `findLambdas` can maintain a name→type scope as it walks — pushing at each block
and lambda, popping on the way out — exactly as the checker does in `checkLambda`. That is the piece
to build next, and it also closes the assignment-target gap, since an assignment's target type is
then known too.

The cells come after: a captured local is a field of the generated struct, and reference semantics
means the enclosing function's reads and writes of that local have to go through the same cell. That
is the part that changes code the lambda is not in.

#### The trap in the last step: capture without cells is by-value, silently — 2026-08-16

**Done:** the capture analysis and the generated struct. `lambdaReportLinked` says what each lambda
captures and which `$cap$N` holds it; capture is transitive, a slab per lambda, ten cases pinned.

**What is left looks like two mechanical steps and contains one semantic one.** Emitting the hoisted
function with `$cap$N` as its receiver, and constructing the struct at the expression site, is
mechanical — tier one's bound wrapper already casts an env to a receiver and calls, so it is a choice
between `wrapAt + ordinal` and `boundAt + ordinal`.

**But a struct whose fields are the captured values is capture by value**, and by value is not what
was decided. It would compile, run, and be wrong only for programs that write: the lambda's writes
would not be seen outside, and the enclosing function's writes would not be seen inside. Every
read-only capture — which is most of them, and all of the obvious tests — behaves identically either
way. That is exactly the shape of a bug that ships.

So whoever writes it has two honest options, and should not pick the third:

1. **Cells at the same time.** A captured local becomes a one-field struct, the capture struct holds
   the cell rather than the value, and the *enclosing* function's reads and writes of that local go
   through the cell too. This is the decided semantics and the invasive part, because it changes code
   the lambda is not in.
2. **Decline anything that writes.** By value and by reference agree exactly when nothing writes the
   captured name — so capture may land for read-only captures, provided a write to a captured name,
   from either side, declines by name. The walk already sees every assignment target, so the check is
   available where the capture set is built.
3. **Not: ship the struct-of-values and call it capture.** It passes every test anyone would write
   first, and the language would quietly have the semantics that was explicitly not chosen.

#### The cells, worked out — 2026-08-16

**Done:** capture runs, read-only, with a write to a captured name declined as *"needs a cell"*. Nine
shapes, `spec/cases/0190`. Measured before gating: the writing shapes answered 1 where reference
semantics wants 42, which is the divergence this section closes.

The shape of the remaining work, so it is not re-derived:

- **A cell type per captured *type*** — `$cell$i32`, `$cell$string` — one field at index 0, registered
  in the pre-pass beside `$cap$N`, for the same reason: it is a type.
- **A captured local's wasm local holds the cell, not the value.** `i32 n = 41;` becomes a local of
  `$cell$i32` initialised with `struct.new`; every read of `n` in the *enclosing* function becomes
  `local.get idx; struct.get $cell$i32 0`, and every write `local.get idx; …; struct.set`. This is the
  part that changes code the lambda is not in, and it is why this step is invasive where the previous
  one was not.
- **The capture struct's field type becomes `$cell$T`**, so the lambda holds the cell rather than a
  copy — which is the whole of reference semantics. Inside the lambda a captured read is then
  `local.get 0; struct.get $cap$N c; struct.get $cell$T 0`, and a write the same with `struct.set`.

**The one piece not yet in hand is which locals to promote, per function.** The walk knows: it records
each lambda's captures, and each function's lambdas are a contiguous range (`first` in
`markWritingLambdas`). What does not exist is a mapping the *emitter* can consult while emitting one
function — the walk indexes by lambda, and emission indexes by function. A table from function ordinal
to promoted names, built in the same walk, is the missing link, and building it in that walk rather
than a second one is the rule this feature has followed throughout.

**Read out of the emitter, 2026-08-16: `localTypes` serves two masters, and that is the whole
difficulty.** A local's entry in that table is used for two different questions — what wasm type the
local slot has, and what type an expression naming it produces. A promoted local needs those to
differ: the slot holds a `$cell$i32`, and `n` still means an `i32` everywhere it is read.

The tractable arrangement, which makes this smaller than "invasive" suggests: **leave `localTypes`
holding the value type**, so all eight of its consumers keep answering correctly and no type-directed
emission changes. Add a parallel flag per local. Then only the sites that actually touch the slot need
to know:

- where the function's **locals vector** is written, which must emit `$cell$T` for a flagged slot;
- the `Ident` read, which becomes `local.get idx; struct.get $cell$T 0`;
- the assignment to a bare name, which becomes `local.get idx; …; struct.set $cell$T 0`;
- the `Var` that declares it, which wraps the initialiser in a `struct.new`.

Four sites, not eight, and none of them is type inference. The promoted set is already recorded by
position; a flag per local index is the only new state.

**Promote every captured local, not only the written ones.** It is tempting to keep the current
by-value path for read-only captures and add cells only where something writes — but that makes the
semantics depend on whether a write exists anywhere in the function, which is exactly the kind of
rule that is invisible in the small cases and wrong in the large ones. One rule: a captured local is
a cell.

### Still open

- ~~The capability check~~ — **run, 2026-08-16, and it costs nothing.**

      a program that closes over a local : 0 imports
      a program with no capabilities     : 0 imports

  The paragraph in *The check, for tier one* refused to let that carry by assumption, and it was right
  to: a closure captures a local the caller already had, which *looks* like it should be free, and
  looking is not measuring. It is free. A capture record is a struct, a cell is a struct, and a
  wrapper is a function the module defines — none of it asks the host for anything, so a program that
  closes over its own state still declares no capability it was not given.
- **`const`**, which is `issues/lang/0052` and `design/lang/0008` rather than this note's work — see
  the decision above for what landing capture first commits us to. **This is now live rather than
  prospective:** capture has landed, so the indirect call that 0008's mechanism cannot cover is
  ordinary code, and a lambda capturing a `const` binding is a route to 0052's hole that needs no
  hand-written `Env(c)`.
- **A real caller**, still. Tier one met the note's own standard by collapsing `Shell.askInterrupt`;
  tier two has not, and every program that exercises capture is a test.

  **Two of the three workarounds named at the top of this note turn out not to be closure problems**,
  which is worth knowing before anyone tries them:

  - `packages/git`'s `completePack` — its own comment says appending bases is *"the better shape
    anyway, because the completed pack is a file git accepts rather than a value only this library
    understands."* Converting it to a callback would be a regression, closures or not.
  - `packages/stream`'s `passthrough` and `upperCase` take their `read` and `write` from the host, so
    there is nothing to capture.

  **`packages/box` is the real one**, and it is now `issues/lang/0137`. `Cli` is a struct of `fn[…]`
  fields, so a substitute is an ordinary value built from lambdas over a local —
  `spec/cases/0193` is that in miniature, and it runs. Filed rather than done because it is `box`,
  `sh` and `platform` together and `pushChild`/`popChild` has callers beyond `shrun`.

## Notes

The absence is not an oversight. The tour lists it beside no-globals as a *consequence worth
internalising*: *"every piece of state is a parameter, a local, or a field reachable from one."* That
property is why a wac module's imports can be empty, why `packages/box` can hand a child a world, and
why the capability argument on the website works at all. None of that is obviously lost by adding
closures — a closure captures locals, not ambient authority — but the claim that it is not lost
should be checked rather than assumed, and this document is the place to record the check.

### The check, for tier one — 2026-08-15

A program that builds a bound reference, passes it to a function and calls it twice:

    $ deno task app:native bref.wac -o bref     # c.inc bound, applied, and applied again
    bref.wasm: 0 imports
    none.wasm: 0 imports                        # packages/platform/size/none.wac, for comparison

**Zero, the same as a program with no capabilities at all.** The representation asks the host for
nothing: a pair is a struct, a bound wrapper is a function this module defines, and `call_ref` is an
instruction. So tier one takes nothing from the property above — and it could not, because a bound
reference captures a *receiver the caller already held* and has no way to manufacture one.

What this does not establish is tier two. A closure capturing a local is capturing something the
caller also already had, so the same argument looks like it should carry — but "looks like it should"
is what this paragraph exists to stop, and the check is one command when there is something to run it
on.
