# 0094 — a funcref parameter needs a host dispatcher, and there is no import section

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit adding the import section and `$bind$fnref_<j>`
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
export i32 g(fn[i32(i32)] cb) { return cb(1); }
```

The reference emits a module importing `wac.cb0`, a host function that dispatches a
callback back into JavaScript. wacc emits a module that imports nothing.

    reference imports = ["cb0"]
    wacc      imports = []

Downstream this is `$bind$fnref_0 is not a function` when a package binds — two of
the eleven still failing.

## Notes

`emit.wac` writes types, functions, memory, globals, exports, start, elements and
code. **There is no import section**, so a host function cannot be named at all.

This is the one remaining bind family that is not simply more helper bodies: wasm
puts imported functions *first* in the function index space, so adding an import
shifts every index the emitter computes — the exports, the start function, the calls
between user functions, and the helper block whose indices are already arithmetic.
Everything that reads `count + strings + 1 + 3 × arrays + structs` has to gain an
import count as well.

Worth doing in one piece rather than alongside another family.

**`spec/cases` cannot express this one**, which is worth saying because the rule here is
that a failing case comes first. A case calls an exported function with no arguments, so
it can show a funcref passed and called *within* wac — `0048` does, and wacc meets it —
but not a callback handed in from the host, which is the thing that needs the import.
The oracle for this gap is `tools/runOnWacc.ts` and the `$bind$fnref_0` line in its
tally.

## Fixed — 2026-08-11, agent-b

wacc emits an import section now: one `wac.cb<j>` per callback signature an exported function takes,
`callbackSlots()` = 16 trampolines of the callback's own type per signature, and
`$bind$fnref_<j>(slot)` answering the trampoline for a slot. The shape is the reference's because the
glue is generated against it — a host function reaches wac as a slot number, since JavaScript cannot
make a WasmGC funcref.

Driven end to end rather than checked for well-formedness:

    const ex = instantiate(wasm, { wac: { cb0: (slot, n) => slots[slot](n) } });
    ex.twice(ex.$bind$fnref_0(0), 3)   // 300, for slots[0] = n => n * 10

**The index shift was the whole difficulty, as predicted, and it was not where I said it would be.**
The note above worried about the helper block arithmetic; that was one line, because those positions
were already single-sourced. What was not single-sourced was the *export* index: `emitModule` keeps a
second counter for it, so shifting `funcIndex` shifted only half of them and every exported function
named a wasm function `cbSigCount` places earlier than itself. With one callback signature that is a
trampoline, so `apply(f)` called the dispatcher with the funcref where an `i32` belongs — the module
validated, and the failure arrived as `(0, 0)` reaching the host dispatcher.

`gzip`, `stream` and `zstd` pass their own suites on wacc-emitted code now; `fs` moved on to the one
remaining name, a static on a generic instance. `spec/cases/0048` needed its runner taught to supply
the imports a module declares, which is what `compiler/wacInstance.ts` already does for the
reference — and its `why` line corrected: the call needs no host involvement, but the module still
declares the dispatcher a host *could* hand one in through.

Not done here: `$bind$callref_<j>`, the other direction — a funcref *returned* to the host. Nothing
in the corpus needs one yet, and it is a helper body rather than a section.
