# 0021 — wacInstance cannot return a string

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** trap (a JS exception from the wrapper, not from wasm)

Calling an export whose return type is `string` through `wacInstance` throws. The
value arrives as a wasm reference and `coerceResult` falls through to
`Number(v as number | bigint)`, which cannot convert it.

## Reproduction

```ts
const inst = await wacInstance(compiled);   // for: export string greet() { return "hi"; }
inst.call("greet", []);
```

```
TypeError: Cannot convert object to primitive value
    at coerceResult (atoms/wac/wacInstance.ts:90)
```

`coerceResult` handles `i64`, `u64`, `u32`, `bool` and `void`, then falls through to
`Number()`. `string` needs the same treatment the bindgen helpers already give it:
`__bind_str_len` and `__bind_str_get` are emitted into every module, so the wrapper
has everything it needs to decode one.

Expected: `"hi"`.
Actual: a TypeError from the wrapper.

## Notes

Not urgent, because everything works around it — but there are now **three** distinct
workarounds in the tree, which is the argument for fixing it once:

- `wacSpec.test.ts` has `runWithExpected`, which appends a `__verify` function and
  compares the two strings *inside* wac, so the string never crosses.
- `harness/wacTestRun.ts` in wac-mono instantiates the module itself and calls
  `__bind_str_len` / `__bind_str_get` by hand.
- `harness/wacBind.ts` goes through bindgen, which handles strings properly.

The first is the one that costs something: a test that compares inside wac cannot
report what it actually got, only that it differed. Several string tests would read
better as direct comparisons.

The same gap probably applies to any reference return — a struct or an array through
`wacInstance` — but only `string` has an obvious decode, so it is the one worth
fixing first.
