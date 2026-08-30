# 0294 — `async` lambdas

- **Status:** open — wanted, and deliberately sequenced after `design/lang/0014`
- **Claimed by:** agent-c, 2026-08-30
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** not implemented

## What is wanted

```wac
p.then(async (Socket s) => {
  Bytes b = await cli.recv(s.handle);
  await cli.send(s.handle, b);
});
```

An `async` lambda, returning `Pending<T>` to its caller exactly as an `async` function does.

## Why it is filed rather than done

`design/lang/0014` D6 says the lowering covers *the whole language*, and a lambda is part of it. The
document did not mention one, which was an omission; D6a now records the decision, and the operator
has confirmed the feature is wanted with the sequencing left to judgement.

After, because a lambda is **already** hoisted to a function with a captured environment
(`design/lang/0002` tier two). `async` on one is the same transform 0014 step 4 builds for functions,
applied to a body that is already being hoisted — so it is worth having the transform working, and
proven against A1–A6, before applying it in a second place.

## The refusal that stands in the meantime

`await` inside a plain lambda is an error today, code 211, and it was **accepted** until 2026-08-30 —
`c.inAsync` answered *which function am I in* with the enclosing one and entering a lambda never
changed the answer:

```wac
async i32 f(Pending<i32> p) {
  fn[void()] g = () => { i32 z = await p; };   // suspend what, exactly?
  …
}
```

`design/lang/0002` settles it: a lambda's `return` returns from the lambda, so its `await` would have
to suspend a plain funcref. Pinned by
`packages/wacc/test/wac/async_test.wac:test_await_inside_a_plain_lambda_is_refused`.

## What it will take

Small, given 0014 step 4:

- `async` before a lambda's parameter list in `parseUnary`'s lambda path, and an `isAsync` on the
  lambda node the way `Func` and `Method` carry one.
- `c.inAsync` becomes the *lambda's* flag where it is currently cleared, which is one line and the
  place the cleared version already sits.
- The target type is `fn[Pending<T>(…)]` rather than `fn[T(…)]`, so a lambda's slot says whether it
  may be async — which is a nicer answer than a rule, and falls out of the funcref type.
- The lowering: whatever step 4 does to a function body, applied to the hoisted one.

## What that list missed, measured 2026-08-30

**The lowering cannot be applied unchanged, and the reason is `0294c`'s neighbour `0296c`.** The
machine's `__wacStep` is a closure *inside* the function being lowered, capturing whatever the body
names — including its parameters. In a function that is the working case. In a lambda it becomes an
inner lambda capturing the **enclosing lambda's parameter**, which is exactly the shape `0296c` says
emits a module the engine rejects. `0294c`'s own motivating example hits it on its first line, since
`s.handle` is read either side of a suspension.

That would make this blocked on `0296c`. It is not, and the difference was worth measuring rather
than reasoning about:

| shape | result |
| --- | --- |
| inner lambda names the enclosing **lambda's parameter** | invalid module — `0296c`, still live |
| enclosing lambda copies it to a **declared cell**, inner lambda reads it | works |
| inner lambda **writes** a declared cell in a lambda body | works |

So the lowering hoists an async lambda's parameters into declared cells before building the machine,
and the inner closure captures a declaration rather than a parameter. `notePromoted` keys a cell by
the position of a declaration and a parameter has none — which is `0296c`'s root cause, and is why
giving it a declaration is enough. One extra step the function path never needed.

Two more that the "small, given step 4" estimate did not cover:

- **`numsNeeded` and the suspension-word walk both filter on `case Func` with `isAsync`.** An async
  lambda inside a *plain* function contributes states and suspensions neither would count, and
  undersizing those synthetic tokens is what trapped the compiler during step 4 rather than
  producing a diagnostic. Both walks have to descend into every function body.
- **`lowerProgram` skips non-async functions entirely**, so it would never find such a lambda.

What does *not* move, checked: `asyncplan`'s `awaitInExpr` already answers `false` for a lambda body
— *"a lambda's body is not this function's"* — and that stays correct, because an async lambda's
suspensions belong to its own machine. The checker's signature comparison does not move either: the
slot genuinely is `fn[Pending<T>(…)]`, so only the *body's* return type unwraps.
