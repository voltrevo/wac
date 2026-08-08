# 0120 — child output sinks are not awaited, so backpressure does not hold

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
