# 0037 — `slice` clamps out-of-range offsets silently, while indexing traps

- **Status:** closed
- **Fixed in:** ecde150
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** diagnostic
- **Covered by:** `§wac-str-slice-clamp-3qnv7wk`
- **Symptom:** wrong answer

`s[i]` traps when `i` is out of bounds, and `strings.md` says so. `s.slice(a, b)`
silently clamps instead — including a negative start — and `strings.md` says nothing
about either case. A caller cannot predict which of the two behaviours applies.

## Reproduction

```wac
export i32 idxOob()    { return "hello"[9].len(); }              // traps — documented
export i32 endPast()   { return "hello".slice(3, 99).len(); }    // 2
export i32 startPast() { return "hello".slice(9, 99).len(); }    // 0
export i32 reversed()  { return "hello".slice(3, 1).len(); }     // 0
export i32 negStart()  { return "hello".slice(-2, 3).len(); }    // 3
```

Expected: one rule, stated. Either both trap, or both clamp, or the difference is
documented with a reason.
Actual: indexing traps and is documented; slice clamps at both ends, treats a
reversed range as empty, and accepts a negative start, none of it written down.

## Notes

Not necessarily a code change — clamping is a defensible choice, and it is what most
languages' slice does. The gap is that `strings.md` documents `slice` only through
one in-range example (`"hello world".slice(6, 11)`), so every edge is undefined
behaviour in the spec sense while being perfectly definite in the implementation.

The negative start is the case I would look at hardest. `slice(-2, 3)` returning
`"hel"` means a negative offset silently becomes 0, so a caller who computed an
offset wrongly gets a plausible answer rather than a trap — and the same arithmetic
mistake in `s[i]` would have trapped. Python-style negative indexing would return
`"lo"` instead, which is a third possible reading; nothing in the docs rules it out.

Whatever is decided, it wants tags. `§wac-str-slice-h8wd4pm` covers only the
in-range case today.


## Resolution (agent-a)

No code change — clamping is the right answer to the question `slice` asks, and the report said
as much. What was missing is the rule, so `strings.md` now states every edge in a table, with
tags: end past the length clamps, start past the length gives empty, a reversed range is empty,
a negative start clamps to 0, and none of it traps.

Two things spelled out because a reader may expect them and get neither: a negative start does
**not** trap, though the same arithmetic mistake in `s[i]` would; and it does **not** count from
the end, so `"hello".slice(-2, 3)` is `"hel"` rather than Python's `"lo"`. wac has no
from-the-end indexing anywhere, and adding it only here would be worse than clamping.

The inconsistency with indexing is now justified rather than merely admitted: `slice` asks for
the part of a string within a range, and every range has an overlap including an empty one, so
clamping answers the question; `s[i]` asks for one character, and when there is none there is
nothing to return, so it traps. The cost — a wrong offset yields a plausible short string — is
recorded as accepted, with a note that the remedy would be a separate checked operation rather
than changing this one.