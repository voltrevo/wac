# 0008 — const should be inferred from what a function does, not declared on every parameter

- **Status:** proposed
- **Date:** 2026-08-13
- **Author:** agent-b
- **Answers:** `issues/lang/0052`, open since 2026-07-31

## The hole

`spec/spec/variables.md` says `const` on a reference means no writes through it at any depth
(`§wac-const-deep-j6b1nyg`). Four lines defeat it:

```wac
struct S { i32 v; }
void mutate(S s) { s.v = 1; }
void bad(const S s) { mutate(s); }   // accepted, and it writes through a const reference
```

Every *assignment* position is guarded. The hole is the **argument** position, and it is the same for
a const field, a const array element and `const this`.

## Why the obvious fix was abandoned

`issues/lang/0052` records three enforcement points, each of which refused correct code. The first —
refuse a const-rooted argument for a non-const parameter — is the one everybody reaches for, and its
cost is now measured rather than estimated:

```
parameters in packages/*/src/*.wac                     8,295
  of reference type (struct, array, string)            4,996
  of those marked const today                             28
distinct funcref signatures                                94
  taking a reference-typed parameter                       64
```

**4,996 parameters would have to declare read-only-ness, and 28 do.** That is not a checker change
with a migration attached; it is a migration with a checker change attached, and every one of those
annotations is a claim a reader has to check.

The funcref row is worse than large — it is impossible. `fn[bool(K, K)]` has nowhere to write
`const`, so `Map<K, V>`, which takes its equality that way, cannot be written under the rule at all.
That is what pushed the issue to "const has to be part of the type", and a type-system change to fix
an argument-position hole is a heavy answer.

## The proposal: ask the callee, do not ask the author

**A function's parameters are read-only or not as a matter of fact, and the compiler already has the
body.** Compute, for each function, which of its parameters it writes through — directly, or by
passing them on to a parameter that is itself written through — and refuse a const-rooted argument
only where the callee actually writes.

Nothing is annotated. The three cases that defeated the declared form all pass:

| case from 0052 | under this rule |
| --- | --- |
| `bytesEq(m.key, key)` — reads only | **allowed**: `bytesEq` writes through neither parameter |
| `Map.keys()` copying out of a const container | **allowed**: copying is not writing through the source |
| `mutate(s)` from `bad(const S s)` | **refused**, which is the bug |

It is the same shape as the `NOT_COVERED` ledgers: a property the code already has, read off it,
rather than a promise a person repeats.

### What it costs — measured, 2026-08-13

The analysis was written against the reference's AST and run over every package source, which is the
first of the three conditions at the end of this note:

```
254 files, 4,266 functions, 7,007 parameters
parse 585ms; fixed point 122ms in 2 rounds
215 functions write through a parameter
225 of 7,007 parameters are written through (3.2%)
```

**Two rounds and a tenth of a second**, on a repository with a Tor relay and a TLS stack in it. And
the shape of the answer is the argument: the declared form asks for **4,996 annotations**; the
inferred one finds **225 parameters** — 3.2% — and finds them itself. A rule that needs a person to
write something 5,000 times to describe a property of 225 places is a rule pointed the wrong way.

One pass over the declarations, to a fixed point — a parameter is *written* if the body assigns
through it, or passes it to a parameter already known to be written. Fixed points over a call graph
are what the emitter's `settleEmittable` already does, so the shape exists in this codebase.

Two things it does **not** do, stated so they are not discovered later:

- **A funcref call cannot be answered.** `this.eq(a, b)` reaches whatever the funcref holds, and the
  answer is only known where the value was made. Every implementation of a given signature could be
  required to agree, which turns 64 signatures into a checked property; or the call could be allowed,
  leaving the residual hole precisely where it is today. This note proposes allowing it and **saying
  so in the spec** — a stated hole is worth more than an unstated one, and the alternative asks
  authors to annotate the thing they cannot see.
- **Const does not travel out of a return.** `tour.wac` documents that as deliberate and this changes
  nothing about it.

### Why not `const` in the type anyway

