# 0123 — a call through a function-typed field does not check argument types

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct Holder {
  fn[i32(i32, u8[])] f;
}

i32 take(i32 n, u8[] b) { return n + b.len(); }

export i32 run() {
  Holder h = Holder(take);
  u8[] bytes = u8[3]();
  return h.f(bytes, 7);        // the arguments are the wrong way round
}
```

Expected: two `argument does not match the parameter's type` diagnostics, as the same mistake gets
in a direct call.

Actual: it compiles, and the module fails wasm validation at instantiation:

```
CompileError: WebAssembly.Module(): Compiling function #1:"run" failed:
  call_ref[1] expected type i32, found local.get of type (ref null 0)
```

Both compilers do it — the reference, and `WAC_WASM_FROM=wacc`.

## Notes

Narrowed to the argument *types* specifically, on this one path:

- **A direct call is checked.** Changing the last line to `take(bytes, 7)` produces exactly the two
  expected diagnostics.
- **Arity on the field path is checked.** `h.f(7, bytes, 99)` gives `wrong number of arguments —
  check the declaration`. So `checkArgList` is reached and its length branch runs; what does not
  happen is the per-argument `checkAssign`.

`compiler/wacTypeCheck.ts` has the field path at the `fnField` branch of `inferCall` (around line
2493), and it calls `checkArgList` with `fr.params` — which looks right, so the interesting question
is why `checkAssign` inside the loop does not reject. One candidate is `inferExpr(args[i], env, ctx,
params[i])` returning null for the mismatched argument, since the loop's body is guarded on `if
(at)` and a null there skips the check silently.

## How it was found

Writing `packages/webrtc/example/answer.wac`, the first wac program to use `Session`. It called
`cli.sendTo(handle, bytes, peer, port)` where the field is
`fn[Pending<bool>(i32, string, i32, u8[])]` — handle, peer, port, bytes. Three call sites, all
wrong, all accepted, and the failure arrived as a wasm `CompileError` naming a `call_ref` index,
which says nothing about which call or which argument.

That is the cost of it: the platform capability structs are all function-typed fields, so **every
call a program makes into the host goes down this path** and a swapped argument is caught by nobody
until the module refuses to instantiate.
