# 0033 — no way to detect integer overflow

- **Status:** closed
- **Fixed in:** 26eb7e7
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-overflow-detect-8jqm4wn`
- **Symptom:** wrong answer

Integer arithmetic wraps silently and there is no checked form. This is the one
entry in `~/notes/living/wac/language-friction-log.md` recorded as having *caused a
shipped bug* rather than merely costing effort.

## Reproduction

```wac
export i32 overflow() { return 2147483647 + 1; }        // -2147483648, no signal
export u32 wrapU(u32 x) { return x * 1000000; }          // wraps at 2^32, no signal
export i32 lenSum(i32[] a, i32[] b) { return a.len() + b.len(); }  // plausible, wrong at scale
```

Expected: some way to say "I need this not to wrap" and get a trap or a flag.
Actual: wrapping is the only behaviour, and it is correct per `types.md` — the gap
is that there is no alternative, not that the default is wrong.

## Notes

The default should stay. Wrapping is what wasm does, it is what the codecs and
hashes in `wac-mono` rely on, and `crypto` would be wrong without it — Poly1305's
borrow trick and ChaCha20's adds are wrapping by design. So this is a request for an
*additional* form, not a change to `+`.

Three shapes worth weighing, none obviously right:

- **Checked operators** — `+!` and friends, trapping on overflow. Reads consistently
  with the cast operators, where `!` already means "or trap", and needs no new types.
  Costs new tokens and a decision about every operator.
- **A checked cast idiom instead** — compute wide, then narrow with the existing
  `as!`: `(a as i64 + b as i64) as! i32` already traps today. This works now, is
  wordy, and only helps where a wider type exists — it does nothing for i64 or u64.
- **A build mode** that traps on all overflow, for testing only. Cheapest to specify
  and the least useful, since the bug it catches is usually in released behaviour.

The middle option means this may be more a documentation gap than a language one:
the pattern exists and is not written down anywhere. Worth deciding that before
building anything.

No reproduction from the original shipped bug — the friction log records the cost
without the case. Whoever picks this up should ask wac-json for it, since a real
example would settle which of the three shapes is wanted.


## Resolution (agent-a): documented, not built

Closed as the documentation gap the notes suspected it might be. The default stays — wrapping is what
wasm does and what `crypto` depends on — and no checked operator is added.

What was missing is that the detection idioms existed and were written down nowhere. `types.md` now
states both, with tests:

**Widen, then narrow.** `(a as i64 + b as i64) as! i32` traps on overflow, and does so today. Verified
rather than assumed: `sum(2147483647, 1)` traps, `sum(2000000000, 100)` does not.

**Compare against an operand.** For 64-bit types there is no wider one, which the notes said left the
first idiom useless there — but a comparison works. `a + b < a` is exactly unsigned wrap, and
`(a < 0) == (b < 0) && (s < 0) != (a < 0)` is exactly signed overflow. Both directions are tested,
because an idiom that reports overflow when there is none would be worse than no idiom.

So the gap the issue identified — "does nothing for i64 or u64" — was real for the widening trick and
not real for the problem. That is the whole reason to write these down.

**`+!` is deliberately not added.** It reads well and is the obvious next step, but a new token per
operator is a large surface, and the idioms cover every case that has come up. Reopen with a case
where they do not.