Because the cost is 4,996 declarations against a hole whose remaining reach, after this proposal,
is one construct — and because a declared `const` is a claim that can be wrong, while an inferred one
is a measurement that cannot. The type-system change stays available if the funcref residue ever
matters more than the annotations would cost.

## What would have to be true before this lands

1. ~~The fixed point terminates and is cheap on this repository~~ — **done**, 122ms and two rounds;
   see above. What remains is doing it inside wacc's checker rather than over the reference's AST,
   where the call graph has to be built from the same import closure the checker already walks.
2. ~~It refuses the four-line reproduction and each of `0052`'s three cases keeps compiling~~ — the
   safety half is **measured**: over every package source, the number of call sites this rule would
   refuse is **0**. See *What implementing it found* below: that measurement was over
   `packages/*/src`, and it is not where the counterexample lives. Nothing in the repository passes a const-rooted argument to a parameter its
   callee writes through, so the rule can be turned on without a migration and every refusal it ever
   produces will be about code written after it.

   The measurement's own limit, stated because it bounds the claim: the probe tracks const-ness from
   `const` parameters and `const this`, which is where `0052`'s cases live, and not from a `const`
   local or a const field. A checker doing this properly knows all of those, so the real number is
   this or higher — and the gap is worth re-measuring inside the checker rather than guessing at.

   **The assignment shape is counted now: 2, and both are benign** — `tools/constLaundering.ts`,
   2026-08-25. Both are in `packages/crypto/src/blowfish.wac`, both are `const this` aliased into a
   local array for a hot loop, and neither writes through it. So the shape a provenance-following rule
   would have to reason about occurs twice in the repository and costs a one-line rewrite each if the
   rule chose to refuse rather than allow a read-only alias. That was the open question in
   `issues/lang/0052`'s closing paragraph, and it does not change this option's price.

   What remains is the other half: a spec case asserting the reproduction *is* refused and that the
   three cases still compile.

### A case the measurement did not reach: storing is not writing — 2026-08-14, agent-b

Found while working out what by-reference closure capture costs (`design/lang/0002` tier two), and
it bears on this note rather than on that one.

```wac
struct Counter { i32 n; }
struct Env { Counter c; }

export i32 launder(const Counter c) {
  Env e = Env(c);        // accepted
  e.c.n = 99;            // accepted, and it takes effect
  return c.n;            // 99, in wacc and the reference alike
}
```

`c.n = 99` written plainly is refused — *cannot write through const reference*. The same write one
field-store away is not, and there is **no callee anywhere in it**. Every reproduction in
`issues/lang/0052` routes through a mutating function; this one routes through a constructor.

**Why that is a problem specifically for this note's mechanism.** The rule here is "infer const-ness
from what the callee does", by a fixed point over function bodies looking for writes. A struct
constructor has no body, and it does not write through its argument — it *stores* it. A body-based
analysis therefore sees no write and concludes the parameter is const, which is exactly inverted:
storing a reference into a mutable field is what enables every later write, by anyone who holds the
struct.

So the fixed point needs a rule constructors cannot supply from a body: a constructor parameter is
const only if the field it fills is never written through, anywhere — which is a whole-program
question about the *field*, not a local question about a body. That is a different shape of analysis
from the one measured above, and the measurement's own stated limit does not cover it: the probe
tracks const-ness from `const` parameters and `const this`, which this case has, but it counts *call
sites a const-callee writes through*, and a constructor writes through nothing.

**And closures walk straight into it.** A by-reference capture lowers to exactly `Env(c)` — the
environment is a generated struct and the captured binding is a field. Written by hand the escape is
visible; generated by a lambda it is invisible, with no `Env` in the source to suggest anything
happened. Whatever this note decides has to cover the constructor case before `0002` tier two can
capture a `const` binding by reference.

### And a second one: a call through a funcref has no callee to ask — 2026-08-14, agent-b

```wac
void mutate(S s) { s.v = 1; }
void viaFuncref(const S s) { fn[void(S)] f = mutate; f(s); }   // accepted, and it writes
```

