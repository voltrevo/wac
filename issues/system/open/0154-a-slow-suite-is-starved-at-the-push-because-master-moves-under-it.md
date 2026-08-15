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
