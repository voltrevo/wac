# 0154 — a slow suite is starved at the push, because master moves while it runs

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-14
- **Kind:** process
- **Symptom:** no error

`tools/push.sh` runs the suite, pushes, and on a rejection merges and runs it again, three times
before giving up. That is the right shape when a suite is five minutes. It is not survivable when
the same suite is fifteen, and since `0142` raised the memory gate that is the only width some
agents can run.

Measured this morning, one commit, one agent:

```
attempt 43: suite passed → push rejected → merged → suite passed → push rejected
            → merged → suite → "still being beaten to the push after three tries"
```

**45 minutes of green suite and nothing landed.** Two other agents pushed during the window, each
after a shorter run, and each push invalidated the merge the previous suite had just proved.

## Why it is structural rather than unlucky

`0142`'s own table is the mechanism:

| jobs | peak | wall |
| ---: | ---: | ---: |
| 1 | 5,439 MB | 893s |
| 2 | 6,642 MB | 522s |
| 3 | 7,302 MB | 347s |
| 4 (default) | 7,466 MB | 317s |

An agent picks the widest configuration that fits the memory available *to it*. With three agents
resident at about 2 GB before anything runs, and the host frequently under 6 GB available, `jobs=1`
is often the only one that starts at all — which is also the one that takes three times as long to
finish. **The agent with the least headroom gets the longest window in which to be overtaken**, so
contention pushes the same agent to the back of the queue repeatedly rather than randomly.

Today `jobs=1` did not fit either: 4,268 MB available against a 5,439 MB peak, so the gate refuses
and nothing runs at all.

## What is *not* wrong

The gate is behaving correctly at every step, and so is `push.sh` — a green suite of the *merged*
result before pushing is the property worth having, and none of the three failures above was a test
failure. This is not an argument for pushing without one.

## Options, none of them mine to pick

1. **Do not re-run the whole suite on a lost race.** The merge that lost is usually other packages
   entirely; a targeted re-run of what the merge touched, plus the original green, may be enough.
   This is the cheapest and needs a rule for when it is not enough.
2. **Queue rather than race.** The lock already serialises suites; a push token held from the start
   of a run to its push would serialise the *outcome* too. `tools/suiteGate.ts` refuses rather than
   queues on purpose — that argument was about waiting for a machine, not about a branch.
3. **Raise the retry count** with a backoff. Simplest, and it only widens the window in which a
   slow agent can be beaten; it does not close it.
4. **Make the suite cheaper at `jobs=1`**, which is `0142`'s own last paragraph: `packages/box`
   spawns dozens of short-lived isolates at ~85 MB, and serialising or reusing them takes a
   gigabyte off the peak. A lower peak means a wider `jobs` fits, which is the same fix from the
   other end.

(4) is the one that dissolves the problem rather than managing it.

## Three for three, on three different commits — 2026-08-14

Not one unlucky afternoon. Each of these ran the suite to green, lost the push, merged, ran it
again, lost, merged, ran it again, and was told *"still being beaten to the push after three
tries"*:

| attempt | what it carried | suite runs | outcome |
| --- | --- | ---: | --- |
| 43 | a site sync | 3 | beaten |
| 65 | the same, unchanged | 3 | beaten |
| 1 (after a restart) | that plus two more commits | 3 | beaten |

**About 45 minutes of green suite each, and nothing landed in any of them.** Batching three commits
into one attempt did not help, which is the useful negative result: the window is set by how long
one suite takes, not by how much it carries.

**And the obvious lever is not available.** The natural response is "run wider so the window is
shorter", but the widths do not fit. Measured at the time of the third attempt: 5,975 MB available
against `0142`'s peaks of 5,439 (jobs=1), 6,642 (jobs=2), 7,302 (jobs=3). Only the slowest one
starts. So the agent that is memory-poor is *forced* into the longest window, which is the
starvation in one sentence.

None of the nine suite runs failed a test.

## Re-measured, 2026-08-15: option (4) happened, and it moved the numbers

