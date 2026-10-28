# 0400a — the compiler's internals, named `__wac…`, are ordinary declarations a program can call

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { Sys } from "std";
import { __wacScheduleTarget } from "core";

export i32 main(Sys sys) {
  return __wacScheduleTarget() is null ? 7 : 8;
}
```

Expected: refused — a program has no business naming the compiler's machinery.
Actual: compiles and exits 8. `Sys.__wacOf(core, cli)` likewise makes a `Sys` from nothing, which breaks ch44's
"a program cannot make a `Sys`: the only one is the one `main` receives".

## Notes

**Not acceptable** (operator, 2026-10-24). The `__wac` prefix is a convention, not a rule; nothing stops a program.

Why they are visible: the compiler lowers by **rewriting source to source**. `async`/`gen` bodies become ordinary
wac text (`packages/wacc/src/asynclower.wac`'s header) and `main`'s adapter is wac text
(`packages/wacc/src/program.wac`), and both are then checked like any program — so whatever they call must be a real
exported declaration found by ordinary lookup. Today that is:

- **core's lowering helpers** — `__wacMachine`, `__wacResumer`, `__wacIsWaiting`, `__wacDoneOf`, `__wacWaitingOn`, …
  in `core/ticket.wac` (33 mentions);
- **the schedule target** — `__wacScheduleTarget`/`__wacSetScheduleTarget`, functions whose bodies the emitter
  replaces with a hidden global (`emit.wac:16052`);
- **`Sys`'s adapter methods** — `__wacOf`, `__wacSettle`, `__wacFailed` in `std/platform.wac`. These should go
  outright, not be hidden: design/system/0013 step 6 has the adapter use the public surface (`drain`, `wait`,
  `stderr`) and the host build a `Sys` through a constructor the compiler emits as a module export.

What remains after that must be unreachable from a program's source — whether by the checker refusing `__wac`
names outside core and compiler-generated text, or by the lowering resolving them in a scope programs cannot
name. Which, is for whoever takes this up; a naming rule alone still leaves them in core's export list.
