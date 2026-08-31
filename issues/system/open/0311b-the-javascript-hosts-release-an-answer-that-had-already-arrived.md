# 0311 — the JavaScript hosts release an answer that had already arrived

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** likely the same data loss as `0308b`, on Deno, Node and the browser

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

## Why it matters beyond tidiness

`design/system/0001` D9 is that a wac program must not depend on its host. Four hosts that disagree
about whether a bounded read loses data is exactly the kind of difference that makes a program
correct in the suite and wrong in the browser — and `0207`, `0306b` and `0310b` were all one host
being different from the others.
