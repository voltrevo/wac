# 0308 — dropping a ticket throws away an answer that had already arrived

- **Status:** open
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — bytes read off a stream are discarded, **0 of 10 kept on both hosts**

## What `0307b` did not cover, and what I said about it was wrong

[0307b](../closed/0307b-the-wasmtime-host-still-drops-an-unclaimed-datagram-0207s-fix-landed-in-one-host.md)
fixed the case where the ticket is **already dead** when the bytes arrive: `Stream::read_unless`
declines to take them at all. This is the other order — the bytes arrive first, `complete` files them
under a still-live ticket, and only *then* does the caller give up. `drop` finds an answer in hand
and discards it.

I closed `0307b` calling this "the narrowest path of all" and left it as a comment in the source.
**Both halves of that were wrong.** It is not narrow and it is not unmeasured:

| host | control (no give-up) | gives up after the answer landed |
|---|---|---|
| wasmtime | 6/6 kept | **0/10 kept** |
| v8 | 6/6 kept | **0/10 kept** |

Deterministic, on both hosts. The control arm is what makes that evidence rather than a broken
probe: it skips the give-up and nothing else, and keeps the payload every time.

## The shape that reaches it

The probe gives up without looking, which exaggerates. The realistic one does not:

    Pending<Read> p = cli.recv(h);
    if (core.waitAny(i32[](p.id), ms) < 0) {   // the deadline — but the answer may have landed
      p.cancel();                              // ...and this throws it away
      core.cancel(p.id);
    }
    // ...retry, and the bytes are gone

`waitAny` returning -1 means *"not settled by the deadline"*, and the window between that answer and
the `cancel` is one the bytes can land in. This is the idiom `std/platform.wac` documents for a
bounded read, and `packages/tor` uses it in three places.

## Why the fix needs a ticket's handle

`drop` is given a ticket id, and an id does not say which stream it was reading — so there is
nowhere to put the bytes back. The v8 host already solves exactly this for datagrams: a
`receiving: HashMap<ticket_id, handle>` filled when the `receiveFrom` ticket is created and consulted
on drop, which is `issues/system/0207`. Reads need the same map.

Then, given the handle, the bytes go back the way `0307b` established: **into the queue** for a
child's stream, because another reader may be parked on it and a side table is somewhere it will
never look; into the per-handle table for a socket, which has no queue to return to.

## What to do

- `reading: HashMap<ticket_id, handle>` on both hosts, filled at the single `submit` in `Cap::Recv`,
  cleaned where the read completes and at the two synchronous discards so it cannot grow without
  bound.
- `Cap::Discard` (wasmtime) and `Cap::Drop` (v8) consult it and hand the bytes back.
- Measure against the 0-of-10 baseline above, not against a single green run —
  `0307b` took three wrong answers because a small sample said yes each time.
