# 0062 — a module with more than 63 types emits an invalid heap type

- **Status:** open
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

## Notes

I could not reproduce it with any *shape* — self-recursive generics, mutually recursive structs
through `Vec`, cross-module type parameters, generics in parameter or return position — all fine.
That is worth recording because it sent me looking for a type-graph bug for some time. It is
purely a count.
