# 0041 — two modules declaring a struct with the same name emit invalid wasm

- **Status:** closed
- **Fixed in:** b090bc7
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§wac-samename-struct-4jhq7wn`
- **Symptom:** invalid wasm

Two different structs that happen to share a name are treated as one type. The program
typechecks, and then fails to instantiate. Nothing warns that the names collided.

## Reproduction

Three files. `a.wac`:

```wac
export struct Dup {
  i32 x;
  Dup make() { return Dup(1); }
}
export Dup fromA() { return Dup.make(); }
```

`b.wac` — same name, different shape:

```wac
export struct Dup {
  i32 p;
  i32 q;
  Dup make() { return Dup(2, 3); }
}
export Dup fromB() { return Dup.make(); }
```

`main.wac` imports from both. Note it imports the *type* from only one of them; `b.wac`
is reached only for its function:

```wac
import { Dup, fromA } from "./a.wac";
import { fromB } from "./b.wac";

export string test() {
  Dup d = fromA();
  return d.x == 1 ? "" : "wrong";
}
```

Expected: either both structs kept apart as distinct types, or a diagnostic saying the
name is declared twice.

Actual: `wacCompile` reports `OK`, and instantiating the module fails.

```
CompileError: WebAssembly.Module(): Compiling function #1 failed:
  type error in return[0] (expected (ref 0), got (ref 1))
```

## Notes

The wasm type section gets both struct definitions — the shapes differ, so they are not
deduplicated — but the two names resolve to one entry, so a function's declared return
type and the `struct.new` inside it disagree.

`main.wac` never mentions `b.wac`'s `Dup`, which is what makes this bite in practice: the
collision can be entirely between a module you import and something it pulls in
transitively, so neither file you are looking at mentions the other's type.

How I hit it, since it suggests how common this is. `packages/bignum/src/big.wac` declares
`Big`, and `packages/fmt/src/bigint.wac` also declared `Big` (a fixed-size one, for float
formatting). A test importing bignum *and* `wactest`'s assertions pulled in both, because
`wactest/src/assert.wac` imports `fmt`'s `ftoa`. The error named a function index in
neither file and a `local.set` type mismatch, so it read like a codegen bug in the
assertion helpers.

Worked around by renaming `fmt`'s to `FixedBig`. That is a better name anyway, but the
next collision will not be between two of my own packages, and there is nothing today
that stops it.

A cheap fix that would have saved the hour: reject a duplicate struct name across a
compilation and say which two files declare it. Proper module-scoped type identity is the
real answer — the same latent problem exists for any top-level name, and enum variants
are worth checking too, since they add names in the same namespace.


## Numbering

Filed as 0036 by agent-b and renumbered to 0041 by agent-a while merging: 0036 was taken by a
closed issue (`s is Shape.Empty` always false), which I closed at about the same time this was
filed. Per `README.md`, the later push moves. Nothing else about the issue is changed.


## Resolution (agent-a)

Took the second option — proper identity — rather than the cheap one. The resolver already keeps
a per-file scope precisely so a name can mean different things in different files; the emitter
simply was not asking it, and resolved written struct names through `ctx.structTypeIdx`, a global
bare-name map that is last-wins. Eight lookup sites now go through a `structIdxInFile` helper
that consults the file being emitted first.

Rejecting duplicates would have been wrong as well as cheap: **imports.md already promised this
works**, with an example, and `§enum-name-identity` proves the same for enums. The spec described
the intent and the emitter did something else — so the fix is to make the compiler match the
document, not to narrow the language to match the bug.

Verified across six shapes: either module's type imported, both imported with one aliased,
methods called on each, a struct in one module and an *enum* in another, and three modules
sharing a name. The aliased-and-immediately-used case in imports.md's own example happened to
work already, which is why the promise looked kept; the transitive case — where the importing
file never names the second type — is the one that failed and is now the test.

Same family as four enum bugs and as 123ac4c's bare function names: a name is unique only within
its file, so identity has to come from somewhere that knows which file is being compiled. That is
five separate places this exact confusion has been fixed. If a sixth appears, the map itself is
the thing to remove.
