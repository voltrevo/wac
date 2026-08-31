# 0294 — sshd serves one client at a time, and the shared `Fs` depends on it

- **Status:** open — the decision is answered below and proven on `dird`. What remains is blocked on `issues/lang/0300b`, not on the decision
- **Claimed by:** agent-b, 2026-08-30 — answering the decision and proving it on `dird` first
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** design decision
- **Symptom:** a second client cannot connect until the first disconnects

## What is there

`packages/ssh/src/sshd.wac`'s accept loop is `design/lang/0014` A1's program written blocking:

```wac
while (true) {
  Socket c = cli.accept(listener.handle).wait();
  bool saved = serve(core, cli, c.handle, host, o, fs);   // the whole session
  cli.closeSocket(c.handle);
  if (o.image != "" && !saved) { save(core, cli, "sshd", o.image, fs); }
}
```

`serve` runs a complete SSH session — handshake, then the session loop — so the accept never comes
round until that client has gone. Now that `async`/`await` exists, `async void serve(…)` called
without awaiting is a three-line change and the test that proves the shape already passes
(`packages/platform/test/wac/asyncserver_test.wac`).

## Why it is filed rather than done

**The blocking is load-bearing, and the file says so.** Above the loop:

> Every session gets this same `Fs`, so what one client leaves behind the next one finds — which is
> the whole difference between a demo and a system. Connections are served one at a time by the loop
> below, so "one writer" is true by construction rather than by a lock; the concurrency question
> `design/system/0001` leaves open is not open *here*, and stops being closed the day this serves two
> at once.

So the port does not make a serial server concurrent. It reopens a question that was closed by
construction, and it does it silently — nothing would fail, two sessions would simply be interleaving
writes into one in-memory filesystem.

Two things need answering first, and neither is the lowering's business:

- **What one `Fs` under two sessions means.** Per-session, copy-on-write, or a lock — three
  reasonable answers, and the wrong one is expensive to undo once anything depends on it.
- **When the image is saved.** `save(…)` runs after a session ends, and `saved` distinguishes a
  session that wrote for itself from one that did not. With two sessions overlapping, "after a
  session ends" no longer names a moment when the filesystem is quiet.

## The decision — agent-b, 2026-08-30

**Neither per-session, nor copy-on-write, nor a lock. The question is narrower than all three, and
the answer is a rule about where a suspension may fall.**

`design/lang/0014` D2 settles it: this concurrency is cooperative and single-threaded. `.wait()`
deliberately is *not* a yield point — "3080 existing sites were written when a `.wait()` was a leaf" —
and a continuation runs only at a suspension or under `core.drain()`. So **no two pieces of wac code
ever run at once**, and nothing can observe a half-written value. There are no data races here to
lock against, and nothing to copy defensively.

What there is, is **lost updates across a suspension**, and only that. The rule:

> A read-modify-write of shared state must not straddle an `await`.

That is checkable by reading, it needs no runtime support, and it is the whole of what concurrency
costs a program in this language.

### Why `dird` is unsafe today, stated as that rule

The hazard is not "two requests touch `docs`". It is that `docs` is **threaded through a parameter
and a return value**, so `answer` holds a private copy across its `recv`:

```wac
docs = answer(core, cli, conn, docs);   // caller writes back what the callee captured
```

Two overlapping calls both start from the same `docs`. If A files a descriptor and B — which began
before A returned — writes back the copy it captured, **A's descriptor is gone**, and nothing fails.
The suspension that makes this possible is the `recv` inside `answer`'s own loop, between the read
(`dirStep(pending.bytes(), docs)`) and the write.

So the fix is not to guard the state. It is to **stop copying it out**: hold the mutable part in one
cell, read it where it is used and write it back with no suspension in between. The immutable parts —
the consensus, the certificate, the microdescriptors — are never written and can be shared by
everybody with no ceremony at all.

### What this means for `sshd`'s `Fs`

The same rule, and the same reading. The question is not "what does one `Fs` under two sessions
mean" in the abstract; it is *which operations on it read and then write across an `await`*. A
capability call that reads, suspends, and writes back is the shape to find. `save(…)` after a session
ends is the one the issue already names, and under this rule it is stated precisely: it is not that
"after a session ends" stops naming a quiet moment, it is that `save` must not begin before every
in-flight write has completed — which is a barrier, not a lock.

That is a smaller and more answerable question than the three options above, and it is why `dird`
goes first: it has one mutable field and one writer, so the rule can be proved there before it is
applied to a filesystem.

## `dird` is the same shape, and its state is even more explicit

`packages/tor/src/dird.wac` has the identical loop, and threads its state through the serial
iteration in the source rather than in a comment:

```wac
while (true) {
  Socket conn = cli.accept(listener.handle).wait();
  docs = answer(core, cli, conn, docs);   // each request may update what the next one serves
  cli.closeSocket(conn.handle);
}
```

