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

### `DENO_JOBS=2`, one trial, and what it does not show

Four workers were killed twice on 2026-08-12, at 352s and 322s. The same six commits then went
through with `DENO_JOBS=2`:

```
== suite passed in 548s (load now 1.60 4.01 6.62) ==
== pushed ==
oom_kill 25          # unchanged across the run
```

**One trial, and the machine was quieting while it ran** — load fell from 6.3 to 1.6 — so this does
not separate "fewer workers" from "nobody else was there". It is worth writing down as a workaround
that got a push through, not as a finding about worker counts.

It also runs against an argument already in `tools/runTests.ts`, which should be read before anyone
acts on this: **four is kinder to the other agents than two**, because the run finishes sooner and
the window during which it holds three gigabytes is shorter. A single 548s run that happened not to
overlap anybody refutes none of that.

The same comment names what would actually settle it, and it is this issue's first candidate:

> What no per-process cap can do is bound the *machine* — three agents at 3 GB each is 9 GB of 11.9
> — and that is 0031, which wants a token every heavy runner takes.

0031 is closed and that token only ever arrived for suites: `takeSuiteSlot` has one caller,
`tools/runTests.ts`, while every `mutate`, `corpus:*`, `coverage:*` and `bench` task builds and runs
programs without asking anyone. That is the shape every kill today has had — all four refusals pass,
the run starts, and something arrives during the five to eleven minutes that follow.

**The cheap half is the one this issue already suggests**: have the heavy tools *record their
presence* where `suiteGate` can see it, rather than take a mutual-exclusion token. A token across
every heavy runner would serialise the machine and could deadlock against `coverage:all`, which now
runs inside `tools/push.sh` — presence is a refusal reason the gate can weigh, which is all it needs.

### The cheap half is built: heavy runners announce themselves

`tools/suiteGate.ts` gains `announceHeavy(label)` and `heavyOthers()`. A heavy runner writes
`/tmp/wac-heavy-<pid>` while it works and removes it on exit; the gate reads them, skips any whose
pid is gone — the same `kill -0` question the lock already asks — and **names them before it checks
memory or load**:

```
== heavy work is running next door: corpus:backings (agent-a, 0m) ==
   Not a refusal. If this run is killed without reporting a failure, that is
   the likeliest reason — issues/system 0142.
```

Wired into the seven that run for minutes and build programs while they do: the five `corpus:*`
runners, `coverage:all`, and `mutate`. Verified by spawning one and watching it appear and then
disappear from `heavyOthers()`, and by running `coverage:unicode` for real and confirming it leaves
no file behind.

**It records rather than excludes, which is this issue's own suggestion and not a compromise.** A
token every heavy runner had to take would serialise the machine, and it would deadlock against
`coverage:all` — which since 0101 runs inside `tools/push.sh`, after the suite it follows and while
that push still holds nothing. What a ten-minute suite needs is not "is there room this instant",
which the memory and load checks already answer about a moment, but "is something going to keep
running while I do". This answers the second question without anyone waiting on anyone.

What it does **not** do is prevent the kill. A suite that starts alone and is joined at minute four
still dies; it now dies with a line in its own log saying what joined it. That is the difference
between the twelve kills on 2026-08-12 — every one of which left "the log simply stops" and nothing
else — and a report somebody can act on. Making it a refusal is a decision for whoever finds the
report accurate enough to trust, and the data for that judgement is what this produces.

## Where the memory actually goes — measured 2026-08-13

The operator asked what is using so much memory, on the grounds that only one suite runs at a time
now. It is not two suites and it is not leftovers. Four measurements, on a machine with 11.9 GB:

**1. There is a 2.04 GB floor before any test runs.** The three Claude agent processes themselves:

    3 agents, 2.04 GB total

That is 17% of the box gone at idle, and it is what the gate's 3 GB memory floor is measured
against.

**2. A single suite's coordinator holds 2.3–2.8 GB for most of the run.** Sampling another agent's
run (so nothing of mine was in it), `deno test --parallel` — the parent, not a worker:

    351s into the run: 2273 MB
    366s into the run: 2812 MB      <- peak
    381s into the run: 2026 MB
    411s into the run: 1046 MB      <- shrinking as files finish

Not a leak. A working set that grows with how much of the suite is in flight and falls as it drains.

**3. Type checking is not the cause**, which is worth writing down because it is the obvious
hypothesis and it is wrong. The top-level `deno test` runs *without* `--no-check` while the nested
`packages/wacc` run uses it, so the parent type-checks the whole graph. Measured on the heaviest
package, peak RSS of the process tree:

    packages/box   with type checking   2744 MB
    packages/box   with --no-check      2965 MB

No difference beyond noise, and in the wrong direction. Turning it off would buy nothing and cost
the checks. `tools/runTests.ts`'s own comment is right: the peak is the built binaries a test file
spawns, not the checker.

**4. Up to 20 deno-family processes exist at once** during `packages/box`, against a `DENO_JOBS` cap
of 4 — because each worker spawns built binaries of its own.

