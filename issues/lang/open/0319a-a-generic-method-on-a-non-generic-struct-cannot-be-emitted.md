# 0319a — a generic method on a non-generic struct cannot be emitted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** `cannot emit` — an internal error about the type section, not a diagnostic

## Reproduction

```wac
struct S { i32 n; U pick<U>(const this, U a) { return a; } }
export i32 f() { S s = S(1); return s.pick<i32>(3); }
```

    $ wac build g.wac -o g
    wacc: cannot emit g.wac — a type was registered while a body was being emitted, after the type
    section had been sized: 50 counted, 53 wanted — sig fn[U(S,U)] sig fn[U(anyref,S,U)]
    sig fn[U(anyref,U)]

## The same method on a generic struct is fine

```wac
struct Box<T> { T v; U pick<U>(const this, U a) { return a; } }
export i32 f() { Box<i32> b = Box(1); return b.pick<i32>(3); }
```

    2716 bytes from 1 file(s)

Same method, same call, same type argument. **The only difference is whether the owner has type
parameters of its own.**

## Why the spec did not catch it

`spec/spec/generics.md` documents the feature and tags it:

> ### A method may take type parameters of its own
>
> A method may declare letters the owner does not have, and a call supplies them the same way
>
> `[§wacc-method-type-args]` Both work

and its example is

```wac
struct Vec<T> {
  U fold<U>(const this, U seed, fn[U(U, T)] f) { … }
}
```

— a generic method on a **generic** struct, which is the half that works. The sentence *"a method may
declare letters the owner does not have"* describes the broken case exactly, and the example beside
it does not exercise it. One example, two shapes, and the tag covers the one that passes.

## What the message suggests, offered as a lead rather than a diagnosis

The three signatures it names — `fn[U(S,U)]`, `fn[U(anyref,S,U)]`, `fn[U(anyref,U)]` — look like the
method being registered more than once, and the count is short by exactly three. On the generic
owner the instantiation presumably registers them while the type section is still open. Not
investigated further; the reproduction is two lines and the difference is one word.
