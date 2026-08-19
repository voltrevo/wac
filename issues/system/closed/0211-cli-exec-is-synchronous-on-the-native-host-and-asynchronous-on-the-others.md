# 0211 — `Cli.exec` is synchronous on the native host and asynchronous on the other three

- **Status:** closed
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

Three one-second sleeps, all three tickets taken before any is waited on:

```wac
Pending<Exec>[] ps = Pending<Exec>[3]();
for (i32 i = 0; i < 3; i++) {
  ps[i] = cli.exec("/bin/sleep", string[]("1"), u8[0]());
}
for (i32 i = 0; i < ps.len(); i++) { Exec r = ps[i].wait(); }
```

| host | elapsed |
| --- | ---: |
| Deno (`buildApp`, run as a program) | **1009ms** |
| native/v8 (`wac test --allow-run`, the host the `wac` binary is) | **3013ms** |
| native (wasmtime, `native/src/main.rs` — read, not measured: same shape) | serial |

Expected: the same, whatever that is. `Pending<T>` is one type with one contract, and every other
capability that hands one out means "asked for, not yet answered".

**Both native hosts, and the measured one was v8.** `wac test` and `wac build` are `native/v8`, not
the wasmtime host in `native/` — the first version of this issue named only the second, which is the
one the two-host tests compare against and *not* the one the number above came from. They had the
same fault, written twice.

## Where it is

`native/src/main.rs` and `native/v8/src/main.rs`, `Cap::Exec`: the child is spawned, drained, written to and **waited for**
inside the capability call, and the answer is handed back through `settle_now` — which submits a
ticket and completes it in the same breath. So on that host a `Pending<Exec>` is a promise of
something that has already happened, and the wasm thread was blocked for the whole of it.

`packages/platform/host/respond.ts` does the opposite, deliberately, and says so at the dispatch:
*"Dispatched, not awaited: the loop goes back to watching immediately, so a slow capability in one
slot does not hold up the others."* `packages/platform/host/call.ts`'s `submit` returns a ticket as
soon as the request is published.

Nothing in `packages/platform/src/platform.wac` says which of the two is the contract. `exec`'s
documentation says "run a program on the host, to completion, and hand back what it said", which is
about the *answer* rather than about when the call returns.

## What it costs

Two things, and the second is worse than the lost parallelism.

**No overlap under `wac test`.** `packages/tor/test/wac/entries_test.wac` compiles thirteen entry
programs by running `wac build` thirteen times: 9.5s, the second-largest test in the `wac` lane, and
every one of those seconds is one process at a time on a machine with cores to spare. The obvious
rewrite — take all thirteen tickets, then wait — is already written above and does nothing there.
Several other `*_test.wac` files shell out to an oracle per case in the same shape.

**A wedged child has nothing watching it.** `waitAny` exists so a program can bound a wait, and on
the two JavaScript hosts an `exec` ticket can be waited on beside `core.delay(…)` — which is how a
test says "this should have answered by now". On the native host the capability call never returns,
so there is no ticket to watch and no deadline to hold: a child that hangs hangs the runtime. That
is the same class as issue 0128, without the instrument.

## Notes

`native/src/tickets.rs` already has what a fix needs — a table with no ceiling on outstanding
tickets, completions recorded by this process's own threads, and a `Condvar` for `waitAny`. `Cap::Exec`
is the caller that does not use it. The two draining threads it spawns per child are the shape of the
answer: hand the ticket back after the spawn, and let a thread record the outcome.

The deterministic-order property `tickets.rs` documents — *"which of several ready tickets `waitAny`
returns is the first in the caller's own list, always"* — is what keeps that from making programs
depend on which child finished first, so the reproducibility argument is already paid for.

## Fixed

2026-08-18, in both hosts, by the shape `Cap::SleepMillis` already used in each: read the arguments
out of wasm (or out of the v8 heap) in the capability call, take a ticket, and hand the ticket back
while a thread runs the child and completes it. The child-running body is now `run_host_program` in
each host — named apart from the existing `run_child`, which starts a confined **wasm module**,
because `Cli.exec` and `spawn` are separate capabilities for exactly that reason.

`packages/platform/test/wac/exec_test.wac`'s `test_three_children_run_at_once` holds it: three
`sleep 1` in under 2.5s, with a floor of 900ms and a count of how many actually ran, so three
children that never started cannot pass it by finishing instantly.

`packages/tor/test/wac/entries_test.wac` is the first caller to take the overlap — thirteen
`wac build`s, four at a time: **9.5s to 3.5s**. It is bounded at four because each is a compiler
holding a program's graph: 447 MB resident one at a time, 833 MB at four.

## Numbered 0206, then 0208, until the merges

Twice: another agent took 0206 and 0207 for two datagram issues in the same hours, and by the time
this was renumbered to 0208 they had pushed a 0208 of their own. The rule that settles it is which
one reached the bare repo first, and both times that was theirs. 0206 there is the
**same shape as this one**: `receiveFrom` blocks at the call, so a datagram read cannot be
time-bounded. Two capabilities, two hosts, one mistake — a ticket handed back after the work is over
is not a ticket. Worth reading together.
