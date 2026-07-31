# 0004 — `const` is not accepted on a free function's parameter

- **Status:** closed
- **Fixed in:** a48c240
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error
- **Covered by:** `§wac-const-param-2vhk7dq`

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


## Resolution

`Param` gained an `isConst` flag, `parseParam` consumes an optional leading `const`, and
the checker binds the parameter with it. Nothing else changed: const is already deep, and
the environment already carries `isConst` per binding, so field writes, element writes and
reassignment were all refused correctly the moment the flag was threaded through.

Composes with `const this`, and is per-parameter rather than per-signature — a const
parameter beside a mutable one leaves the mutable one alone, which has its own test
because that is the plausible way to get it wrong.

Note for the wacc port: the reference `Param` type changed shape, so `packages/wacc`'s
AST, parser and canonical printer needed the same field. The differential test would not
have caught the omission until a corpus file used a const parameter.
