# 0018 — should `1e9` be a float literal?

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
f64 billion = 1e9;      // error: a float literal needs a decimal point
f64 ok      = 1.0e9;    // fine
```

## Notes

A decision, not a defect. `FLOAT_LITERAL` in grammar.md requires the decimal point, and
issue 0017 made the refusal say so clearly instead of lexing `1e9` as two tokens. The
open question is whether the grammar should change.

For accepting it: `1e9` for a billion is common and reads better than `1.0e9`; C, Rust,
Go, TypeScript and every other language in the family accept it; the exponent marks the
literal as a float as unambiguously as the point does.

For leaving it: the current rule is already documented and now reports itself properly,
so the cost is one character in an uncommon position. Changing it touches the lexer, the
grammar, and `wacc`'s lexer port, which has to keep agreeing token for token.

Not urgent either way. Filed so the decision is recorded as a decision rather than
rediscovered as a bug — I nearly "fixed" it by widening the grammar before checking that
the grammar said otherwise on purpose.
