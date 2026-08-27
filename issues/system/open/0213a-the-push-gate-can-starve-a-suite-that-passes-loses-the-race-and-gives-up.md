# 0213a — the push gate can starve: a suite that passes, loses the race, and gives up

- **Status:** open — the counter from the recommendation is in (2026-08-20); the policy is not
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** decision
- **Symptom:** not implemented

## A second measurement, from the other side of the failure — 2026-08-21 (agent-b)

The table below is four green suites that lost the race. Mine is eleven attempts in **two hours and
seventeen minutes** with nothing pushed, and the mix is different in a way that matters for the
decision: the race is not the main loss here.

| attempts | outcome |
|---:|---|
| 7 | **refused** — another agent's suite was already running, so nothing ran |
| 4 | ran the suite and **failed**, each on a different test |

Zero pushes. Last successful push 22:47; fourteen commits queued, the oldest from 23:00.

**The four failures were four different tests and none reproduced alone:** a fixture whose `mkdir`
result was discarded, a 10s bound that printed its own load average, a stale wasmtime binary reporting a
missing feature, and an sshd that announced itself and then refused a connection. Every one is in
`issues/system/0203`, read and written up; three had fixes committed the same hour. That is the shape
worth noting — **on a loaded machine the gate is more likely to find a load-sensitive defect than to
lose the race.**

So the two measurements together say the cost is not one thing:

  - 64% of my attempts never started, which is `tools/suiteGate.ts` working as designed — three agents,
    five cores, and it refuses rather than letting three suites kill each other at 70%;
  - the attempts that did start each cost 4–8 minutes and found something real, which is the gate
    earning its keep;
  - and the queue grows the whole time, so each attempt is verifying more commits than the last. The
    fourteenth attempt re-runs the work of the first thirteen.

**What this adds to the decision** is that "let a passing suite push" solves the 36% and not the 64%.
Whatever policy comes out of this wants an answer for a gate that cannot get a slot at all — a queue, a
token, a longer refusal cooldown that is *told* to the caller as a time rather than an invitation to
retry. `push.sh` already prints "Do not wait for the slot", which is right, and the honest consequence
of following it is a fourteen-commit queue.

Not claimed. This is a measurement, not a proposal: I have no view on which policy is right that is
worth more than the numbers.

## A third measurement, and the mix has changed — 2026-08-24 (agent-b)

One batch, five invocations of `tools/push.sh`, nothing pushed:

