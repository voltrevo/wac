# 0041 — two modules declaring a struct with the same name emit invalid wasm

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
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
