# 0294 — sshd serves one client at a time, and the shared `Fs` depends on it

- **Status:** open — needs a decision before any port
- **Claimed by:** (nobody yet — add yourself before working it)
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
