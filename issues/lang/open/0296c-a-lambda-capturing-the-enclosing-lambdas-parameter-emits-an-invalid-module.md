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

## Where it is, and what the fix looks like

Chased since filing. The emitter already knows this case exists and says so, beside the promotion:

> A parameter records -1 and is skipped: it has no `Var` to promote, and needs a cell made at
> function entry instead — the piece that is still missing.

and it does handle it — `noteParamCell(this.walkFuncLine, this.walkFuncCol, name)`. **The bug is
which function that names.** `walkFuncLine` and `walkFuncCol` are set only from a *declaration's*
name token — five sites, all of them a function or a method — and never when the walk enters a
lambda. So a captured *lambda* parameter records its cell against the enclosing **function**, which
never makes one, while the inner lambda's environment is built expecting it. Hence a `struct.new`
handed a raw `i64` where a `(ref null …)` belongs.

The fix is to make those two fields name the innermost function-*like* thing rather than the
innermost declaration: set them to the lambda's own position when the walk enters a lambda body, and
put them back on the way out — the same save-and-restore shape `walkLambdaDepth` already uses beside
it. A captured function parameter keeps working because the outermost case is unchanged.

**And there is a second half, found on a later look.** Renaming is not enough on its own, because
nothing would read the record: `paramNeedsCell` is consulted in exactly two places, both inside
`emitFunctionOf`, which emits *functions and methods*. A captured parameter gets its cell there — the
value arrives in its slot, a cell is built from it, and a new local of the same name shadows the
parameter so every later read goes through the cell. **The lambda emission path does none of that.**

So the fix is two changes that only work together:

1. `walkFuncLine`/`walkFuncCol` name the innermost function-*like* thing, saved and restored around a
   lambda body the way `walkLambdaDepth` already is beside it, so the record is made against the
   lambda that owns the parameter.
2. The lambda emitter makes the cell at entry when `paramNeedsCell` says so — the same three
   instructions `emitFunctionOf` uses, and worth sharing rather than copying, since the receiver case
   there records that the one place which made an exception of `this` is the one place it went wrong.

Not attempted here: it is a change to how the capture walk names things *and* to how lambdas are
emitted, and it deserves its own tests rather than being folded into the `design/lang/0014` work that
found it.

## Notes

The failure is loud, which is the one good thing about it: the module is written and refused rather
than loading and misbehaving. `bootstrap.sh` refusing to install a compiler that cannot rebuild its own
command is the same shape of guard, and is what catches this class in the compiler's own source.
