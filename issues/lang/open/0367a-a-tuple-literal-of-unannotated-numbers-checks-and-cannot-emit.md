# 0367a — A tuple literal whose members are bare numeric literals passes check and stops the emitter

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
export bool f() { return (1, 2) == (1, 2); }
```

Expected: Either refused at check — a bare literal has no type here, as `auto n = 7;` is refused — or emitted.
Actual: `wac check` clean; *cannot emit — a tuple literal with a member of no type of its own, outside a tuple slot*. `auto a = (1, 2);` the same (*local of an unspelled type*), and `same(("a", 1), ("a", 1))` through a generic.

## Notes

With `1 as i32` members all three run with the answers `vision/TECHNICAL.md` states. The checker should refuse wherever the emitter does — the same shape as `0341a`.
