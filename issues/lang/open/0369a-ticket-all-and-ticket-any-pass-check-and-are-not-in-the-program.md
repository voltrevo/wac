# 0369a — `Ticket.all` and `Ticket.any` pass `wac check` and are not in the program the emitter builds

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** missing feature
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
import { Ticket } from "core";
async i32 one() { return 1; }
export i32 f() {
  Ticket<i32> a = one();
  Ticket<i32> b = one();
  Ticket<i32> w = Ticket.any(a, b);
  return w.wait()!;
}
```

Expected: Builds — spec ch35 defines both.
Actual: `wac check` is clean; the build says *no static Ticket<i32>.any* — `core/ticket.wac` declares neither `any` nor `all`, and the checker does not notice the static is missing. Through a larger program, *a call to `Ticket<i32>.any` … which is not in the program*. Spec ch35's own `allSettled` example fails with *unresolved name Ticket*.

## Notes

From `vision/IDIOMS.md`'s `Ticket.all` idiom and `vision/TECHNICAL.md`'s *`Ticket.any`'s losers keep running*.

Why check is clean: any missing method named through a generic's template passes the checker — 0371a.
