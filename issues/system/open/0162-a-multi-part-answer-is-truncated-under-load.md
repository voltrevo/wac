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
- **Not reproducible on demand, and two ways of trying have failed.** Three targeted re-runs pass,
  and so do **twelve concurrent copies** of the fuzz — four at a time, three rounds — under the
  `seeded` policy this appeared in. So it is not concurrency among fuzz processes; it wants whatever
  the full suite is doing to the machine at that moment. Worth knowing before spending an afternoon
  on a loop: the same two attempts were made for `issues/system/0155` and failed the same way. Same as 0155: the seeded scheduler
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

## The guest side, read — one asymmetry, not a diagnosis

`collect` in `host/call.ts` takes pieces in a loop: wait for `ST_READY`, read the status, copy the
chunk out, push it, and if the status was `STATUS_MORE` ask again. The reassembly itself is a
straight concatenation of everything it pushed, so a short answer means it *stopped asking* — it saw a
status that was not `STATUS_MORE`.

What stands out is how it asks:

```ts
Atomics.store(b.ctrl, at + S_OP, OP_CONTINUE);
Atomics.store(b.ctrl, at + S_REQ_LEN, 0);
Atomics.store(b.ctrl, at + S_STATUS, ST_PENDING);   // a plain store
ping(b);
```

**Every other status transition in this ring that could race is a compare-and-exchange**, and each
carries a comment about what a plain store cost: `take` uses one so two claimers cannot both win;
`write` publishes with one because a plain store overwrote `ST_CANCELLED` with `ST_READY` and stranded
a slot for the life of the program; the sweep takes `ST_PENDING -> ST_RUNNING` with one for the mirror
reason. This is the one place a status is published with a bare store.

**That is an asymmetry and not a diagnosis.** I could not construct the losing interleaving: at this
point the worker owns the slot, the host wrote `ST_READY` and is done with it, and the worker is the
only party that moves a slot back to `ST_PENDING`. It may be perfectly safe and simply undocumented,
which is worth knowing either way — every neighbouring store says why it is a CAS, and this one says
nothing.

Whoever takes this should either write the comment that explains why a store is enough here, or find
the race. Both outcomes are worth the reading.

## Why this is worth a number rather than a retry

Because the evidence exists now and will not next time. It took a message that names what it found
rather than what it wanted, and that message is one run old — the same failure has been seen at least
twice before (0155, and the run 0155 itself reports) with nothing to distinguish the two hypotheses.
A third sighting with no diagnosis would be a third hour spent on the fork.

## A mechanism for the cancel-heavy prefix, from reading — agent-b, 2026-08-31

This issue notes *"96 cancelled and 105 spent by then"* and calls a cancel-heavy prefix the shape the
ring's hardest interleavings live in. Here is a way that prefix could truncate an answer, offered as
a **hypothesis from reading** rather than a measurement — nothing below has been reproduced.

`cancel` in `host/call.ts` has a fast path for a slot whose answer has already arrived:

    if (Atomics.load(b.ctrl, at + S_STATUS) === ST_READY) { release(b, t.slot); return; }

`release` frees the response buffer, bumps the generation and stores `ST_FREE` — so the slot is
**immediately reusable**. What it cannot do is clear `pending[slot]`, `partial[slot]` or
`finalStatus[slot]`, because those live in `host/respond.ts` on the other side of the bridge and
`call.ts` cannot reach them. Only `abandon` clears them, and this path never reaches `abandon`.

So cancelling a **multi-part** answer between its first chunk and its `OP_CONTINUE` leaves a tail
attached to a slot that is free for the next call. The `ST_PENDING → ST_RUNNING` exchange in the
`OP_CONTINUE` handler guards a cancel landing *between the sweep and there*; it does not notice that
`pending[slot]` belongs to a call that no longer exists.

**What would confirm or kill it**, cheaper than reproducing the fuzz failure:

- ~~Whether `abandon` is reached for a slot cancelled at `ST_READY`.~~ **Checked: it is not.** The
  sweep is `if (st === ST_PENDING) take(s); else if (st === ST_CANCELLED) abandon(s);` and nothing
  looks at `ST_FREE`. A slot the fast path released straight to free is never visited again, so its
  `pending[slot]` is never cleared. That does not make the hypothesis true — it removes the cheapest
  way it could have been false.
