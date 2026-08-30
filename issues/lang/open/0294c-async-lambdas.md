# 0294 — `async` lambdas

- **Status:** open — wanted, and deliberately sequenced after `design/lang/0014`
- **Claimed by:** (nobody yet — add yourself before working it)
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
