# 0173a — a signature mentioning an unsubstituted type parameter is registered as a type

- **Fixed in:** the commit closing this issue
- **Status:** closed — agent-a, 2026-08-21, third attempt
- **Closed by:** agent-a, 2026-08-21
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

## Fixed — agent-a, 2026-08-21, and the two failures were halves of one fix

    type entries   22 extra  ->  0
    functions       9 extra  ->  0
    exports         3 extra  ->  0
    bytes         467 extra  ->  0 (the two modules differ only where the manifest embeds the filename)

`deno task seed` is a **fixed point after 2 rounds**, which is where both earlier attempts died. The
program at the top still answers 42, and calling the method is still refused by name — *"no
`Box<i32>.map` without its type arguments"*.

### Why each half failed alone

The two recorded attempts are not two ideas; they are the two ends of one, and each is broken without
the other:

- **Not instantiating** (attempt 1) leaves `Box<U>` spelled but unbuilt — and emission carries on and
  looks the name up, so "something references a struct that was never built".
- **Refusing the signature** (attempt 2) reaches parity and hands out index 0, which is a real type.

Together, they work: `typeOfTyName`'s `Named` arm answers the *spelled* name and does not instantiate
when any type argument `isUnresolvedBareName` — that predicate already existed for exactly this shape —
**and** the method is declined where it is registered, so nothing emitted ever asks for the name.

### The three things that made it safe, all read before writing

1. **`addFunc` declines a function whose return type is `""`.** So answering nothing is not an option
   and the spelled name is: registration needs a non-empty type, and only *emission* would try to
   resolve it.
2. **`funcIndex` starts at `-1`** and the renumbering skips anything not `funcOk`. So declining the
   method is enough to keep it out of the module — and `methodLines`, which writes the bindgen wire,
   already refuses to describe a method without an index. That is where the 3 exports went, with no
   guard added.
3. **The registration must stay.** Its own comment says why: *"a call resolves to **this** entry, so a
   flag set only on the template is a flag the refusal never sees."* Removing it would turn a named
   refusal into "no method Box.map". So the method is registered, flagged, and declined — three facts
   about the same entry.

Four `registerFuncTypes` calls on methods also had to skip a generic one, which is where the last 9 of
the 22 type entries were: a signature whose return type names the method's own letter is the entry this
issue is titled after.

### What it buys, beyond the bytes

The payoff this issue named: **`writeValType` can now refuse a bare unresolved name outright**, and
`isUnresolvedBareName` — which the issue says "exists only to make room for this entry" — has one real
caller instead of being a tolerance. Not done here, deliberately: that is `issues/lang/0170a`'s
territory and it wants its own fixpoint run.

`genericsig_test.wac` is the equality now rather than a ledger, as this issue asked. Its sharper half is
the name assertion: three counts can return to zero by two errors cancelling, and an export called
`$bind$sm_Box___main$U_of` cannot.

Verified: genericsig 2, lambda 21 (it is the file whose *"nothing is emitted for a method nobody calls"*
was untrue until now), cases 224, emit 2, selfhostemit 1, genericenum 3, downcast 2, corpuscheck clean,
linkEmit 2, and the generated sweep at 4540 compared, 0 mismatched, 0 declined.
