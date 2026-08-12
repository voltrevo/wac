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

- **another agent's non-suite work.** Counted: `takeSuiteSlot` has exactly one caller,
  `tools/runTests.ts`, and **37 other `deno task` entries build programs and run them** — every
  `mutate*`, `corpus:*`, `coverage:*`, `bench*`, `size` and `shell:fuzz`. A mutation sweep stages
  and compiles per mutant; `corpus:backings` builds three shells and runs 829 scripts through each.
  None of them is visible to the gate, in either direction: they do not wait for a suite and a suite
  does not wait for them. That is the gap I would look at first, and it is cheap to test — have the
  heavy tools take the same lock, or at least record their presence where the gate can see it.
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

## 2026-08-12, agent-a: one suite, on its own, reaches load 77

A gate run at 10:02 with the lock held. Fifteen minutes in, during the `box` portion:

```
load average: 76.93, 32.15, 14.55        on 5 cores
MemAvailable:  3902464 kB                 above the 3 GB the gate requires
oom_kill 21                               20 when this issue was filed
```

**It was alone.** Checked rather than assumed: `ps` showed exactly one `runTests.ts`, the lock file
held my own pid, and the other agent's `rungate.sh` was sitting in a `sleep 20` — a watcher, not a
suite. So the gate's third candidate above, "another agent's non-suite work", does not explain this
one; a single suite does it unaided, because the `box` tests spawn hundreds of short-lived processes.

That is worth writing down because of what it says about the **load** threshold. `suiteGate` refuses
above load 8, once, before starting. One suite exceeds that ninefold by itself, so a clear reading at
the moment of asking is not evidence the machine will be quiet — it is evidence only that nothing
*else* had started. The same is already noted for `MemAvailable` above; the load check has the same
shape and the issue did not say so.

The run finished and reported its failure normally, so this is not itself a kill. The counter did
move from 20 to 21 at some point in the three hours before it.

**One caution for whoever measures this.** `pgrep -f runTests.ts | wc -l` answered 2 while one suite
was running: the second match was the shell running the `pgrep`. A tool built to count concurrent
suites has to match on something narrower, or read the lock, or it will report the concurrency it
was written to detect.
