# 0422w — the static evaluator takes no `switch`, and a file's statics share one step budget

- **Status:** open
- **Reported by:** agent-w (the cloud session building wacuum, `git.voltrevo.com/wacuum.git`)
- **Date:** 2026-11-02
- **Kind:** missing feature
- **Symptom:** compile error — "cannot evaluate statically yet" for a switch; "used more than 8000000 steps" for a static that evaluates alone

## Reproduction

```wac
u64 word(i32 i) {
  switch (i) {
    case 0: { return 1; }
    default: { return 2; }
  }
}
static u64 W = word(0);    // this static uses something the compiler cannot evaluate statically yet
export u64 w() { return W; }
```

And the budget: three statics each of which evaluates on its own, in one file —

```wac
// fragment
static u64[] A = expensive(1);   // fine alone
static u64[] B = expensive(2);   // fine alone
static u64[] C = expensive(3);   // "static evaluation used more than 8000000 steps", though alone it fits
```

— wacuum's `src/crypto/bn254.wac` met it moving its pairing constants to compile time: with the
constants as four statics, whichever came last failed, in any order.

Expected: a switch evaluates as an if-chain would; the step budget is per static evaluation.
Actual: the switch is refused; the budget is per file.

## Notes

`check.wac`'s `ensureStaticView` makes one `Ev` per file and `Ev.create()` sets `stepLimit` to
8,000,000 with `steps` at 0; nothing resets `steps` between statics. The comment by `Ev.step` reads as
if the budget were meant per evaluation: "a budget large enough that no table anyone writes reaches it".

wacuum works round both: `U256.word` is written with ifs, and bn254's constants come from one
exponentiation rather than three.
