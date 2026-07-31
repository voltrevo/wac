# 0030 — a payload-less enum allocates instead of being an integer

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** performance
- **Symptom:** not implemented

## Reproduction

```wac
enum Colour { Red, Green, Blue }      // no variant carries a payload

Colour pick(i32 n) { return n == 0 ? Colour.Red : Colour.Green; }
```

Every `Colour.Red` is a `struct.new` — a heap allocation for a value that is fully described
by its tag.

## Notes

Deferred as an optimisation; recorded in enums.md. Filed to be tracked, with a measurement
attached rather than a guess, since "this allocates" is not by itself a reason to act.

An enum whose every variant is payload-less could compile to a plain `i32`: the tag *is* the
value. `match` would become the switch it already resembles, and there would be nothing to
allocate or cast.

What makes it more than a one-line change:

- The enum type would no longer be a struct, so anywhere it is used as one — a field, an
  array element, a nullable — changes representation. `Colour?` in particular has no null,
  so it would need boxing or a sentinel, and that decision leaks.
- It would be observable through `is` and through reference identity, both of which work on
  enums today.
- A mixed enum (some variants with payloads, some without) cannot use it, so the language
  would have two representations for one construct and a rule about which you get.

Worth measuring before doing: a benchmark of a payload-less enum in a hot loop against the
equivalent `i32` constants would say whether this is worth the representation split. My
guess is that it matters much less than it sounds, because the allocation is a bump and the
GC is generational — but that is a guess and the point of filing this is to replace it.
