# 0123 — the wapy printer drops parentheses around a cast in a conditional, so the file cannot be read back

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** compile error

`compiler/wapyRoundTrip.test.ts`'s *round trip: every package* is red on master:

```
1 of 264 files did not round-trip:
packages/webrtc/src/sctp.wac (as wapy) did not parse:
  unexpected '60000' after the expression
```

Three lines reproduce it, through the test's own `roundTrip` helper:

```wac
export i64 clamp(i64 t) {
  return t > (60000 as i64) ? (60000 as i64) : t;
}
```

The printer renders that as

```python
return 60000 as i64 if t > 60000 as i64 else t
```

**The parentheses the wac source carries are gone**, and wapy's conditional binds so that
`60000 as i64 if …` is not the expression the wac side meant. The result does not parse, which is
the honest failure — a rendering that *did* parse and meant something else would be worse.

`sctp.wac` has it at lines 677 and 1211–1212, from `packages/webrtc` landing today. Nothing about
the construct is new or exotic; it is the first file to combine a parenthesised cast with a ternary,
which is why nothing caught it before.

## What "done" would mean

1. The printer parenthesises an operand of a conditional when the operand's own binding is looser
   than the conditional's — a cast is the case in hand, and it is unlikely to be the only one.
2. A case in `compiler/wapyRoundTrip.test.ts`'s own fixtures rather than only in a package, so the
   next regression fails on three lines instead of on a 1,200-line file.
3. Worth a sweep while it is open: the same question for every other operator that can appear as a
   conditional operand. `issues/lang/0077` is the neighbouring wapy-rendering gap, and both were
   found by a corpus rather than by reading the printer.

The oracle is the round-trip test, which is already in the suite and already red.
