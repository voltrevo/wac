# 0202 — two simultaneously due timers have no tie-break, so continuations run in either order

- **Status:** open
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
