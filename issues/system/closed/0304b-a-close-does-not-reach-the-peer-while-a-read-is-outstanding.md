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

## All four hosts, and the default was the only one wrong

Two rows of this were "could not ask" when it was closed. They are answerable by reading, and the
answer is sharper than the probe would have been:

| host | what `closeSocket` does | verdict |
|---|---|---|
| wasmtime (`native/`) | `s.shutdown(Shutdown::Both)`, then closes the handle | already correct |
| Deno | explicit teardown | correct — the probe passes on it |
| Node (`host/nodeNet.js`) | `close: () => sock.destroy()` | correct — explicit |
| **v8 (`native/v8/`)** | removed the entry and let the `TcpStream` drop | **the bug** |

**And the right pattern was fifteen lines away.** `closeSend` — the half-close from
`issues/system/0215` — does `s.shutdown(Shutdown::Write)` on the socket fetched by handle, in the
same file, in the neighbouring capability. So this was not a host that did not know how to shut a
socket down; it was one place that reached for the drop instead, next to one that did not.

So the fix applied here is what the *other* Rust host has been doing all along, and the one that was
wrong is the default. That is the useful part: it was not a misread contract shared across hosts —
three of four call an explicit teardown, and only this one relied on a value going out of scope,
which stops being a close the moment `recv` has taken its own descriptor with `try_clone`.

`packages/tor/test/wac/socksnet_test.wac` now asserts the close and runs in ~4s instead of ~14s.

## The same shape remains for listeners, and the symmetric fix does not exist

Applying the mechanism rather than the symptom: `recv` is not the only capability that duplicates a
descriptor. `accept` does `l.try_clone()` on a `Sock::Listener`, and the match this fix added handles
`Queue` and `Stream` with `_ => {}` over `Listener` and `Datagram`. So closing a listener while an
`accept` is parked drops one descriptor and the clone holds the port.

**Left as a note rather than fixed, for two reasons.** `std::net::TcpStream` has `shutdown` and
`TcpListener` does not, so the one-line fix has no counterpart — closing a listener properly means
tracking the clone or going to the raw descriptor, which is a different change. And nothing here can
show an effect: every server in this repository closes its listener at process exit, where the
operating system reclaims the port anyway. A long-running program that closed a listener and expected
the port free would see it.

Recorded so the next person to meet it does not have to rediscover `try_clone` to explain it.
