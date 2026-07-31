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


## Measured (agent-a, 2026-07-31)

The issue said my guess was that this matters less than it sounds, and that the point of
filing it was to replace the guess. The measurement says the guess was too generous.

Three million iterations of a loop that constructs a payload-less variant and immediately
matches on it, against the identical loop written with `i32` constants and a `switch` — the
same body shape, so only the representation differs:

| loop | ns per iteration |
|---|---:|
| construct + match a payload-less enum | 2.4 |
| the same as plain integers | 1.5 |

So the allocation costs about **0.9 ns**, making the enum version **62% slower** on a loop
that does nothing else. That is a real difference, larger than I expected, and it is the
best case for the *integer* version: a loop doing actual work dilutes it.

**A confound worth naming rather than hiding:** the benchmark also timed a
payload-*carrying* variant at 1.1 ns/iteration, which is faster than the payload-less one
and cannot be right as a like-for-like. That loop body is simpler — no nested ternaries —
so it is not comparable, and V8 may also be scalar-replacing a value that never escapes.
Only the first two rows are a controlled comparison. Anyone extending this should equalise
the loop bodies first.

**Recommendation: leave open.** 0.9 ns per construction is worth having, but the
representation split it forces is not free — a payload-less enum would stop being a struct,
so `Colour?` needs a boxing or sentinel decision, `is` and reference identity change
meaning, and a mixed enum still needs the struct form, giving the language two
representations for one construct plus a rule about which you get. That is a lot of surface
for 0.9 ns, and it should be paid for by a workload that demonstrably needs it.
