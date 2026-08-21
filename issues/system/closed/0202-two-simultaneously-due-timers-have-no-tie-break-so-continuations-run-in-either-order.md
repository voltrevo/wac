# 0202 — two simultaneously due timers have no tie-break, so continuations run in either order

- **Status:** closed — agent-a, 2026-08-21: the tie-break already exists, and this was not a tie
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

`packages/platform/example/scheduled.wac`, which is what `test/wac/scheduled_test.wac` drives:

```wac
core.delay(1).then((i64 at) => { core.log("first"); });
core.delay(2).then((i64 at) => { core.log("second"); });
core.log("scheduled " + itoa(core.outstanding()) + ", ran 0");
core.drain();
```

Expected, and what it printed on every run for weeks: `first` then `second`.

Actual, on a machine running four `wac test` workers: `second` then `first`.

## Why

`Scheduler.run` dispatches whichever ticket `core.waitAny(live, budget)` says is ready. Each capability
call runs on a thread of its own, so `delay(1)` and `delay(2)` are two threads that sleep and then mark
their tickets ready. On an idle machine the 1ms thread gets there first. On a loaded one the 1ms thread
can be descheduled between waking and marking, and by the time `waitAny` is called both timers are long
overdue — so what it answers is *completion* order, and completion order between two overdue timers is
thread scheduling.

`example/scheduled.wac` already says the honest thing — the continuations run "in the order the host
answered" — and the tests then pinned that order, which is the part that was wrong. They now assert the
two lines in either order (`sorted`), keeping what the transcript is for: neither continuation ran before
the drain, and both ran inside it.

## The decision

Should `waitAny` break a tie deterministically — answer the earliest in the list it was given, or the
one with the earliest deadline — or is completion order the contract?

Both have a cost, which is why this is filed rather than fixed:

- **Deterministic by list position** makes every program reproducible and makes `Scheduler.run`
  dispatch in registration order. It also lets a re-arming reader at the front of the list starve one
  behind it: `run` removes a handler before calling it, so a single pass is fair, but a handler that
  re-registers immediately goes back to the front of a list that is scanned from the front.
- **Deterministic by deadline** is what a person expects of timers and says nothing about the other
  thirty-nine capabilities, whose tickets have no deadline at all.
- **Completion order** is what there is now. It is fair and it is not reproducible, and nothing
  currently says so where a caller would read it.

Whichever is chosen, `Core.waitAny`'s documentation should state it, because a scheduler built on it
inherits whatever it does. Until then, a test that depends on the order of two due tickets is a test
that passes until the machine is busy.

## The decision had already been made, in the code — agent-a, 2026-08-21

The section above asks *"Should `waitAny` break a tie deterministically … or is completion order the
contract?"* and answers *"**Completion order** is what there is now."* That is wrong, in both hosts:

    packages/platform/host/call.ts   for (const t of tickets) if (isDone(b, t)) return t;
    native/src/tickets.rs            // **The policy, and D12's whole point.** First in the caller's
                                     // list rather than first to finish, so the answer does not
                                     // depend on how the threads were scheduled.

Each scans the caller's list and returns the first *settled* ticket. So the tie-break is **list
position**, it is the same in both hosts, and one of them cites `design/system/0001` D12 as the reason.
`Scheduler.run` passes its ids in registration order and `removeAt` shifts rather than swaps, so among
continuations due at once, dispatch is in registration order too.

### Then why did `scheduled.wac` print `second` then `first`?

Because that was **not a tie.** A ticket the host has not marked ready yet is not ready — the 1ms timer
was descheduled between waking and marking, so at the moment of the scan only the 2ms one was settled
and it won on its own. No tie-break can change that, and D12 says as much in the half of it nobody
quotes: *"whether a real `readFile`, `accept` or child exit has completed is the kernel's business. So
the choice set … is not reproducible from a seed, even though the choice among them is."*

The tests relaxing to `sorted` was therefore right, and for a better reason than the one recorded: not
"the order is unspecified" but "which timers are *ready* is the kernel's, and only the choice among
ready ones is ours".

### What was actually missing

The documentation the issue's own last paragraph asks for. `std/platform.wac`'s `waitAny` now states
the tie-break, cites both implementations, and says the thing that trips people: it is not a statement
about when work finishes. `Scheduler.run` says its list is in registration order and why that follows.

And an assertion, which is what would have answered this in a minute:
`test_waitany_answers_the_first_ready_ticket_in_the_callers_list` sleeps until both timers are long
overdue, then asks twice with the list reversed. **Asking once cannot tell position from completion** —
the 1ms timer is both first in the list and first to finish. Reversed, position still answers index 0,
which separates them. Canaried by expecting completion order: `got 0, want 1`.

### One stale sentence left behind

D12 itself says *"which one it sees is our choice — the protocol permits either, and **today it is
decided by timing**"*, written 2026-08-06. That is no longer true of either host; the Rust one changed
it and cites D12 while doing so. Noted in the design file rather than edited out, since the argument
around it still holds.
