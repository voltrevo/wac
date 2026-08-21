# 0179a — `emitFiles` answers a bare wasm header at 1024 import edges in one file

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** no error — an 8-byte module, and the checker calls the program clean

## Measured

`n` one-function files plus an entry importing every one of them, through `diagnoseFiles` and
`emitFiles` on the same input — `packages/wacc/test/wac/importcurve_probe.wac`:

| imports in the entry | check | emit | module |
| ---: | ---: | ---: | ---: |
| 1 000 | 66ms | 49ms | 61 423 bytes |
| 1 020 | 71ms | 49ms | 62 663 bytes |
| **1 024** | 67ms | 4ms | **8 bytes** |
| 1 100 | 77ms | 5ms | 8 bytes |
| 1 200 | 89ms | 5ms | 8 bytes |

Eight bytes is `\\0asm` and a version — a module with nothing in it. `diagnoseFiles` answers **clean**
at every one of those sizes, and `blockedFiles` says nothing either.

**It is the import edges in one file, not the file count.** The same 1 024 files with only ten imports
in the entry emit **3 665 bytes** and run. So the bound is on one file's import list, and 1 024 is
exactly where it falls — `Env` is constructed with about a dozen `string[1024]` tables
(`packages/wacc/src/emit.wac`, in `Env(...)`), one of which is that list.

## Who can reach it

Not `wac build` or `wac check`: `gather` in `example/wacc.wac` refuses past **512** files now
(`issues/lang/0158`), so the CLI stops before the emitter's limit. What is exposed is a caller that
supplies its own path map and calls `emitFiles` directly — the playground, the harness, an embedder,
which is the same set `issues/lang/0157` is about, and the set that gets no diagnostic today.

No real program is near it. The largest import list in this repository is `packages/box/src/box.wac` at
65, and the only thing that generates more is a test written to push the linker's tables.

## What to do

The principle is the operator's, quoted in `issues/lang/0170a`: *"In every case where it hits a case
that isn't implemented, it must fail, not be silent."* So:

1. **Find which table it is.** The `Env(...)` constructor has a dozen `string[1024]`s on four lines and
   the field names are in the struct rather than at the call, so this is a matter of reading the
   declaration order rather than guessing. Then check whether the overflow is a *guarded write* — the
   shape `issues/lang/0130` found in the linker, where `if (table.len() > n)` silently skips — or a
   `return`.
2. **Say so.** A decline with a reason, which `blockedFiles` already has a channel for, naming the limit
   and the file whose import list is too long. The sentence `gather` now uses is a fair model.
3. **Then decide whether to raise it**, which is a separate question and probably "no": 1 024 imports in
   one file is not a program anybody writes, and a limit that reports itself costs nothing to leave.

Worth doing at the same time: `Env`'s other fixed tables have the same shape and no reason to be
different. Counting how many of them are written under a guard rather than a check would say whether
this is one bug or a family — the linker's version of it was a family.

## How it was found

Re-measuring `issues/lang/0158`, whose superlinearity had been fixed by someone else's change and whose
wall was gone; the probe kept going past the sizes that issue used and fell off this instead.
