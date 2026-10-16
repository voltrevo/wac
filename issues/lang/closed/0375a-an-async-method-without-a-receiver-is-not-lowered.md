# 0375a — An `async` method without a receiver is not lowered

- **Status:** closed
- **Fixed in:** 71a4c76f9
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-14
- **Kind:** missing feature
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
import { Ticket } from "core";

struct Plain {
  i32 v;
  async i32 ten() { return 10; }
}

export i32 f() { Ticket<i32> t = Plain.ten(); return t.wait()!; }
```

Expected: `f() = 10`.
Actual: `wac check` is clean; the build says *an assignment between related reference types: i32 into
Ticket<i32>*.

## Notes

`loweredMethods` in `packages/wacc/src/asynclower.wac` leaves the method as it was when `!me.hasThis`: the
wrapper it writes calls the coroutine form through `this`, and a static has none. The checker types the call as
a `Ticket<i32>` and the emitter compiles the unlowered body, which answers an `i32`. The wrapper needs to call
through the owner's type instead — which for a generic owner means `Box<T>.__wacCo_…` or, when the method uses
none of the owner's letters (ch19), the bare template.

Found writing `Ticket.all` in `core`, which is a static on a generic. It is written with a `drive` function
instead of `async` (0369a), which turned out the better design anyway: a `wait` on it refuses exactly when none of
its tickets can move.
