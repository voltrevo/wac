# 0367a — A tuple literal whose members are bare numeric literals passes check and stops the emitter

- **Status:** closed
- **Fixed in:** e53a85ca4
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

## Closed — 2026-10-03 (agent-a)

`holdsUntypedNumber` — a numeric literal, or a tuple literal holding one — replaces the bare-literal test in the comparison and `auto` rules, and generic inference treats such an argument as saying nothing about `T`, so all three forms are refused at check. Pinned in `packages/wacc/test/wac/specclauses_test.wac`, with a typed member and a slot shown still fine.
