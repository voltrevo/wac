# 0014 — a frame's output streams with backpressure

- **Status:** option 1 chosen 2026-10-24, subject to the measurement — whose results go to the operator before
  anything is moved
- **Raised by:** agent-a, 2026-10-22. The ruling: *"Neither cap nor growth: frames stream with backpressure, as
  an OS pipe does, so nothing needs a cap and `truncated` goes."*
- **Spans:** `std/platform.wac` (`pushChild`, `popChild`, `Captured`), `packages/platform/src/frame.wac`, the
  four hosts' frame stacks, `packages/sh` and `packages/box`'s in-process route

## Where the cap comes from

A **frame** runs another program *in this instance*: the host (or, since `frame.wac`, a value the caller holds)
swaps in the child's argv, input and output streams for one call, the child runs to completion on the caller's
own stack, and `popChild` / `Frame.captured()` hands back what it wrote. Because the child runs to completion
before anyone reads, its output has to be held somewhere whole — and so it is either capped (Deno, Node,
`frame.wac`: 8 MiB, then `write` answers false and `truncated` is set) or grown without limit (both native
hosts).

**A spawned child already does what the ruling asks.** It is its own instance on its own thread or worker, its
output is a queue the parent reads with `recv`, and a write into a full queue *waits*
(`native/v8/src/streams.rs`, `native/src/streams.rs` and `host/children.ts`'s `QUEUE_CAP` all say so, to the
byte). `seq 1 1500000 | wc -c` through spawned stages gives bash's answer on every host. Nothing there is capped
in the sense this issue means: the bound is on what may sit unread, not on what may be produced.

So the cap is a property of running the child **on the caller's stack**. A pipe has backpressure because the
writer can be suspended while the reader runs; a frame cannot suspend its child, because the child *is* the
caller for the duration of the call.

## The options

1. **Frames go, and the in-process route is a spawned child.** Everything that pushes a frame today —
   `packages/sh`'s *called* applet route, `box`'s fallback, `frame.wac`'s users — spawns instead, and gets the
   queue that already has backpressure. `pushChild`, `popChild`, `Captured` and `truncated` are deleted, as
   `frame.wac`'s cap is. Cost: an instance per stage where there was a function call. Measured once, on
   `packages/box` `cat` over a small file: 64 ms as a worker, against near nothing in-process — that number
   has to be taken again, for a short pipeline and for the shell corpus, before this is chosen.
2. **Frames become coroutines.** The child runs as a machine whose `write` suspends when its buffer is full,
   and whoever drains the frame resumes it. wac has the machine (`gen`, `async`, `coroutine`), but an applet's
   `cli.write` is an ordinary synchronous call deep inside ordinary code; suspending it needs either every
   applet compiled as a coroutine or stack switching from the engine (JS Promise Integration, or wasm stack
   switching), which not every host has. Not portable today.
3. **A frame pushes to its sink.** The frame's `write` hands each block straight to a consumer function
   instead of buffering. That streams when the consumer is a plain sink — the parent's own output, a file —
   and is exactly the frame's current problem when the consumer is the next stage of a pipeline or a
   `$(…)` capture, which is a value the parent wants whole (bash holds it whole too). It removes the cap for
   the cases that never needed one and keeps it for the ones that do.

## Recommendation

**Option 1**, subject to the measurement. It is the only one that gives *every* frame a pipe's behaviour on
every host without a new engine feature, it deletes a second implementation of "run a child" (CLAUDE.md:
two producers of one artefact is one too many), and the capability that replaces it already passes the
conformance ledger on all four hosts where `PUSH_CHILD`/`POP_CHILD` are recorded as two-host gaps.

The order of work, if it is chosen:

1. Measure: the shell corpus and `box`'s tests with the called route forced off, wall time and peak memory,
   against today. If the cost is a startup per stage, a pool of warm instances is the next question — still
   no cap.
2. Move `packages/sh`'s and `box`'s in-process route to `spawnSelf`, behind no flag; delete `frame.wac`'s cap
   and its `truncated`.
3. Delete `pushChild`/`popChild`/`Captured` from `std/platform.wac` and the four hosts, with
   `conformance_test.wac`'s two gaps.

## What would change the recommendation

If the measurement makes per-stage instances unaffordable (a corpus that takes minutes longer, or memory that
grows with pipeline length), option 3 for plain sinks plus option 1 for pipelines is the fallback — `$(…)`
holding its output whole is not a cap, it is what the construct means.
