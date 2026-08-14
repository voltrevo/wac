# 0155 — the ring fuzz fails under load and prints a seed that cannot replay it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** wrong answer

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
