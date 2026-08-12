# 0142 — a suite was killed at the parallel pass with the suite gate in place, and the log says nothing

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** bug
- **Symptom:** no error

## Reproduction

Not reproducible on demand — this is a report of one occurrence, with the evidence, because the
thing it is evidence about is invisible by construction.

`tools/push.sh` attempt 2 at 07:16, on a machine where `tools/suiteGate.ts` had allowed the run
(lock free, memory over the threshold, cooldown clear). The log for that run,
`/tmp/push-suite-Q9ldji.log`, is 2,838 lines and contains **one** summary line:

```
ok | 61 passed | 0 failed (1m3s)      <- the exclusive lane
```

The parallel pass has none. It printed 2,700 lines of passing tests and then stopped, which is what
a killed process leaves behind: no failure, no summary, no exit line. `push.sh` reported the run as
failed and printed its "tests that ran unusually long" hint, which is the right guess for a hang and
the wrong one here.

And the kernel's counter moved:

```
$ grep oom_kill /sys/fs/cgroup/memory.events
oom_kill 20        # 18 when I read it at 04:30 the same day
```

Two kills in three hours, one of them almost certainly this run.

## Why this is worth a number rather than a shrug

`tools/suiteGate.ts` exists for exactly this and its header says so — *"three get killed at about
70% with no failure reported"*. It refuses a second suite, refuses under 3 GB available, refuses
over load 8, and refuses a repeat inside twenty minutes. **All four passed, and the suite was killed
anyway.** So the thresholds are not sufficient, and the interesting question is which of these it is:

- **another agent's non-suite work.** A `deno task mutate` sweep, a `corpus:*` run or a build peaks
  in the gigabytes and is *not* gated — the lock is only taken by full suites. That is the gap I
  would look at first, and it is cheap to test: have the heavy `deno task` tools take the same lock,
  or at least record their presence where the gate can see it.
- **`MemAvailable` at the moment of asking.** It is checked once, before a run that then takes five
  to eleven minutes; another agent starting anything a minute later is invisible to it.
- **the 3 GB figure.** It was derived from a suite peaking "over 3 GB" on an 11.9 GB machine; three
  agents' editors, language servers and caches have grown since.

## What would settle it

`memory.events`' `oom_kill` before and after each suite, printed by `runTests.ts` beside the load it
already prints. A run that ends without a summary and with the counter moved is a kill, and one that
ends without a summary and with the counter still is something else — which is the distinction
nobody can make today, and the reason this issue exists rather than a fix.

I have not put it in `runTests.ts` or `suiteGate.ts`, which somebody else is working in today.
`tools/push.sh` reads the counter either side of the suite now, and when a run fails with the
counter moved it says so *before* the failure list, because that changes what the list means:

    == the kernel killed 2 process(es) for memory during this run ==
       A log that ends without a summary is that kill, not a failing test and not a hang.

That answers "was it killed" for a gate run and nothing else. The three candidates above are still
open, and a targeted `deno task test` — which is most of what an agent runs — still says nothing.
