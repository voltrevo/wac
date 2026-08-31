# 0302 — two async calls do not interleave under load, and `[§wac-async-drain-7cvj4bn]` says they do

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** bug — a spec claim that does not hold, surfacing as a flaky gate
- **Symptom:** `test_two_machines_interleave_under_one_drain` fails on a busy machine and passes on a
  quiet one

## The claim

`spec/spec/async.md`:

> `[§wac-async-drain-7cvj4bn]` A suspension on a ticket that carries a scheduler registers a
> continuation, so `core.drain()` alone finishes the function and **two async calls in flight
> interleave rather than running one after the other.**

## Measured

`packages/platform/test/wac/asyncsyntax_test.wac` starts two machines that each `await core.delay(1)`
twice, logging which one ran. Serial execution reads `1122` or `2211`; anything else is an
interleaving.

Run eight times on 2026-08-30 at load 6.6–7.4, with another agent's gate holding the machine:

    the log was 1122
    the log was 2211

— two serial runs in eight. On a quiet machine it interleaves every time. So the property holds when
nothing else is running and stops holding exactly when a gate is busiest, which is the worst
available failure mode: **it turns somebody else's push red**, and the message says the machines did
not interleave, which is true and reads like a regression in the thing under test.

## Why it happens

`ticks` awaits a **1ms** timer. Under load, more than a millisecond passes between dispatches, so by
the time a machine's continuation runs and registers its *next* timer, that timer is already expired.
`Sched.run` then has two ready tickets and picks with `core.waitAny(live, budget)` — the host decides,
and registration order is only the tie-break among what the host reports. A machine whose next timer
is already ready can therefore be dispatched twice before the other runs at all.

So the interleaving the spec promises is really "interleaves when each suspension outlives the
dispatch", and a 1ms timer on a loaded box does not.

## What is worth deciding

Two readings, and they lead to different fixes:

- **The spec overclaims.** Interleaving is what the mechanism permits, not what it guarantees; a
  program that needs fairness needs something else. Then the clause should say so and the test should
  assert the weaker thing.
- **The scheduler should be fair.** Dispatching in registration order among *all* ready tickets —
  rather than taking the host's first answer — would make the claim true and cost a sort. That is a
  real change to `Sched.run` and to what `waitAny`'s answer means.

The second is more useful to a program and is what a reader of that clause will assume. Neither is
this issue's to decide.

## One thing fixed here anyway

The test enumerated the logs it accepted — `1212 || 2121` — and there are **four** interleavings, so
`1221` and `2112` failed it while satisfying the property. That was widening the flake for no reason
and is corrected to exclude the two serial logs instead, with the observed value in the message. It
does not fix the flake, which is the subject above.
