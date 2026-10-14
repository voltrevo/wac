# 0372a — An `await` inside a `static_for` is refused by the async lowering

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-14
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
import { Ticket } from "core";
async (i32, string) both((Ticket<i32>, Ticket<string>) ts) {
  (i32, string) out;
  static_for (i32 i = 0; i < 2; i++) { out.[i] = await ts.[i]; }
  return out;
}
export i32 t() {
  Ticket<i32> a; Ticket<string> b;
  Ticket<(i32, string)> r = both((a, b));
  b.resolve("xy"); a.resolve(3);
  (i32, string) got = r.wait()!;
  return got.0 + got.1.len();
}
```

Expected: 5. Spec ch31 does not restrict what a `static_for` body holds, and ch35 writes `Ticket.all`'s body
this way.
Actual: *an `async` function this compiler cannot lower — an `await` inside a `static_for`*
(`asyncplan.wac`'s `declineFor`).

## Notes

The lowering rewrites a function's AST into a coroutine once per template, before monomorphisation, and in a
generic the number of turns depends on the instance (`typeref(Ts).tupleMembers().len()`). So it is not a matter
of unrolling first: the unrolled shape does not exist when the lowering runs. A concrete bound, as above, could
be unrolled there; a generic one needs the lowering to run per instance, or a state for each turn chosen at run
time.

`Ticket.all` does not need it: it can collect its tickets as a `TicketBase[]` under `static_for`, await them in an
ordinary loop, and read each `value()` under a second `static_for` with no `await` in it.
