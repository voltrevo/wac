# 0034 — generics

- **Status:** closed
- **Fixed in:** stages A and B (see below), D as issue 0043, C in this commit
- **Scope:** all four stages of the design are implemented
- **Claimed by:** agent-a
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** not implemented

The top entry in `~/notes/living/wac/language-friction-log.md`, and the only one
left in that ranking that has not been closed. Filed here so it is visible from the
repo; the design lives in `~/notes/living/wac/generics-design.md` and should not be
restated here.

## Reproduction

Not a defect, so there is no failing snippet. The demand is four hand-written
containers that exist only because `Vec<T>` does not:

| where | what |
|---|---|
| `json` | `JsonArray.items` — `JsonValue?[]` plus a count |
| `json` | `JsonObject.members` — the same logic again for a different element type |
| `bytes` | `Buf` — shared across two packages *only* because its element type is fixed |
| `wacc` | tokens flattened to `i32` quintuples, because an array of structs needs a container |

Plus one absence with a measured cost: `json`'s object lookup is O(n), and a
string-keyed hash map needs generics over the value type.

## Notes

Corroborated by three projects independently, which is the signal the friction log
says to act on. Everything above it in that ranking has been closed — bytes→string,
float→string, number→string, sum types, module constants, unsigned integers, i64
literals.

The design records settled decisions, notably **monomorphisation rather than
erasure**: the containers that hurt most are the numeric ones, and erasure would turn
`Buf`'s `u8[]` and `Big`'s `u32[]` into arrays of boxed references. It is staged so
each rung stands alone, and `Vec<T>` is usable at the end of stage B — the milestone
where `json` stops writing containers by hand.

Written by agent-b with the operator, so ownership is worth settling before anyone
starts.


## Numbering

Filed as 0024 by agent-c and renumbered to 0034 by agent-a while merging: 0024 was already
taken by a closed issue (match arms and branch coverage), and 0025–0033 were taken too. Per
`README.md`, the later push moves. Nothing else about the issue is changed.

The number was picked from a view of the tracker that did not yet have those, which is the
race the README warns about — `git fetch` immediately before choosing is the only thing that
avoids it.


## Stages A and B implemented (agent-a, 2026-07-31)

Generic **structs** work, monomorphised in the resolver as a pre-pass. `spec/spec/generics.md`
documents the feature; `§wac-generic-struct-9tkq4wm` covers it. The design's milestone is reached:
`Vec<T>` is usable, which is where `json` can stop writing containers by hand.

Verified: primitive, struct and enum type arguments; several instantiations in one program; nesting
including the munched `>>`; a generic holding a generic; two type parameters; arrays of generics
with `fill:`; both ternary branches; across modules with and without an alias; invariance; and each
of the four error cases including the depth cap.

**Three predictions from the design held.** Substituting through a cloned AST is most of the work.
The depth cap is necessary. And the instantiation trace is first-class rather than polish — every
diagnostic renders `Vec$i32` as `Vec<i32>`, with a test asserting no `$` reaches a message, because
an error naming code the author did not write is the difference between this and a C++ template.

**One it did not predict.** The initial sweep must skip template *bodies*. `Box<T>` written inside
`struct Wrap<T>` would otherwise be materialised as `Box$T` — the parameter name treated as an
argument — which surfaced two phases later as a bogus "creates a non-null recursive reference"
error. Worth knowing for Stage C: a generic function's body has the same hazard.

## Stage C implemented (agent-a, 2026-07-31)

Generic **functions** work: `T max<T>(T a, T b)`, with type arguments inferred from the argument
types. `spec/spec/generics.md` documents them and `§wac-generic-fn-5hvq3mt` covers them.

There is no explicit form — `max<i32>(x, y)` would be ambiguous with less-than — so **inference is
the whole interface**. That is only tractable because wac has no declaration type inference: every
local and parameter states its type, so an argument's type is available from the syntax alone. The
inference reads literals, variables, fields, array elements, casts, unwraps, `is`, comparisons and
arithmetic, ternaries, struct constructions, calls to functions and *methods* with declared return
types, and other instantiations. It returns "not evident" rather than guessing, and the diagnostic
says to assign the value to a declared variable first.

A parameter's type is a **pattern**: `T[]`, `T?`, `fn[T(T)]` and `Box<T>` all bind T structurally.
`Box<T>` needed the resolver to read a mangled name back into template plus arguments, since by the
time functions are monomorphised no argument's type says `Box<i32>` anywhere.

Eight bugs found while building it, each with a test that fails without its fix:

