# 0062 — a module with more than 63 types emits an invalid heap type

- **Status:** closed — fixed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** bug
- **Symptom:** invalid wasm

Once a module has enough types, the `__bind_e_*` helper emitted for an enum at the boundary
references a heap type as a **single-byte signed LEB128**. A type index of 64 or more does not fit
in one byte, so it decodes as a negative number and the module is rejected:

```
WebAssembly.Module(): Compiling function #261:"__bind_e_Option__packages_std_src_option_S0_..."
failed: Unknown heap type -64
```

## Reproduction

```wac
import { Vec } from "../../std/src/vec.wac";

export struct S0 { i32 a; }
// … S1 through S60, identical …

export struct Holder { Vec<S0> xs; }
export Holder make() { return Holder(Vec.create()); }
```

Expected: a module that instantiates.
Actual: `Unknown heap type -64`.

**The boundary is exact and the arithmetic gives the cause away.** With this shape:

| structs | result |
|---|---|
| 60 | fine |
| 61 | `Unknown heap type -64` |
| 62 | `Unknown heap type -63` |
| 63 | `Unknown heap type -62` |
| 70 | `Unknown heap type -55` |

Each added struct moves the reported heap type up by exactly one. A signed-LEB byte of `0x40` is
−64, `0x41` is −63, and so on — so the encoder is writing type index 64, 65, 66 … as one byte
where the format needs two (64 is `0xC0 0x00`). The struct count at which it starts depends on how
many other types the module has; the invariant is the index crossing 64.

`Vec` is not special — it is the shortest way to get an `Option<T>` instantiated, and `Option` is
an enum, which is what makes a `__bind_e_*` helper get emitted. Any enum crossing the boundary in
a module of that size should do it.

A module with the same 70 structs and **no enum helper** is valid, so ordinary code is unaffected
until something needs one.

## Where it bites

`packages/sh/src/parse.wac` in wac-mono cannot be bound at all: a shell AST is a dozen small
structs and nine `Vec` instantiations, which is enough on its own. The package works — `exec.wac`
imports it and binds fine, because the boundary is drawn elsewhere and the helper is not emitted —
but the parser cannot be unit-tested through bindgen, which is why that package's coverage driver
goes in through the executor.

Sixty-odd types is not a large module, and every package that grows past it loses the ability to
bind an entry that exposes an enum. This is likely to be hit again.

**Hit again, 2026-08-03 (agent-a).** `packages/sh/src/sh.wac` in wac-mono grew an exported
`shellMain(Core, Cli, Shell, i32)`, so that `packages/box` could start the same shell with its
applets wired into `Shell.external`. `Shell` reaches `Map<string, string>` and therefore
`Option<string>`, the helper got emitted, and the index landed at 94 — `Unknown heap type -34`, in
`__bind_e_Option__packages_std_src_option_string`. Every one of the 539 differential scripts failed
at once with exit 70, which reads as the shell being broken rather than as a module that never
instantiated.

Confirmed count-only again from the other direction: a struct holding an `Option<string>`, exported,
with N filler structs beside it — 37 fine, 38 `Unknown heap type -64`. Same +1-per-struct march.

Worked around by moving the function to `packages/sh/src/entry.wac`, which `sh.wac` imports without
re-exporting: bindgen binds a *built module's* exports, so the helper is no longer emitted for the
program that is built. That is a good workaround and a bad rule to have to know — it means "which
file an exported function lives in" changes whether a module is valid.

## Notes

I could not reproduce it with any *shape* — self-recursive generics, mutually recursive structs
through `Vec`, cross-module type parameters, generics in parameter or return position — all fine.
That is worth recording because it sent me looking for a type-graph bug for some time. It is
purely a count.

## Closed, 2026-08-03 (agent-a)

Two sites wrote a `ref.cast` immediate with `uleb`:

- `wasmBuildBin.ts`, the `__bind_e_*_get_*` helper — the one this issue found;
- `wacEmitFunc.ts`'s `unboxPrim`, which is `x!` on a nullable primitive.

`ref.cast` takes a **heap type**, which is a signed LEB (s33). `struct.new` and `struct.get` on the
adjacent lines take an unsigned *type index*, and the two encodings agree for every value below 64 —
which is exactly why this sat here until a module got big enough, and why the diagnosis you arrived
at from the arithmetic was right on the first try.

Both are `sleb` now. Regression test in `wacCompile.test.ts`: seventy filler structs plus an exported
enum with a payload, instantiated, and the unboxing path beside it. Reverting either site makes it
fail at 63 filler structs and pass at 62, which is the boundary this issue predicted.

The count-only diagnosis was also right in a way worth recording: no *shape* reproduces it. I looked
for one too, before reading your note.
