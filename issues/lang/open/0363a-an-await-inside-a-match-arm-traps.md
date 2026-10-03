# 0363a — `await` inside an arm of a value-giving `match` compiles, and traps when the function is called on an unsettled ticket

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** trap

## Reproduction

```wac
import { Ticket } from "core";
async i32 recover(Ticket<i32> p) {
  return match (p.wait()) {
    Ok(v):  v,
    Err(_): await p,
  };
}
export i32 late() { Ticket<i32> p; Ticket<i32> r = recover(p); p.resolve(5); return r.wait()!; }
```

Expected: `late` answers 5 — `vision/TECHNICAL.md`'s *a refused `wait` leaves a resting state*.
Actual: `RuntimeError: unreachable` as soon as `recover(p)` is called. Moving the `await` out of the `match` into a local gives 5.

## Notes

An already-settled ticket (`q.resolve(3)` before the call) answers 3, so it is the suspend inside the arm that breaks.
