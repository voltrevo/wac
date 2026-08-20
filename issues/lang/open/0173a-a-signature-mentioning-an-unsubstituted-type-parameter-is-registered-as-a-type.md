# 0173a — a signature mentioning an unsubstituted type parameter is registered as a type

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** cleanliness — a wrong entry that is currently harmless
- **Symptom:** none visible; the type section carries an entry whose element type is meaningless

## What happens

Declaring a generic **method** registers a signature-table entry for it, even though nothing can call it
until it is instantiated:

```wac
struct Box<T> {
  T v;
  Box<T> of(T v) { return Box(v); }
  Box<U> map<U>(const this, fn[U(T)] f) { return Box.of(f(this.v)); }
}
export i32 f() { Box<i32> a = Box.of(21); return a.v * 2; }
```

The entry for `map` mentions `U`, which is not a type — it is the method's own parameter, unsubstituted.
`writeValType` is then asked to write `U` into the type section.

## Why it has never mattered

`valType` answered `127` — a plain `i32` — for anything it did not recognise, so `U` was written as an
`i32`. Nothing references that entry, so the module is valid and the program answers 42.

## Why it is worth recording anyway

It surfaced when `writeValType` stopped guessing. `issues/lang/0170a` replaced `valType`'s catch-all with
a refusal, and the first thing that refusal caught was this — so **declaring an uncalled generic method
stopped building**, which the spec allows and `packages/wacc/test/wac/lambda_test.wac` pins in as many
words: *"Declaring one is harmless: nothing is emitted for a method nobody calls, so the module loads."*

The guard now tolerates a bare unresolved name, on the argument that the checker has already accepted the
program — so a bare name resolving to no declared type can only be a template parameter. That keeps the
refusal for genuinely unwritable types and lets this through, which is the right *behaviour* and leaves
the wrong *entry* in place.

## The actual fix, and why it is not done here

A type mentioning an unsubstituted parameter is not a type and should never be registered. The reason to
file rather than do it: the signature table is index-addressed and **grown lazily during emission** — see
`pairMark`'s comment on why nothing may be appended after it — so removing an entry moves every index
after it. That is a change worth making deliberately, with the fixpoint check as its oracle, rather than
as a footnote to a nullable-primitive fix.

Whoever takes it: the payoff is not the byte saved. It is that `writeValType` could then refuse a bare
unresolved name outright, and `isUnresolvedBareName` — which exists only to make room for this entry —
would go.

## What found it

The gate, not the seed build. wacc's own source has no generic *method* type parameters, so
`deno task seed` was a fixed point with the guard in place and reported nothing; the `wac test` lane
failed on the eleventh file. Worth remembering that the seed is a large real program but not a complete
corpus.
