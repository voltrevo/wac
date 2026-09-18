# Decisions

Small decisions already taken. One rule each, with enough of the reason that it can be revisited — a
rule without its reason is one nobody can argue with.

A decision is here because it is settled and small: too small to be worth arguing at length, and
settled enough that the next person should follow it rather than re-open it.

An entry is **deleted once it reaches `spec/`**, rather than marked done. A rule written twice is a
rule that drifts, and the spec is the better copy — an implementation can have a bug, so landing the
code is not the test.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## `_` is a binding that cannot be read

`_` may be written wherever a name is bound — a pattern, a local, a parameter — and may repeat,
because it names nothing. **Reading it is an error.**

Discarding a value is a decision, and a reader should be able to see it: `i32 _ = f();` says call
this and throw the answer away, in the place where the answer would otherwise have gone.

The half that matters is that reading fails. A name that cannot be read cannot be mistaken for one
that can, so `_` stays unambiguous in the places a bare name would not be — a payload position, where
a word could otherwise be a variant to match or a name to bind.

## `default` is the arm that names no shape

A match arm is a shape and a consequence. `default` is the arm for the shapes not named above.

Not `_`. `_` means *a value I am not naming*, and an arm does not name a value — it names a shape, and
in a payload the two sit one bracket apart:

```wac
Err(_):  { … }        // the fault is a value I am not naming
default: { … }        // there is no shape here at all
```

Reusing `_` for both would be a pun on the payload wildcard rather than a generalisation of it, and
the two mean different things in the same arm.

## The ternary's type is decided by its branches

`Ternary<Left, Right>` is the narrowest available type containing both, except `anyref`: the greater
of the two nullability depths, over the nearest common ancestor of the non-nullable forms.

* `Ternary<T??, T????>` → `T????`
* `Ternary<Square, Circle>` → `Shape`
* `Ternary<Square, Circle?>` → `Shape?`
* `Ternary<S?, null>` → `S?` — `null` is depth one over no type

`anyref` is excluded because it contains everything, so a rule allowed to reach it could never refuse
a pair. Branches that meet nowhere else are an error.

Today `spec/spec/control.md` has a `null` branch giving "the other branch's, made nullable", which
appends rather than takes the greater, and the compiler answers unknown for the mixed cases.

## A nullable subject is matched, not unwrapped first

`match` takes a `T?`, and the arms name `null` alongside the variants. `default` covers it like any
other unnamed case; every other arm sees a non-null subject.

Requiring the unwrap puts one case outside the check. `match (s!)` traps unless a null test ran
first, so the null case gets handled in a statement above the match and the variants inside it, and
exhaustiveness then proves something about only part of the decision.

Today `spec/spec/enums.md:484` requires the unwrap, with `[§enum-match-nullable]` pinning
`match (s)` on a `Shape?` as a compile error.

## A packed type is an ordinary type

`u8 i8 u16 i16` may be a local, a parameter, a field and a return type, and indexing a `u8[]` answers
a `u8`. The width is a fact about storage, not about the type.

Three spec rules assume otherwise and go with it: `[§wac-packed-nullable-2knq6wv]`,
`[§wac-cast-packed-v7nq4mj]`, and an element reading as `i32` and writing by truncation.

## Some tuple returns must be optimised

A function that returns a tuple may be compiled to return the members instead. When this
representation is used, a caller that destructures the result immediately, or reads a single member
of it, must build no tuple.

A function must use this representation when the following conditions are met:

1. The function is synchronous (not async).
2. The returned tuple is created inside the function.
3. The function gives nothing a chance to hold a reference to that tuple after the call.
4. There exists a caller that destructures the resulting tuple or reads a single member of it.

Optimising by returning members under other conditions is permitted but not required by this
decision.

Being an optimisation, it changes nothing a program can observe. Where the two forms would otherwise
differ, the optimised function is wrapped in one that returns a tuple, and the wrapper is what is
used: an exported function's wasm signature comes from its declared parameter and return types, and
a funcref points at the wrapper, so two funcrefs to one function stay equal. It is the same wrapper
in both cases.

Requiring this optimisation allows performance-sensitive code that cannot afford the unnecessary
tuple allocations to rely on it.

## References are comparable but not hashable

`is` on two references is `ref.eq` and costs nothing. Identity hashing is not free, and the language
does not give it to every reference.

A moving collector invalidates anything derived from an address, and wasm GC exposes no object header
to stash a lazy hash in — so the only portable implementation is a field assigned at allocation.
Universal would put a word on every object, which is half again the size of a `Point { i32 x, i32 y }`.

A type that wants to be a hash key carries the field itself.

