# 0087 — `break` after an infinite loop crashes the compiler

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
export i32 f() { while (true) { } break; return 1; }
```

Expected: `'break' outside loop or switch`, which is what the same program gets when the loop is
`while (false)`.

Actual: an uncaught `TypeError: Cannot read properties of undefined (reading 'breakTarget')` from
`compiler/wacEmitFunc.ts` — the compiler throws rather than returning diagnostics, so the caller
gets an exception instead of an answer.

`continue` does the same thing one property along (`continueTarget`), and `for (i32 i = 0; ; i++)`
stands in for `while (true)`.

## Notes

The difference from the working case is the **loop's condition being constant true**: after
`while (false)` the checker reports the `break` and the emitter is never reached. So the type
checker is treating the statements after an infinite loop as though they were still inside it — the
loop context it needs is gone by the time the emitter looks, and nothing checked that it was there.

A crash is worse than a wrong diagnostic here because it escapes the diagnostic channel entirely: a
tool that compiles a file per request gets an exception, and `wacCompile` is called from
`packages/wacc`'s test harness, from `bindgen` and from the site.

Found by mutating the repository's own code — inserting a `break` before a `return` — and
`packages/crypto/src/keccak.wac` is the file it landed in, because its squeeze loop is
`while (true)` with an unreachable `return` after it. Real code is where this shape lives; no
generated program in `packages/wacc`'s sweeps had ever written one.
