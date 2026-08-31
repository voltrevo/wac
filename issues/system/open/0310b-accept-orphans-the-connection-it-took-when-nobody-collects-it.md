# 0310 — `accept` orphans the connection it took, and `readStdin` lost the whole of standard input

- **Status:** open — the `accept` half. `readStdin` is fixed below.
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** a client is connected to a handle nothing will ever hand out, and waits for nothing

## Found by enumerating siblings, not by anything failing

`0307b` and `0308b` fixed `recv`. The question they raise is which *other* capabilities consume
something irreplaceable and hand it to a ticket that may be gone. There are four, and two were
broken:

| capability | consumes | state |
|---|---|---|
| `recv` | bytes off a queue or socket | fixed — `0307b`, `0308b` |
| `receiveFrom` | a datagram | fixed on v8 by `0207`; synchronous on wasmtime, so it cannot arise |
| `readStdin` | the whole of standard input | **1 of 8 kept**; fixed below |
| `accept` | a connection off the backlog | **0 of 8 kept**; open |

Both measured against controls that keep the payload 8 times in 8.

## `readStdin` — fixed

An abandoned `readStdin` read to EOF anyway and dropped the lot: the retry saw nothing, because
"everything" had already been taken. It now uses `Stream::read_unless` on a child's feed, so a dead
ticket stops the read rather than draining it, and puts back what it had already gathered; the
process's own input has no queue to decline from and hands back under `STDIN_HANDLE` instead, which
the next `readStdin` takes before reading more. **8 of 8 after, from 1 of 8.**

## `accept` — measured, and the obvious fix does not work

The accept thread takes a connection, **puts it in the handle table**, and completes. If the ticket
was given up on, the answer is dropped and the socket stays in the table: a live client attached to a
handle that will never be handed out, and an entry never freed.

`packages/tor/src/socks.wac` arms an accept and cancels it, so this is a shape we actually write.

**Parking the connection under the listener for the next `accept` was tried and measured at 0 of 8,
unchanged.** By the time the abandoned thread parks anything, the retry's thread is already blocked
inside `listener.accept()`, and nothing can hand a connection to a thread waiting in the kernel for a
different one. It waits for a *second* client that never comes. The parking helps only if the next
accept is issued after the parking, which is not the pattern that loses.

So the fix has to **complete the other ticket** rather than leave a socket somewhere for it to find:
track the live accept tickets per listener, and when a connection arrives for a dead one, give it to
a live one. That leaves a thread blocked in `accept()` with no ticket, which is the next question —
it will wake on some later connection and find its own ticket gone, which must not cascade.

Closing the orphan instead is defensible and worse: the client is told nothing and has to guess.

## The comment that hid both of these

Both sites carried `// Nothing was consumed to make this, so there is nothing to hand back.` — one
blanket sentence a script wrote across twelve `let _ =` annotations while fixing `0307b`. It is false
at three of them, and it made two real defects read as considered and dismissed. The others were
re-read and hold. A mechanical edit that writes a *claim* rather than a marker is worth avoiding.
