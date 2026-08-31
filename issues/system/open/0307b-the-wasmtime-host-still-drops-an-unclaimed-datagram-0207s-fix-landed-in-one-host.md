# 0307 — the wasmtime host still drops an unclaimed datagram: `0207`'s fix landed in one host only

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — bytes are read off a stream for a ticket nobody claimed and are gone.
  Reproduced on **both** Rust hosts. The title says "datagram" and is wrong; see the corrections
  below, and the file is not renamed because the number is what anything referring to it uses.

## Two corrections, and the second is the one that matters

**It is not the datagram.** The wasmtime host's `Cap::ReceiveFrom` is synchronous — `sk.recv_from`
inline, then `settle_now` — so there is no ticket, no thread, and no abandoned reader. `0207`
describes a reader parked on a socket after its caller gave up, and this host has never had one. I
filed that from the shape of `tickets.rs` alone: the table can drop an unclaimed outcome, so I wrote
down the bug that shape causes *elsewhere* without asking whether anything here reaches it.

**And it is not one host.** Both Rust hosts lose bytes that were read off a stream for a ticket
nobody claimed. The v8 host has the machinery `0207` built and spends it on datagrams only:

    // native/v8/src/main.rs, Cap::Recv on a socket
    let a = match stream.read(&mut buf) { … };
    let _ = worker.complete(id, a);          // <- the bytes, discarded

    // native/v8/src/main.rs, Cap::ReceiveFrom
    if let Some(unclaimed) = worker.complete(id, a) { … park it for the next reader … }

One `let _`, one `if let`, twenty lines apart, on the same `#[must_use]` return. The wasmtime host
does not have the choice to get wrong — `complete` returns nothing at all — and its three spawned
stream readers drop the same way.

## The mechanism, read out of the code rather than guessed

`Stream::read` in `native/src/streams.rs` **blocks** and then **drains**:

```rust
loop {
    if !inner.bytes.is_empty() {
        let taken: Vec<u8> = inner.bytes.drain(..).collect();   // taken out of the queue
        …
        return taken;
    }
    if inner.done { return Vec::new(); }
    inner = self.ready.wait(inner).unwrap();                    // parks here
}
```

So the loss is by construction rather than by race:

1. `recv` submits a ticket and spawns a reader, which parks in `read()` — the queue is empty.
2. The caller's bounded `waitAny` expires and it gives up on the ticket.
3. The peer writes. The parked reader wakes, **drains** the bytes out of the queue, and calls
   `complete` for an id that is no longer live. The bytes are dropped.
4. The next `recv` spawns a second reader and finds the queue empty. It waits, and eventually sees
   the stream end.

The peer will not send them again, so the reader after the abandoned one starts *after a hole* and
nothing anywhere says so.

## What it takes to hit, which is narrower than it sounds

Abandoning the ticket is not enough: waiting on the *same* `Pending` again collects the answer
normally, because the ticket is still live. It needs **abandon, then issue a fresh `recv`** — which
is what a bounded read followed by a retry looks like, and `platform.wac`'s deadline idiom invites
exactly that shape.

## Reproduced, on both hosts, with a control

One program: `spawnSelf` gives a child whose handle goes to `recv` and `waitAny` exactly as a
socket's does, so the parent and the child are the same module told apart by their first argument.
The child sleeps 400ms and writes `PAYLOAD`. The parent issues a `recv`, lets a 50ms `waitAny`
expire — so the reader is parked on an *empty* queue — abandons the ticket with `Pending.cancel` and
`Core.cancel`, and then reads again to end of stream.

| host | arm | the second `recv` saw |
|---|---|---|
| wasmtime | control | `PAYLOAD` |
| wasmtime | abandoned | **empty** |
| v8 | control | `PAYLOAD` |
| v8 | abandoned | **empty** |

**The control arm is the half that makes this evidence.** It skips the abandoned read and nothing
else. Without it "the second read saw nothing" has a dull explanation — a child that never wrote, a
handle with nothing attached — and the probe prints the same line either way.

Not a truncation: the payload is gone entire, because `read` drains the whole queue in one go.

The probe is not committed yet; the test to write from it belongs in `packages/platform/test/wac/`
and has to run on both hosts, which is what `nativeHostWhyNot()` in `packages/wactest/src/built.wac`
is for. Written before the fix on purpose — this is the kind of fix that looks obviously right and
cannot be seen working, so a test written afterwards tends to test the fix rather than the bug.

**The Deno host is untested here.** Its `recv` goes through a different provider and worker, so
nothing above says anything about it; it is a third arm somebody should add rather than a claim.

## What to do

Give the wasmtime host's `complete` and `discard` the v8 signature — `Option<Outcome>`, `#[must_use]`
— so every site has to say what it does with an unclaimed answer rather than having no way to ask.
Then hand the bytes back at the stream sites on **both** hosts, to the front of the queue rather than
to a side table, since a stream's order is the whole of its meaning.

And worth asking whether these two tables should be one file. They are near-identical by intent, they
have now drifted in both directions inside a day, and `CLAUDE.md` says a second copy of anything is a
copy that drifts.
