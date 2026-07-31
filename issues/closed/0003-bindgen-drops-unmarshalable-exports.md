# 0003 — bindgen silently drops exports it cannot marshal

- **Status:** closed
- **Fixed in:** a48c240
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** diagnostic
- **Symptom:** wrong answer, no error
- **Covered by:** `§wac-bind-skip-h9pd5wn`

## Reproduction

Any module whose exports all take or return structs:

```wac
export struct Expr { i32 line; }
export Expr mk(i32 line) { return Expr(line); }
export i32 lineOf(Expr e) { return e.line; }
```

Expected: some indication that `mk` and `lineOf` cannot cross the boundary.
Actual: the generated module exports nothing at all. `Object.keys(mod)` is `[]`, with no
warning at compile time and no error at bind time.

## Notes

Partly wrong as filed: bindgen *did* record the reason, as a `// skipped: ...` comment in
the generated file. What was missing is that a comment in a generated file is not where
anyone looks while wondering why `mod.mk` is undefined, and a module whose entire surface
is skipped produces a file with no exports at all — which reads like a failed build rather
than a deliberate omission.

Fixed by exporting the reasons as `__bindgenSkipped`, so they are reachable from the
module the caller already has.

Dropping them is the right behaviour — a struct is not a value JavaScript can hold, and
inventing a representation would be worse. The problem is purely that it is silent: the
first sign is `TypeError: mod.mk is not a function` at the call site, which reads like a
typo rather than a design constraint.

A note in the generated file listing what was omitted and why would be enough. It costs
nothing and puts the explanation where the person looking for the missing export is.

Hit while porting wacc's AST: every export was struct-typed, the module bound cleanly,
and it took a `console.log(Object.keys(mod))` to see that nothing was there.
