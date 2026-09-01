# 0311 — the JavaScript hosts release an answer that had already arrived

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** the same data loss as `0308b`, on Deno, Node and the browser — **5 of 5**

## The line

`packages/platform/host/call.ts`, `cancel`:

```ts
export function cancel(b: Bridge, t: Ticket): void {
  const at = slotAt(t.slot);
  if (Atomics.load(b.ctrl, at + S_GEN) !== t.gen) return;             // already gone
  if (Atomics.load(b.ctrl, at + S_STATUS) === ST_READY) { release(b, t.slot); return; }
  // The host frees it when the work lands. …
  Atomics.add(b.ctrl, at + S_GEN, 1);
  Atomics.store(b.ctrl, at + S_STATUS, ST_CANCELLED);
  ping(b);
}
```

**`ST_READY` means the answer is in the slot**, and `release` gives the slot back without reading it.
For a `recv` that answer is bytes taken off a socket or a queue exactly once, so this is
[0308b](../closed/0308b-dropping-a-ticket-throws-away-an-answer-that-had-already-arrived.md) — the
caller gave up after the bytes landed, and they go in the bin.

The second branch is the other ordering, [0307b](../closed/0307b-the-wasmtime-host-still-drops-an-unclaimed-datagram-0207s-fix-landed-in-one-host.md):
the slot is marked cancelled and the host frees it when the work lands, so bytes that arrive after
the give-up are dropped rather than handed back.

`cancel` is reached from `drop`, which is what `Pending.cancel` calls — `provider.ts` builds every
`Pending` with it. So the path is real and not hypothetical.

## Measured — half of what this issue guessed

Driven through the Deno host with `appRunner`, the same probe the Rust hosts were fixed against:

| ordering | Deno |
|---|---|
| control — never gives up | kept |
| abandoned **before** the bytes arrive (`0307b`'s) | **0 of 5 lost** |
| abandoned **after** the answer landed (`0308b`'s) | **5 of 5 lost** |

So the `ST_READY` branch is the defect and it is deterministic: an answer sitting in the slot is
released unread, every time. **The other branch is not affected** — this issue guessed both and one
was wrong. Marking a cancelled slot for the host to free evidently does not lose the bytes here, and
the reason is worth someone confirming rather than assuming: it is the difference between a
`SharedArrayBuffer` ring and a thread parked in `read`.

That is the second time today a filing from a recognised shape was half wrong — `0307b` named the
datagram and the datagram path could not have it. The shape tells you where to look and never what is
true.

## One function, *every* capability — which is the opposite of the Rust hosts

`provider.ts` builds every `Pending` kind with the **same** `drop`:

    const drop = (id: number) => { cancel(b, unpack(id)); };
    …
    i32:     (t) => cls.Pending$i32.of(pack(t), i32, settled, drop),
    bytes:   (t) => cls.Pending$u8Arr.of(pack(t), bytes, settled, drop),
    chunk:   (t) => cls.Pending$u8Arr.of(pack(t), chunk, settled, drop),
    ok:      (t) => cls.Pending$bool.of(pack(t), ok, settled, drop),
    …

So this is **one** defect across every capability that answers a `Pending` — seventeen call sites
over eight kinds:

    T.socket   4     T.ok    3     T.text   2     T.i32   2
    T.child    2     T.bytes 2     T.read   1     T.datagram 1

where the Rust hosts had it five times with three different remedies (`issues/system/0310b`). Only
`recv` has been measured here; the others follow from the shared function rather than from separate
runs, which is a weaker claim and is meant to be — `0307b` was filed off a shape whose path turned
out not to reach it.

**That cuts both ways and the second half is the awkward one.** One function is one place to fix —
and a shared `drop` has no idea *what* was consumed or who could still want it, which is precisely
the knowledge the remedy needs. `0310b`'s answer differed by capability: put bytes back in a queue,
hand a connection to a live ticket, close a dialled socket. A single `cancel(b, ticket)` can do none
of those, so the fix has to give the kinds their own drops — and then the `waitAny` problem below
applies to each.

## One function, three hosts — checked rather than assumed

The measurement above is Deno's. The title says Node and the browser too, and that is by
construction rather than by analogy: **`cancel` is defined once**, in `call.ts`, and reached through
`provider.ts`, which builds every `Pending` for all three. There is no second implementation to
diverge. `deno.ts`, `node.ts` and `browser.ts` are the *host* side — they answer the ops — and none
of them has a `cancel` of its own.

That asymmetry decides the shape of the fix. The **defect** is one function; the **remedy** is not,
because putting bytes back means telling whichever host owns the queue, and that side is three files.
So a fix is one edit plus three, not three edits.

Worth stating because today's other host bugs were the opposite shape — `0207`, `0306b` and `0310b`
were all *parallel* implementations that drifted, and the instinct they train is "check the other
one". Here there is no other one to check.

## What this issue does *not* claim

**It is not measured on these hosts.** The two Rust hosts were fixed against numbers — 0 of 10, 1 of
8, 0 of 8 — and this has none, because the probes run a wac program under a `wac` binary and the
JavaScript hosts are reached through the harness instead. Reading a line and recognising a shape is
where `0307b` went wrong: I filed a datagram bug from `tickets.rs` alone and the path that would have
had it turned out to be synchronous. So this says *likely*, and the first job is a number.

## How to measure it

`packages/platform/test/wac/lostbytes_test.wac` already holds three cases — a bounded read abandoned
before the bytes arrive, one abandoned after, and the same for `readStdin` and `accept` — and runs
them against both Rust binaries. The programs are string constants in that file. Driving the same
programs through the Deno host needs `appRun` from `harness/`, which is what
`packages/platform/test/*.test.ts` uses, and gives a third and fourth column for that table.

## Why the fix is bigger here than it was in Rust, sized before starting it

On the Rust hosts the answer is a value a thread is holding, so handing it back is `q.unread(bytes)`
— the thread puts it down where it got it. Here it is bytes in a `SharedArrayBuffer` slot, and
`cancel` runs on the **guest** side, which does not own the queue they came from. So:

- **`Ticket` is `{slot, gen}` and carries no opcode.** The slot's control block has one — that is
  what `slotStates` prints — so `cancel` could learn it is looking at a `recv`.
- **The handle is in the *request* payload**, not the response, and by the time an answer is ready
  that buffer may already be back in the pool. Something has to keep it, or the slot has to carry it.
- **Giving bytes back means telling the host**, which means a new op — `deno.ts`, `node.ts` and
  `browser.ts` each implement the table, and `provider.ts` builds the guest side. A protocol change
  across four files rather than an edit to one.

None of that is a reason not to do it; it is the reason not to start it as a small patch, which is
how the first two attempts at `0307b` went wrong. Whoever takes it should decide first whether the
slot carries the handle or the guest keeps the request buffer alive, because everything else follows
from that.

**The cheap guest-side answer does not work, and it is the one to reach for.** The guest knows the
handle — `recv` is `(handle) => T.read(send(OP.RECV, i32le(handle)))`, so a per-call `drop` could
capture it — and could stash the bytes under that handle and hand them straight back from the next
`recv`. All of it in shared code, no new op, and it is exactly the `pushback` map that fixed the Rust
hosts.

It breaks `waitAny`. A `Pending` is not only something to `wait()` on: `core.waitAny(ids, ms)` asks
the **host** which of those tickets has settled —

    (ids: Int32Array, millis: number) => {
      const tickets = Array.from(ids, unpack);
      const settled = waitAny(b, tickets, millis);

— and a locally-invented ticket is in no slot table, so it can never be reported settled. A program
that bounds its retry, which is the very shape that loses the bytes, would then wait on an id the
host has never heard of until its deadline. Trading a lost read for a stall is not a fix.

The Rust hosts avoid this because `settled_now` mints a **real** ticket that `waitAny` can see; the
guest here cannot mint one, since only the host writes a response. So the answer has to reach the
host, which is what makes this three files rather than one — and that is the constraint to design
against rather than a detail to discover halfway.

## Why it matters beyond tidiness

`design/system/0001` D9 is that a wac program must not depend on its host. Four hosts that disagree
about whether a bounded read loses data is exactly the kind of difference that makes a program
correct in the suite and wrong in the browser — and `0207`, `0306b` and `0310b` were all one host
being different from the others.

## The fix has to clear the *request* accumulator too — agent-b, 2026-08-31

`cancel`'s fast path calls `release`, which is guest-side and cannot touch the host's per-slot state.
`abandon` clears three things — `pending[slot]`, `partial[slot]` and (implicitly) `finalStatus[slot]`
— and the fast path reaches none of them.

`pending` is the obvious one and is what this issue is about. **`partial` is the one that is easy to
miss**, and it is reachable: `OP_PUSH` answers `STATUS_ACK`, which puts the slot at `ST_READY`, so a
guest that pushes one piece of an oversized request, sees the ack, and then gives up takes exactly
this path. The pieces it already pushed stay on the slot, which is immediately reusable.

What would follow is a later call's payload being joined with a dead call's pieces —
`whole = joined(partial[slot], payload)`. In today's tree the handler's `p.length !== declared` check
in `packages/platform/test/fuzz.test.ts` would catch that and say *"request reassembled to N bytes,
declared M"*, which is not a symptom anyone has reported; a capability without such a check would not
notice at all.

So this is not offered as `issues/system/0162` — that report shows no reassembly error. It is a
requirement on whatever fixes this issue: **clearing `pending` is not enough, and a fix that only
addresses the answer leaves the request half of the same asymmetry in place.**

## How big this actually is: seventeen places it could happen, eight where it can

The count above — seventeen `T.*` call sites over eight kinds — is where the defect *could* occur,
because every one of them is built with the same `drop`. Where it *can* occur is narrower, and worth
saying so, since "one defect across every capability" reads as far more alarming than the truth and
will get this triaged wrongly.

The host's `cancel` is reached only by `Pending.cancel()`, which is `this.drop(this.id)`. Nothing in
`std/platform.wac` cancels on a caller's behalf, and **`Core.cancel(id)` does not reach it at all** —
that is `sched.off(id)`, the scheduler's half, which takes back a continuation and leaves the ticket
alone. So the reachable set is the explicit `.cancel()` calls, and in package sources there are
**eight**, against seventy-five `waitAny` sites.

Two things follow.

**The blast radius is enumerable.** Eight call sites can be read, and each one asked whether losing
an answer there matters. `packages/tor/src/link.wac`'s two are the pattern: one closes its socket
immediately afterwards so nothing is lost, and the other is a dial whose remedy turned out to be
`issues/system/0310b`'s close.

**And the split invites a different bug.** The two halves of *stop caring* are separated by who may
write, so a caller doing only `core.cancel(p.id)` leaves the ticket live — no lost answer, a leaked
slot — and a caller doing only `p.cancel()` leaves the scheduler's continuation. `platform.wac` says
a caller wanting both does both and calls that *"worth a single call one day"*. Sixty-seven bounded
waits that never cancel either half are not obviously wrong — most re-wait rather than give up — but
nobody has counted which do which, and `CALL_SLOTS` is finite.

### Read all six, and none of them loses anything today

Of the eight matches, two are prose — `std/platform.wac`'s own note and its generated copy in
`packages/wacc/src/coretext.wac`. The six real ones:

| site | cancels | what is lost |
|---|---|---|
| `tor/src/link.wac:116` | a dial | was a leaked connection; `issues/system/0310b` closes it now |
| `tor/src/link.wac:168` | a bounded read | nothing — `closeSocket` follows immediately |
| `platform/example/patience.wac:65` | a dial | as tor's, and the same remedy |
| `platform/example/patience.wac:106` | a bounded read | nothing — `closeSocket` follows |
| `platform/example/wacland.wac:89` | `sleepMillis` | nothing — a timer consumes nothing |
| `platform/example/wacland.wac:125` | a tick | nothing — a timer |

So **this defect currently costs nothing in this repository.** Every caller is a timer, a read whose
socket closes straight after, or a dial that is now closed on drop. That is worth knowing before
anyone spends the protocol change: it is a **latent** defect and a trap for the next caller, not
active data loss.

It does not make it wrong to fix — a bridge that discards an answer nobody has collected is a bad
foundation, and the next bounded read that retries instead of closing will hit it silently. But it
should be weighed against a change spanning `call.ts`, `respond.ts` and three host files, and against
`0310b`'s finding that the remedy differs by what was consumed. Sizing it honestly is more useful
than sizing it alarmingly.
