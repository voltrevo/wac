# 0304 — `socks` does not close a client's socket when its stream ends, so the client waits forever

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** no error. The whole response arrives, the proxy logs `stream 1 ended: done`, and a
  client reading to end-of-stream never sees one.

## The measurement

`packages/tor/test/wac/socksnet_test.wac` carries an HTTP request through a three-hop circuit of our
own relays. Every byte arrives — **2,561 of them**, which is the number the exit relay reports
writing:

    relayd: [2]  stream 1 on handle 3 closed by the far end after 68 bytes in, 2561 bytes out
    socks:       stream 1 ended: done

and then nothing. A reader waiting for `End` waits until its deadline. Without a deadline it waits
for ever: the first version of that test hung for six minutes and produced **no output at all**,
because `wac test` buffers a file's output until it finishes.

## Where it is

Both paths that end a client do the same two things in the same order:

    if (c.reading) { c.read.cancel(); }
    cli.closeSocket(c.sock);

— `dropClient` at `packages/tor/src/socks.wac:113`, and the `gotEnd` branch at :320. The `gotEnd`
branch is the one this case takes, and it is reached: the log line above is printed two lines before
the close.

So the close is *issued*, on the right handle — `Client c = clients.get(target)` and
`clients.swapRemove(target)` use the same index, which was the first thing I checked given this
file's own warning that a slip there "routes a stranger's bytes".

## What is different about it

`dird.wac` closes a client the same way and its peer sees `End` — `dird_test.wac`'s `servedWithin`
depends on that and passes. The difference is the **cancelled read**: `socks` has a `recv` pending on
the client socket when the stream ends, cancels it, and closes. `dird` closes without one
outstanding.

That makes the hypothesis testable and small: does `closeSocket` deliver a FIN when a just-cancelled
read is outstanding on that socket? A probe that accepts a connection, issues a `recv`, cancels it,
closes, and asks whether the peer sees `End` would answer it without any of Tor in the way.

**It may be `socks`'s bug rather than the platform's** — `Pending.cancel()` runs the host's `drop`,
while a continuation registered by `then` is only taken back by `Core.cancel(id)`, and code that does
one and not the other leaks the slot (`issues/lang/0300b` records the same pairing). If the socket is
held by a continuation nobody took back, the close cannot complete and the symptom is exactly this.

## Why it matters beyond a test

A proxy that never closes a finished stream's socket leaks a client connection per request against
`MAX_CONNS`, and every SOCKS client in the world reads to end-of-stream. Nothing had noticed because
nothing had ever spoken SOCKS5 to this program: `issues/system/0303b` is that account, and this is
the first bug its test found after the port one.

## What would close it

The probe above, then either the platform fix or the missing `Core.cancel`. The test asserts the
bytes and the proxy's own `stream 1 ended: done`, and deliberately does **not** assert the close, so
the suite is not red for a bug that is written down. It also spends ~10s of its ~14s waiting out the
deadline this causes, so fixing it makes that case three times faster.
