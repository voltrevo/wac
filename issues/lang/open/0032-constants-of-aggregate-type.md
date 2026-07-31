# 0032 — constants of struct type

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error

Module-level constants cover scalars, strings and arrays. A struct constant is
rejected, so a fixed record has to be rebuilt at each use or passed around.

## Reproduction

```wac
struct P { i32 x; i32 y; }

const P ORIGIN = P(0, 0);          // error: constant 'ORIGIN' needs a compile-time value
const i32[] T = i32[8]();          // error: a sized array is built at run time
```

Expected: at least the first to work. `P(0, 0)` is as much a compile-time value as
`i32[](0, 0)` is, and array constants already become an immutable global built by a
constant expression at instantiation.

Actual: both rejected by `notCompileTimeConstant`, which permits literals, the
operators over them, casts, other constants, and the *literal* array form only.

## Notes

The array case is already implemented and is the shape to copy: `wasmBuildBin`
emits one immutable global per constant array whose initialiser is an
`array.new_fixed` constant expression, and `wacConstEval` folds the elements.
WasmGC's constant expressions also admit `struct.new`, so a struct constant should
work the same way — the fields go through the same evaluator, and a nested struct
constant is `struct.new` over already-folded operands.

Two things that need deciding rather than just implementing:

- **Deep immutability.** A constant array is rejected as an assignment target
  because one object is shared by every use. A struct constant needs the same, and
  the check would have to reach through field access — `ORIGIN.x = 1` and
  `ORIGIN.inner.x = 1`.
- **The sized array form** `i32[8]()` is a separate question and probably should
  stay rejected: there are no elements written down to fold, so it would need the
  emitter to synthesise them, which is a different feature from folding what the
  programmer wrote.

Not blocking anything today. Recorded because the asymmetry — arrays yes, structs
no — is the kind of thing that reads as an oversight rather than a decision, and
because `json`'s `JsonValue` tags and `wacc`'s node kinds are both places a struct
constant would be the natural thing to write.
