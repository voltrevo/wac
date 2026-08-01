# 0054 — a callback with an array in its signature calls a helper bindgen never emits

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-01
- **Kind:** bug
- **Symptom:** wrong answer

A `fn[…]` parameter whose signature mentions an array generates a dispatcher that calls
`_arrayToWasm_u8` / `_arrayFromWasm_u8`. Neither function is emitted, so the call throws
`ReferenceError` the first time the callback runs.

Nothing warns: `__bindgenSkipped` is empty, so the export looks supported right up to the point of
use.

## Reproduction

One line:

```wac
export i32 f(fn[u8[]()] read) { return read().len(); }
```

```ts
const m = await wacBind("repro.wac");
m.f(() => new Uint8Array([1, 2, 3]));
// ReferenceError: _arrayToWasm_u8 is not defined
```

Expected: `3`.

The generated file contains the call and not the definition:

```ts
const _cbd0 = (_slot: number) =>
  _arrayToWasm_u8((_cbs0[_slot]()));          // <- never defined anywhere in the file
```

The other direction is the same. A callback *taking* an array —
`export i32 g(fn[bool(u8[])] write)` — emits `_arrayFromWasm_u8(a0)` and no definition either.

## Notes

Both directions are needed together for a streaming transform, which is how this surfaced:

```wac
export i32 passthrough(fn[u8[]()] read, fn[bool(u8[])] write)
```

That shape is the reason `[§wac-bind-callback-7pqm4wk]` matters beyond the toy case — it is what
lets a wac loop consume input the host supplies over time, with the host doing the blocking. It is
written up in `wac-mono/issues/0006`, and the bridge that drives it is written and cannot run.

The exports' *own* array parameters work: the same module's non-callback exports convert arrays
fine, so the conversion helpers exist somewhere in the generator — they appear not to be pulled in
when the only use is inside a dispatcher.

Worth checking the same path for `string` and for structs in callback signatures; I only tried
`u8[]`.
