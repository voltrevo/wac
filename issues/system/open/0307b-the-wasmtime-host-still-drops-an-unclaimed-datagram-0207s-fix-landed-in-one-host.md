# 0307 — the wasmtime host still drops an unclaimed datagram: `0207`'s fix landed in one host only

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — a datagram arrives, is read by nobody, and is gone. Exactly
  [0207](../closed/0207-a-dropped-receivefrom-ticket-leaves-a-reader-that-eats-the-next-datagram.md),
  which is closed, on the host that was not changed.

## Corrected before it was pushed: not the datagram, and not `receiveFrom`

**The first version of this said the wasmtime host still had `0207`'s datagram bug. It does not, and
I had not looked at the path that would have it.** `Cap::ReceiveFrom` there is *synchronous* — it
calls `sk.recv_from` inline and hands the result to `settle_now`. There is no ticket submitted, no
thread spawned, and therefore no abandoned reader to eat the next datagram. `0207` describes a
reader parked on a socket after its caller gave up, and this host has never had one.

That was inferred from `tickets.rs` alone: the table has the old shape, so I wrote down the bug the
old shape caused *on the other host*, without asking whether anything here reaches it. A table that
can drop an outcome is only a defect where something hands it one that cannot be recreated.

**The blocking `receiveFrom` is its own gap, and it is `0206`** — the issue whose fix made the v8
host asynchronous here. `waitAny` cannot bound a `receiveFrom` on the wasmtime host, because by the
time the ticket exists the call has already blocked. Not filed again; noted so the next reader does
not mistake the synchronous shape for a deliberate choice.

## What is actually wrong, which is the same class one resource over

`Tickets::complete` still drops an outcome nobody claimed:

```rust
pub fn complete(&self, id: i32, outcome: Outcome) {
    let mut inner = self.inner.lock().unwrap();
    if inner.live.remove(&id).is_none() {
        // Cancelled, or completed twice. Dropping the value is right for the first and the only
        // safe answer for the second; either way nothing is waiting for it.
        return;
    }
```

and this host *does* spawn threads whose outcome is a **consumed** resource — three of them, all
reading a stream that only yields its bytes once:

    std::thread::spawn(move || table.complete(id, Outcome::Bytes(stream.read())));   // a child's output
    std::thread::spawn(move || table.complete(id, Outcome::Bytes(answers.read())));  // a parent's replies
    std::thread::spawn(move || table.complete(id, Outcome::Bytes(fed.read())));      // a fed queue

A caller that gives up on one of those — a bounded `waitAny` that hits its deadline — leaves the
thread reading. The bytes arrive, `complete` finds the id gone, and they are dropped. The peer will
not send them again, and the next `recv` on that handle starts after the hole. That is `0207`'s
sentence — *"either way nothing is waiting for it"* — being wrong for the same reason, about a
stream rather than a datagram.

**Unmeasured.** Unlike `0306b` there is no reproduction here yet: it needs a bounded `recv` on a
child's output that times out while the child is mid-write, and then a second `recv`. Writing that
is the first job, because the fix is the kind that looks obviously right and cannot be seen working.

## What to do

Give `complete` and `discard` the v8 host's signature — `Option<Outcome>`, `#[must_use]` — so every
site must say what it does with an unclaimed answer, and hand the bytes back at the three sites
above. The v8 host parks an unclaimed *datagram* by handle for the next reader
(`native/v8/src/main.rs`, `Cap::ReceiveFrom`); a stream needs the same idea, pushed back to the front
of the queue rather than to a side table.

Worth asking whether these two tables should be one file. They are near-identical by intent, they
have now drifted in both directions in a day, and `CLAUDE.md` says a second copy of anything is a
copy that drifts.