Returns 1 in wacc and the reference alike. This is a *call*, so it is the shape this note is about —
and there is no callee to infer from. `f` holds whichever function was assigned to it, and in general
the checker cannot know which.

That leaves two options and neither is free. **Refuse every const-rooted argument at an indirect
call**, which is the enforcement point `issues/lang/0052` records as refusing correct code, now
applied to the one call shape where nothing better is available. Or **let indirect calls through**,
which keeps the hole and makes it reachable by writing one `fn[]` local.

It also gets worse rather than better with `design/lang/0002`: once `fn[]` values are pairs and
closures exist, indirect calls stop being rare. A rule that is sound for direct calls and silent for
indirect ones would be least effective exactly where the new feature encourages code to go.

### The grid this came from

Thirteen routes from a const root to a write, one file, one compile. Five are refused: a direct
write, a store into an array, a value returned from a `const this` method (`issues/lang/0060`), a
field of a const struct parameter written directly, and a const array element written directly.

Eight are accepted, and all eight write through a const reference:

| route | refused |
|---|---|
| `s.v = 1` | ✅ |
| `mutate(s)` | ❌ — `0052`'s original |
| `Env e = Env(s); e.c.v = 1` | ❌ |
| `CEnv e = CEnv(s); e.c.v = 1` — const field | ❌ |
| `KEnv e = KEnv(s); e.c.v = 1` — `const struct` | ❌ |
| `a[0] = s; a[0].v = 1` | ✅ |
| `S got = m.leak(); got.v = 1` | ✅ |
| `fn[void(S)] f = mutate; f(s)` | ❌ |
| `h.s.v = 1` — field of const struct | ✅ |
| `Env(h.s)` then write | ❌ |
| `xs[0].v = 1` — const array element | ✅ |
| `Env(xs[0])` then write | ❌ |
| `const S t = s; Env(t)` then write | ❌ |

The pattern in the refused column is that **every direct write is caught and every store is not**.
The last three rows are the same store route reached from a const *field*, a const *array element*
and a const *local* — so the aliasing rule that makes `const S t = s` const does not survive the
store either.

### Where the implementation goes, and the one thing that is not contained

Read out of `packages/wacc/src/check.wac` rather than guessed:

- **The write-set table** belongs beside `funcParamTypes` in `C` — a `bool` per parameter, indexed
  through the existing `funcParamAt`/`funcParamCount` pair, initialised by `declareFunc`.
- **Direct writes are contained.** `declareModule` already receives the whole `Program`, bodies and
  all, for every imported file. Walking each body for an assignment whose lvalue *root* is a
  parameter — and whose lvalue is not the bare parameter, which is a rebind rather than a write
  through — fills the table for the file being declared.
- **Const-rootedness at the call site is already written.** `constPath(C, Lvalue)` answers it for
  assignments; arguments need the same three lines over an `Expr`.
- **The fixed point looked uncontained and is not — read 2026-08-13.** This said propagation "needs
  every body again, so it needs those `Program`s retained", and that retention is a change to the
  pass where `issues/lang/0098` and `0099` both live — `0099` being a sizing change in this exact
  function that cost **230 MB of peak resident set**. Retaining every imported file's AST for a large
  closure is squarely in that hazard.

  It is not necessary. `checkFiles` parses each imported file into `iprog` and calls
  `declareModule(c, iprog, only)` with the whole `Program`, **bodies included** — so each body is
  available exactly once, at the moment its file is declared. What the fixed point needs from a body
  is not the body: it is two things, both small.

  1. **Direct writes.** A parameter assigned through, which is a bit.
  2. **Flow edges.** For each call whose argument is rooted at a parameter, an edge
     `(thisFunction, p) → (callee, i)`.

  Compute both in the single walk that `declareModule` already makes, and the fixed point runs over
  the **edge set alone**: if `(f, i)` is written, so is every `(g, j)` with an edge into it, repeated
  until nothing changes. No AST is retained; the state is a bit per parameter and one edge per
  argument that is a parameter, which the measurement above bounds — 7,007 parameters, and edges are
  fewer than call sites.

  That also makes the cross-file chain work without the compromise this note was ready to accept: the
  alternative it named — "propagating only within each file as it is declared" — would leave a chain
  crossing a file boundary uncaught, and an edge set does not care which file either end came from.

  So the remaining work is a checker change with no memory hazard in it, which is a different size of
  job from the one this bullet used to describe.

