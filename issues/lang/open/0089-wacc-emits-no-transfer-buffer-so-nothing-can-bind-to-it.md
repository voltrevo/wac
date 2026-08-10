# 0089 — wacc emits no transfer buffer, so nothing that passes bytes can bind to it

- **Status:** open — the buffer is emitted; the array helpers are not
- **Claimed by:** agent-b, 2026-08-10
- **Reported by:** agent-b
- **Date:** 2026-08-10
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

Run any package's tests against a module `wacc` compiled, which
`harness/wacBind.ts` will now do on request:

```sh
WAC_WASM_FROM=wacc deno test -A packages/fmt/test/
```

Expected: the tests pass, as they do against the reference-built module.

Actual:

```
TypeError: $exports.$bind$mem_ensure is not a function
    at _memEnsure (.cache/bind/….gen.ts:12:26)
```

## Notes

`wacBindgen` generates JS that reaches wasm memory through two exports the module
is expected to provide:

- `$bind$mem` — the `WebAssembly.Memory` the staging buffer lives in;
- `$bind$mem_ensure(bytes) -> i32` — grow that buffer to hold `bytes` and answer its
  new size, after which the caller re-reads `memory.buffer` because growing detaches
  the old one.

The reference builds both in `wasmBuildBin.ts` (`makeMemEnsure`, and the export named
at line 2265). `packages/wacc/src/emit.wac` contains no `$bind$mem` at all, so every
exported signature that carries a `u8[]` or a `string` across the boundary has glue
waiting for a function that is not there.

**This is what stands between wacc and being usable by this repository**, and it is
one bounded feature rather than a long tail: a linear memory, a growth helper, and the
two exports. It is independent of the type checker, which is where the recent work has
been.

**Six of the 33 packages already pass their own suites on wacc-emitted code** — `bytes`,
`ethrpc`, `rlp`, `std`, `tty`, and `tor` with 305 tests — because their exports do not
need the buffer. So the emitter is right about a great deal more than this issue makes
it sound.

Of the 27 that fail, **22 are this one feature**: 21 want `$bind$mem_ensure` and one
wants `$bind$str_len`. The rest are separate: `sh` hits `untyped member`, which is an
emitter gap `corpusEmit` already counts, and a few fail on answers rather than binding.

## Done so far — 2026-08-10, agent-b

`$bind$mem` and `$bind$mem_ensure` are emitted. wacc now writes a memory section (one
page, grown on demand) and one synthetic helper, and every package that used to stop at
`$bind$mem_ensure` now stops at the *next* helper instead.

Two things that were not obvious from outside:

- The signature has to be registered in the pre-pass beside the string helpers'. Asking
  for it while emitting grows the type table after the type section was sized, and the
  emitter declines the module rather than emit a lie — an eight-byte module is what that
  looks like.
- The start function is emitted last and numbered by hand, so inserting a helper in front
  of it without moving its index gives *"invalid start func reference"*.

**What is left is the per-element-type array family**: `$bind$arr_u8_len`,
`$bind$arr_u8_to_mem`, `$bind$arr_u8_from_mem`, and the same three for every other element
type an exported signature carries. Those are `array.copy` loops between a WasmGC array and
linear memory; `makeToMem` and `makeFromMem` in `compiler/wasmBuildBin.ts` are the
reference's, and they are parameterised by element width and the load/store opcode.

Re-measure with `deno run -A packages/wacc/tools/runOnWacc.ts`.
