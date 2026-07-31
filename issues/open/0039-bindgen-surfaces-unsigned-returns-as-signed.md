# 0039 — bindgen surfaces `u32`/`u64` returns to JS as signed

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, no error

A function returning `u32` or `u64` reaches JS as a two's-complement *signed* value
once the top bit is set. `wacBindgen` already knows the wac-level type — it emits
`number` for `u32` and `bigint` for `u64` — but does not narrow the value, so the
result is off by 2^32 or 2^64.

## Reproduction

```wac
// sig.wac
export u32 u32High() { return 0xFF000000; }
export u64 u64High() { return 0xFF00000000000000; }
export i32 i32High() { return 0xFF000000; }
```

```ts
const m = await wacBind("sig.wac");
console.log(m.u32High());   // -16777216           want 4278190080
console.log(m.u64High());   // -72057594037927936n want 18374686479671623680n
console.log(m.i32High());   // -16777216           correct — i32 is signed
```

Both unsigned values are exactly `want - 2**width`, which is the signed reading of the
same bits.

## Cause

wac's `u32` and `u64` are `i32` and `i64` in wasm, which is the right representation —
signedness lives in the instruction, not the type. But the JS API of WebAssembly
converts `i32` to a signed `number` and `i64` to a signed `BigInt`, and that is the
last point where the wac-level type is still known. The generated wrapper passes the
raw result straight through:

```ts
export function u64High(): bigint {
  return (_exports.u64High as CallableFunction)() as bigint;
}
```

The `as bigint` says the type is right while the value is not.

## Suggested fix

Narrow in the wrapper, where the declared return type is available:

- `u32` → `x >>> 0`
- `u64` → `BigInt.asUintN(64, x)`

`u8` and `u16` need nothing: they are packed types and the typechecker already rejects
them as return types (`packed type 'u8' cannot be a return type`), so they cannot reach
the boundary as scalars.

Arguments do not need this: JS→wasm `i32` conversion is `ToInt32`, so passing
`4278190080` for a `u32` parameter already arrives with the intended bit pattern. It is
only the return path that loses the interpretation.

Worth checking the same path for `u32[]` and `u64[]` returns. `u8[]` is fine — it
becomes a `Uint8Array`, which is unsigned — but the wider array types should be
confirmed rather than assumed; I have not checked them.

## Notes

Found while testing byte/word conversion helpers in wac-mono's crypto package against
the host's `DataView`. It is easy to miss because the usual workaround hides it: a JS
caller who writes `x >>> 0` out of habit, as I had in the 32-bit half of that test, sees
correct values and never learns the value arrived signed. The 64-bit half had no such
habit to lean on, which is the only reason it showed up.

No wac program is wrong because of this — the arithmetic inside the module is correct,
and the existing crypto vectors all pass, because those exports return `u8[]`. It bites
exactly at the boundary, and only for the unsigned scalar types, which are new enough
that no caller had returned one yet.
