# 0296 — a lambda capturing the enclosing lambda's parameter emits an invalid module

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** invalid wasm — the compiler writes a module the engine will not load

## Reproduction

```wac
import { Core, Cli } from "std/platform.wac";
export i32 main(Core core, Cli cli) {
  i32[] n = i32[1]();
  core.delay(1).then((i64 a) => {
    core.delay(1).then((i64 b) => { n[0] = (a > (0 as i64)) ? 1 : 2; });
  });
  core.drain();
  return n[0];
}
```

    wac: the build wrote … and the engine will not load it, so the compiler emitted something
    invalid rather than refusing the program

    CompileError: Compiling function #267:"$lambda$0/4:22" failed:
      struct.new[1] expected type (ref null 48), found local.get of type i64

**The inner lambda's capture struct wants a cell and is handed the value.** `a` is the *outer
lambda's parameter*, and a captured local lives in a one-field cell so that the lambda and the
function it came from share one storage. The inner lambda's environment is built expecting that cell;
what is pushed is the raw `i64`.

## What narrows it

| shape | result |
| --- | --- |
| three lambdas nested, each capturing a *function* local | fine |
| a lambda capturing a *function* local, one level | fine |
| a lambda capturing the **enclosing lambda's parameter** | **invalid module** |

So it is not nesting, not the depth, and not capture in general. It is that the captured thing is a
lambda's parameter rather than a declaration.

`notePromoted(line, col)` is how the emitter records that something must live in a cell, and
`localIsCell` asks the same way — **by the position of its declaration**. A lambda's parameter has no
declaration statement to promote, so nothing marks it, and the capture is built against a cell that
was never made.

## Why it matters

Every continuation-passing shape meets this. `p.then(x => { q.then(y => … x …); })` is the ordinary
way to write two dependent asynchronous steps, and `x` is exactly a lambda parameter captured by an
inner lambda. It was found writing a *control* for `design/lang/0014` — a hand-written version of what
the `async` lowering produces — which is to say the first time anybody wrote that shape by hand.

The `async` lowering does not hit it: its handlers are declared in the enclosing function rather than
nested inside one another, for an unrelated scoping reason. So this is a gap in what a person can
write by hand, not in what the compiler generates.

## Notes

The failure is loud, which is the one good thing about it: the module is written and refused rather
than loading and misbehaving. `bootstrap.sh` refusing to install a compiler that cannot rebuild its own
command is the same shape of guard, and is what catches this class in the compiler's own source.
