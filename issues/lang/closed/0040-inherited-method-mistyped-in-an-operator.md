# 0040 — an inherited method's result is mistyped, so `s.get() + 1` emits invalid wasm

- **Status:** closed
- **Fixed in:** 2d3c248
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§wac-inherited-method-type-9dkq3wv`
- **Symptom:** invalid wasm

## Reproduction

```wac
struct Base { i32 a; i32 get(const this) { return this.a; } }
struct Sub : Base { i32 b; }
export i32 f() { Sub s = Sub(4, 5); return s.get() + 1; }
```

Expected: 5.
Actual: `WebAssembly.instantiate(): f64.add[0] expected type f64, found call of type i32`.

Two things have to coincide, which is why it has survived:

- the method must be **inherited**, not declared on the struct itself; and
- its result must feed an **operator**, so that something asks for its type.

`s.get()` on its own is fine — the call is emitted correctly. `Base(4).get() + 1` is fine.
Only the combination fails, and it fails identically two levels down a hierarchy.

## Notes

`typeOfExpr`'s method-call case resolves the method through `structEntry.methods`, which holds
only the struct's *own* methods. For a subtype the lookup misses, falls through, and the
expression ends up typed f64 — so the emitter picks `f64.add` for two i32s. The call itself is
emitted by a different path that does resolve inheritance, which is exactly why the call works
and only its *type* is wrong.

Nothing to do with enums, though that is how I reached it: an enum's methods live on its
generated base struct, so calling one on a narrowed variant is an inherited call, and
`e.val() + e.v` failed. Reducing it to plain structs showed the enum was incidental.

The type checker gets this right — it walks the parent chain — so this is the checker and the
emitter disagreeing about a type, which is the failure mode this compiler produces most often
(the i64 literal, the ternary result type, variant construction). The emitter should walk the
chain the same way rather than keeping a second answer.


## Resolution (agent-a)

`typeOfExpr` now walks `parentEntry` when resolving a method, via a small `lookupMethod`
helper, so it gives the same answer the type checker does.

Filed and fixed in the same sitting because I found it while verifying something else — but
filed *first*, and reduced to plain structs, because the enum route I arrived by was incidental
and an issue saying "enums are broken" would have sent the next reader to the wrong place.

Found by probing the three enum features added today in positions nothing had tried:
`e.val() + e.v` on a narrowed variant. Fifteen of sixteen probes passed; this was the
sixteenth, and reducing it took one round — `Sub s = Sub(4, 5); s.get() + 1`, no enum anywhere.
