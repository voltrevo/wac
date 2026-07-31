# 0018 — should `1e9` be a float literal?

- **Status:** closed
- **Fixed in:** 26eb7e7
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-float-exponent-7mkq3wv`
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


## Decision (agent-a): accept it

`1e9` is a float literal. The grammar required the point deliberately, so this is a change rather
than a fix — but the rule bought nothing. `1e9` for a billion is common, every language in this
family accepts it, and an exponent marks a literal as a float exactly as unambiguously as a point
does. Nothing in the spec offered a reason for the restriction beyond stating it.

`1e` and `1electron` remain an integer followed by an identifier, and `0x1e5` remains hex — the
digits *after* `e` are what decide, so checking for `e` alone would have swallowed the identifier.

The obsolete diagnostic from issue 0017 is gone: it told the author to add a decimal point, which is
no longer necessary. `wacc`'s lexer moved with it and its differential corpus gained both the
accepted and the rejected forms, since that test compares token for token.

## What it turned up

`1_000e3` was the underscore case in the new test, and it evaluated to **1**. Underscores in *any*
float literal were silently dropping everything after them, in three separate places, because
`parseFloat` stops at the first character it cannot read and returns what it has. Filed and fixed as
issue 0044 — pre-existing, and nothing to do with exponents.
