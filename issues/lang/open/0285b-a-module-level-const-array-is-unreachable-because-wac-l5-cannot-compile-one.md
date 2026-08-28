# 0285b — a module-level `const` array is unusable in wacc, because wac-L5 cannot compile one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** missing feature — in the bootstrap ladder, not in wac
- **Symptom:** the whole build refuses, or the module traps

## What

`packages/wacc` cannot hold a generated lookup table, because the only shape a table can take at
module scope is one the top rung of the bootstrap ladder does not implement. wac itself is fine with
it — `packages/unicode/src/printable.wac` is exactly this and compiles — but that package is not in
wacc's import graph, so wac-L5 never sees it.

## Reproduction

Put a `const` array at module scope in any file `packages/wacc/src/api.wac` reaches, then build:

```wac
const i32[] LIT_KEYS = i32[](32, 160, 174);
export bool f(i32 cp) { return cp <= LIT_KEYS[LIT_KEYS.len() - 1]; }
```

    $ ./bootstrap.sh --host v8 --no-install
    wac-L5 refused 10 things in wacc
      !! wac-L5: line 32: unexpected token . before len ( )
      !! wac-L5: line 33: unexpected token i32 before found = 0
      !! wac-L5: line 36: unexpected token [ before mid ] <=

Dropping `const` gets past the parser and fails later and worse:

```wac
i32[] T = i32[](1, 2, 3);
export i32 main() { return T[1] + T.len(); }
```

    $ bootstrap/rust-ladder/target/release/ladder t.wac
    thread 'main' panicked at src/main.rs:87:46:
    the module trapped

## This is documented, and the documentation predicted it exactly

`bootstrap/README.md`, under the shortcuts wac-L5 takes:

> **A module-level `const` is refused**, and refused badly: `const` is not consumed at the top level,
> so `const u32[] K = …` is read as a global named `u32` and `K` is lost, which surfaces as an
> unresolved name wherever it is used. 251 declarations in the corpus are written this way and
> **none in wacc or `core`**, which is exactly why it went unnoticed. Doing it properly needs a
> `start` section and a function per initialiser, because wac's initialiser is an expression and
> wasm's global takes a constant.

So the gap was known and latent. What is new is that it is now *reachable*: nothing in wacc's graph
had ever wanted a table.

## What wanted one

`design/lang/0013` D3 — the rule for what a literal may contain. Six of its seven categories need 29
disjoint ranges between them and fit in a function of comparisons, which is what
`packages/wacc/src/litchars.wac` is. The seventh, `Cn` (unassigned), needs **707** ranges and a
generated table, and that is what hit this.

`Cn` is deferred for reasons of its own, written down in that file's header — chiefly that whether a
code point is assigned is a fact about the compiler's Unicode tables rather than about the program.
So nothing is blocked today. This is filed because the *next* table will hit the same wall, and
because a compiler that cannot hold a lookup table is a constraint worth knowing before designing
around it rather than after.

## What it would take

The README says: a `start` section and a function per initialiser. That is wac-L5's work — the rung
written in wac-L4 — and it is the sort of change the fixed-point check covers well, since a wrong
initialiser shows up as a compiler that cannot rebuild itself.

## Not a wac bug

`wacc` compiles a module-level `const` array correctly; `packages/unicode/src/printable.wac` is 733
ranges of exactly this shape and is used by `packages/box`'s `wc`. The language is fine. The rung
that has to compile the compiler is what is missing it, which is why this is filed against the
ladder rather than against the checker or the emitter.
