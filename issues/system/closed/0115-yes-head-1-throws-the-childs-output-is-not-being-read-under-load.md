# 0115 — `yes | head -1` throws "the child's output is not being read" under load

- **Status:** closed
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

## Second sighting — 2026-08-09, agent-a

The test's own comment asks whoever sees it fail to paste the assertion text here, so:

```
an endless producer stops at the cap rather than filling memory => ./packages/box/test/shell.test.ts:139:6
error: Error: assertEquals failed — error: Uncaught (in promise) Error: the child's output is not being read
          if (!await out.push(b)) throw new Error("the child's output is not being read");
    at write (file:///tmp/box-shell-66523b778d35b77c/wacsh:1538:41)

  got:  "y\n"
  want: "y\nstatus=0\n"
```

Same shape as the first: the line arrives, the process dies before `echo status=$?`. In a gate run,
under a suite of 2960, with another agent's gate running beside it — so "under load" holds. The
commit it failed on changed one markdown file, which is as close to a control as this gets.

**And the two candidate answers are not equal**, which is worth writing down while it is fresh. The
throw is not an accident: `deno.ts` says "Throwing is how the host says false — the same shape
`pushChild`'s cap uses", and the wac side is written for a false (`box yes` is `while (cli.write(b))
{}`). So the mechanism is right and the *delivery* is what fails: this rejection reaches Deno as
`Uncaught (in promise)`, which means some path invokes the child's `write` callback without awaiting
what it returns. That is a third possibility the original notes did not have — neither "answer false"
nor "catch it in the shell", but **find the caller that drops the promise**, which would leave the
design as written and make the failure impossible rather than handled.

## Closed — 2026-08-09

**A dropped promise, in three hosts, on four callbacks.** `log`, `warn`, `write` and `writeErr` are
declared `void` in the world options and implemented `async` by every spawned child — a child's
output is a push onto a queue, and pushing is asynchronous exactly when the queue is full.
TypeScript assigns a `Promise<void>` to a `void` without complaint, so every call site dropped it:

    deno.ts     writeOut(p.slice())      log(unstr(p))     warn(unstr(p))    writeErrOut(...)
    browser.ts  write(p)                 log(unstr(p))     warn(unstr(p))    writeErr(p)
    node.ts                              log(unstr(p))     warn(unstr(p))

The throw is not the bug. `deno.ts` says so in place — "throwing is how the host says false" — and
`box yes` is `while (cli.write(block)) {}`. The bug is that nobody was holding it, so instead of
becoming a false answer to the guest it became Deno's `Uncaught (in promise)` and took the parent
down. That is why the symptom was a *shell* that died after printing its line.

The four are now `void | Promise<void>` and awaited at every call site, so a rejection is the op's
failure — which the bridge already turns into `false` for the guest.

**The test is `packages/platform/test/sinks.test.ts`**, and it is deterministic where the reported
failure was a race: hand a world a sink that rejects, call the op, and require the *op* to reject;
hand it a sink that has not finished, and require the op to still be pending. Both fail against the
previous code — the first as an uncaught error, which is this issue's own signature.

**Second bug, same cause, nobody had seen it.** An op that answers before its push completes
releases the guest early, so its next write can be pushed while the first is still waiting for room
and two writes can land out of order. The second test is that one.

**One site was found by the test rather than by reading**: `browser.ts`'s `WRITE_STDOUT`, which I had
missed while fixing the other seven.

Not claimed: that the *race* is gone. A consumer still ends its queue while the producer is writing —
that is what `head -1` does. What changed is what happens next.
