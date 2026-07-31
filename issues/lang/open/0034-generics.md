# 0034 — generics

- **Status:** open
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
