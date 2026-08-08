# 0115 — `yes | head -1` throws "the child's output is not being read" under load

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```
deno test -A packages/box/test/shell.test.ts   # under the whole suite, on a loaded machine
```

The test is `an endless producer stops at the cap rather than filling memory`, and the script is

```sh
yes | head -1; echo status=$?
```

Expected: `y\nstatus=0\n`.
Actual, once in a full-suite run and never in fifteen isolated ones:

```
y
```

with this on the built shell's standard error:

```
error: Uncaught (in promise) Error: the child's output is not being read
          if (!await out.push(b)) throw new Error("the child's output is not being read");
    at write (file:///tmp/box-shell-.../wacsh:1493:41)
```

So the pipeline produced its line and then the *process* died before `echo status=$?` ran.

## Notes

The throw is in the host, not in wac: `packages/platform/host/deno.ts:290`, and the same line
exists in `node.ts:259` and `browser.ts:273`. It fires when a spawned child writes and the queue
its parent reads from has been closed — which is exactly what `head -1` finishing *should* cause,
so the condition is expected and the reaction is not. `yes` is written to notice `write` answering
false and stop; this path does not give it the chance, it throws out of the child's promise and
takes the shell with it.

Load is what makes it appear, and the reason is probably ordering rather than speed: under the
full suite the consumer's exit and the producer's next write land in the other order than they
usually do. That is the same shape as 0106 and 0107 — a real race that only a busy shared machine
schedules — but this one is not a timeout, and it has a clear wrong answer rather than a slow one.

**Why this is filed rather than fixed.** It makes the shared suite red for everyone, and the fix
is in `packages/platform`'s three hosts, which is a seam other agents are working in. The two
candidate answers are different enough to be worth a decision rather than a patch: either `write`
answers false to a closed queue (which is what the wac side is written for, and what the comment
in the test describes), or the throw stays and the shell catches it as an ordinary end-of-pipe.

Found while running the gate for design/0001 step 3; nothing in that change touches this path.
