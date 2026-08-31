# 0307 — the wasmtime host still drops an unclaimed datagram: `0207`'s fix landed in one host only

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — a datagram arrives, is read by nobody, and is gone. Exactly
  [0207](../closed/0207-a-dropped-receivefrom-ticket-leaves-a-reader-that-eats-the-next-datagram.md),
  which is closed, on the host that was not changed.

## The closed issue quotes the code that is still there

`0207` fixed this by making `Tickets::complete` and `Tickets::drop_ticket` **hand back an answer
nobody took**, so a caller that gave up can return the datagram rather than discard it — a
computation can be run again, a packet read off a socket exactly once cannot.

That landed in `native/v8/src/tickets.rs`, where both functions are `#[must_use]` and answer
`Option<Answer>`. `native/src/tickets.rs` — the wasmtime host — still has the version `0207` quotes
as the bug, down to the comment:

```rust
pub fn complete(&self, id: i32, outcome: Outcome) {
    let mut inner = self.inner.lock().unwrap();
    if inner.live.remove(&id).is_none() {
        // Cancelled, or completed twice. Dropping the value is right for the first and the only
        // safe answer for the second; either way nothing is waiting for it.
        return;
    }
```

`discard` is the same shape: it removes from `done` and answers nothing, so a datagram that landed
between the caller giving up and the call is dropped on the floor. "Either way nothing is waiting for
it" is the sentence `0207` disproved — the *socket* is waiting for it, and the peer will not send it
again.

## Why it was not noticed

Found while diffing the two hosts' ticket tables for `0306b`, not by a failing test. The datagram
tests need `--unstable-net` and run against the default host; the wasmtime host is not built by
default at all (`0208`), so eleven test files skip with a reason rather than covering it.

**A fix for one host is not a fix**, and this is the second time today the two Rust hosts have
disagreed in a way nothing checked: `0306b` was the v8 host throwing where this one answers, and this
is this one dropping where the v8 host answers. They diverge in both directions.

## What to do

Port `complete` and `drop_ticket`/`discard` to return the unclaimed outcome and make the call sites
hand it back, mirroring `native/v8/src/tickets.rs`. `#[must_use]` is what makes the port checkable —
it turns every site that ignores an answer into a warning.

Worth asking at the same time whether these two tables should be one file. They are near-identical by
intent and have now drifted twice; `CLAUDE.md` says a second copy of anything is a copy that drifts.
