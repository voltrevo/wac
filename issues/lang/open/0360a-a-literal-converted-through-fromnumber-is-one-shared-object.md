# 0360a — a literal converted through `fromNumber` is one shared object

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { NumberLiteral, fromNumber, Result } from "core";
struct Box {
  i32 v;
  Result<Box, string> [fromNumber](NumberLiteral n) { return Result.Ok(Box(7)); }
}
export i32 twice() {
  i32 total = 0;
  for (i32 i = 0; i < 2; i++) {
    Box b = 3;                 // a literal, written once and evaluated twice
    total = total + b.v;
    b.v = 100;
  }
  return total;                // 7 + 7 = 14 expected
}
```

Expected: `14` — each evaluation of `Box b = 3;` is a value of its own.
Actual: `107` (`wac run`, 2026-10-03) — the second iteration sees the first one's write.

## Notes

`lowerFromNumberLiterals` turns each converted literal into a static, `static Box @"$lit_L_C" =
literalValue(Box.[fromNumber](…))`, computed once at compile time (spec ch09 says *"The compiler
calls it statically, once per literal"*). For a number or an immutable value that is exactly right. For a
struct the program can write to, every evaluation of the literal binds the same object.

The `const`-as-type change (spec ch17) made this visible: a static is `const`, so `Box b = 3;` was
refused as a `const Box` becoming a `Box`. The checker exempts the `$lit_` statics for now
(`constExpr` in `packages/wacc/src/check.wac`) so ch09's examples keep working, which keeps the sharing.

Two ways out, and the choice is the spec's: a converted literal is `const` (so `Box b = 3;` needs
`const Box b = 3;`), or the static holds the *converted value's ingredients* and each evaluation builds a
fresh object. The second needs a copy the language does not have for an arbitrary struct.