Two rounds were enough over the reference's AST, so the retained-program loop would run twice. The
alternative — propagating only within each file as it is declared — would leave a chain that crosses
a file boundary uncaught, and this note has already spent one stated hole on the funcref call. A
second one, in the common direction rather than the rare one, is not worth the saving.
3. `spec/spec/variables.md` states the funcref residue in the same paragraph as the guarantee, so
   the guarantee is not read as stronger than it is.

## What implementing it found — 2026-08-13

**It works, and it is blocked on a decision this note did not name.**

Written into wacc's checker as the note prescribed: a `bool` per parameter beside `funcParamTypes`,
filled by a statement walk in `declareModule` where each file's body is available exactly once, and a
refusal at the call site under a code of its own. The four-line reproduction:

```
error: cannot pass a const reference where the callee writes through it
  --> repro.wac:3:30
   |
 3 | void bad(const S s) { mutate(s); }
   |                              ^
```

and `readsOnly(s, s)` on the same `const S s`, where the callee only reads, compiles — which is the
table at the top of this note, met.

Two things worth keeping from the doing of it:

- **Under-approximation is the safe direction, and that is a property of the inferred form only.** A
  write the walk fails to find leaves the parameter unmarked and the const argument allowed — which
  is exactly today's behaviour, so an incomplete walk can only fail to close a hole and can never
  refuse correct code. A *declared* `const` is the opposite: a person writing one is asserting
  something about a body they may not have read, and a wrong assertion refuses correct code.
- **The statement walk is all the direct case needs.** An assignment is a statement in wac, so no
  expression walk is involved; expressions enter only with the call edges that make it transitive.

### The blocker: the corpus says the hole is the answer

`spec/cases/0083-a-const-reference-passed-as-a-mutable-one.wac` expects `emits`, and its own comment
says why: *"the one hole variables.md names — const lives on the variable, not in the type, so a
non-const parameter accepts it and may write through it (issue 0052)"*. The spec **documents** this
hole, and the corpus is where a compiler is held to it.

That corpus is not wacc's. `compiler/wacCases.test.ts` asserts the *reference* meets every case, and
says why in its header: "a case the reference fails is a case whose expectation is in doubt".

**But it can be told not to ask — corrected 2026-08-14.** `spec/cases/cases.ts` carries
`only: "both" | "wacc"`, written as `// only: wacc` in a case's header, and its comment says exactly
what it is for: "a feature the reference does not have — the spec targets wacc as of
design/lang/0003, so those exist on purpose now". No case uses it yet, which is why grepping the
corpus for it found nothing and I concluded the mechanism was absent. It is not.

So the blocker is smaller than this note said. What is needed is `spec/spec/variables.md` to stop
naming the hole and case 0083 to become `expect: refused` with `// only: wacc` — the reference is not
asked, because the reference is a seed and its behaviour is not the specification. **The reference
does not have to implement the analysis.**

What remains is therefore only the language decision: whether `const` means what `variables.md` says
it means. That is still not mine to take, but it is one decision rather than three pieces of work.

**My own measurement missed this, and the way it missed is worth writing down.** "Over every package
source, the number of call sites this rule would refuse is **0**" was true, and I wrote "so the rule
can be turned on without a migration". The corpus is not package source. It is a directory of the
smallest program that shows each thing a compiler has got wrong — so it is precisely where a
deliberate counterexample to a rule would be, and I measured everywhere except there.

So condition 2 is not met, and the note stays **proposed**. What it is waiting for is one decision:
whether `const` means what `variables.md` says it means — and, per the correction above, at no cost
to the reference at all.
