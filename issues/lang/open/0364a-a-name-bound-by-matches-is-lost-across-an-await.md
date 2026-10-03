# 0364a — A name bound by `matches` in a `while` head and used after an `await` in the body passes check and stops the emitter

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
import { Continuation, Queue, Ticket } from "core";
struct Box { Queue<Continuation> q;
  async void run1(this) { while (Continuation c matches this.q.pop()) { await; c.call(); } }
}
async void tick() { await; }
export i32 go() { Box b; { schedule b.q.push; tick(); } b.run1().wait()!; return b.q.len(); }
```

Expected: Builds and runs.
Actual: `wac check` is clean; `wac run` says *cannot emit — a call to `.call`, which this expression is emitted as and which is not in the program*.

## Notes

From `vision/TECHNICAL.md`'s *`Sys.drain` runs the work nobody awaited*. The same loop over a nullable local, assigned and unwrapped, runs — so it is the `matches`-bound name not being carried into the coroutine's saved state.
