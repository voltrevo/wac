# 0304 — an exported generic function cannot be called from another module

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** the emitter declines the module — *"a call to `ready`, which this expression is emitted
  as and which is not in the program"*

## Reproduction

`packages/platform/src/frame.wac` exports one:

```wac
export Pending<T> ready<T>(T value) {
  return Pending.of(0, (i32 id) => value, (i32 id) => true, (i32 id) => { });
}
```

Any other file that calls it fails, **including at a type `frame.wac` itself already instantiates**:

```wac
import { ready } from "../../../platform/src/frame.wac";
i32 n = ready(7).wait();
```

    wacc: cannot emit tp_test.wac — a call to `ready`, which this expression is emitted as
    and which is not in the program

`ready(7)`, `ready(FileResult(…))` and `ready(Stat(…))` all fail the same way, so it is not the type
argument. It is that the instantiation is expected in the *caller's* module and is not emitted there.

## What still works, which is what makes this confusing

**Non-generic functions in the same file that call `ready` internally are fine.** `childCli` is
exported from `frame.wac`, calls `ready` in six lambdas, and every caller of it compiles and runs —
including in-process applet runners across three packages. So the export boundary is not the problem
in general; a *generic* one is.

**Generic types cross modules without trouble.** `Vec<T>`, `Option<T>` and `Pending<T>` itself are
used everywhere. This is about a generic **function**.

## The workaround, and what it costs

A non-generic wrapper per type, kept in the file that defines the generic:

```wac
Pending<FileResult> readyFile(FileResult v) { return ready(v); }
Pending<Stat> readyStat(Stat v) { return ready(v); }
```

That works, and `packages/platform/src/frame.wac` now carries five of them for `childCliGranted`.
The cost is one wrapper per type per generic, written in the *defining* module — so a caller cannot
use a generic at a type its author did not anticipate, which is most of what a generic is for.

## Why it was found now

`issues/system/0302c` asked for a way to hand a frame's child fewer grants than its parent. The
natural implementation replaces a few of `Cli`'s function fields with stubs that refuse, and a stub
that refuses has to return an already-answered `Pending`. That is `ready`'s entire purpose.

## Where to look

Monomorphisation in `packages/wacc/src/emit.wac`: the instantiation is recorded against the module
that *defines* the generic rather than the one that needs it, or the caller's module is not asked to
emit it. `spec/spec/generics.md` says nothing restricting a generic function to its own module, so the
spec is on the side of this working.

**The diagnostic is worth fixing beside it.** It names the function and says it "is not in the
program", which reads as a missing import — the one thing it is not. Neither the type argument nor the
call site's line is given, and both are known at that point.
