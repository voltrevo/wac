# 0162 — a multi-part answer comes back truncated under load, and it is not cross-talk

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer

## What happened

`packages/platform/test/fuzz.test.ts` failed inside a full suite run:

```
seed 2000003 (seeded): answer for 203 is 131625 bytes, wanted 179994
  the nonce is this call's, so it is truncated rather than crossed
  slot 1 gen 33, 1 live, 96 cancelled and 105 spent so far
  statuses=[3,0,0,…]  live=2 step=489 nonce=204
```

This is the failure `issues/system/0155` was about, and the sentence that matters is the second line.
0155 closed with the observation that *"answer for N is X bytes, wanted Y"* is equally consistent with
a truncated answer to **this** call and with another call's answer landing in this slot — and that
those want opposite fixes. The report now says which, and it says **truncated**: the first four bytes
are this call's own nonce.

So it is not the generation check and not a recycled slot. It is the **multi-part answer path** —
`STATUS_MORE` and `OP_CONTINUE` in `host/respond.ts` — losing a chunk. 131,625 of 179,994 bytes is
about 73%, not a round fraction of anything obvious.

## What is known

- **Under `seeded`, which is the policy this test only started running today.** The `off` policy is
  production and did not produce it here; that is one observation rather than a pattern.
- **Not reproducible in isolation.** Three targeted re-runs pass. Same as 0155: the seeded scheduler
  makes the *scheduler's* choices reproducible and not the host's completion timing, which
  `host/schedule.ts` says in as many words — *"whether a real `readFile`, `accept` or child exit has
  completed … is not reproducible from a seed"*.
- **96 cancelled and 105 spent by then**, with one call live. A cancel-heavy prefix is the shape the
  ring's hardest interleavings live in.

## Where to look

`write` in `host/respond.ts` fills the chosen room, then `attach`es a pooled buffer and sets
`S_RES_LEN`, and hands the tail back through `STATUS_MORE`. The pieces a reader must reassemble are
the inline area, a pooled buffer when one was free, and each `OP_CONTINUE`. A truncation means one
piece was not asked for or not written — and the answer arrived *short but well-formed*, so whatever
decided it was complete believed it.

`finalStatus[slot]` is the other thing in that path that outlives a single write.

## Why this is worth a number rather than a retry

Because the evidence exists now and will not next time. It took a message that names what it found
rather than what it wanted, and that message is one run old — the same failure has been seen at least
twice before (0155, and the run 0155 itself reports) with nothing to distinguish the two hypotheses.
A third sighting with no diagnosis would be a third hour spent on the fork.
