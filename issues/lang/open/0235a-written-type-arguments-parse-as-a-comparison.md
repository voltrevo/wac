# 0235a — written type arguments parse as a comparison, and the diagnostic says `found bool`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — a message that names neither the rule nor the intent

## Reproduction

```wac
struct Box<T> {
  T v;
  Box<U> map<U>(const this, fn[U(T)] f) { return Box<U>(f(this.v)); }
}
export i32 main() {
  Box<i32> b = Box<i32>(2);
  Box<i32> c = b.map<i32>((i32 x) => x + 1);
  return c.v == 3 ? 0 : 1;
}
```

    error: initialiser does not match the declared type
      --> m.wac:7:25
       |
     7 |   Box<i32> c = b.map<i32>((i32 x) => x + 1);
       |                         ^ expected Box<i32>, found bool

**The message is not wrong.** `spec/spec/generics.md` is explicit that there is no `max<i32>(x, y)`:
*"Angle brackets are type syntax only — the same ambiguity with less-than — and a call is an
expression, so inference is the whole interface."* So `b.map<i32>(…)` is `(b.map < i32) > (…)`, a
comparison chain, and its type really is `bool`.

It is also useless to the person who wrote it. Nothing in it says that angle brackets are not call
syntax, and `found bool` invites the reader to look for a boolean they did not write.

## Why it will be hit

Every language a reader is likely to arrive from spells this `f<T>(x)`. `design/lang/0010` — a method's
own type parameter — has this as its option C and rejects it *for this ambiguity*, so the language is
deliberately keeping a syntax that reads as something else. A deliberate trap earns a diagnostic that
names it.

It is also the first thing anyone tries when the inference form fails, and the inference form fails
today for exactly the case `0010` is about:

    error: nothing here wants a function, so this lambda has no type

So the likely sequence is: write the inference form, get told the lambda has no type, add the type
arguments to help, and get told the initialiser is a `bool`.

## What would help

A comparison whose right operand is a **type name** — `isStructName`, `isEnumName` or a primitive —
and which is immediately followed by `>` and a parenthesised argument list, is not a comparison anyone
wrote on purpose. That shape is narrow enough to name without guessing:

    error: type arguments are not written at a call
      --> m.wac:7:22
       |
     7 |   Box<i32> c = b.map<i32>((i32 x) => x + 1);
       |                      ^^^^^ `<` here is less-than, so this parsed as a comparison
       = help: a type argument is inferred from the arguments and the slot; see generics.md

The two halves are separable, and the first is most of the value: **detect the shape and say `<` is
less-than here**. Whether to name the inference rule in a help line is a smaller question.

## Not to be confused with

- `design/lang/0010`, which is the *language* question of where a method's own type parameter may come
  from. This issue is about the message for a syntax that is already settled as illegal.
- `issues/lang/0088` — a generic enum's variant cannot name its type arguments — which is a missing
  feature rather than a diagnostic.