### What this adds up to

    2.0 GB   three agents, always
    5–6 GB   one suite at its peak
    1.3 GB   page cache (reclaimable, but it is in `free`'s "used")

against 11.9 GB. It fits, and the headroom is around 3 GB — which is why one-suite-at-a-time helped
and why it did not fix this. A kill still happens when a heavy package coincides with another
agent's spawned binaries, which is exactly the shape of the occurrence above.

**The lever with the most room is `packages/box`'s spawn pattern**, not the worker cap: 2.9 GB in
one package, from dozens of short-lived Deno isolates each costing ~85 MB. Serialising those spawns,
or reusing one isolate across the applets, would take a gigabyte or more off the peak and would not
slow anything the way lowering `DENO_JOBS` does.

### Not the cause, but worth sweeping

Orphans from old runs exist and are tiny — about 6 MB in total — so they are clutter rather than
pressure. Still, some have been running for days and nothing will ever reap them:

    7.8 days   openssl s_server -accept 39975 (agent-c's tls fixture)
    6.0 days   python3 -m http.server 4180, python3 srv.py
    4.1 days   bash -c kill -STOP $$
    0.8 days   ./native/v8/target/release/wacv8

`issues/system/0136` is the same shape for temp directories.

## A second occurrence, 2026-08-13 — with the exit status this time (agent-b)

`deno task test` from a workspace, gate satisfied on all three of its checks (it had refused twice
before this for memory and load, and once for the cooldown, so those were live and working).

What was different from the report above is that this run **did** print summaries — and failed
rather than vanishing:

```
EXIT=137
./packages/platform/test/native_shell.test.ts   the applets answer the same on both hosts   FAILED (9m44s)
./packages/sh/test/differential.test.ts         every script agrees with bash                FAILED (9m41s)
./packages/platform/test/native_hostfs.test.ts  standard input on both hosts                 FAILED (5m8s)
ok | 61 passed | 0 failed (1m1s)                <- the exclusive lane, again the only summary
```

**137 is SIGKILL**, which is the answer to what the first report could only infer. And the three
failures are the same event wearing a different face: all three are spawn-heavy differentials, all
three ran for five to ten minutes, and the log carries a watchdog dump rather than an assertion —

```
wac: packages/sh/src/sh.wac still running: 0:running:READ_DIR (submit=31 done=46)
     host: running=true sweeps=24 out: 0 chunk(s) reader-waiting | in: ended
```

**They pass alone.** The same three files, run together on their own minutes later:
`20 passed, 0 failed (2m26s)`. Against 9m44s + 9m41s + 5m8s under the gate, on a machine whose load
average was **19.82 over one minute and 79.09 over five**.

So the failure mode is broader than "no summary": under enough pressure a starved test **reports a
failure** before the kill arrives, and that failure names a package rather than the machine. That is
worse than silence, because it is a red that points at code. Anyone reading a red `native_shell` or
`sh/differential` should check the exit status and the wall-clock time before believing it: 137 and
nine minutes for something that takes fifty seconds is the machine, not the package.

## Reproduced on an idle machine, and measured — 2026-08-13 (agent-b)

Three runs today, all `EXIT=137`, two of them on a box with nothing else on it (load 0.55, 5.9 GB
available, no other agent's tests running). **This is reproducible by running the gate**, which is
worth correcting above: the first report could only say it happened once.

The third run carried a sampler — used and available memory, and `/proc/vmstat`'s `oom_kill`, every
few seconds:

```
peak used            11,637 MB   of 11,931 MB total
lowest available        292 MB
oom_kill             62 -> 64    two kills, at the sample where memory stopped climbing
```

**The kernel's OOM killer fires.** That is the piece the first report inferred from a counter and
could not attribute; here the counter moves *during* the run, at the moment the trace turns over.
Above 11 GB from sample 61 to sample 116, then two kills, then the fall.

**The victims are always the same four**, and they are one family — spawn-heavy host differentials
that build and run programs on two hosts at once:

```
packages/platform/test/native_hostfs.test.ts   (twice: grants, and standard input)
packages/platform/test/native_shell.test.ts    the applets on both hosts
packages/sh/test/differential.test.ts          every script agrees with bash
```

They pass alone in 2m26s. Under the gate they run five to ten minutes and then fail or vanish.

## Why the gate cannot stop it

`tools/suiteGate.ts` admits a run when **3,000 MB** are available. The rise measured here is
**~5.6 GB** (11,637 peak against 5,989 used when it started). A gate that checks for less than the
suite needs will keep admitting runs that cannot fit, which is exactly what happened three times
today with every one of its three checks satisfied.

And the table in `tools/runTests.ts` — the one that justifies `jobs = 4`, from issue 0075 — records a
**peak of 5,735 MB and a rise of 2.5–3.3 GB**, with the note that *"memory barely moves"* between one
worker and four. Today's rise is roughly double the top of that range. Either the suite has grown
past its own measurement or the measurement was taken differently (that sweep sampled
`/sys/fs/cgroup/memory.current`; this sampled system-wide `free`, so the *rise* is the comparable
number and the baseline includes whatever else is on the box).

Either way the table is stale enough that the number it justifies cannot be trusted, and it is the
number that decides how many spawn-heavy files run at once.

## What would settle it

1. **Re-run `tools/jobsSweep.sh`** on today's suite. It exists, it is the right instrument, and its
   output is what `runTests.ts` quotes.
2. **Raise the gate's threshold to the measured rise**, or make it check the rise rather than a
   constant — a guard that admits runs that then die is worse than none, because it launders a
   machine failure into a red test that names a package.
3. **Or move those four files into the exclusive lane**, where the same tests pass in 2m26s. That
   costs wall-clock and buys a suite whose reds mean something.

Not taken here: (1) is a measurement anyone can run and (2) and (3) change what every agent's gate
does, which is a decision rather than a fix.
