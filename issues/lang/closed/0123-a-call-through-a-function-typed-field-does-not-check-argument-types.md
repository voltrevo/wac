# 0123 — a call through a function-typed field does not check argument types

- **Status:** closed
- **Fixed in:** this commit
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

## Resolution

**It is wacc's, not the reference's.** `wacBind` builds with wacc by default (since 2026-08-12,
because the spec targets it), which is why the first reading of this said "both compilers". Run with
`WAC_BIND_FROM=reference` the same program gives exactly the two expected diagnostics — so this was a
rung-3 gap: a rule the reference implements and wacc did not.

The gap was **recorded rather than unknown**. `funcrefArity`'s own doc comment said it: *"A call
through a funcref is checked for arity and no further: the parameter types are in the funcref's
spelling and could be compared, but that needs the spelling taken apart again and the corpus does
not distinguish it."* The corpus did not distinguish it; the first wac program to make host calls
did.

Fixed by `funcrefParam`, which splits the spelling the way `funcrefArity` counts it — on a comma at
depth zero, so `fn(fn(i32, i32) -> i32, u8[])` is two parameters and not three — and
`checkFuncrefArgs`, applied at both places a funcref is called: a field on a struct, and a local of
funcref type.

Deliberately still not compared: a parameter this checker cannot name, meaning an unbound `T` inside
a generic or a `Pending<T>`. Comparing those needs a substitution it does not perform, and a wrong
complaint about correct code is worse than a missed one. `nameableType` is the guard.

Measured: `packages/wacc/test/wac/typecheck_test.wac` gains a rung-3 differential with four caught cases
and three quiet ones, and turning the new rule off makes it fail with the reference's own message.
1,183 tests across wacc, webrtc, quic, sh, platform, tls, fs, http, server, std, stream, tor, git and
box pass unchanged, which is what says the rule does not fire on correct code.

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