1. The initial type sweep skipped generic *struct* bodies but not generic *function* signatures, so
   `T unbox<T>(Box<T> b)` materialised `Box$T` — exactly the hazard Stage B's notes predicted.
2. `monomorphise` returned early when no struct was generic, so a program with only generic
   functions never reached them.
3. Function names were not in the identity map, so a template and a call site in different files
   disagreed about which `max` was meant.
4. Field and method types were keyed by written name, so a *materialised* struct's members were
   never found — which broke a generic function called from a generic struct's method.
5. A construction inside a materialised body never took its type arguments from its declared type,
   because the pass that matches them ran before substitution. **This one also affected generic
   structs** and is fixed for both.
6. Imports needed by a materialised function's argument types were injected before those functions
   existed, so a generic taking a struct from a third file compiled to `expected P__p, got P`.
7. Two imports from the same file each got their own injected copy of the same name.
8. Nothing capped recursive instantiation, so `i32 grow<T>(T a) { Box<T> b = Box(a); return grow(b); }`
   ran the stack out instead of reporting.

Three deliberate limits, all documented in the spec:

- A type parameter that no parameter's type mentions is unusable, and reported at the call. A return
  type alone does not determine `T`.
- A `null` argument and a call through a funcref are not evident.
- **A construction in an argument position still must name its type.** Stage C's notes predicted
  inference would lift this; it does not, because the two run in the wrong order — argument-directed
  inference reads the argument's type, and a bare `Vec(...)` has none until an expected type gives it
  one. Lifting it means propagating expected types into calls, which is a separate change.

An `export`ed generic function is importable by other wac files but its instantiations are **not**
wasm exports: the name a host would call is mangled and changes with the file the template lives in.
A concrete wrapper is the documented way to export one.

Stage D now covers generic functions too, which surfaced a false positive worth recording: an opaque
`T` makes `a > b` a reference comparison, and that was the one operator diagnostic naming no type, so
it could not be told apart from a real error and `max` itself was unwritable. The message now names
the type.

## Measured, since the design asked (agent-a, 2026-07-31)

**Code size: monomorphisation costs exactly what writing the containers by hand costs.** The same
`Vec` instantiated at *k* element types, against *k* hand-written copies, byte for byte:

| instantiations | generic | hand-written |
|---|---|---|
| 1 | 1954 | 1954 |
| 2 | 2250 | 2250 |
| 4 | 2843 | 2843 |
| 8 | 4043 | 4043 |

Identical at every k — ~296 bytes per further `Vec`, ~72 per further `max`. So the growth is real
and linear, and it is not *overhead*: it is the size of the code the feature replaced.

**Compile time is within noise of the same code written out** — 1.96 ms against 2.25 ms at eight
instantiations, best of five after warm-up, the generic version faster on this run. The fixpoint
pass does not show up at this scale.

Both were listed as unmeasured in the section below; they are measured now.


## How well tested, asked and answered (agent-a)

Asked directly, so measured rather than asserted.

**Revert checks.** Each of the three load-bearing parts was neutralised in turn and the suite run:
skipping template bodies, rewriting imports to mangled names, and building display names. All three
fail `§wac-generic-struct-9tkq4wm` alone, so the tests hold the implementation up rather than
sitting beside it. I had not done this before being asked, which was a gap.

**A probe round of fourteen shapes the tests did not reach.** Thirteen passed. The one failure:
`Box<fn[i32(i32)]>` — the var-decl lookahead bailed on the funcref's own `)`, so the declaration
was read as an expression and `fn` failed in expression position with a message about array
construction. Fixed by tracking bracket depth in the scan.

The other thirteen are now tests, because they are the shapes I would not have thought of while
implementing: an array, nullable, funcref or string type argument; a generic with a parent struct;
a nullable field of its own type; `match` and narrowing inside a generic method; a local whose type
is the parameter; one generic method calling another; a generic as a module constant; a generic
instantiated with another generic; three instantiations at once.

**Coverage instrumentation.** Each instantiation gets its own branch points — asserted, because if
they shared them, one instantiation exercising a branch would mark it covered for all, and coverage
of a generic would be meaningless.

**Still untested, and worth naming rather than leaving implied:**

- ~~**Code size and compile time**~~ — measured above.
- **`wacc`'s parser knows nothing about generics** (or about generic functions). The differential test is green only because no
  `.wac` file in wac-mono uses one yet; the first that does will fail it loudly, which is intended
  but is a real gap between the two implementations.
- ~~**A generic template that is never instantiated is never checked**~~ — Stage D, issue 0043, and
  now for generic functions as well.
- **Deep instantiation chains** beyond the depth cap's boundary case: I tested that the cap fires,
  not that a legitimately deep chain just under it works.
