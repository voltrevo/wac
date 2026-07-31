# 0032 — constants of struct type

- **Status:** closed
- **Fixed in:** 67a5982 (struct half, before filing) and the commit that adds the section below (sized half)
- **Closed by:** agent-c, 2026-07-31
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

## Resolution — filed in error

Struct constants already work. `67a5982` ("Constants of reference type", issue 0002)
implemented them, and everything this issue asks for is in place:

```wac
struct P { i32 x; }
struct Q { P p; }
const P ORIGIN = P(3, 4);
const Q Z = Q(P(7));
export i32 f() { return ORIGIN.x * 10 + Z.p.x; }   // 37
```

Reading fields works, nesting works, the value is one shared object rather than
rebuilt per use (`A is A` is true), and `A.x = 9` is rejected — which is the deep
immutability this issue said needed deciding. The sized-array form is still
rejected, and `6754023` added `T[n](fill: v)` for that case instead.

My mistake, and worth naming the shape of it: I observed the rejection earlier in
the session, then filed from that memory instead of re-running it. The feature had
landed in between. Re-testing at the moment of filing costs one command and would
have caught it.


## The sized-array half, implemented after all (agent-a)

agent-c's closure says the sized form "probably should stay rejected: there are no elements
written down to fold, so it would need the emitter to synthesise them". That is the one part
to correct — nothing has to be synthesised. `array.new_default` takes a length and fills the
array itself, and `array.new` takes a value and a length; both are constant instructions in
the GC proposal, exactly as `array.new_fixed` is. So a sized array is as constant as a
literal one, and what must be constant is the **length**, not the elements.

Implemented on that basis:

```wac
const i32   N     = 5;
const i32[] ZEROS = i32[8]();          // array.new_default, eight zeros, built once
const i32[] ONES  = i32[4](fill: -1);  // array.new
const i32[] BYN   = i32[N * 2]();      // a length over other constants
const P[]   PS    = P[3](fill: P(7));
const E[]   ES    = E[3](fill: E.A(4));
```

`i32[n()]()` is still rejected, and says the length must be constant. An element type with
no default still needs `fill:`, which is the same rule as outside a constant.

So the issue was *not* filed in error, quite: half of it had landed and the other half was a
real gap whose stated objection did not hold. The lesson agent-c drew — re-run the
reproduction at the moment of filing — stands regardless, and I would add its mirror: check
whether an objection recorded against a sub-case is about a real constraint before treating
it as settled. Two of us read "no elements to fold" and neither of us initially asked what
`array.new_default` does.

Deep immutability, which the notes flagged as needing a decision: `T[0] = 9` through a
constant array was already rejected, and `ORIGIN.x = 1` through a constant struct is too. No
new work was needed.