- ~~Whether a multi-part answer can be cancelled mid-sequence.~~ **Checked, and it refines the
  hypothesis rather than killing it.** `collect` is a synchronous loop — `awaitReady` blocks and the
  slot is held across every chunk — so the *collecting* caller can never cancel between them. The
  window is a different one: a `Pending` the guest **abandons without ever collecting**, whose first
  chunk the host has already written with `STATUS_MORE`. `S_STATUS` is then `ST_READY`, `cancel`
  takes the fast path, and the tail is left behind. That is precisely `issues/system/0311b`'s path,
  which is measured at 5 of 5 on the Deno host for a single-part answer.
- `pending[slot] !== null` at the moment a slot is handed out would be a cheap assertion, and it
  fails *loudly* where this fails as 48,369 missing bytes.

Related: `issues/system/0311b` is about the same `release` call discarding a completed answer, which
is how I came to be reading it. Its measurement is 5 of 5 on the Deno host, but for a *single*-part
answer; this is the multi-part consequence of the same line, and is unmeasured.

### Followed to the end, and the mechanism does not deliver — agent-b, 2026-08-31

**Retracting the truncation claim above.** The three legs hold and the conclusion does not.

What is true: `cancel`'s fast path releases a slot without reaching `abandon`, the sweep looks only at
`ST_PENDING` and `ST_CANCELLED` so it never revisits a freed slot, and `pending[slot]` is therefore
left set. Multi-part answers are reachable from an abandonable `Pending`, since `write` splits
anything past the pooled buffer and the reported answer — 179,994 bytes — is past it.

What is missing is a path that ever **reads** the stale value. `pending[slot]` is consulted only when
`op === OP_CONTINUE`, and only `collect` sets that, on a slot it owns, for an answer whose first
chunk said `STATUS_MORE`. So:

- if the next call on that slot is **multi-part**, `write` overwrites `pending[slot]` with its own
  tail before its guest can ask for it;
- if it is **single-part**, `OP_CONTINUE` is never sent and the stale tail is never read.

Either way nothing stale is delivered. The leftover state is real and untidy — an assertion that
`pending[slot]` is null when a slot is handed out would still be worth having, and would cost
nothing — but it is not this bug.

**Recorded rather than deleted**, because the next reader will notice the same asymmetry between
`release` and `abandon` and should not have to re-derive why it is harmless. `issues/system/0307b`
was filed this morning off exactly this kind of shape, where the dangerous-looking pattern was real
and the path that would reach it was not.

### One variant of "two answers for one slot" is ruled out — agent-b, 2026-08-31

The section above asks which interleaving replaces or drops `pending[slot]` between the first write
and the continue, and names *two answers for one slot, one deferred and one inline* as the thing to
reason about first. One of the ways that could happen is not available, which narrows it:

**A late `write` for a slot that has been recycled cannot touch `pending[slot]`.** `write` opens with

    if (Atomics.load(b.ctrl, at + S_GEN) !== gen) return;   // recycled; this answer is for a dead call

and the store into `pending[slot]` is *after* that guard, not before. So call A's deferred write
arriving after A was cancelled and the slot handed to B returns without writing anything — it cannot
overwrite B's tail, and it cannot install a tail of its own for B's `OP_CONTINUE` to collect.

That leaves the interleavings where **both** writes belong to live calls on the same slot, which is
the harder question and the one the section above was already pointing at. Written down so the
generation-check variant does not have to be re-derived; it is the first thing that looks like it
would explain this and it does not.

### And the intra-`write` ordering is sound, so deferral alone does not open a window

The section above notes that `write` runs through the scheduler while the `OP_CONTINUE` that reads
`pending[slot]` is handled inline, and asks about the interleaving. Within a single `write` there is
no window, because the stores are in the right order:

    Atomics.store(S_RES_LEN, fits);
    Atomics.store(S_RES_STATUS, tail.length > 0 ? STATUS_MORE : status);
    pending[slot] = tail; finalStatus[slot] = status;      // before publication
    …
    Atomics.compareExchange(S_STATUS, ST_RUNNING, ST_READY)   // the release barrier

A guest blocks in `awaitReady` until that exchange, so it cannot ask for a tail that has not been
recorded. Deferring the whole of `write` moves all of it together, which the guest cannot observe.
The losing-exchange path also sets `pending[slot] = null` rather than leaving it, so a write that
loses the slot cleans up after itself.

**What the arithmetic still wants explaining.** After a 131,072-byte first piece the tail owed is
48,922, and any `reply` of that tail would deliver either all of it (a pooled buffer is big enough)
or 4,096 of it with `STATUS_MORE` (if the pool were empty and it fell to the inline area). Neither is
553. So the second write's *body* really was 553 bytes — `pending[slot]` held something that was not
this call's tail — and the two eliminations above say it was not a late write for a recycled slot and
not a torn store within one write. That is worth knowing before the next attempt.
