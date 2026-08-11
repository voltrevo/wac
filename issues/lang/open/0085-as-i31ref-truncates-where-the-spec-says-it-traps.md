# 0085 — `as! i31ref` truncates where the spec says it is checked

- **Status:** open
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 f() {
  i31ref r = 1073741824 as! i31ref;    // 2^30 — one bit too wide
  return r as i32;
}
```

Expected: a trap. `spec/spec/casts.md` gives the rule for the family — *"`as!` — checked: exact
or trap"* — and again for this cast: `42 as! i31ref` is "checked (i32 may not fit in 31 bits)".
`spec/tour.wac:609` says the same in its comment.

Actual: `-1073741824`. The low thirty-one bits are kept and the value silently changes sign.
`-1073741825 as! i31ref as i32` gives `1073741823` the same way.

## Notes

`ref.i31` itself is a truncating instruction — it says nothing about the bits above the
thirty-first — so the check has to be emitted around it, and nothing is. In range the cast is
correct, so this only shows up at the boundary.

The rest of `as!` is checked as specified: `x as! i32` from an `i64` traps outside the range, which
is the same promise on a numeric type. This is the one member of the family that keeps its low bits
instead.

Found by `packages/wacc`, which implements the checked form; the two compilers therefore disagree on
these programs on purpose. The pair is *not* in wacc's differential sweep for that reason — they are
in `packages/wacc/test/i31Trap.test.ts`, asserted against the specification rather than against this
compiler, and that test is the thing that should start failing when this is fixed.
