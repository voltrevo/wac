# 0173a — a signature mentioning an unsubstituted type parameter is registered as a type

- **Status:** open
- **Claimed by:** agent-a, 2026-08-20
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

## Measured, and it is much larger than "a wrong entry" — agent-a, 2026-08-20

The program at the top, emitted with and without the uncalled `map`:

| | with `map` declared | without it |
|---|---:|---:|
| type entries | **50** | 28 |
| functions | **25** | 16 |
| exports | **14** | 11 |
| module bytes | **1718** | 1251 |

And the three extra exports name what is actually happening:

    $bind$sm_Box___main$i32_of      $bind$m_Box___main$i32_map
    $bind$sm_Box___main$U_of        $bind$m_Box___main$U_map     ← U is not a type

**`Box<U>` is instantiated as a struct**, with the method's own unsubstituted parameter as its type
argument, and the instance's methods are emitted *and* given bindgen glue. So this is not a stray
signature entry whose element byte is arbitrary — it is a whole spurious instantiation, nine functions
of emitted code and three exported names, for a method nobody calls.

That also makes `packages/wacc/test/wac/lambda_test.wac`'s sentence untrue as written —
*"Declaring one is harmless: nothing is emitted for a method nobody calls, so the module loads."* The
module does load, and it is 467 bytes bigger than it should be.

`packages/wacc/test/wac/genericsig_test.wac` holds this as a **ledger**: it asserts the three
differences at 22, 9 and 3, and that an export still names a `U` instance. Every one of those should be
zero, so when this issue is fixed that test fails and asks to be rewritten as the equality it should
be.

## Two fixes tried, both emit an invalid module

Recorded so the next attempt does not repeat them. Each was measured against the program above and each
made `deno task seed` fail with *"the build wrote … wacc.wasm and the engine will not load it"* — the
validator from `issues/lang/0170a` catching it, which is that net earning itself twice in a day.

1. **Skip `env.instantiate` when a type argument is an unsubstituted parameter**, at the
   `Named(tok, typeArgs)` arm that resolves a written generic type, returning the spelled name
   unchanged. This is the *right-looking* one and it fixed the visible half: functions 25 → 16 and
   exports 14 → 11, both equal to the program without the method, with type entries at 37. Then the
   self-build produced a module the engine rejects — the name is returned and nothing declares it, so
   something references a struct that was never built.
2. **Refuse it in `Env.sigType`**, returning index 0 for a signature mentioning an unsubstituted
   parameter. This got everything to parity — 16 types, 16 functions, 11 exports, 1166 bytes, the two
   modules byte-identical — and *also* removed 12 entries from the program **without** the method,
   because `Box<T>.of`'s template-level signature mentions `T`. Then the same invalid module: index 0
   is a real type and handing it out is worse than the entry it saved.

So the issue's own warning is the operative one: the signature table is index-addressed and grown
lazily, and an entry cannot be dropped without deciding what every reference to it resolves to. The
work is that decision, not the skip. Both attempts also cost a `seed:bootstrap` each, because a failed
seed leaves the bad compiler installed.

**A lead for whoever takes it.** Attempt 2's effect on the *plain* program is the interesting part: 12
of 28 type entries in a program with one ordinary generic struct are template-level signatures
mentioning `T`. That suggests the general shape is "template-level signatures should never reach the
type section at all", which is a bigger and more valuable change than the `U` case that opened this
issue — and it is measurable on any program with a generic in it.