| invocation | what happened |
|---|---|
| 1 | suite passed 382s → **push rejected**, merged, retried; attempt 2 refused (another agent's suite) |
| 2 | suite passed 355s → **push rejected**, merged, retried; *"still being beaten to the push after three tries"* |
| 3 | refused — 5382 MB available and a suite needs 5500; agent-a's `coverage:all` was running |
| 4 | refused twice — agent-a started a suite 1m before each attempt |
| 5 | — |

**Three green suites, zero suite failures, zero pushes.** The batch has grown from five commits to
nine, four of which are merges of other people's work made while losing.

**What is new is not the number, it is the absence of the middle column.** The 2026-08-21 measurement
above was 7 refused, 4 *failed*, 0 pushed, and its conclusion was the honest one for that data: *"on a
loaded machine the gate is more likely to find a load-sensitive defect than to lose the race"*. Today
the suite found nothing — three consecutive clean runs at 355–382s, where that day's runs took
613–836s. `issues/system/0203`'s load-sensitive defects were fixed, and what is left is the race and
the refusals, with nothing being paid for in return.

That matters for the decision because it moves the weight. When a third of the loss was the gate
earning its keep, "let a passing suite push" was solving the smaller half of a two-part problem. If
the suite is now stable under load — one day is not a trend, and this is why the counter exists — then
option **(2)** addresses effectively all of the loss and option (1) buys nothing but machine time.

**And a refusal reason not in the table above: memory.** One of the five never started because
`coverage:all` next door had taken the machine below the 5500 MB floor. That is neither the race nor
the suite-lock; it is a third contention channel, and it is the one that will get worse as
`coverage:all` grows, because the two heavy jobs have no shared notion of a slot — the suite lock does
not cover coverage, and the memory floor is checked once at the start rather than held.

Still not claimed, still not a proposal. The one thing I would say from being the starved agent twice
now: whatever is chosen wants to bound the *batch*, not the attempt. Nine commits is nine commits of
review surface for whoever reads the merge, and the batch grows precisely when nobody can land.

## Reproduction

Have a batch of commits ready and run `bash tools/push.sh` while another agent is working normally.
On this machine, today, that is enough — no unusual state is needed.

Measured over four consecutive runs of one batch:

| run | suite | outcome |
|---|---|---|
| gate27 attempt 2 | passed, 836s | `push rejected, merging and retrying` |
| gate27 attempt 3 | passed, 613s | `push rejected` → `still being beaten to the push after three tries` |
| gate29 | *refused twice* — another agent's suite was running | nothing ran |
| gate30 attempt 1 | passed, 615s | `push rejected, merging and retrying` |
| gate30 attempt 2 | refused — another agent's suite | nothing ran |

Four full suites, all green, nothing pushed. **Six commits landed on `origin/master` in one 70-minute
window** while this was happening, so the other agents are pushing about every 10–12 minutes; a full
gate run here takes 10–20 minutes depending on contention. The race window is (suite ends → push),
and `push.sh` already makes it as small as it can — the problem is that the run is simply longer than
the interval between other people's pushes, so losing is the expected outcome rather than bad luck.

The retries then compound it: after a rejection `push.sh` merges and re-runs, and the re-run is
usually refused because whoever won the race has since started their own suite.

## Why this is filed rather than fixed

Every way out is a decision about the shared gate, and picking wrong is expensive:

1. **Retry more than three times.** One line. Also multiplies the machine time a starved batch
   costs everyone, on a box with five cores and three agents — and does not fix the arithmetic, it
   just buys more lottery tickets.
2. **Push the merge without re-running when the merge is disjoint** — when the files the incoming
   commits touch do not intersect the files this batch touches. The argument is decent: both sides
   were gated, and a disjoint merge is the concatenation of two tested trees. It is not airtight,
   because a semantic conflict needs no shared file — my batch changed `harness/wacFiles.ts` and the
   run that beat me changed `packages/wactest/src/oracle.wac`, which is exactly the shape that looks
   disjoint and is not obviously so.
3. **Re-run only the lanes the merge could affect.** Most correct in principle, most work, and needs
   a mapping from files to lanes that does not exist and would itself go stale.
4. **Serialise pushes** — a token in the bare repo, so a run holds the right to push for its
   duration. Removes the race entirely and adds a way to deadlock if a holder dies.
5. **Leave it.** Batches land eventually, when the machine happens to go quiet.

## Recommendation

**(2), with the disjointness test written to be honest about what it does not cover**, plus a
counter so a batch that has passed the suite N times without landing is visible rather than silent.
The reason to prefer it over (1) is that it stops paying for full suites nobody reads; the reason to
prefer it over (3) is that it can be written in an afternoon and (3) cannot.

But this is somebody else's call as much as mine — the gate is shared, and I am the agent it is
currently costing, which is the worst position from which to decide how strict it should be.

## Notes

**Not a defect in anything.** `push.sh` is doing what it is for: it pushes the revision the suite ran
against, and re-runs after a merge because the merge is the one thing that has not been tested. Both
of those are right. What is new is that the suite has grown to where the run no longer fits inside
the interval between other agents' pushes, so a correct policy has an emergent failure mode.

**It gets worse on its own.** The suite gets longer as packages are added, and the number of agents
is not going down.

**`WAC_SUITE_ANYWAY` interacts badly with this.** Two of the refusals above were "another agent
started one N minutes ago, **with WAC_SUITE_ANYWAY**" — that override skips the shared lock, so a run
holding it makes everyone else's gate refuse while not being subject to refusal itself. That is a
separate question from the race and probably wants its own answer; noted here because it is what
turned two of the five attempts into no-ops.

## The counter is in — 2026-08-20

The half of the recommendation that is not a policy question. `tools/push.sh` now counts how many times a
batch has passed the suite without landing, and says so at the top of the next run:

    == this batch has already passed the suite 3 time(s) without landing ==
       2 commit(s) waiting. That is
       issues/system/0213a — the run is longer than the gap between other agents' pushes, so
       losing the race is expected. The suite time spent so far is real and nobody read it.

Keyed on the **oldest unpushed commit**, which is the one thing about a batch a merge does not change:
`git merge` adds commits and rewrites none, so the earliest of mine stays the same object while the batch
grows around it. Verified — committing on top left the key identical. Per agent. Bumped when the suite
passed and the push did not land, *before* the merge, since the merge changes what the batch is; cleared
on a successful push; also printed after the third failed try.

**Nothing about the policy is decided by this.** The five options are still open and the note above still
stands: the agent being starved is the worst placed to choose how strict a shared gate should be. What
this removes is the reason it went unnoticed — every symptom was a separate invocation, each looking like
one unlucky run, so seeing it required reading four logs together.

### Killing the gate does not kill the suite

Timing out `push.sh` to see the banner left its `runTests` child **alive**, orphaned, still running and
still holding `/tmp/wac-suite.lock` two and a half minutes later. I killed it by pid.

**The lock was honest** — I first wrote this up as a stale-lock hazard and that was wrong.
`tools/suiteGate.ts:139` already covers it: *"A lock whose process is gone is not a lock"*, tested with
`kill -0`. The holder here was alive and genuinely running a suite, so refusing other agents was correct.

What is actually worth knowing is narrower and still worth knowing: **`timeout`, `Ctrl-C` or any kill
aimed at `push.sh` leaves the suite running.** It keeps a core busy, keeps the lock, and nobody is reading
its output. Anyone stopping a gate should kill the `deno run … tools/runTests.ts` child too, or the thing
they stopped is only the part that would have told them the answer.
## Decided: option 4, serialise the gate — operator, 2026-08-27

The recommendation above is option 2, a disjoint-merge shortcut. The operator took **option 4**, and
added the argument the measurements here did not have.

**Why not option 2.** This page already says why it is unsound: *"a semantic conflict needs no shared
file"*, with its own example of a batch touching `harness/wacFiles.ts` losing to one touching
`packages/wactest/src/oracle.wac`. Serialising needs no soundness argument.

**Why option 4 answers the 64%.** agent-b's measurement was 11 attempts, 7 of which never started.
Option 2 addresses the races and none of the refusals. Holding the lock across the whole gate means a
run that *starts* is a run that can *land* — the suite alone held it before, so a batch could pass,
lose the push and re-run everything. Two gates on 2026-08-27 each ran the whole thing twice, one of
them for a merge that touched only markdown.

**The deadlock objection is answered by a primitive that already existed.** `alive(pid)` —
`stat("/proc/<pid>")`, measured today: a dead holder stats false, `/proc/self` true — so a lock whose
holder died is not a lock. `tools/push.sh` also releases on a `trap`, so it rarely comes to that.

### What the operator ruled, in their words rather than mine

**Refusing stays the default.** *"The normal answer is 'someone else is pushing, so I'll do more
useful work rather than trying to push now', not 'I'll wait until I can get a push slot'."* This is
what `tools/runTests.wac` already said at its own `take` — *"what to do when the machine is busy is
the caller's decision, and a script that waits quietly for ninety minutes takes it away"* — so the
change is to hold the lock longer, not to wait for it. `tools/push.sh --queue` waits, for the lock
only; memory, load and the cooldown are not queues to join.

**The cooldown stays, and it is not rationing.** *"Even if no one else is running, the 20 minute
cooldown exists to keep you working most of the time, not burning time waiting for push gates. It is
wasteful to run a push gate on every change, even 20min/push is aggressive."* That reframes it: the
cooldown is a *batching* mechanism. Everything on this page reads it as fairness — including my own
recommendation, and including the framing that a growing queue is a symptom. The batch is the point.

The refusal message says all of this now, because a refusal that does not explain the policy reads as
an invitation to retry.

### What is left

Nothing on this page's list. Option 1 is moot, 2 and 3 are unnecessary once a started run can land,
and 5 was the status quo. What remains unmeasured is whether the starvation this issue is named for
actually goes away — that needs a few days of gates with the lock held end to end, and the counter
this page already added is what would show it.
