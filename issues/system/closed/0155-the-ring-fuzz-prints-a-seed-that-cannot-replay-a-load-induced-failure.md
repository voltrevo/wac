# 0155 — the ring fuzz fails under load and prints a seed that cannot replay it

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** wrong answer
- **Fixed in:** this commit

`packages/platform/test/fuzz.test.ts` — *the ring keeps its invariants under random load* — failed
inside a full suite run:

```
seed 31: answer for 12 is 326 bytes, wanted 924
statuses=[2,0,3,3,2,3,2,0,0,0,0,0,0,0,0,0…]
```

Targeted re-run of the same test, same seed, on the same checkout minutes later: **passes in 1s.**
The suite is eight fixed seeds — `[1, 7, 31, 1009, 12345, 65537, 99991, 2000003]` — so seed 31 runs
every time and passes every other time.

## Why the seed does not help

The file's own header says it is *"deterministic despite being random"* and that a failure *"prints
its seed and can be replayed exactly"*. That is true of the **worker's choices**, which come from a
seeded xorshift. It is not true of the **interleaving** between the worker and the host, which is
decided by the scheduler — and the comment two hundred lines down says as much without drawing the
conclusion: *"the interleavings that matter are decided in the first few steps — whether a cancel
lands before or after the host takes the slot"*.

Under load those land differently. So the printed seed replays the *inputs* and not the *schedule*,
and the one number the failure hands you is the one that cannot reproduce it. That is worth fixing
or worth saying in the header, because as written it invites exactly the debugging session that will
not converge.

## What it is not

Not `issues/system/0082`, which covered `packages/http/test/fuzz.test.ts` and four others, and whose
mechanism was a worker-readiness deadline. This is a different file and the failure is a wrong
*answer* rather than a timeout — `answer for 12 is 326 bytes, wanted 924`.

The shape it reports is the one the file attributes to a removed guard: its own comment lists *"the
generation check removed -> answer for 28 is 1064 bytes, wanted 1248"*. So either the generation
check has a hole that only a hostile schedule reaches, or the harness mis-attributes a late answer.
Both are worth knowing and the second is likelier.

## What "done" would mean

1. The failure reproduces on demand — a way to force the interleaving, rather than waiting for a
   loaded machine.
2. Either the header stops promising exact replay, or the seed covers the schedule too.
3. If it is a real hole in the generation check, a case in `packages/platform` that fails without
   the guard and passes with it.

Seen once, on 2026-08-14, in a suite that was otherwise 3,390 passed.


## Closed, 2026-08-15 — and the seed was the smaller half

Both halves of this were addressed, and looking for the first one found something worse.

### The header claimed a replay it cannot do

Corrected rather than implemented. This test runs the scheduler `off` deliberately — a deterministic
one takes away the concurrency the file exists to stress — so the interleaving is the machine's and
no seed can carry it. The header now says the seed replays the *inputs* and not the *schedule*.

### A failure now carries its own diagnosis

`answer for 12 is 326 bytes, wanted 924` is equally consistent with a truncated answer to *this* call
and with another call's answer landing in this slot, and those want opposite fixes. The nonce is the
first four bytes of every answer, so the check reads it and says which:

    answer for 12 is 326 bytes, wanted 924
      the nonce belongs to cancelled call 23 - a recycled slot
      slot 1 gen 7, 4 live, 9 cancelled and 31 spent so far

That is the diagnosis this issue asked for, available from the one report a load-induced failure
gives you.

### The thing that was actually wrong: the guard was dead in the only mode this ran in

The file's own notes record the mutations that should kill it, first among them *"the generation
check removed -> answer for 28 is 1064 bytes, wanted 1248"*. **Deleting that check leaves this test
passing, five runs out of five.**

With scheduling `off`, `respond.ts` calls `write` straight back inside `reply` — so the generation is
read and checked with nothing in between, and the window a recycled slot needs never opens. The
guard against `issues/system/0023` was being exercised by a configuration in which it cannot fire.
Nothing said so, because a passing test says nothing about what it can see.

Under `seeded` the same deletion dies on the **first** seed, every time, and names the cancelled call
whose answer arrived. So the test runs both policies now, sixteen runs rather than eight: `off` is
production, `seeded` is the only one that reaches the delayed-answer path, and neither is redundant.

**A guard is only tested in a configuration that can delay the thing it guards.** That is the
transferable part, and it is not specific to this file — every mutation in that list was recorded
against a run that could see it, and one of them had silently stopped being able to.

### What is still not answered

The original failure — seed 31, inside a full suite run, wrong length — is still not reproduced. Four
concurrent copies of this test over three rounds did not do it. What has changed is that if it
happens again the report will say whether it was crossed or truncated, which is the fork the whole
investigation was stuck on.
