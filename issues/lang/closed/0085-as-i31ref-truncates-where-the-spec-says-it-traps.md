# 0085 — `as! i31ref` truncates where the spec says it is checked

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 86371d5d
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

## Resolution

The check is emitted around `ref.i31` now — `x >s 2^30-1` or `x <s -2^30` traps — through the same
`guardI32` the checked signedness changes already used. In range nothing changes, and both edges
answer rather than trap: `1073741823` and `-1073741824` are the values an i31 holds.

**The two compilers had opposite halves of it.** wacc emitted its check for *every* spelling of the
cast, so `1073741824 as~ i31ref` trapped where the language says it keeps the low bits; the reference
emitted nothing at all for that spelling, leaving an i32 on the stack where an i31ref belonged, so
the module did not validate. Neither had a case for `as~` into an `i31ref` — which is the spelling the
checker's own hint recommends when it refuses `as` as lossy:

```
'i32' -> 'i31ref' is lossy — use 'as!', 'as~'
```

Both are fixed. `as~` is `ref.i31` with nothing around it, which is exactly what the instruction is.

**The case corpus could not state this rule.** Its expectations were `emits`, `refused` and
`answers`, and the nearest a case could get to "this traps" was an answer — which is precisely the
wrong answer the bug produced. `spec/cases` has a `traps <fn>` expectation now, in the format and in
both runners, and only a wasm `RuntimeError` satisfies it: a host-side error is the runner being
wrong about the program rather than the program trapping. The bounds checks and `!` on a null are the
same shape and can be written down whenever someone wants them.

`spec/cases/0109` (out of range traps), `0110` (the largest value does not) and `0111` (`as~` keeps
the low bits).
