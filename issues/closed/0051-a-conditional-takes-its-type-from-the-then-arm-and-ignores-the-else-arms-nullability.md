# 0051 — a conditional takes its type from the then-arm, ignoring the else-arm's nullability

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-a
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm

`cond ? T : T?` is typed as `T`, so the nullable arm is stored where a non-nullable value is
expected. It typechecks and fails to instantiate.

Reproduced against `2db0eb1` and again after pulling as of filing.

## Reproduction

Six lines, no imports:

```wac
struct S { i32 x; }

export i32 pick(bool b, S? s) {
  S? r = b ? S(1) : s;
  return r is null ? 0 : 1;
}
```

Expected: the conditional is `S?`, since one arm can be null. Nothing here needs a diagnostic —
the code is reasonable and the target type is spelled out on the left.

Actual: `wacCompile` reports `OK`, and the module does not validate.

```
CompileError: WebAssembly.Module(): Compiling function #0 failed:
  type error in fallthru[0] (expected (ref 0), got (ref null 0)) @+367
```

## The rule

| expression | result |
|---|---|
| `b ? S(1) : s` — non-nullable then, nullable else | invalid wasm |
| `b ? s : S(1)` — nullable then, non-nullable else | fine |
| `b ? S(1) : S(2)` — both non-nullable | fine |
| `b ? s : s2` — both nullable | fine |

So the result type is taken from the then-arm alone, and the else-arm is stored into it without a
widening. Swapping the arms works because widening the *other* way — non-nullable into nullable —
is a no-op at the wasm level.

Enums behave the same way, and an enum *variant* against the enum type is a second instance of
the same shape: `b ? Host.Named(x) : someHostOptional` fails for both reasons at once. That is how
I hit it — `packages/url` assigning a host that is either a fresh variant or an existing optional.

## Notes

The fix is presumably to take the join of both arms rather than the first, which for `T` and `T?`
is `T?`, and for a variant and its enum is the enum.

Worth checking the same join in the other places two branches meet — `match` arms as an
expression, and a function with `return` in both halves of an `if` — since the bug is in what the
type of a two-armed expression is, not in the ternary syntax specifically.

Workaround, for anyone who hits it before it is fixed: declare the local with the nullable
initializer and overwrite it.

```wac
S? r = s;
if (b) { r = S(1); }
```

## Fixed (agent-a, 2026-07-31)

The report's table is the whole diagnosis: the result type came from the then-arm alone, and the
reason only one order showed it is that widening non-nullable *into* nullable is a no-op at the wasm
level.

**The type checker had it right.** `unifyBranches` returns `S?` for that pair, because `S` is
assignable to `S?`. The emitter derived the type a second time in `typeOfExpr` and had no case for
"one branch nullable", so it returned the then-arm's `S`. Two places computing one type — the same
mistake as the i64-literal split and the ternary-variant bug, both of which have comments in that
function saying the fix is to mirror rather than to re-derive.

So this time the derivation went away instead: the checker records the unified type on the ternary
node and the emitter reads it, exactly as `matchExpr` already did. The derivation stays as a
fallback because `wasmBuildBin.test.ts` drives the emitter directly with no checker — and it is
fixed too, since a fallback that is exercised has to be right.

Not only structs: an array, a string, a boxed primitive and an enum all had it, and
`§wac-ternary-nullable-9pqk3vm` covers each, plus a subtype against a nullable parent and a ternary
nested inside one.
