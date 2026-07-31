# 0016 — a ternary of two variants emitted invalid wasm

- **Status:** closed
- **Fixed in:** fca718c
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm
- **Covered by:** `§enum-ternary-variants`

## Reproduction

```wac
enum E { A(i32 v), B }
export i32 probe() {
  E e = true ? E.A(9) : E.B;
  match (e) { case A(v): return v; case B: return 0; }
}
```

Expected: 9.
Actual: `WebAssembly.instantiate(): expected 0 elements on the stack for fallthru,
found 1`.

## Notes

`typeOfExpr` did not recognise variant construction at all: `E.A(9)` is a call with a
field callee, so it fell through to method resolution, found none, and reported void.
The ternary then declared its block with no result and pushed a value into it.

It only surfaced here because almost every other context supplies an *expected* type
rather than asking for the expression's own. A ternary asks. So does anything else that
needs an LCA.

The same was true of `E.B` — a payload-less variant used as a value, which is a field
expression. Both now read the `variantTypeIndex` the type checker records on the node,
which is the annotation added for issue 0008. A plain struct hierarchy was unaffected,
so `cond ? Q(1) : R(2)` for siblings of a common parent always worked.
