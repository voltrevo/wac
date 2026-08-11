# 0083 — a struct whose parent is declared after it emits an invalid supertype

- **Status:** open
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct Kid : Par { i32 k; }
struct Par { i32 p; }

export i32 f() { Kid v = Kid(1, 2); return v.p * 10 + v.k; }
```

Expected: `12`. Writing the two structs the other way round gives exactly that.

Actual: the compiler reports no error and produces a module the engine refuses —
`CompileError: WebAssembly.Module(): type 0: invalid supertype 1`.

## Notes

The types go into one rec group, and being in one rec group makes the members mutually
*visible* — it does not make a later one *defined* for the purpose of `sub`. A supertype
still has to be declared before the type that names it, so the type section needs the
structs ordered parents-first rather than in source order.

Nothing about the order is the author's business: the checker resolves the parent by
name and is happy either way, which is why this reaches the engine instead of the user.

Found while giving `packages/wacc` the same feature — its emitter orders the structs by a
pass over the parent chain before writing the type section, and the program above is in
its generated sweep. The sweep compares answers against this compiler and counts a module
the *reference* refuses to instantiate as a trap, so it went unnoticed until the two
implementations disagreed about which one was broken.
