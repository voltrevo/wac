# 0304 — `closeSocket` does not reach the peer while a `recv` is outstanding

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** no error. A server closes a connection and the client, reading to end-of-stream,
  never sees one — it waits until its own deadline, or for ever if it has none.

## The measurement

`packages/platform/test/wac/closeaftercancel_test.wac` is three arms that differ only in what is
outstanding on the server's socket when it calls `closeSocket`:

| what is outstanding at the close | what the client sees |
|---|---|
| nothing | `End` — correct |
| a **live** `recv` | nothing, for 3s, then the deadline |
| a **cancelled** `recv` | nothing, for 3s, then the deadline |

So a close is delivered when the socket is idle and swallowed when a read is pending. The control is
the load-bearing row: without it this reads as a harness that never sees a close at all.

## It is not about cancelling, and the first version of this issue said it was

This was filed as *"`socks` does not close a client's socket when its stream ends"*, because
`socks.wac` cancels a pending `recv` before closing and `dird.wac` — whose peers do see `End` —
does not. That made cancellation the obvious suspect and it is wrong: the **live-read** arm fails
exactly as the cancelled one does. The cancel is a coincidence of that code path.

The first draft of the probe could not have told the difference: it issued the `recv` in *both* arms
and called the uncancelled one "the control", so both arms failed and the control failed with them.
A control that fails for the same reason as the case proves nothing. Three arms is the smallest set
that separates "cancel breaks it" from "any outstanding read breaks it".

## Why it has not been seen before

Because a close only matters to whoever is reading, and almost nothing in this repository reads a
socket it did not open. `dird.wac`'s clients do, and `dird` has no read outstanding when it closes —
it reads a request, answers, closes. `socks.wac` is a proxy: it always has a `recv` parked on the
client while the stream runs, so it always closes into this. It is the first program here anything
ever spoke to and then read from to end-of-stream (`issues/system/0303b`).

Every server that keeps a read parked on a connection and then closes it has this, and the shape is
common enough that the correct assumption is that others do.

## What it costs

A client that reads to end-of-stream hangs. `packages/tor/test/wac/socksnet_test.wac` spends ~10s of
its ~14s waiting out a deadline for this, and asserts the bytes and the proxy's own
`stream 1 ended: done` rather than the close, so the suite is not red for it. A proxy also leaks a
connection per request against `MAX_CONNS`, since the socket is never released.

## What would close it

The probe is written and fails on two of its three arms, so this is reproducible in six lines
without any of Tor in the way. Whether the fix is in the host's socket handling or in what
`closeSocket` does with an outstanding call is the open question — `Pending.cancel()` runs the host's
`drop` while a continuation registered by `then` is only taken back by `Core.cancel(id)`
(`issues/lang/0300b` records the same pairing), and a socket held by a call nobody took back would
behave exactly like this.

When it is fixed, `socksnet_test.wac` can assert the close and gets three times faster.
