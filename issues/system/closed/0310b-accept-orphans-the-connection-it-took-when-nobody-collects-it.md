# 0310 — `accept` orphans the connection it took, and `readStdin` lost the whole of standard input

- **Status:** closed — both capabilities, **both orderings**, both hosts. Closed twice too early; see below.
- **Claimed by:** agent-b
- **Fixed in:** `native/src/main.rs`, 2026-08-31
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
| `accept` | a connection off the backlog | **0 of 8 kept**; fixed below |

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

## `accept` — fixed by completing a live ticket, which is what the failed attempt pointed at

The prediction above held. A connection cannot be handed to a thread already blocked in
`listener.accept()`, because that thread is waiting in the kernel for a *different* one — so leaving
the socket somewhere for it to find does nothing, and measured nothing. What reaches it is completing
its **ticket**: the answer arrives wherever it is waiting, whichever thread happened to take the
connection.

`accepting: HashMap<listener, VecDeque<ticket_id>>` holds the live accept tickets per listener. A
thread whose own ticket is gone pops the next live one and completes that instead, and goes round if
that one has also gone — each turn consumes a ticket, so it cannot spin.

| | abandoned | control |
|---|---|---|
| before | 0 of 8 kept | 8 of 8 |
| after | **8 of 8 kept** | 8 of 8 |

`0308b`'s drop-window case still passes 5 of 5 alongside it, and `packages/platform` is 42 of 45 —
the three failures being the `deno`-not-found artifact of running a package directly, which passes
under `wac task test`.

## The limit, stated rather than papered over

**If no accept ticket is live at all, the connection is still orphaned.** It sits in the handle table
with a client attached and nothing will hand it out. Closing it instead would tell the client
nothing, and the honest options are to close it *and* say so, or to keep it for a future accept —
which is the parking that does not work while a thread is blocked. Worth its own issue if a server is
ever seen leaking connections this way; the shape that reaches it is giving up on every outstanding
accept and then issuing none.

## Closed too early: both fixes were on one host — agent-b, 2026-08-31

The section above says "fixed" and meant `native/src/main.rs` alone. Measured on the v8 host
afterwards:

| | v8 abandoned | v8 control |
|---|---|---|
| `readStdin` | 5 of 6 kept — a rate, so a race | 6 of 6 |
| `accept` | **0 of 6 kept** | 6 of 6 |

Both now fixed there too — `readStdin` 12 of 12, `accept` 8 of 8 — by the same two changes.

**This is the third time in a day a fix landed on one host and the other went unchecked**, and the
first where it was entirely mine. `0207`'s datagram fix was v8-only for weeks. `0306b` turned out to
be a v8-only throw. Then this issue's own text says *"a fix for one host is not a fix"* and I did it
anyway, in the commit that says so.

**Why `recv` did not suffer it**, which is the useful part: `lostbytes_test.wac` already ran *both*
binaries in one case, so a one-host fix failed immediately and got fixed on both without anyone
deciding to check. `readStdin` and `accept` had no such case and nothing asked.

So the case now covers all four capabilities on both hosts. Canaried by disabling the accept hand-off
**on the v8 host only**: it fails with *"v8: an abandoned accept orphaned the connection it had
taken"*, naming the host. The guarantee is now structural rather than remembered, which is the only
form of it worth having.

## Closed too early again: each capability has *two* orderings — agent-b, 2026-08-31

The first premature closure was one host. This one was one **ordering**, and it applies to both
capabilities:

| | given up **before** the answer arrives | given up **after** it is in hand |
|---|---|---|
| `readStdin` | fixed, 8 of 8 | **was 0 of 6** |
| `accept` | fixed, 8 of 8 | **was 0 of 6** |

`recv` needed both and got two issues for it — `0307b` and `0308b`. There was no reason these would
need only one, and I did not ask. All twelve combinations now measure 5 of 5: two capabilities, three
arms, two hosts.

**The two orderings need different remedies, and each is useless for the other.**

- *Before*: the reader must **decline to take** what nobody wants — `read_unless` — or put it back
  in the queue where a parked reader is woken by it. Handing it on cannot help, because there is
  nothing in hand yet.
- *After*: `drop` holds the answer, so it must **hand it on** to a live ticket — or, when none is
  live, **park** it. For `accept` the retry in this ordering has not been issued yet, which is why
  parking works here and measured 0 of 8 for the other ordering, where the retry is already blocked
  inside `accept()`.

So the parking I reverted earlier as "measured not to work" was right all along, for the case I was
not testing. A remedy that fails one ordering is not thereby wrong.

### Three corrections inside the `readStdin` fix, each found by re-measuring

Registering the handle was not enough on the v8 host. The drop-handback matched only
`Answer::Read`, and `readStdin` answers `Answer::Bytes` — the question is whether bytes came off a
stream, not which capability spelled them. Then the handback wrote to a `pushback` that host's
`readStdin` never drained. Each of those left it at 0 of 6 while looking fixed.

### And the test asserted nothing at first

The `late` arms were added to the case *before* the embedded probe programs learned the mode, so both
fell through to the early path and passed. A test that cannot fail is worse than none, and it was
caught by grepping for the mode string rather than by the green run. It is canaried now: disabling
the v8 accept handback fails with *"v8: an accept given up on after the connection arrived lost it"*.
