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

## References are comparable but not hashable

`is` on two references is `ref.eq` and costs nothing. Identity hashing is not free, and the language
does not give it to every reference.

A moving collector invalidates anything derived from an address, and wasm GC exposes no object header
to stash a lazy hash in — so the only portable implementation is a field assigned at allocation.
Universal would put a word on every object, which is half again the size of a `Point { i32 x, i32 y }`.

A type that wants to be a hash key carries the field itself.

