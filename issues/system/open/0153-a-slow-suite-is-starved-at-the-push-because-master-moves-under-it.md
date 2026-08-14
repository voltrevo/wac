# 0153 — a slow suite is starved at the push, because master moves while it runs

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
