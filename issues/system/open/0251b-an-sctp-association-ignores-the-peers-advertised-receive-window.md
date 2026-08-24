# 0251b — an SCTP association ignores the peer's advertised receive window

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-24
- **Kind:** missing feature
- **Symptom:** not implemented

`packages/webrtc/src/sctp.wac` exports an accessor for the receive window a peer announces in its
INIT, and nothing calls it:

```wac
/** The advertised receiver window an INIT or INIT-ACK carries. */
export i32 initWindow(u8[] value) { … }
```

`Association.receive`'s INIT branch reads `initiateTag` and `initTsn` out of `c.value` and leaves
`initWindow` alone. `Association.of(ourTag, initialTsn, window)` takes **our** window; there is no
field for the peer's. So this end does congestion control against its own `cwnd` and no
receiver-side flow control at all: the peer says how much it will accept before an acknowledgement,
and we never look.

## Reproduction

There is nothing to run — it is an absence. `grep -rn initWindow packages/` finds the definition and
one probe, and no caller.

Expected: a peer that advertises a small window is sent no more than that before it acknowledges.

Actual: `send` is bounded by `cwnd` and by the flight table's capacity, neither of which the peer
chose.

## Notes

**What it costs.** Overrunning a peer that asked for less degrades rather than corrupts — the peer
drops what it cannot hold and the retransmit machinery recovers it — so this is slow rather than
wrong. That is why it is a missing feature and not a bug. It matters most against a receiver that is
genuinely constrained, which on the open internet is the common case rather than the exotic one.

**Its twin was a bug, and that half is fixed.** `initTsn` was unread in the same branch of the same
function, and the consequence was not degradation. The association took whichever DATA chunk arrived
first as its cumulative point — a claim that everything below it had arrived — so one reorder made it
acknowledge a chunk still in flight, refuse the real one as a duplicate when it landed, and never name
it in a gap block. The peer stopped resending; the payload was lost with both ends believing
otherwise. Fixed 2026-08-24 by seeding the cumulative point from the peer's declared start, with
`test_the_peers_declared_first_tsn_is_believed_over_the_first_to_arrive` in
`packages/webrtc/test/wac/sctp_test.wac`.

**The pair is the reason this is filed rather than left in the ledger.** Both accessors were recorded
in `packages/webrtc/test/cov_ledger.wac` as uncovered entries with near-identical notes, ending *"a
gap in the implementation rather than in the tests. Recorded as such."* They read the same and only
one of them was harmless. A coverage ledger is read by someone moving a number; an implementation gap
has to be findable by someone deciding what to implement, and the wrong home for it is the reason the
bug sat next to the gap for as long as it did.

**What the work is.** `Association` needs a field for the peer's window, set in the INIT branch beside
the two values already read there, and `send` needs to respect it — bytes in flight against the
smaller of `cwnd` and the peer's window, which is what RFC 4960 §6.1 says. The INIT-ACK path does not
need it: this association is only ever the passive side, and `receive` has no INIT-ACK branch at all.
