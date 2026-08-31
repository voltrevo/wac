# 0307 — the wasmtime host still drops an unclaimed datagram: `0207`'s fix landed in one host only

- **Status:** closed
- **Claimed by:** agent-b
- **Fixed in:** `native/src/`, `native/v8/src/`, 2026-08-31
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

## Fixed on both hosts — agent-b, 2026-08-31

`Stream::unread` puts the bytes back at the **front** of the queue and notifies. `complete` on the
wasmtime host now answers `Option<Outcome>` with `#[must_use]`, matching the v8 host, so a site has
to say what it does with an unclaimed answer instead of having no way to ask.

`packages/platform/test/wac/lostbytes_test.wac` is the case, on both hosts, with the control arm.

### Two wrong fixes, and a green run said yes to both

**The second one is the more interesting mistake**, because it looked like the considered fix rather
than the quick one. `unread` puts the bytes back at the front and notifies — which is right, and is
not enough. Between a reader *taking* the bytes and putting them back there is a window, and another
reader parked on the same queue can look in it:

1. Reader A drains the bytes for a ticket nobody holds.
2. The child writes nothing more and **exits**, so the queue is marked done.
3. Reader B — the retry — wakes, finds the queue empty *and* done, and answers `End` to the guest.
4. A puts the bytes back. Too late: `End` has been delivered and the guest's read loop has stopped.

`kept, lost, kept` over three runs, about one in three. **I read 8-of-8 and 6-of-6 earlier and
called it fixed**, on a probe that happened to schedule the other way; the run that found this was
the one where I used the test's own generated program instead of the hand-written one.

So a reader must not *take* bytes it cannot deliver. `Stream::read_unless` asks whether the ticket
is still live **under the same lock as the drain** and leaves them in the queue if not, notifying so
whoever should have them wakes. The `unread` backstop stays for the narrower race where the caller
gives up between the check and `complete`.

**A socket keeps the side table and cannot do better.** Its bytes come off the kernel, so there is
no "decline to take them" — the read has already happened by the time anything can be asked. The
per-handle table is the best available there, which is worth knowing rather than assuming the two
paths are equally safe.

### The first fix was wrong and one run said it worked

It parked the unclaimed bytes in a map keyed by handle and served that from the next `recv`. It
passed, and then failed, and the difference was luck: **two readers are parked on the same queue** —
the abandoned one and the retry that replaced it. `notify_all` wakes both, whichever drains first
wins, and when the abandoned one won it filed the bytes somewhere the other was never going to look.

A side table is only right where there is no queue to put anything back into, which is the socket
case and nothing else. That one keeps its table, and the table is cleared when the handle closes —
handles are reused the instant they are free (`0306b`), so leftovers would otherwise be served to
whoever takes the number next, as if their peer had sent them.

**The lesson is the one this repository keeps teaching**: a single green run against a race is not
evidence. The second run is what found it, and it was only run because the first fix felt too easy.

| host | arm | before | after |
|---|---|---|---|
| wasmtime | abandoned | lost | **6/6 kept** |
| wasmtime | control | kept | 6/6 kept |
| v8 | abandoned | lost | **6/6 kept** |
| v8 | control | kept | 6/6 kept |

### The test needed measuring too, and one canary run was not enough

Backing the fix out and running the case **once** is what I did first, and it failed, and I took
that as proof it guards the bug. Run ten times against the same broken host it passed **3 of 10** —
because the loss depends on which of two parked readers wins, so a one-shot check waves a broken
host through almost a third of the time.

So the abandoned arm runs `TRIES = 5` times and every one must keep the payload. The number is
derived rather than picked: the defect shows about 7 runs in 10, so five independent tries miss it
with probability 0.3^5, near enough one in three hundred. Re-canaried at that strength:

| the v8 host | the case passes |
|---|---|
| fix backed out, one try per run | 3 of 10 — **would have shipped a regression** |
| fix backed out, five tries per run | **0 of 10** |
| fixed | 10 of 10 |

**Three times in one bug** a green sample said the work was done: the side-table fix (passed once),
`unread` (8 of 8, then 6 of 6), and the test itself (failed once when broken). Every time the missing
step was the same one, and every time it was found because something forced a repeat rather than
because I chose to.

### What is deliberately not fixed

**`readAll` has the same defect and is not handle-keyed.** It takes standard input to EOF, so an
abandoned one loses the lot, and there is no handle to put it back under the way `recv` has. Both
sites are marked in `native/src/main.rs` rather than quietly given a `let _ =`. Worth its own issue
if anything is found to read that way with a deadline.

**`drop` can still lose an answer, on the narrowest path.** `Cap::Discard` is what a guest's
`Pending.cancel` reaches, so bytes that landed between the caller giving up and the drop are
discarded. Handing them back needs the ticket's *handle*, and a ticket id does not carry one — the
v8 host keeps a `receiving` map for precisely this and only for datagrams. Marked in the source.

Worth saying how that was nearly missed: the twelve `let _ =` annotations were applied by a script
with one blanket comment, *"nothing was consumed to make this"*, and on this site that sentence is
simply false. A mechanical edit wrote a wrong claim into the code and it read as considered. The
other eleven were checked afterwards and hold; two were reworded to say why rather than assert it.

**`#[must_use]` did not flag the sites that mattered.** The three spawned readers are
`std::thread::spawn(move || table.complete(…))`, where the value is the closure's return and
therefore used. The attribute found thirteen synchronous sites and none of the four that could lose
data — worth knowing before trusting it as the audit.

**The Deno host is still untested here**, and is recorded as untested rather than as clean.
