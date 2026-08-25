# 0266c — the suite gate's memory floor refused every push for a day, and the floor is self-described as unmeasured

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** decision
- **Symptom:** none — 45 finished commits, none of them pushed

## Measured

Thirty-five attempts of `tools/push.sh` across one working day, on one workspace. **Every one refused
before the suite started**, always for memory:

    == not running the suite: only 5116 MB of memory available, and a suite needs about 5500 to finish ==

Available memory over the day, as the gate read it: **4930–5520 MB**, against a floor of **5500**. It
crossed the line once. The machine has 11.9 GB and five cores, and the reason the reading sits where it
does is not a suite:

    RSS   920 MB   claude
    RSS   760 MB   claude
    RSS   597 MB   claude   <- me

Three resident agents hold **2.28 GB** before anything is built, and each one's own workspace holds a
seed, a cargo target tree and a build cache. So the floor is not being missed by a little because a
suite is running somewhere — it is being missed because three agents are *alive*, which is the normal
state of this machine.

Nothing is broken. `wac test` on a package, on one file, and the deno halves all run with no cooldown,
and this workspace has been validating against them all day — 10,013 generated programs, 4,594 corpus
programs, 871 real sources, 1077 corpus files emitted whole, seven package suites. What does not happen
is a push.

## Why this is a decision and not a fix

**The floor exists for a real failure.** `issues/system/0142` is a suite killed at the parallel pass
with the gate in place, whose 2,838-line log contains one summary line — a kill that reports nothing and
reads like a pass. Lowering the number to get a push through trades a queue for that, and the queue is
the safe failure.

**And the number says of itself that it has not been checked.** `tools/wac/suitegate.wac`, beside
`minAvailableMb`:

> The suite was 3230 tests in the parallel pass when the table above was taken and is larger now, so
> **5500 is a floor nobody has re-measured**, and if it is wrong today it is wrong by being too low.
> Re-run the sweep before trusting it against a machine that is close to the line.

So the two candidate answers point opposite ways and neither is available from here: the floor may be
too low, in which case forcing is worse than waiting; or it may be far too high for a suite that is
mostly `wac`-hosted now, in which case a day of refusals bought nothing. **Deciding needs the
measurement, and the measurement needs the suite to run** — which is the part the floor forbids. A run
under `WAC_SUITE_ANYWAY=1` with a sampler attached would produce the peak, and on this machine it is
also the run most likely to be killed at 70%, which produces no number at all.

## What would settle it, in the order that costs least

1. **Take the peak on a quiet machine.** One `WAC_SUITE_ANYWAY=1` run with RSS sampled per second,
   when one agent is resident rather than three. That is the sweep the comment asks for, and it is a
   number rather than an argument.
2. **Then decide the floor from it**, with the margin stated — and if the answer is that 5500 is right,
   the decision is about how many agents share a machine, not about the gate.
3. **Failing both, a reservation** would at least make the wait fair: the refusal is stateless, so
   thirty-five attempts are thirty-five independent coin flips against a threshold nobody is queueing
   for. `issues/system/0213a` is the neighbouring shape — a suite that *passes* and loses the race —
   and its recommendation was a counter, which is in; the policy is still not.

## Not the same as 0213a or 0154

`0213a` is a green suite losing the push race, and `issues/system/0154` is a slow suite starved because
master moves under it. Both are about a suite that **ran**. This one never starts, so neither
measurement covers it and neither fix would help it.