`docs = answer(…, docs)` only means what it says while one request is in flight at a time. Two
overlapping requests would need `docs` to be shared mutable state, which is the same question `Fs`
raises above — so whatever answers one should answer both, and they are worth deciding together.

There is a reason to want it here that `sshd` does not have: `answer`'s own comment records that a
client which never finishes a request line holds the loop forever, *"and a directory port is
reachable by anyone who can route to it"*. It is capped rather than concurrent, so a slow client
still blocks every other client for as long as the cap allows. Concurrency would remove that
head-of-line block, which makes this the stronger case of the two — and still not a mechanical port.

## What is worth knowing anyway

The survey that found this was looking for packages where `async` is a clear win. Measured across
`packages/*/src`: `.then(` has **no** adoption outside the embedded platform source — 3080 `.wait()`
against 13 `.then(`, all 13 in `coretext.wac`/`emit.wac`. So there is very little callback code to
tidy; the opportunity is in code that never became concurrent because a trampoline was the price.
`sshd` is the clearest instance of exactly that, which is why it is worth deciding rather than
leaving as an unexamined "it blocks".

`packages/tor/src/relayd.wac` is the one that has already been ported, in `design/lang/0014` A6, and
it is the evidence the transform pays off: two `then`-plus-re-arm trampolines became `while` loops
with an `await` in them, and `network_tor_test` stayed green.

## `dird` is done, and the rule held — agent-b, 2026-08-30

`packages/tor/src/dird.wac` is A1's shape now: `accepting` is `async` and calls `answer` **without
awaiting it**, so a client that stops mid-request no longer holds the door. `DirDocuments` stopped
being a parameter and a return value and became one cell, which is the whole of the fix — the read at
`dirStep` and the write at `filed` are consecutive statements with no suspension between them.

**The head-of-line block is now a test rather than a paragraph.**
`test_a_stalled_client_does_not_hold_the_door` opens a connection, sends a request line with no blank
line after it, holds the socket open, and asks a second client for the consensus.

That test was checked against the code it describes, which turned out to matter more than expected:

- on the ported `dird` it passes in ~290ms;
- on the **pre-port** `dird` it does not fail — it **hangs**. The first run took ten minutes and was
  killed. The stalled client owns the accept loop, so the second connection is never accepted and an
  unbounded read waits for ever.

So the assertion is bounded — `waitAny(ids, 5000)` — and a regression now fails in 5.7 seconds with a
message naming this issue, instead of costing a gate. A test that hangs where it means to fail is
worse than no test, and this one would have.

All 48 files in `packages/tor/test/wac` pass, including `network_tor_test` and `ctor_live_test`.

### What is left, and what it needs

`sshd` is the remaining instance, and the rule above turns its second open question into a
concrete one. "When is the image saved" is not a question about when a session ends; it is: **`save`
must not begin while any write is in flight.** That is a barrier — a count of outstanding writers, or
a save deferred until the last session's continuation has run — and it is a smaller thing to design
than a locking discipline for the whole `Fs`.

Not started here, because `sshd`'s interrupt machinery (`askInterrupt`, `Keystrokes`, `Conn.ready`)
is split ten mentions in `packages/ssh` and ten in `packages/sh`, and another agent is working in
`packages/sh`.

## What blocks the rest, and it is not this issue — agent-b, 2026-08-30

`dird` and `relayd` were portable for a reason neither of them states: **their reads have no
deadline.** An onion service's introduction circuit is silent by design, and an accept loop waits for
ever on purpose. Every other candidate bounds its reads — `packages/tor`'s circuit layer at thirty
seconds, because *"a relay that says nothing for thirty seconds is wedged"* — and a bounded read
cannot be `await`ed.

`issues/lang/0300b` has the mechanism: the only deadline is `core.waitAny(ids, ms)`, which **blocks**,
so inside an async function it stalls every other continuation; and a bounded wait cannot be written
around it in a package, because `Sched.run` dispatches through `waitAny` over *host* ids and a
program-made ticket has none.

**Do not repeat the dead end.** A race combinator over `Pending` looks writable and half-works:
poll it and `settled()` answers, so a test that checks the flag passes. Only the `await` hangs. It
cost me an hour and a wrong claim; the issue records the misreading beside the mechanism.

So the remaining ports — `sshd`, `hsserviced`, `hsfetch`, `hsconnect`, `app` — wait on one of:

- **`0300b` being fixed**, after which every bounded read converts with no change in behaviour; or
- **relayd's route**: delete the per-read deadlines and move them to a supervising
  `core.drainFor(budget)`. That works, `relayd` proves it, and it changes *when a Tor client notices
  a silent relay* while restructuring three client `main`s that have no supervising loop today.

The second is a decision about a security-sensitive path rather than a translation, which is why it
is written here rather than done.
