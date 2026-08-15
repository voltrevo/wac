# 0128 — wacc does not distinguish two modules' structs of the same name

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

Three files.

```wac
// a.wac
export struct S { i32 v; }
export i32 takesA(S s) { return s.v; }
```

```wac
// b.wac
export struct S { i32 v; }
export S makeB() { return S(7); }
```

```wac
// main.wac
import { takesA } from "./a.wac";
import { makeB } from "./b.wac";
export i32 confuse() { return takesA(makeB()); }   // b's S handed to a's S
```

Expected: `type mismatch`, which is what the reference answers.

Actual: wacc reports nothing and the module fails to validate —

```
CompileError: Compiling function #0:"confuse" failed: call[0] expected type (ref n…
```

Both shapes were tried: `struct S { i32 v; f64 extra; }` in `b.wac` and the identical
`struct S { i32 v; }`. **Both behave the same** — no diagnostic, invalid wasm — so the checker is
not comparing shapes and getting it wrong, it is not comparing at all. The emitter does distinguish
them, which is why the module refuses to load rather than silently working.

## Why it is loud, and still worth fixing

The failure is a `CompileError` naming a `call[0]` index, so nothing silently corrupts. That puts it
in the same class as `issues/lang/0123` — a missing check whose consequence is an unloadable module
and a message that names neither the call nor the types — rather than in `0127`'s class, where a
wrong answer came back and looked plausible.

Worth doing anyway because the message is useless to whoever hits it: it points at a wasm function
index, and the actual mistake is two imports away, in a name that appears identical in both places.

## Enums have it too — tested 2026-08-14

```wac
// ea.wac                                   // eb.wac
export enum E { A(i32 x), B }               export enum E { A(i32 x), B }
export i32 takesE(E e) { … }                export E makeE() { return E.A(7); }
```

`takesE(makeE())` across the two: reference says `type mismatch`, wacc says nothing and the module
fails to validate with the same `call[0] expected type`. So the enum half of this is **not** fixed —
`packages/wacc/README.md` records a related enum bug as found and fixed, and it was a different one.

## Generics could not be tested this way, and the reason is a lead

The same shape with `export struct Box<T> { T v; }` in two files is declined by the harness before it
reaches a module:

    a call to makeBox, declined: a construction of Box<i32> with 1 of 2 fields

**`Box<T>` has one field in both files.** A count of two matches neither declaration, which is what a
name-keyed table would produce if two same-named generics were merged rather than kept apart — the
same conflation this issue is about, surfacing in the instantiation metadata instead of in a call.

That is a guess from one message and it is worth chasing rather than believing: it may equally be the
bindgen declining for its own reasons and reporting a count from somewhere unrelated. Whoever takes
this should reproduce it without the harness in the way.

## Where this has been before

`packages/wacc/README.md` records the same shape, found and fixed for **enums**: *"enums resolved by
name where identity was meant, which only two files declaring the same enum name could expose."*
Structs look like the remaining half of that. Enums were not re-tested here; whoever takes this
should, along with generic instantiations of a same-named generic.

## How it was found

A deliberate hunt for cross-module type identity, chosen because the README above says it has
produced bugs before and because it is invisible to a single-file corpus — the sweep of 10,013
generated programs that rung 3 reports is single-file by construction.
