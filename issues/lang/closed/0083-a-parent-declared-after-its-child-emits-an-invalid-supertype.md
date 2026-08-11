# 0083 — a struct whose parent is declared after it emits an invalid supertype

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 1296f5f0
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

## Resolution

The struct types are numbered parents-first now, by a permutation applied at the top of
`wasmBuildBin`. The note above was right about the cause: one rec group makes the members mutually
*visible* and not mutually *defined*, so a `sub` clause still needs its supertype earlier in the
section.

**It was wider than one file's declaration order.** A file's imports are processed *after* its own
declarations, so a parent reached through an import always landed at a higher index than the child
inheriting from it:

```
// par.wac
export struct Par { i32 p; }
// main.wac
import { Par } from "./par.wac";
struct Kid : Par { i32 k; }        // type 0: invalid supertype 1
```

Which is to say inheritance across files did not work at all, in either declaration order. Nothing
caught it because the corpus has no cross-file inheritance in it — an absence that looked like a
style, and was a compiler limit nobody had written down.

**The renumbering had to rewrite every index already recorded**, not just `StructEntry.typeIndex`:
the checker stamps `resolvedTypeIndex`, `variantTypeIndex`, `enumBaseTypeIndex` and
`narrowTypeIndex` into the AST before emission, and a method's origin carries `structTypeIndex`.
That is done by walking the object graph and rewriting those fields by name, rather than by a walk
over the node kinds that carry them — a positional walk missing an arm is the failure this codebase
produces most often, and here it would have produced a module that validates and reads the wrong
struct rather than one that fails loudly. `structs[i].typeIndex === i` is preserved, since
`wacTypeCheck` and the emitter both depend on it, and a program already in a good order is left byte
for byte as it was.

`spec/cases/0112` (a parent declared below its child) and `0113` (a parent imported from another
file).
