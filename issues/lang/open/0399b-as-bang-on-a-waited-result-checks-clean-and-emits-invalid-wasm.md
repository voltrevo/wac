# 0399b — `as!` on a waited `Result` checks clean and emits a module the engine refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Sys } from "std";
async i32 one() { return 1; }
export i32 main(Sys sys) {
  i32 x = one().wait() as! i32;
  return x;
}
```

Expected: either a refusal at the cast, or `1`.
Actual: `wac check` says *no diagnostics*; `wac run` says *the module compiled from m.wac was rejected by
the engine — this is a compiler bug*. V8's own message for a larger case: `local.set[0] expected type
(ref null 59), found call of type (ref null 205)` — the `Result<T, Stuck>` from `wait()` is stored into
the `T` local unconverted. A struct `T` fails the same way.

## Notes

**The checker suggests the cast.** Writing `Sources s = t.wait();` is refused with *expected Sources,
found Result<Sources, Stuck>* and the help line *use `as!` for a checked conversion or `as~` for the
nearest value* — so following the diagnostic's own advice produces the invalid module.

`spec/3-expressions/24-casts.md` gives `as!` to numeric narrowing and reference downcasts and says
nothing of an enum to one variant's payload. So the decision is which way to close it: refuse `as!`
from `Result<T, E>` to `T` (and stop suggesting it), or define it as "`Ok`'s value, trapping on `Err`"
and emit that. `match` on the waited value works today, which is what `packages/tor`'s tests do.

Found while writing a test for `issues/lang/0398b`.
