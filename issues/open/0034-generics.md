# 0034 — generics

- **Status:** open
- **Scope:** stages A and B are done; C (generic functions) and D remain — see below
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

## What remains

**Stage C — generic functions.** `T max<T>(T a, T b)`, with type arguments inferred from the
argument types. Types alone covered the containers, so this is the smaller half of the demand.

Inference will also lift the one documented limitation of Stage B: a construction in an *argument*
position must currently name its type, because the callee's signature is not known when
substitution runs. Doing argument-directed inference means knowing signatures, which is the same
information.

**Stage D is done** — see issue 0043. Templates are checked at their definition with type
parameters opaque, so a mistake independent of `T` is caught even in a generic nobody instantiates.

**Not measured yet**, and the design asked for both: code size, since monomorphisation duplicates
bodies and wac compiles in the browser; and compile time, since the fixpoint runs on every build.
Neither is likely to bite at current scale — `Vec<i32>` plus `Vec<f64>` is two copies of forty
lines — but the numbers should exist before a widely-instantiated generic appears in a
self-hosting compiler.


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

- **Code size and compile time**, which the design asked for. Not measured. Unlikely to bite at two
  instantiations of forty lines, but the numbers should exist before a widely-instantiated generic
  appears in a self-hosting compiler.
- **`wacc`'s parser knows nothing about generics.** The differential test is green only because no
  `.wac` file in wac-mono uses one yet; the first that does will fail it loudly, which is intended
  but is a real gap between the two implementations.
- **A generic template that is never instantiated is never checked** — the documented C++ bargain.
  Stage D would address it.
- **Deep instantiation chains** beyond the depth cap's boundary case: I tested that the cap fires,
  not that a legitimately deep chain just under it works.
