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

## The arithmetic names the shape

`BUF_BYTES` is `1 << 17` = 131,072 and `INLINE_BYTES` is 4,096.

    got  131,625 = 131,072 + 553      one full pooled buffer, then 553 bytes
    want 179,994
    lost  48,369

So the answer arrived as **one complete pooled buffer and one short final piece**, and the reader
stopped — which means that second piece was published with a status that was not `STATUS_MORE` while
48,369 bytes were still owed. 553 is under `INLINE_BYTES`, so the short piece is the shape of a
*final* inline write.

`write` sets `S_RES_STATUS` to `STATUS_MORE` exactly when `tail.length > 0`, so the status followed
the tail it had. The question is therefore not "why was the status wrong for that tail" but **"why
was the tail short"** — something replaced or dropped `pending[slot]` between the first piece and the
continue.

`pending` and `finalStatus` are indexed by **slot**, and a slot outlives the call in it. Both are
written inside `write`, which runs *through the scheduler* — `sched.ready(bridgeId, slot, () => write(…))`
— so the store into `pending[slot]` happens at whatever moment the scheduler chooses, while the
`OP_CONTINUE` that reads it is handled inline. Two answers for one slot, one deferred and one not, is
the interleaving to reason about first. That it appeared under `seeded` and not under `off` is
consistent with that and is one observation, not a pattern.

## Where to look

`write` in `host/respond.ts` fills the chosen room, then `attach`es a pooled buffer and sets
`S_RES_LEN`, and hands the tail back through `STATUS_MORE`. The pieces a reader must reassemble are
the inline area, a pooled buffer when one was free, and each `OP_CONTINUE`. A truncation means one
piece was not asked for or not written — and the answer arrived *short but well-formed*, so whatever
decided it was complete believed it.

`finalStatus[slot]` is the other thing in that path that outlives a single write.

## Two host-side hypotheses ruled out by reading — 2026-08-15

Both were mine, and neither survives the code, so they are written down to save the next person
forming them.

- **"A cancel leaves the tail behind."** It does not. `abandon(slot)` sets `pending[slot] = null` and
  `partial[slot] = []` and releases both buffers, so a slot handed back carries nothing forward.
  There are exactly four writes to `pending`: the tail is set in `write`, cleared when `write`'s
  publishing CAS loses, cleared by `abandon`, and taken-and-cleared by the continue.
- **"A continue can be served for a dead call."** It cannot reach one. The handler takes the slot with
  a `ST_PENDING -> ST_RUNNING` compare-and-exchange before it looks at the op, so an `OP_CONTINUE` is
  only handled for a slot a live worker has just submitted on, and the answer it produces goes through
  `write`'s generation check on the way out.

So the host's bookkeeping for a tail looks maintained on every path I can see. That moves the
suspicion to the **guest** side — `host/call.ts`'s collect loop, which is the half of this exchange I
have not read: what it does with `STATUS_MORE`, when it decides an answer is complete, and what it
does if a piece arrives while it is between reads.

Worth saying plainly: *"looks maintained on every path I can see"* is weaker than a proof, and this is
a bug that appears once in a full suite run. The next person should not treat the two paragraphs above
as settled so much as already-tried.

## Why this is worth a number rather than a retry

Because the evidence exists now and will not next time. It took a message that names what it found
rather than what it wanted, and that message is one run old — the same failure has been seen at least
twice before (0155, and the run 0155 itself reports) with nothing to distinguish the two hypotheses.
A third sighting with no diagnosis would be a third hour spent on the fork.
