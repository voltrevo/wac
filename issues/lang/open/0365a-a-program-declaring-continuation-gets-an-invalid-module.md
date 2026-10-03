# 0365a — A file that declares its own `struct Continuation` and does async work compiles to a module the engine rejects

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Ticket, TicketBase, Vec } from "core";
struct Continuation {
  TicketBase? t;
  fn<void()> call;
}
export string example() {
  Vec<Continuation> pending;
  schedule pending.push;
  Ticket<i32> input;
  Ticket<i32> r = doubled(input);
  input.resolve(10);
  pending.get(0).call();
  return "\{r.value()}";
}
async i32 doubled(Ticket<i32> t) { return (await t) * 2; }
```

Expected: Either the program's `Continuation` is its own type and this runs, or it is refused with a position; a compiled module is always valid.
Actual: *the module compiled from main.wac was rejected by the engine — this is a compiler bug*.

## Notes

Importing `Continuation` from `core` instead runs (answers 20). A lone `struct Continuation { i32 x; }` with no async work is fine, so it is the scheduler's lowering naming `Continuation` by spelling rather than by core's declaration.
