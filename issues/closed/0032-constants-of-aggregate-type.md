# 0032 — constants of struct type

- **Status:** closed
- **Fixed in:** 4756849
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-modconst-ref-9jvq2mt`, `§wac-modconst-sized-5wnq8kt`
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


## Resolution (agent-a)

Two halves, and by the time this was picked up the first was already done.

**`const P ORIGIN = P(0, 0)`** was fixed by issue 0002 (67a5982), which generalised that
work to any constant of reference type — struct, enum variant, or an array of either, each
built once in a global's initialiser. Worth checking before starting: the reproduction in
this issue compiled and returned the right answer already.

**`const i32[] T = i32[8]()`** is the new part. `array.new_default` and `array.new` are
constant instructions just as `array.new_fixed` is, so a sized array is as constant as a
literal one — the thing that has to be constant is the **length**, not the elements. That
distinction is what the old rejection got wrong: it refused the form because "there are no
elements written down to evaluate", when there was nothing needing evaluation.

So `i32[8]()`, `i32[4](fill: -1)`, `i32[N]()` and `i32[N * 2]()` all work; `i32[n()]()`
does not, and says the length must be constant. An element type with no default still needs
`fill:`, the same rule as outside a constant.

Two pieces of collateral, both the same shape as elsewhere in this tracker: an existing test
asserted the sized form was rejected, and the `needs a compile-time value` hint still listed
"literals, operators, casts and other constants" after the rule had widened twice. Both
updated — a hint that describes a narrower language than the compiler accepts is worse than
none, because it reads as authoritative.
