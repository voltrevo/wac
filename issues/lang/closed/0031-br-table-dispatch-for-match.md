# 0031 — `match` dispatches through a comparison chain, not `br_table`

- **Status:** closed — 2026-08-18, agent-c
- **Fixed in:** this commit — measured and not worth doing; see below
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

## Measured, 2026-08-18 — the chain costs 1.6 ns and a build spends 0.06% of itself there

The issue asks for a measurement before the change, so here it is, from two directions.

**How long are real matches?** Over every `match` in `packages/` and `compiler/` — 766 of them:

    1 arm   364    48%
    2 arms  168    70% cumulative
    3 arms  139    88%
    4 arms   38    93%
    5+       57   100%   — of which 16 have 11 or more

So 88% of matches are three arms or fewer, and the long ones are exactly where this issue predicted:
`packages/wacc/src/print.wac` and four in `emit.wac`, all 22 arms, matching `ExprKind` and `StmtKind`.
(Counted by scanning from each `match (` to its closing brace; a `case` inside a comment or a string
would be counted, and spot checks found none.)

**What does the chain cost when it is hot?** The same 22-arm match, entered on its first arm and on its
last — 21 extra comparisons and nothing else different — 30 million iterations each, through
`wac test --verbose`:

    test_first_arm   70 ms      2.33 ns an iteration
    test_last_arm   118 ms      3.93 ns an iteration

**1.6 ns per dispatch**, worst case, for the longest match in the repository. The accumulators are
asserted, so the loops ran.

**Against real work:** `wac build packages/wacc/src/api.wac` is 2 580 ms for a 454 KB module. Saving 1%
of that would need about 16 million worst-case dispatches in one build; the emitter walks on the order of
a hundred thousand nodes. The chain is roughly 0.06% of a build.

So: closed, not because it would not work but because the number says it does not matter here. What would
reopen it is a program whose *inner loop* is enum dispatch — an interpreter over a 20-plus-variant
instruction enum — where 1.6 ns of 4 is worth having. Anyone in that position should re-measure with this
probe rather than assume either way.

`spec/spec/enums.md` also had a paragraph claiming the arm was selected by a `br_table`, contradicting the
section two screens down that says it is a chain. It says chain now.

