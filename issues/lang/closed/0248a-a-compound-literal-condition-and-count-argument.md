# 0248a — `if (1)` is refused and `if (1 + 1)` is not

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — the last two reachable guards in the sweep
- **Fixed in:** `packages/wacc/src/check.wac` (`notBool`, `checkCountArg`), with rows in
  `packages/wacc/test/wac/compoundlit_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — a condition that is not a bool, and a count argument that is not an
  integer, are accepted when written as a compound literal

## Reproduction

```wac
export i32 f() { if (1 + 1) { return 1; } return 0; }
export i32 f(bool b) { return "ab".slice(1, b ? "x" : "y").len(); }
```

Expected: refused. The reference says *"condition must be bool"* and *"'slice()' arguments must be
i32, got string"*, and it refuses the direct forms `if (1)` and `slice(1, "x")` identically.

Actual: both accepted, while both direct forms are refused.

## Why

`notBool` asks `litKindOf`, so `1 + 1` is not a literal to it and it falls through to `typeOfExpr` —
which answers `typeNone()` for an integer literal sum, correctly, because an integer literal is
polymorphic and has no type until a slot gives it one. A condition is not a slot that gives one, so
nothing could speak. `checkCountArg` has the same shape for `slice`'s two arguments, and its docstring
even says what it intends: *"A literal is asked whether the family fits, exactly as an index is;
anything else is asked what it is"* — a compound literal was neither.

Both take a `C` already, so both become `litFamily(c, e)`.

## The sweep this closes

`issues/lang/0244a` started from eleven guards that call `reportLiteral`. Carried across every
`litKindOf` call site in `check.wac` and asked of each *"is there a program where the direct form is
refused and the compound form is not"*, it came to:

| | |
|---|---|
| 11 `reportLiteral` guards | widened — `0244a` |
| array size, index read, index write | widened — `0244a` |
| `isPlainLiteral` + 2 ternary family guards | widened — `0246a` |
| `notBool`, `checkCountArg` | widened — this issue |
| a `switch` case value, a `while` condition | **no change**: already refused by another rule |
| the `Binary` arm's `bothLit` and literal gate | **no change**: covered, measured |
| `litFamily`'s own first line, `litKindOf`'s recursion, `naturalTypeOf`'s tail | correct by construction |
| the `litNull` checks, generic inference, `armShape`, `castOperandType`, an assignment's right side | correct — measured or null-specific |

Two of those "no change" rows are in the test as coverage and labelled as such, because a row that
passes either way is worth having and worth not mistaking for a fix.

**One swap was reverted for want of a failing case** — the `switch` case value, in `0244a`. The canary
is what said so: three rows failed, not four.

## Notes

`notBool` gates every condition in the language — `if`, `while`, `do`, `&&`, `||`, a ternary's
condition — so the corpus was the thing to check rather than the reproduction. `corpuscheck` is green
over the repository, and rung 3 reports 0 false alarms and 0 contradicted.
