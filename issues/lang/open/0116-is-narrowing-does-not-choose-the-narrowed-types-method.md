# 0116 — `is` narrowing does not choose the narrowed type's method, so an override is not called

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
struct Shape { i32 tag; i32 getTag(const this) { return this.tag; } }
struct Circle : Shape { i32 radius; override i32 getTag(const this) { return 42; } }

i32 narrowed(Shape s) { if (s is Circle) { return s.getTag(); } return s.getTag(); }
i32 viaCast(Shape s)  { if (s is Circle) { return (s as! Circle).getTag(); } return s.getTag(); }

export i32 byNarrowing() { return narrowed(Circle(0, 5)); }   // 0   — wants 42
export i32 byCast()      { return viaCast(Circle(0, 5)); }    // 42  — correct
export i32 plain()       { return narrowed(Shape(99)); }      // 99  — correct
```

`byNarrowing` answers **0**, which is `Shape.getTag` reading a `Circle`'s `tag` field. The explicit
cast dispatches correctly, so what is missing is narrowing: inside `if (s is Circle)` the checker
treats `s` as a `Circle` — `spec/spec` says so, and `§wac-override-dispatch-r2km6jf` was rewritten to
drop the cast *because* the narrowing makes it redundant — and the emitter still resolves
`s.getTag()` against the declared type.

## Why it is visible now

The program did not emit at all until 2026-08-13. `emitConversion` wrote a `ref.cast` only when the
source was `anyref`, so a struct-to-struct downcast emitted nothing and the module failed to
validate; those programs were declined. With that fixed, seven more of the spec's programs emit and
this is the one whose *answer* is wrong.

`packages/wacc/test/specEmit.test.ts` names it as its one known difference. The entry should go when
this closes, and it is the only one — the rung's contract is still that every other answer agrees.

## Also visible now, and probably related

The same test prints three programs that emit but do not instantiate, which it did not print before
because it only reports when a *count* is non-zero:

    §wac-cshift-local-e85g9us     compoundShiftLocal
    §wac-cshift-field-abx403z     compoundShiftField
    §wac-ternary-subtype-h4jm9wq  pickParent
    §wac-ternary-lca-q7fk3wn      pickSiblings
    §wac-raw-truncf-nan-w9fk2xq   truncFloatNaN
    §wac-cmpfloat-68s8unj         cmpFloat
    §wac-cmpfloat-lit-*           (the same shape)

**`cmpFloat` is `1.0 == 1.0`**, and it is worth its own paragraph because the obvious fix is wrong.
`operandType` asks each side what type it is; a literal answers "none of my own, I take the slot's",
so two literals leave it empty and the caller reads empty as `i32` — `i32.eq` against two `f64`
constants. Answering `"f64"` when either side is a float literal repairs that case **and breaks
twelve corpus files**: `bisect32` in `packages/fmt` returns an `f32` and computes with literals, so
forcing `f64` on it broke every caller. Measured, not guessed — `0 invalid` before, `12 invalid`
after, and the same twelve back to zero when it was taken out.

It is not the literals' family that decides, it is the slot's. The fix has to reach the `want` the
emitter already holds at the operator, and `operandType` is not given it.

Two of them are ternaries whose arms have different types — a parent and a child, and two siblings —
which is the same subtyping corner as this issue: the block type a ternary declares has to be a type
both arms fit, and picking one arm's type is what fails to validate. The compound shifts and the
float truncation are their own things.

They were invisible rather than new: an instantiation failure went into the same list as the answer
differences, and that list is *counted* by `compared - agreed`, which an instantiation failure never
reaches. So the count stayed zero, the message never printed, and five programs had been failing to
load for as long as anyone had been reading a green line. They are printed now, and still not
asserted — turning them fatal is a decision about the rung's floor rather than a fix.

## Where to start

`emitMethodCall`'s receiver type comes from `typeOfE`, which answers the *declared* type. The checker
narrows by shadowing the binding; the emitter has no equivalent, so the narrowed block would need the
same shadow — or the emitter would need to consult the narrowing the checker already computed.
