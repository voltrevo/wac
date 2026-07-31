# 0045 — a nullable primitive is neither boxed on assignment nor unboxed on `!`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
export i32 main() { i32? a = 7; return a!; }
```

Expected: `7`.
Actual: does not instantiate —

```
local.set[0] expected type anyref, found i32.const of type i32
```

The unwrap fails the same way from the other side:

```wac
i32 f(i32? a) { return a!; }
export i32 main() { i32? n = 7; return f(n); }
```

```
type error in return[0] (expected i32, got (ref any))
```

## Notes

Two halves of one thing. `i32?` is represented as `anyref` (so it can be null), which means
a primitive going in has to be boxed — `ref.i31` for the small integers, a boxed struct for
`i64`/`f64` — and `a!` has to unbox it. Neither happens: the value is stored raw and read
back as a reference.

Narrowed:

| shape | result |
|---|---|
| `i32? a = 7;` (local) | `local.set` expects anyref, got i32 |
| `i32 f(i32? a) { return a!; }` | return expects i32, got `(ref any)` |
| `i32 f(i32? a) { i32 v = a!; }` | `local.set` expects i32, got `ref.as_non_null` |
| `f64? ` parameter | same as the i32 case |
| `a! + 1` | `i32.add` expects i32, got `ref.as_non_null` |
| `P? p` where `P` is a struct | **works** — `a!.v` is `3` |

So nullable *references* are fine and only nullable *primitives* are broken. `ref.as_non_null`
is emitted for the unwrap, which is right for a reference and not enough for a primitive.

Found while probing generic functions (`T orElse<T>(T? a, T d)`), but generics are not
involved: every reproduction above is plain wac. Worth checking whether the type checker
should be rejecting these instead — a nullable primitive may be a shape the language does not
mean to allow, in which case the fix is a diagnostic and a spec sentence rather than boxing.
`spec/spec/types.md` currently documents `T?` without excluding primitives, so the
implementation and the spec disagree either way.
