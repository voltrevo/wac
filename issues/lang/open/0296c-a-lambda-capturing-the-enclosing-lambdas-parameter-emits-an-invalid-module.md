# 0296 — a lambda capturing the enclosing lambda's parameter emits an invalid module

- **Status:** open
- **Claimed by:** agent-b
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

## Isolated: the enclosing lambda's *parameter*, whatever its type — agent-b, 2026-08-31

The wasmtime host names it where the v8 one says only that the engine will not load the module:

    failed to compile: wasm[0]::function[286]::$lambda$0/4:22
    Invalid input WebAssembly code at offset 73606: type mismatch: expected (ref null $type), found i64

Four cases:

| the inner lambda captures | result |
|---|---|
| the enclosing lambda's parameter, `i64` | invalid wasm |
| the enclosing lambda's parameter, `FileResult` — a reference | invalid wasm |
| a **local of the enclosing function**, `i64` | compiles |
| only a reference local, `i32[]` | compiles |

The `i64` message made "capturing a primitive" the obvious reading and it is wrong: a reference
parameter fails the same way. What matters is that the captured name is a **parameter of the
enclosing lambda** rather than a local of the enclosing function. Nesting alone is fine — the third
row is two lambdas deep.

### The mechanism, traced

Capturing a **function's** parameter works — reference or primitive, both compile. The machinery is
`Env.noteParamCell`, which records a captured parameter so a cell can be built for it, and it keys
each entry by `walkFuncLine`/`walkFuncCol`: *"where the function currently being walked is, so a
captured parameter can be keyed by it"*.

**Those two fields are only ever set from a function's or a method's `nameTok`** — `emit.wac:9221`,
`:9230`, `:9262`, `:9294`, `:9474`, `:9515` — and never from a lambda. So while walking a nested
lambda, they still name the enclosing *function*. A capture of the enclosing lambda's parameter is
recorded against a function that has no parameter of that name, no cell is ever built, and the raw
value is handed to a capture record whose fields are cell types. That is the
`expected (ref null $type), found i64`.

**`Env.lambdaCapturesParam` is dead** — one occurrence in the whole compiler, its own declaration.
Its comment describes the safeguard for exactly this case: *"such a lambda is declined … handing on
a raw parameter would be an invalid module rather than a wrong answer"*. The decline was never
wired up, and the `paramCell` mechanism that superseded it covers functions only. So the module the
comment promises to refuse is the module that gets written.

**Two ways out**, and the choice is a real one rather than an oversight to patch: key param cells by
the lambda when walking a lambda body, so lambda parameters get cells like function parameters do;
or implement the decline the dead field documents, which turns an invalid module into a refusal and
is much the smaller change. The second is strictly better than today's behaviour even if the first
is the eventual answer.
