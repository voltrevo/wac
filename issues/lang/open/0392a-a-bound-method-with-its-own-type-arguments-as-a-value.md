# 0392a — `c.pick<i32>` as a value is refused; the parser drops the written type arguments

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
struct Cell<T> { T v; U pick<U>(const this, U a) { return a; } }
export i32 c() { Cell<i32> c = Cell(5); fn<i32(i32)> g = c.pick<i32>; return g(7); }
```

Expected: 7, as `§wacc-fnref-bound` and `§wacc-method-type-args` together suggest.
Actual: refused (case 0715). It used to emit invalid wasm.

## Notes

Needs the AST to keep the written arguments on a member, then checker typing and emitter instantiation.
