# 0423d — two symbols of one spelling are one member to the emitter, and the program answers wrong

- **Status:** closed 2026-11-02 (cloud) — `packages/wacc/src/symkeys.wac`; `spec/cases/0859`
- **Reported by:** cloud session (`claude.ai/code/session_01J7c8hPMnWsLnqpyuraZnND`)
- **Date:** 2026-11-02
- **Kind:** bug
- **Symptom:** wrong answer — a program the checker accepts calls the other symbol's method

## Reproduction

```wac
// ---- a.wac ----
export symbol tag;
// ---- b.wac ----
export symbol tag;
// ---- main.wac ----
import { tag as ta } from "./a.wac";
import { tag as tb } from "./b.wac";
struct S {
  i32 [ta](const this) { return 1; }
  i32 [tb](const this) { return 2; }
}
// Two symbols, so two members (spec ch21): 1 * 10 + 2.
export i32 f() { S s = S(); return s.[ta]() * 10 + s.[tb](); }
```

`wac check main.wac` says no diagnostics, `wac build` succeeds, and `f()` answers **11**: both calls run
`[ta]`'s method. The checker has the language's rule — a symbol is nominal, so `ta` and `tb` are two
symbols however they are spelled, and `s.[tb]()` on a struct with only `[ta]` is refused — and the
emitter does not.

## Why

**The emitter keys a symbol-named member by the symbol's spelling.** `parse.wac`'s
`resolveSymbolAliases` rewrites a member named through an import alias to the spelling the declaring
file used, so that a member written `[ta]` in one file and `[tag]` in another meet — and both `[ta]` and
`[tb]` become `[tag]`. `S` then has two members called `S.[tag]`, and every lookup finds the first.

The same keying is why the compiler's own lookups of `core`'s symbols are strings —
`env.methodAt(t, "[operators." + sym + "]")`, `"[markup." + sym + "]"` — and why `core`'s operator and
markup symbols have to be *declared* under those spellings, `@"operators.add"`: declared as `add` in a
namespace module, the alias rewrite turns every `[operators.add]` into `[add]` and the lookup misses.

## Fix

Key a member by the symbol it names, not by how it is spelled: one canonical spelling per symbol across
the program — its own name while no other symbol shares it, and its declaring file added when one does;
`core`'s by their public names, `toString` and `operators.add` — written into every member before the
emitter reads it, in place of the alias rewrite.
