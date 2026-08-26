# 0269a — a switch case value need not be constant, and the spec's own reason says it must

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-26
- **Kind:** decision — is a non-constant case value legal
- **Symptom:** accepted silently, and the spec gives a rationale that forbids it

## Measured

Both compilers accept a **parameter** as a case value, and it works:

```wac
i32 pick(i32 n, i32 k) { switch (n) { case k: { return 111; } default: { return 222; } } }
```

    wacc:      no diagnostics
    reference: OK
    running it: pick(5, 5) -> 111,  pick(5, 6) -> 222

A named `const` works too. So a `switch` here is an if-else chain with different syntax, and that is
not an accident of one implementation — `compiler/wacEmitFunc.ts`'s `emitSwitch` says so in as many
words: *"Use if-else chain for correctness. br_table optimization can come later."* It emits the
scrutinee and the case expression and compares them at run time.

## Why that is a problem rather than a feature

`spec/spec/control.md`'s switch section states the type rule **and its reason**:

> The switch expression and case values must be a 32-bit integer, `i32` or `u32` — `br_table`
> dispatches on 32 bits, and signedness plays no part in an equality match.

**`br_table` cannot dispatch on a value that is not known at compile time.** So the spec justifies its
restriction by an instruction that would forbid `case k:` outright, while both implementations accept
it because neither uses that instruction yet. The rationale and the behaviour are describing different
languages, and the day `emitSwitch`'s "can come later" arrives, every `case k:` in existence stops
compiling — with a message about `br_table` that will make no sense to whoever wrote it.

Nothing in this repository writes one today (measured under `0266c`: 30 `switch` sites across 1,431
`.wac` files, 125 across `spec/`, `compiler/` and the wacc tests). So this is cheap to settle *now* and
expensive to settle after somebody depends on it.

## The options

1. **Require a constant, and say so.** Matches the spec's stated reason, keeps `br_table` available,
   and makes `switch` mean what its grammar suggests. Costs: a rule in both checkers, and `case k:`
   becomes an error — which nothing here writes, but which is a real narrowing of an accepted language.
2. **Allow a non-constant, and fix the rationale.** Cheapest in code — nothing changes — and it makes
   the current behaviour a decision. The spec sentence has to stop saying `br_table`, because the
   reason would then be false: the restriction to 32 bits would need a different justification, or
   would have to go. It also forecloses the `br_table` optimisation, or forces a fallback path for the
   non-constant case, which is two emitters for one construct.
3. **Leave it**, which is where it is: an undocumented capability resting on an unimplemented
   optimisation.

## Recommendation

**Option 1**, and the deciding argument is the spec sentence rather than the feature. A rationale that
forbids what the implementation allows is the kind of thing that reads as settled until somebody acts
on it, and the person who acts on it will be whoever finally writes `br_table` — at which point the
break is theirs to explain and the decision will have been made by an optimisation.

Option 2 is defensible if runtime case values are actually wanted, but nothing here wants them, and
"an if-else chain with different syntax" is a thing wac already has.

## What it blocks

`issues/lang/0266c` — refusing a repeated case value. That rule can only compare values it can
evaluate, so while `case k:` is legal the rule is necessarily partial: two constant cases that are
equal are refused, and `case k: … case k:` is not. Under option 1 the rule becomes total. The partial
version is still worth having and is what 0266c implements; this issue is why its header says
*constant*.
