# 0120 — child output sinks are not awaited, so backpressure does not hold

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/51](https://github.com/voltrevo/wac-mono/issues/51)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** wrong answer

The Deno and browser hosts type output callbacks as synchronous `void`, but spawned-child plumbing
supplies `async` ones that await `ByteQueue.push`. `OP.WRITE_STDOUT` / `OP.WRITE_STDERR` call them
without awaiting, so a write is acknowledged before the queue has taken the bytes — defeating the
backpressure the queue is for — and a later rejection becomes an unhandled promise rejection rather
than a failed host call.

**Not reproduced here**, though the shape is visible at `host/deno.ts`'s `OP.SEND`, which has the same
unawaited-push mistake (see 0121). Related: wac-mono 0115, where a child's write throwing out of a
promise takes the shell with it.

## Half of this was already fixed, and the half that was left was on the other host

Read before touching: the Deno, Node and browser hosts all declare their sinks
`void | Promise<void>` and all three **await** them — `if (!await out.push(b)) throw …` for a child's
output, `await writeOut(...)` for the process's. That landed with 0115, which this issue predates.
So the defect as filed was gone, and nothing held it: with the `await` removed by hand, the entire
`packages/platform` suite still passed, 148 tests.

`send` was the one line still unawaited, which this issue names — fixed under 0121.

**And then the two hosts disagreed the other way.** `packages/platform/example/feed.wac` makes a
child write nine megabytes into a parent that will not read for 300ms, and asks two things: that
nothing is lost, and — the child timing its own writes — that it had to *wait*. Every JavaScript host
made it wait, because `ByteQueue` has held a cap since it existed. The native runtime finished
immediately: `streams.rs`'s `Stream` was an unbounded `VecDeque`, so `write` always answered true and
a producer's entire output could sit in memory. `box yes` writes for ever by design.

`Stream` now has `capped()` and `uncapped()`. A capped write waits on the condvar until there is room
or the stream ends, and a reader notifies after draining. The cap is `8 << 20` — the same number as
`host/children.ts`'s `QUEUE_CAP`, to the byte, because two hosts whose buffers differ are two hosts
whose programs behave differently. Uncapped, and why: a child's **standard input**, which the parent
decides the size of and which `children.ts` also leaves uncapped; and both directions of the
**filesystem channel**, where the thread that would wait for room is the one that drains it.

**Canary:** reverting the Deno sink to an unawaited `push` fails `feed`'s last two verdicts, and so
does reverting the native cap. Neither had anything to fail before this.
