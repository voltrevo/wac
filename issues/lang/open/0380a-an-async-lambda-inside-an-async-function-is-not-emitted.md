# 0380a — an `async` lambda inside an `async` function is not emitted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
import { Ticket } from "core";
export async i32 main(Sys sys) {
  Ticket<i32> inp;
  fn<Ticket<i32>(Ticket<i32>)> f = async (Ticket<i32> t) => { i32 v = await t; return v + 1; };
  Ticket<i32> r = f(inp);
  inp.resolve(1);
  sys.log("\{await r}");
  return 0;
}
```

Expected: prints `2`.
Actual: `wacc: cannot emit … — a lambda whose type this emitter could not work out` (`emit.wac`, the
`declineFor` in the lambda arm).

## Notes

The same lambda in a function that is not `async` works (spec case 0314 is that shape), and so does a
plain lambda in an `async` function. So it is the lambda surviving the enclosing function's async
lowering: the hoisted machine seems to lose the slot type the lambda takes its own type from.

Found writing UI handlers for `design/system/0012`, where an event handler that awaits — a confirm
dialog, a save — is an `async` lambda written inside `async main`.
