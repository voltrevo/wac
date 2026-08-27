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

## One cheap idea, measured and wrong

The gate reads memory **after** discovery — `discover()` then `take()` in `tools/runTests.wac` — and a
shell's `free` taken immediately before an attempt reads 90–330 MB higher than the number the gate then
prints. That looks like the runner counting its own footprint against the floor, and against a shortfall
of 55 MB on the closest attempt it would be most of the gap.

It is not. A `--dry` run does the whole discovery — 39 directories, 411 test files, 56 chunks — and
available memory dipped from **5601 MB to 5592**: nine megabytes, sampled five times a second
throughout. So the runner's own cost is noise, moving the check before discovery would buy nothing, and
the 90–330 MB is other agents allocating between the two readings.

Which is the same conclusion the section above reaches from a different direction: the number moves
because the machine is shared, not because of anything the gate does to itself.

## Why this is a decision and not a fix

**The floor exists for a real failure.** `issues/system/0142` is a suite killed at the parallel pass
with the gate in place, whose 2,838-line log contains one summary line — a kill that reports nothing and
reads like a pass. Lowering the number to get a push through trades a queue for that, and the queue is
the safe failure.

**The number is measured, and what it is measured over is the point.** `tools/runTests.wac`'s header
carries the sweep's table, from `tools/jobsSweep.sh`:

    jobs   wall      peak      rise      anon   result
    4      259s    7893MB    5158MB    5905MB   3377 passed      <- the default

5,158 MB of *rise* at the default width, and a floor of 5,500 is that plus a margin — a derivation, not
a guess. But the same header says what the table does not cover:

> **The `3377 passed` column is the *Deno lane alone*, and that is now less than half the suite.**
> `tools/jobsSweep.sh` runs `deno test` at each width and does not run the `wac test` lane at all

It reasons that the memory argument survives this, "since the peak is the machine's rather than a
lane's" — true of the reading, and it does not settle the question, because both columns were taken
while only one lane ran. The suite the gate protects runs 411 `*_test.wac` files *and* 117 `.test.ts`
files, and `issues/system/0161` keeps moving tests from the second to the first: 3,377 in the Deno lane
when the table was taken, 1,690 by 2026-08-21, against 2,387 in the other. So the rise of the suite that
actually runs has never been measured, and `minAvailableMb`'s own comment agrees about the direction:

> **5500 is a floor nobody has re-measured**, and if it is wrong today it is wrong by being too low.

Which is what makes forcing the wrong move and the queue the safe failure: the plausible error is that
5,500 is too *small*, so a push that goes through under `WAC_SUITE_ANYWAY=1` is the one that meets
`0142`'s silent kill.

## What would settle it, in the order that costs least

1. **Extend the sweep to both lanes** — `tools/jobsSweep.sh` is the instrument and already exists; what
   it needs is to run the suite the way `runTests.wac` does rather than `deno test` directly. Its own
   header records this failure twice already, in the same words: *"a measuring instrument that runs the
   suite differently from the suite measures a different suite."* The wall-clock column wants this
   anyway — the header above says so and asks nobody to move the width on its strength until then.
2. **Then set the floor from the rise it reports**, with the margin stated. If 5,500 turns out to be
   right, the decision is about how many agents share a machine rather than about the gate.
3. **The instrument would have to bypass the floor to measure it**, which is worth knowing before
   anyone starts. `tools/jobsSweep.sh` calls `deno test` **directly** rather than going through
   `runTests.wac` — its header says why, that setting `DENO_JOBS` per run is the whole point — and a
   side effect is that it never reaches `take()`. Point it at `runTests.wac` to cover both lanes and it
   meets the very refusal it is trying to price, on a machine near the line. So the extended sweep has
   to set `WAC_SUITE_ANYWAY=1`, which is defensible for a measuring instrument on a quiet machine and
   should be *stated* in the script rather than discovered.

   That is probably part of why nobody has extended it: the obvious version does not run.
4. **Either way it needs a quiet machine**, because a sweep is several suite runs and this one would be
   killed. That is the part no workspace can arrange for itself, and the reason this is filed rather
   than done.
5. **Failing all of it, a reservation** would at least make the wait fair: the refusal is stateless, so
   thirty-five attempts are thirty-five independent coin flips against a threshold nobody is queueing
   for. `issues/system/0213a` is the neighbouring shape — a suite that *passes* and loses the race —
   and its recommendation was a counter, which is in; the policy is still not.

## Not the same as 0213a or 0154

`0213a` is a green suite losing the push race, and `issues/system/0154` is a slow suite starved because
master moves under it. Both are about a suite that **ran**. This one never starts, so neither
measurement covers it and neither fix would help it.

## What the refusals actually cost, measured — agent-c, 2026-08-25

This page said the cost was a queue: 45 finished commits and nothing pushed. That was too kind. The
coverage ratchets run **only** inside `tools/push.sh`, so while the gate was refusing they were not
running — and thirteen of the twenty-one were red for most of a day without anything saying so.

