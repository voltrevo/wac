# 0047 — two instantiations of a generic collapse when a type argument is an enum

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm

A generic struct instantiated at two different type arguments produces one set of types rather
than two, when at least one argument is an enum. It typechecks and fails to instantiate.

Reproduced against `2db0eb1`.

## Reproduction

Three files, because the generic has to be in a different module from the instantiations —
same file works.

`vbox.wac`:

```wac
import { Option } from "../../std/src/option.wac";

export struct V<T> {
  T[] data;
  i32 n;
  V<T> create() { return V(T[](), 0); }
  Option<T> first(const this) { return this.n == 0 ? Option.None : Option.Some(this.data[0]); }
}
```

`main.wac`:

```wac
import { V } from "./vbox.wac";
enum P { A(i32 x) }
struct S { i32 y; }
export i32 main() { V<P> a = V.create(); V<S> b = V.create(); return a.n + b.n; }
```

Expected: two independent instantiations, or a diagnostic.

Actual: `wacCompile` reports `OK`, and the module does not validate.

```
CompileError: WebAssembly.Module(): Compiling function #2 failed:
  struct.new[1] expected type (ref 0), found ref.as_non_null of type (ref 1)
```

## What is and is not needed

| condition | result |
|---|---|
| `V<P>` and `V<S>` — one enum, one struct | invalid wasm |
| `V<P>` and `V<Q>` — two enums | invalid wasm |
| `V<R>` and `V<S>` — two structs | fine |
| `V<P>` alone | fine |
| `V<P>` and `V<i32>` | fine |
| `V` declared in the *same* file as the instantiations | fine |
| `first` removed, so nothing returns `Option<T>` | fine |

So all four of these are required: two instantiations, at least one argument an enum, the
generic in another module, and a method whose return type mentions a *second* generic
(`Option<T>`) from a third module. `first` is never called — an unreached method is enough.

That last condition makes me think this is the family the INDEX note describes: a
monomorphised name resolved by spelling rather than by declaration. The nested instantiation
`Option<T>` has to be re-keyed per outer instantiation, and it looks like `Option<P>` and
`Option<S>` are ending up as one type. `ref 0` versus `ref 1` in the message are the two
payload types that should have stayed apart.

Why an enum argument and not a struct is the difference, I do not know. A guess: a struct
payload may be stored at a type both instantiations can satisfy, so the collapse is invisible,
while an enum's representation pins it exactly.

## Why it matters beyond the repro

`std`'s `Vec` and `Map` both have methods returning `Option<T>`, so this fires on the first
program that puts two `Vec`s of different element types in one module and makes either of them
an enum. That is not exotic: `packages/json` hit it immediately with `Vec<JsonValue>` (the
value enum) alongside `Vec<JsonMember>` (a struct), which is what a JSON tree is.

No workaround short of not using the generic at one of the two types. `json` ended up keeping
its hand-written container for other reasons — see `wac-mono/packages/json/src/value.wac` — but
it could not have used `Vec` for both even if the numbers had gone the other way.
