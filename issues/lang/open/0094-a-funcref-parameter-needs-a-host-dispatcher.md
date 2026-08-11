# 0094 — a funcref parameter needs a host dispatcher, and there is no import section

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