`issues/system/0257c` moved `covdump` into the program, a loaded module is granted `run: false` by
policy, and every coverage exercise that asks an oracle stopped being able to ask it. `packages/bignum`
read 54.8% where it is 100%. The first thing to notice was the gate itself, about sixty commits later,
in the one phase that had not run all day.

So the refusal is not only a delay. **A check that lives only in the gate stops running exactly when
the gate is refusing, which is when the tree is changing fastest.** That is an argument for the floor
being settled rather than endured, and it is independent of which way it is settled: it would be as
true of a floor that is too high as of one that is too low.

It is also an argument for the ratchets being runnable outside the gate — `deno task coverage:all` has
no cooldown, so it *can* be run; nothing prompts anyone to. It is **223 seconds** for 37 tasks at four
workers, measured on the run that finally got through, so "cheap" is the wrong word for it and "cheaper
than losing a day of measurement" is the right one. Cheapest of all: say in the refusal message which
checks are not running because of it, which is one line and is in.

## It did get through, and the question is still open — 2026-08-25 ~17:00

Two runs reached the suite once the other agents went quiet, and the second pushed **61 commits**. So
this page is not a standing block; the memory floor is not unreachable, it is *rarely* reachable, and
which of those it is on a given afternoon depends on how many agents are resident. The decision it asks
for is unchanged: the rise of the suite that actually runs has never been measured, and until it is,
nobody can say whether 5,500 is generous or short.

## Run outside the gate, and green — agent-c, 2026-08-25

The argument above is that a check living only in the gate stops running exactly when the gate is
refusing. So with 25 commits queued and the floor unreachable, `deno task coverage:all` was run
directly: **37 of 37 ratchets pass, 258s** (923s of work at four workers; 36 hold a floor, one
reports and cannot fail). Three packages have no coverage task and are not in that number — `box`,
`wac`, `wacc`.

Which is the good outcome and still makes the point: nothing prompted that run except having read this
page. The queue is not hiding a red ratchet today, and the only reason anyone knows is that somebody
went looking.

## The measurement this page asked for — agent-c, 2026-08-26

The operator freed memory and said the box was quiet. The gate started on the first attempt, and a
sampler read `free -m` every two seconds for the whole run.

### Time, both lanes

    the Deno pass    70s   14%      1692 passed, 0 failed, 6 ignored
    `wac test`      427s   85%      2580 tests in 405 files across 39 directories
    in the lanes    497s            total 498s

    wac lane: 1213s of work at 4 workers, 55s of it alone, so the floor is 345s
      318s  packages/crypto/test/wac — 11 files
      158s  packages/wacc/test/wac — 12 files
       52s  packages/platform/test/wac — 9 files

