# 0117 — five spec programs emit and then fail to instantiate, and had been doing so invisibly

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** bug
- **Symptom:** wrong answer

`packages/wacc/test/specEmit.test.ts` compiles every single-file program in the spec's own suite with
both compilers and compares the answers. Five of them emit a module that the engine then refuses:

    §wac-cshift-local-e85g9us     compoundShiftLocal      still failing
    §wac-cshift-field-abx403z     compoundShiftField      still failing
    §wac-raw-truncf-nan-w9fk2xq   truncFloatNaN           still failing
    §wac-ternary-subtype-h4jm9wq  pickParent              fixed, 2026-08-13
    §wac-ternary-lca-q7fk3wn      pickSiblings            fixed, 2026-08-13
    §wac-cmpfloat-68s8unj         cmpFloat                fixed, 2026-08-13
    §wac-f64bits-zero-w2nk6dq     equalAsFloats           fixed, 2026-08-13

Three of the seven are fixed and the rung is at **369 of 369 answers agreeing**, four programs more
than when this was filed. What each of the two fixes was:

**The ternaries took the first arm's type.** `flag ? c : s` with a `Circle` and a `Shape` declared a
block returning a `Circle` and then handed it a `Shape` — `type error in fallthru[0]`. It takes the
type the arms *share* now: a parent and a child give the parent, two siblings give their common
ancestor. `spec/cases/0142`, which also shows the narrowing from
[0116](../closed/0116-is-narrowing-does-not-choose-the-narrowed-types-method.md) applying to the
result, since the two rules meet there.

**A comparison's slot is a `bool`, which knows nothing about its operands.** The emitter already fell
back to the slot's type when both operands were literals — right for arithmetic, and for `1.0 == 1.0`
it took `bool`, read that as an integer shape, and compared two `f64` constants with `i32.eq`. Only a
comparison takes the literals' own family now; arithmetic still takes the slot's, which is what keeps
`f32 x = 1.0 * 2.0` an `f32` multiply. `spec/cases/0143` holds both halves, because the earlier
attempt at this rule applied it to both and broke twelve corpus files.

## Why nobody had seen them

They went into the same list as the *answer* differences, and that list is counted by
`compared - agreed`. An instantiation failure never reaches a comparison, so it added nothing to the
count, the message never printed, and the line above it read `356/356 answers agree` — which was
true, and about the programs that loaded.

They are printed now, under `and N emit but do not instantiate`, and deliberately **not** asserted:
turning them fatal is a decision about that rung's floor rather than a fix, and it would make the
suite red for everyone until all five are done.

## What they look like

Two are ternaries whose arms have different but related types — a parent and a child, and two
siblings. A ternary declares a block type, and it has to be a type both arms fit; picking one arm's
is what fails to validate. That is the same corner as the struct downcast fixed in
[0116](../closed/0116-is-narrowing-does-not-choose-the-narrowed-types-method.md), one expression over.

### The float comparison, which is fixed — and how it was nearly fixed wrongly

One was `1.0 == 1.0`, and the obvious repair is wrong. `operandType` asks each side what type it is; a
literal answers "none of my own, I take the slot's", so two literals leave it empty and the caller
reads empty as `i32` — `i32.eq` against two `f64` constants. Answering `"f64"` when either side is a
float literal fixes that program and **breaks twelve corpus files**: `bisect32` in `packages/fmt`
returns an `f32` and computes with literals, so forcing `f64` broke every caller. Measured: 0 invalid
→ 12 → 0 when it was taken out again. The fix has to reach the `want` the emitter already holds at the
operator, and `operandType` is not given it.

The two compound shifts and the float truncation are unexamined.
