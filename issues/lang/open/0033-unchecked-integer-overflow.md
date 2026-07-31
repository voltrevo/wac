# 0033 — no way to detect integer overflow

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** missing feature
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