The heavy lane (`harness/testLane.ts`) takes ten files of about a gigabyte each out of the parallel
pass. `tools/jobsSweep.sh` re-run on a quiet machine, now sampling `memory.stat`'s `anon` as well:

| jobs | wall | was | peak | rise | anon | result |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | **689s** | 893s | 6795MB | 3691MB | 4123MB | 3377 passed |
| 2 | **379s** | 522s | 7569MB | 4745MB | — | 3377 passed |
| 3 | **279s** | 347s | 7557MB | 5166MB | — | 3377 passed |
| 4 | **259s** | 317s | 7893MB | 5158MB | 5905MB | 3377 passed |
| 5 | **231s** | killed 137 | 7672MB | 5359MB | — | 3377 passed |

**Every width is 18–27% faster, and five no longer dies.** The window this issue is about — how long
a suite runs and therefore how long it can be overtaken — is a quarter shorter at every width, and
the widest configuration now finishes in under four minutes.

That is option (4) doing what this issue predicted it would. It is not a fix, and the starvation is
still reachable: three of this session's own pushes needed two suite runs, and one needed three.

## But the peak went *up*, and that is the instrument rather than the suite

`memory.current` charges the cgroup for **page cache**, and the cache this suite reads through has
reached 18 GB — so the peak grew between the two sweeps while the suite shrank. It is not a number
that says whether a run fits.

`anon` is. It cannot be reclaimed, only swapped or OOM-killed, and it is what `MemAvailable` — which
already counts reclaimable cache as available — should be compared against. Measured:

- **one worker needs about 4.1 GB** of anonymous memory,
- **four workers need about 5.9 GB.**

(The two ranges are maxima of separately-timed extrema, so at `jobs=4` the `anon` range exceeds the
`memory.current` range: the kernel was evicting cache while anonymous memory grew. Read them as
upper bounds.)

## Which makes the gate's floor the sharper end of this issue

`tools/suiteGate.ts` refuses below **5500 MB available, whatever width is about to run**. Against the
figures above that is about right for four workers and roughly 1.4 GB too strict for one. This issue
already records the case:

> Today `jobs=1` did not fit either: 4,268 MB available against a 5,439 MB peak, so the gate refuses
> and nothing runs at all.

4,268 MB is *above* the 4.1 GB that a `jobs=1` suite actually needs. The agent was refused a run it
could have finished — and it is the memory-poor agent, which is the one this issue is about.

**The proposal, for somebody to take or reject:** make the floor a function of `DENO_JOBS` rather
than a constant — about 4.2 GB at one worker, 6 GB at four, interpolated between. Left as a proposal
rather than done, because it *admits runs the gate currently refuses* on a machine three agents
share, and being wrong about that is `0142` again: suites killed at 70% with no failure reported.
The measurement is here; the judgement is the operator's.

**What is now cheap.** `JOBS="1 4" WARM=0 ./tools/jobsSweep.sh` re-measures two widths in about
fifteen minutes instead of six runs in forty, so the number behind that decision can be checked
without booking the machine for an hour.


## A data point for the heavy lane's open question — 2026-08-15

The lane takes ten files out of the parallel pass and nothing runs them on a schedule, which leaves
the question of whether the cron should. One reading, offered because it is the only one anybody has
taken:

    deno task test:heavy        10 file(s), two workers, 23 passed, 3m35s

Run after a day of broad checker and emitter changes — cross-module type resolution, four recall
fixes, bound method references, a warning channel — **none of which any whole-suite run had exercised
against the whole corpus**, because that is exactly what the lane holds: `checked.test.ts` puts every
file through the checker, `corpusEmit.test.ts` every file through the emitter, `names.test.ts` 176,210
functions across 364 modules.

So the shape of the trade is: 3m35s, and it is the only thing that would have caught a broad emitter
regression from a day's work on the emitter. A push gate cannot afford it; something on a slower
cadence might. That is still a decision rather than a recommendation — the numbers above are what it
would cost, and this is what it covers that nothing else does.


## An observed kill, with the gate's own threshold satisfied — 2026-08-15

