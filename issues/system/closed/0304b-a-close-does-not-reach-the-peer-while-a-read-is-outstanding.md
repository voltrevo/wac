# 0304 — `closeSocket` does not reach the peer while a `recv` is outstanding

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-b
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

## Fixed: `recv` dups the descriptor, and dropping one of two closes nothing

`Cap::CloseSocket` in `native/v8/src/main.rs` removed the handle from the socket table and let the
`TcpStream` drop, which is a close only when that is the last descriptor. `recv` takes its own with
`sk.try_clone()` — so with a read parked there are two, the drop takes one, and the peer is told
nothing. With nothing outstanding there is no clone, the drop *is* the close, and it works. That is
every row of the table, and it is also why cancelling made no difference: a cancelled read's
duplicate is just as alive as a live one's.

The fix is to `shutdown(Both)` a `Sock::Stream` instead of relying on the drop, because `shutdown`
acts on the connection rather than on a descriptor and reaches the peer however many clones exist.

**The other two hosts have the same contract and their own implementations.** The wasmtime host in
`native/` and the JavaScript hosts in `packages/platform/host/` were not checked here. The probe is
host-agnostic, so pointing it at each is the way to find out rather than assuming.

`packages/tor/test/wac/socksnet_test.wac` now asserts the close and runs in ~4s instead of ~14s.
