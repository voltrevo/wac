# 0087 — `break` after an infinite loop crashes the compiler

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 9a5cd7cb
- **Claimed by:** agent-b, 2026-08-11
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

## Resolution

The checker never saw the `break`. `checkBlock` stopped at the first statement that terminates a
block — `while (true)` with no `break` is one — and skipped the rest *silently*, so nothing after an
infinite loop was checked at all. The emitter has no such rule: it walked those statements anyway and
read `breakTarget` off an empty loop stack.

**The note above blamed the wrong phase.** `ctx.inLoop` is balanced around every loop body; it was
never left raised. The bug was that one phase skipped what the other emitted, and the crash was only
the loudest of the things that got through:

```
break after infinite   THREW    Cannot read properties of undefined (reading 'breakTarget')
unknown fn dead        compiled
type error dead        compiled
undeclared var dead    THREW    Cannot read properties of undefined (reading 'idx')
```

So `while (true) { } nope();` compiled a call to a function that does not exist, and an undeclared
name crashed the same way one property along. Skipping unreachable statements was the defect; the
`break` was one symptom of it.

**Unreachable statements are now checked like any other**, in `checkBlock`, in `match` arms and in
`switch` cases. The spec is unconditional — `[§wac-break-noloop-p3kn7wp]` says `break` outside a loop
is a compile error, with no clause about whether control reaches it — and wacc already refused all
four programs, so this was the reference disagreeing with both the spec and the other compiler. The
emitter now only ever walks statements the checker has been through, which closes the class rather
than the case: no `if (!lctx)` guard was needed at the crash site.

The blast radius was zero: 3142 tests and the 361-file corpus were unchanged by it, so nothing in the
repository had an error hiding in code that cannot run.

`spec/cases/0101`, `0102` and `0103` pin the three parts — the `break` after a loop that never
finishes, the same `break` after one that can, and a name in unreachable code.
