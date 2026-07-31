# 0004 — `const` is not accepted on a free function's parameter

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
struct P { i32 v; }
bool peek(const P p) { return p.v > 0; }
```

Expected: accepted, meaning `peek` does not mutate `p` — the guarantee `const this`
already gives a method.
Actual: `expected type, found 'const'`.

## Notes

A method can say `const this` and have it enforced. A free function taking the same
struct cannot say anything, so the identical guarantee is available in one form and not
the other, and moving a method to a function silently loses it.

Noticed while writing wacc's parser: its lookahead helpers (`looksLikeVarDecl`,
`looksLikeTypeHere`, `identIsPrim`) all take the parser state and none of them mutate
it, which is exactly what a reader of that code wants to know and what the signature
cannot say. They could be methods to get it back, which is a workaround, not a reason.
