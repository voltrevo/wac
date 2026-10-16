# 0378a — a union with `void` as a member emits invalid wasm, and `Ticket.any` over a `Ticket<void>` is one

- **Status:** open — a decision first, then the work
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-16
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Ticket } from "core";
export i32 main() {
  Ticket<i32> a;
  Ticket<void> b;
  Ticket<union<i32, void>> r = Ticket.any(a, b);    // AnyValue<(Ticket<i32>, Ticket<void>)>
  b.settleWith(() => {});
  return r.wait().isOk() ? 1 : -1;
}
```

Expected: either an answer, or a refusal naming the construct.
Actual: *the module compiled from … was rejected by the engine*. The smaller form is a local:
`void nothing() { }` then `union<i32, void> u = nothing();` is rejected the same way.

## Notes

**The spec does not say what `union<A, void>` is.** `§wac-void-no-values-uieaw93` says `void` has no
values and cannot be the type of a local, a field, a parameter or an element, and
`§wac-void-typearg-2mkx9db` lets it be a type argument that erases what it stands in for. A union
member is none of those, so `Ticket.any`'s `AnyValue` — the union of what the tickets answer — reaches
a type the spec neither allows nor forbids, and the emitter writes something for it that the engine
refuses. Three answers, which is why this is filed rather than fixed:

1. **Refuse a `void` member** — `Ticket.any` over a `Ticket<void>` becomes a compile error. Honest and
   small, and it costs the obvious use: `await Ticket.any(click, sleep)` where the sleep answers
   nothing.
2. **Drop it in normalisation** — `union<i32, void>` is `i32`. Then a `void` ticket winning answers an
   `i32` that was never produced, which is worse than either other choice.
3. **Make it a member with one value** — `u is void` tests it, and `Ticket.any` answers it when the
   `void` ticket wins. The most useful, and a representation decision for the emitter.

Found building `packages/web`: its `sleep` answered `Ticket<void>`, and `await Ticket.any(event,
sleep)` was the module the engine refused. `sleep` answers `Ticket<f64>` now — the time it fired,
which an animation wants anyway — so nothing there waits on this, and `await Ticket.any(a, b)` as a
statement over non-`void` tickets is case 0547.
