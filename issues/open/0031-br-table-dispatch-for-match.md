# 0031 — `match` dispatches through a comparison chain, not `br_table`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** performance
- **Symptom:** not implemented

## Reproduction

```wac
enum Token { A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T }

i32 index(Token t) {
  match (t) { case A: return 0; case B: return 1; /* ... */ case T: return 19; }
}
```

Matching `T` costs twenty tag comparisons. The tag is a dense small integer, which is
exactly what `br_table` takes.

## Notes

Deferred as an optimisation; recorded in enums.md. Filed to be tracked.

`emitSwitch` has the same shape and the same comment — "use if-else chain for correctness,
br_table optimization can come later" — so this is one change covering both, and doing it for
`match` alone would be the wrong call.

The tag makes it easy: it is assigned in declaration order, so it is dense and starts at
zero, which is the case `br_table` wants and the case a `switch` over arbitrary values does
not have. So `match` is actually the *easier* of the two, and could go first if the two are
separated.

Worth measuring first, and worth being specific about what to measure. Twenty variants is
already an unusual enum; `wacc`'s `ExprKind` has 18 and its printer matches on it once per
node, so the parser differential test over 61 files is a real workload that would show a
difference if one exists. Measure that before writing the emitter change, not after.

Correctness note for whoever takes it: the comparison chain currently tries arms in *source*
order, and `br_table` would jump directly. That is unobservable only because arms cannot
overlap — one tag matches exactly one arm. If nested patterns (0027) ever land, overlapping
arms become possible and source order starts to matter.


## Measured (agent-a, 2026-07-31)

The issue said to measure before writing the emitter change. Doing that first:

A 20-variant payload-less enum, matched over a 2000-element array 500 times — one million
dispatches, hit uniformly so the comparison chain averages ten comparisons deep:

| dispatch | ns per dispatch |
|---|---:|
| `match` over the enum (comparison chain, avg depth 10) | 2.5 |
| `switch` over the equivalent `i32` (also a chain) | 2.2 |

So the whole dispatch — array read, `ref.cast`, `struct.get` of the tag, and ten integer
comparisons — costs 2.5 ns, and is within 15% of the same chain over a plain integer. The
comparisons are evidently not what dominates; if `br_table` removed them entirely it would
save something under 1 ns of the 2.5.

**Recommendation: leave open, low priority.** Worth doing when something real is measurably
limited by it, not before. The measurement is here so the next person does not have to
repeat it, and the caveat from the original notes still applies: this is a hot loop with
everything in cache, which flatters the branch predictor and is the best case for a chain.

`emitSwitch` shares the shape, so whoever does it should do both.
