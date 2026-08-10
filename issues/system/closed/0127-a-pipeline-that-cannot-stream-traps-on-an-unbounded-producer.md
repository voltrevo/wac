# 0127 — a pipeline that cannot stream traps the whole shell on an unbounded producer

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** trap

## Reproduction

```
wacsh -c 'yes | nosuchcmd; echo status=$?'
  ours:  error: requested new array is too large        (~11s, the shell is gone)
  bash:  bash: line 1: nosuchcmd: command not found / status=127   (at once)

wacsh -c 'yes | x=1 cat | head -1; echo status=$?'
  ours:  error: requested new array is too large        (~11s)
  bash:  y / status=0                                   (at once)
```

Expected: the pipeline answers, whatever it answers, without the shell dying.
Actual: the process traps and the script it was running ends there.

## Notes

**Not about either command in it.** Both of these are pipelines `canStream` refuses — the first
because `nosuchcmd` is not a name this build can start, the second because a stage with a prefix
assignment is not a simple spawnable word. A refused pipeline falls back to the sequential route,
which runs each stage *to completion* and holds its output in a wac array. `yes` has no completion,
so the array grows until the allocation traps.

So the two conditions are: **a producer that does not end**, and **any stage the streaming route will
not take**. The list of the second is `canStream` in `packages/sh/src/exec.wac`, and it is long —
`>>`, `2>`, `< file`, a here-document, two output redirections, a non-literal first word, a prefix
assignment, a function, a builtin, and any name this build does not have.

Related but not the same:

- **0125** is the streaming route answering 4194304 for `yes | wc -l`: bounded by the 8 MiB queue
  cap, wrong answer, shell survives. This is the *other* route, and it does not survive.
- **0115** is `yes | head -1` under load on the streaming route.

One case of this is now fixed, and how it was fixed is the shape of the general answer: a stage
spelled `/bin/head` used to fail `canStream` for having a slash in it, so `yes | /bin/head -2`
trapped while `yes | head -2` streamed and stopped. `spawnableName` resolves a path into `/bin` to
the program it names, and the pipeline streams. That widens the streaming route by one spelling; it
does nothing for the cases above, where the stage genuinely cannot stream.

**The decision the general fix needs** is what the sequential route should do when a stage produces
more than it will hold. bash never faces it because it forks every stage at once and a pipe applies
backpressure. Two answers that do not need that: bound the buffer and report the truncation the way
`Captured.truncated` does (0125's cap, with a message), or resolve every stage's name *before*
running any of them, so `yes | nosuchcmd` fails the way bash fails it — at once, and without the
producer ever starting. The second is narrower and fixes the reproduction above; only the first
covers `yes | x=1 cat`.

## Closed — 2026-08-10

**The third place the same bytes pile up, and the only one with no cap.** A frame's output is capped
in `platform/host/child.ts`; a spawned child's queue is capped by the host; and the shell's own `Buf`
in `collectChild` — where a stage's whole output lands when the pipeline cannot stream — had nothing.
So the one route with no limit was the one that killed the shell rather than reporting anything.

`HELD_CAP` is 8 MiB, the same number the other two use, and that sameness is the point. Past it the
child is **stopped** rather than merely ignored: `closeSocket` terminates it wherever it is on every
host since 0123, so the producer goes away instead of filling a queue nobody will read.

What the caller sees is `shrun.wac`'s judgement, which was already argued for the in-process route:
*more than this shell can hold is a command that did not run, not a short answer.* The bytes do not
say they are short, so a number computed from them is wrong in silence — `boxsh -c 'seq 1 1500000 |
wc -c'` printing 8323568 where bash prints 10888896 is what that looks like unreported.

Measured, on both hosts:

    yes | nosuchcmd; echo status=$?      ours: the cap's sentence, then
                                               `sh: nosuchcmd: command not found`, status 127
                                         bash: the same 127
    seq 1 200000 | x=1 wc -l             200000 on both — under the cap, unaffected
    yes | head -2                        y y — streams, untouched

**What this does not do**, and it is the honest half: `yes | x=1 cat | head -1` prints `y` in bash
and prints nothing here. The pipeline still runs its stages one at a time, so the producer's output
is discarded rather than consumed as it is made. The shell survives and says so; it does not give
bash's answer. Concurrency for stages `canStream` refuses is what would, and that is 0038's territory
rather than this one's.

Canaried by removing the cap: `error: requested new array is too large`, and the script's next
command never runs.
