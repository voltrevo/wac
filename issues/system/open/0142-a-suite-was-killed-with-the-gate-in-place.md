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

## 2026-08-12, agent-a: caught one live, and the gate was calling it something else

A gate run at 11:20. Attempt 1 passed in 392s and lost the push race; attempt 2 was merged and
started, ran about nine minutes, and stopped. What `tools/push.sh` printed:

```
== the suite did not finish in 45m: not pushing ==
   This is a hang, not slowness — see issue 0036.
```

and `oom_kill` went **21 to 22** across that window. So this is the failure this issue is about,
observed end to end for the first time, and the gate named it a hang.

The cause is that `124` and `137` shared a branch. `timeout` sends SIGKILL only 30 seconds *after*
its 45 minutes, so a 137 that arrives in nine minutes is not the bound firing — it is somebody else's
kill, and on this machine that is the kernel. The counter that says so was already being read a few
lines below, in the branch the 137 case skips past.

Split now: a 137 under 45 minutes reports a kill and, if the counter moved, says the kernel did it
and that nothing in the log is evidence about the change. The timeout branch mentions the counter
too, because a run that genuinely hits the bound *and* had a kill in that window is a third thing.

**What this leaves open** is unchanged and is the more useful half: this is the gate. A targeted
`deno task test` still says nothing, which is the second candidate in the list above. And the run
that died was the first one to carry `coverage:all` — 38 seconds of extra work at the end, which is
not obviously innocent on a machine this close to its memory, and is worth watching before it is
blamed for anything.

### Later the same day: a third kill, named correctly this time, and `coverage:all` is cleared

`oom_kill` 22 → 23, in a gate run at 12:25 that stopped 352 seconds in. What it printed:

```
== the suite was killed after 352s: not pushing ==
   The kernel killed 1 process(es) for memory during this run — this is that kill.
   Not a hang and not a failing test: the log simply stops. issues/system 0142.
```

Which is the fix above working on a real occurrence rather than on a replayed status code. Three
kills in one day — 21, 22, 23 — and the first two were reported as something else.

**`coverage:all` is not the cause, and it was the obvious suspect.** It went into the gate an hour
before this, adding 38–51 seconds of instrumented runs at the *end* of a push. This run never reached
it: the log has no `19/19` line and no `coverage:` line at all, because the suite it follows was
killed at 352s of a run that takes about 400. Ruled out by reading the log rather than by argument,
which is the only reason worth trusting here.

What the machine looked like either side: 5.5 GB available and load 7.5 after the fact, with
`agent-b` holding the suite lock a minute later. So the pattern in this issue holds — the refusals
pass, the run starts, and something else arrives during the five to eleven minutes that follow.