`tools/jobsSweep.sh`'s table — the one the floor is derived from — says `4 jobs, 259s wall, 3377
passed`. That was the Deno lane, which is now **70 seconds and 14% of the suite**. The header's own
warning was right and is now quantified: *"a measuring instrument that runs the suite differently from
the suite measures a different suite."*

### Memory

    available at start   6625 MB          used at start   5305 MB
    lowest available     4137 MB          peak used       7794 MB
                         at +2.1 min

    rise (used)          2489 MB
    draw (available)     2488 MB

**The floor is 5500 and the suite ran to completion with 4137 available at its trough** — 1363 MB
below the number that had been refusing it for two days.

### Why the two rises disagree, which is the point

The sweep recorded `peak 7893MB, rise 5158MB`. This run: peak **7794 MB**, rise **2489 MB**. The peaks
agree within 100 MB; the rises differ by a factor of two.

Because **rise is baseline-dependent and peak is not.** The sweep started from a nearly empty box and
climbed 5.1 GB to 7.9; this run started with 5.3 GB already used and climbed 2.5 GB to 7.8. The suite
does not have a fixed appetite — it has a fixed *ceiling*, and what it must climb depends on where it
starts.

So `minAvailableMb` asks the wrong question. "Is 5500 MB available" is a proxy for "will a 5158 MB
rise fit", and the rise is not a property of the suite. The property that held across two runs with
very different starting points is **peak system usage of about 7.8–7.9 GB**, against 11.9 GB of RAM.

That also explains the shape this page has been describing all along: with other agents resident the
*rise* shrinks, because there is less to climb — so the gate refuses hardest exactly when the suite
would have needed least.

### What this does not settle

One run, on a quiet box, sampled every two seconds — a transient spike between samples would not
appear. The suite also **failed** on this run (one test, since fixed), so it is a complete run in
wall-clock and lane terms but not a green one. Someone changing the floor should take a second reading
under load before choosing the margin.

What it does settle is the question the page was stuck on: the rise of the suite that actually runs
has now been measured, and it is **2489 MB from a 5.3 GB baseline, peaking at 7794 MB**, not the 5158
MB the floor assumes.


## 2026-08-26: the floor is too low, and the refusals were right — agent-a

Read off the table already in `tools/runTests.wac`, before running anything. It has two columns and
**the floor was taken from the one that under-reports.**

    jobs   wall      peak      rise      anon   result
    4      259s    7893MB    5158MB    5905MB   3377 passed      <- the default

`rise` is `memory.current` high minus low; `anon` is the same for `memory.stat`'s anonymous pages. The
floor is 5,500 — derived from the 5,158 — and the anon rise at the same width is **5,905**.

**`memory.current` rising by less than `anon` is not a contradiction, it is the failure mode.** The
kernel evicts page cache to satisfy anonymous allocation, so the charge for the cgroup as a whole grows
more slowly than the part that cannot be reclaimed. The gap opens exactly when memory is tight, which
is when the floor is being consulted. `jobsSweep.sh` already says which of the two matters, in the
comment beside the sampler:

> `anon` from `memory.stat` is the part that has to be found: it cannot be reclaimed, only swapped or
> OOM-killed. `tools/suiteGate.ts` compares its floor against `MemAvailable`, which *already* counts
> reclaimable cache as available.

So the instrument names the right column and the floor was set from the other one.

**And that table is the Deno lane alone**, which this page already notes: 3,377 tests when it was
taken, 1,690 by 2026-08-21, against 2,387 in the `wac test` lane that the sweep never runs. The
defence offered in `runTests.wac` — *"the peak is the machine's rather than a lane's"* — holds only if
the two lanes never overlap and Deno's is the heavier of them. Neither is established, and both
would have to be true.

### What this changes

Both facts point the same way, and it is not the way this issue assumed when it opened: **5,500 is too
small, and the thirty-five refusals were correct.** The gate was not being pedantic about a machine
that had room; it was declining to start a suite that would not have fitted.

- **Raising the floor to match the evidence makes refusals more frequent, not fewer.** The number to
  raise it to is at least 5,905 and probably more once the wac lane is in the measurement.
- **So the floor is not the fix for the refusals.** What produced them is contention — three resident
  agents holding 2.28 GB before anything is built, as this page measured. That is a scheduling
  problem: a queue, or fewer concurrent agents, or a suite that needs less.
- **`WAC_SUITE_ANYWAY=1` is worse than it looks.** Forcing past a floor that is already too low is how
  a run meets `issues/system/0142`'s silent kill, and this page says so; the numbers above are why it
  is not a remote risk.

### What is still worth measuring, and what is not

Step 1 as written — extend the sweep to both lanes — is still the right work, and it will move the
floor **up**. What is no longer worth doing is re-measuring to find out whether 5,500 is too generous:
the table in the tree already answers that, and the answer is no.

I have not run a sweep. Everything above is arithmetic on numbers this repository recorded on
2026-08-15 and a comment written beside the sampler that produced them; a sweep is six suite runs and
the better part of an hour, and it would confirm a direction rather than establish one.

## Decided: 4000 — operator, 2026-08-26

`minAvailableMb()` is 4000. The decision this page asked for is taken, and the reasoning is beside the
constant in `tools/wac/suitegate.wac` rather than only here.

**What it rests on.** The table the old floor came from is the Deno lane alone at 3,230–3,377 tests —
about 14% of the suite now. The full-suite sampling above rose **2489 MB** and peaked at 7794 of
11.9 GB. A floor of 5500 is roughly twice the measured requirement, and it refused thirty-five pushes
in a day with 45 finished commits behind them.

**Correcting my own section above.** *"2026-08-26: the floor is too low, and the refusals were right"*
argued from the `anon` column (5905) that 5500 was too small. Two things were wrong with it as a
conclusion, though the observation about the column stands:

- it compared **5905 from the old Deno-only sweep** against a floor meant for today's suite, which is
  the same stale-workload error the page had already identified in the 5158;
- it treated `anon`-versus-`memory.current` as settling the floor's *value*, when the prior question
  is whether a start-time availability check predicts anything at all — which the baseline-dependence
  of rise says it does not.

I also, in conversation, read the 4137 trough as "the gate would have refused a run that completed".
It would not have: that run **started at 6625**, above the floor, and dipped mid-run. A trough is not
a start condition and the two are not comparable. The rise is the comparable number, and it is 2489.

**What is still not measured, and is the one thing that would settle this:** the cgroup `anon` rise
for the suite as it is now. One instrumented run. Until someone takes it, 4000 is a judgement made
against the best numbers in the tree rather than a derived figure — which is a better position than
5500 was in, and not the same as a good one.

**The risk, stated plainly.** 3000 admitted runs that then died, three in one afternoon
(`issues/system/0142`). 4000 is 1000 MB above that, and the reason it is not the same bet is that those
runs rose 4.9 GB where this one rose 2.5. If killed lanes reappear, this constant is the first thing to
suspect — a floor that is too low does not fail loudly.
