# 0127 — a pipeline that cannot stream traps the whole shell on an unbounded producer

- **Status:** open
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
