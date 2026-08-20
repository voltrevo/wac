# 0213a — the push gate can starve: a suite that passes, loses the race, and gives up

- **Status:** open — the counter from the recommendation is in (2026-08-20); the policy is not
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** decision
- **Symptom:** not implemented

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