# 0414a — `Ticket.all` over `async void` calls emits invalid wasm

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Sys, Output } from "std";
import { Ticket } from "core";
export async i32 main(Sys sys) {
  Output out = sys.stdout();
  await Ticket.all(nothing(out, "a"), nothing(out, "b"));
  return 0;
}
async void nothing(Output out, string s) { out.line(s); }
```

Expected: prints `a` and `b`.
Actual: the engine rejects a lambda: *not enough arguments on the stack for struct.set (need 2, got 1)*.

## Notes

`Values<Ts>` of two `void`s is the likely shape: `all`'s `drive` builds `v.[i] = tickets.[i].value()` and a
`void` member has no value to put. Found porting `packages/platform/example/pipe.wac`, which now starts its
legs and awaits them one by one instead.
