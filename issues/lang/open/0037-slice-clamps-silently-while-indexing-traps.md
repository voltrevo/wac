# 0037 — `slice` clamps out-of-range offsets silently, while indexing traps

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** diagnostic
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
