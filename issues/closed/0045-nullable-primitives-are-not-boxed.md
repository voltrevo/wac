# 0045 — a nullable primitive is neither boxed on assignment nor unboxed on `!`

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-a
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

## Fixed (agent-a, 2026-07-31)

Boxed, not rejected. `P?` is stored as `anyref` holding a one-field struct the resolver
synthesises — `#box$i32` — and `!` is a `ref.cast` plus a `struct.get`. The struct is
synthesised the same way an enum's base and variant structs are, so nothing downstream had to
learn about boxing: the type section, field offsets and `struct.new` already handle a struct.

**Rejecting nullable primitives was the wrong answer, and worth recording why.** It was the
first plan — nothing used `i32?`, `Option<i32>` had just been written, and boxing looked like
a hidden allocation. What it misses is that `T?` has to work for *every* `T` or it cannot be
used in generic code: there is no constraint to say "instantiate me only with a reference `T`",
so `struct Slot<T> { T? v; }` would compile until someone wrote `Slot<i32>` and then fail
inside code they did not write — the C++ template error the generics design is built to avoid.
`Map` had already worked around the hole with a `MapEntry<K, V>?` wrapper rather than parallel
`K?` arrays, without noticing it was one.

**`ref.i31` is what it used to do, and the reason it had to change is a wrong answer rather
than invalid wasm.** i31 holds 31 bits:

```wac
export i32? big() { return 2000000000; }   // came back as -147483648
```

No diagnostic, at exactly the values a program is most careful about. The allocation is the
price of that not happening, and it is documented in `spec/spec/types.md` along with the
cheaper alternative (a parallel `bool[]` of presence flags) for the case where it matters.

Nine other things had to change, each revert-checked:

| what | why |
|---|---|
| a value is boxed on the way into a nullable slot | one hook in `emitExpr`, so every expected-type position is covered at once |
| `!` unboxes | `ref.cast` is the null check *and* the way to the field |
| the declared type reaches a nullable-primitive initialiser | it was pushed down only for `null` |
| `hintFor` at the four storage sites | field, named field, assignment, array element |
| the emitter's `nullableOf` allows primitives | it and the checker's must agree, which is what `typeOfExpr`'s own comment says |
| the checker's `nullableOf` allows primitives | so `cond ? 1 : null` has a type |
| a literal types through a nullable | `u32? a = 4294967295` typed the literal as i32 and then failed to assign |
| `i32?[3]()` parses | the construction lookahead accepted `?` only after a *named* type |
| a reference crosses the `wacInstance` boundary | `Number()` of a wasm reference throws, which is how a returned `i32?` failed |

The last one changes an observable behaviour: **a nullable primitive crosses the host boundary
as a reference**, like every other reference, where it used to arrive as a number. Reading one
from the host needs an accessor written in wac. `(audit-07)` asserts exactly that, and
`bindgen` already omitted exports whose signatures mention a nullable type.

`§wac-nullable-primitive-4mzq7vp` covers it: every storage position, the full range of each
type, and the trap.