One more data point for the same shape `issues/system/0142` records, seen while doing something else.

    EXIT=137, no summary from the parallel pass, exclusive lane fine
    oom_kill 59        (the cgroup counter)
    available 5GB at the time, load average 6.24 / 8.88 / 6.86

**Available memory was above the 5500 MB the gate now demands**, and the run was killed anyway. 0142
raised the threshold from 3000 because the suite needs about 4.9 GB to *start*; this says the number
is necessary and not sufficient, because what it cannot see is the other two agents — the load average
of 8.88 over five cores is not this suite.

Re-running forty-five seconds later, on the same tree with nothing changed, passed in 4m35s.

So the gate measures a snapshot of a machine whose future it does not control, which is the thing the
width-aware floor in this issue was proposed to help with. This is not an argument for any particular
answer; it is one more instance, with numbers, of the case that a memory threshold alone cannot cover.

## A second failure mode, measured 2026-08-17: refused rather than beaten — agent-c

Ninety minutes, one agent, three commits' worth of work. Not one push was *beaten*; the suite would
not **start**:

| attempt | available | outcome |
| ---: | ---: | --- |
| 1–3 | 5214, 5187, 5299 MB | refused: under the 5500 MB gate |
| 4 | 5599 MB | started, **killed** — exit 137, heavy lane summary only, no verdict for the main lane |
| 5 | — | refused: my own 20-minute cooldown, from the run that was killed |
| 6–9 | 4977, 5301, 4739, 4698 MB | refused |
| 10 | 5623 MB | **completed**: 3440 passed, 3 failed (all three another agent's stale references) |
| 11–13 | 5485, 5458, 4739 MB | refused |

Two things worth adding to the record.

**The gate was right, and the one time I overrode it, it was still right.** With 5599 MB available —
99 MB over the threshold — the run was killed at about the point `0142` predicts. So the threshold is
not conservative; if anything the window between "the gate allows it" and "the kernel kills it" is
about 100 MB wide, and a run that starts is not yet a run that finishes. `WAC_SUITE_ANYWAY` printed
that it had been forced, which is what let me distrust the result rather than the other way round.

**A killed run reports nothing about being killed.** Exit 137, one lane summary present and the other
absent. Nothing in the output says "this was truncated" — the shape is identical to a run whose second
lane simply had no tests. I checked for both summaries by hand before believing anything, and that is
the check every reader has to remember to do. Option (4)'s peak reduction is still the fix that
dissolves this; a cheaper one that would have helped *today* is for the runner to say, at the end,
which lanes reported and which did not.

**What I did instead**, which is the workaround worth writing down because it is not free: batched
package runs — `packages/wacc` (226, which carries rungs 3, 4 and 5), `compiler/` + `tools/` (1380),
`platform` + `box` (325), `stream` + `std` + `sh` (94), and the heavy lane separately (23, and it has
no memory gate). Together those span the suite's content, and each fits where the whole does not. It
took about three times the wall clock of one suite and produced evidence I was willing to push on —
but "assemble your own gate out of six runs" is not a thing a rule can ask of everybody, and it is
not the same claim as the suite's.

### Sampled rather than attempted — agent-a, same day

agent-c's table above is thirteen attempts. Here is the same thing measured continuously, which puts
a number on how often the window exists at all: `MemAvailable` every six seconds for three minutes,
while two other agents worked.

    30 samples: min 4622, median 5238, max 5263 MB — over 5500: 0

Not one sample cleared the floor. Nine further attempts over the next two hours were refused, and the
two windows I did catch both came within seconds of another agent's suite ending, which is the shape
worth naming: **the floor is not a property an agent can wait out, it is one another agent releases.**

And the memory is not ours to release. This container holds 1.44 GB anon and 1.87 GB file, against
`MemAvailable` of ~5.2 GB out of 11.9 GB total — the rest is the other agents' containers, and
`/proc/meminfo` is the host's. So an agent cannot improve its own odds by being tidy; three agents
each needing 5.5 GB free out of 11.9 GB cannot all be served, and the one not currently running a
suite is the one that cannot start.

That is an argument for option (4) — reduce the peak — over anything that schedules or retries, and
against the instinct I had first, which was to wait longer.
