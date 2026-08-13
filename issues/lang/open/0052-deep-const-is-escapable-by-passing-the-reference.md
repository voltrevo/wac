# 0052 — deep const is escapable by passing the reference to a mutating function

- **Status:** open — `design/lang/0008` proposes an answer
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, no error

## Reproduction

Four lines:

```wac
struct S { i32 v; }
void mutate(S s) { s.v = 1; }
void bad(const S s) { mutate(s); }   // accepted — and it writes through a const reference
export i32 f() { return 0; }
```

`spec/spec/variables.md` says `const` on a reference means "no writes through that reference at
any depth" (`§wac-const-deep-j6b1nyg`). This writes through one. No diagnostic.

The same holds for a const field, a const array element, and `const this`:

```wac
struct S { i32 v; }
void take(S s) { s.v = 1; }
void viaThis(const this)      { take(this); }        // accepted
void viaField(const H h)      { take(h.s); }         // accepted
void viaElement(const S[] xs) { take(xs[0]); }       // accepted
```

Every *assignment* position is guarded — a const reference cannot be assigned to a plain local, a
field or an array element — so the hole is specifically the argument position.

## Why it is not fixed here

I tried three enforcement points and each refused code that is correct. They are worth recording
because the third one is the argument that this needs a language change rather than a checker fix.

**1. Refuse a const-rooted argument for a non-const parameter.** Breaks `packages/json`:

```wac
bool bytesEq(u8[] a, u8[] b) { ... }                 // reads only
JsonValue? get(const this, u8[] key) {
  JsonMember m = this.slots[i]!;
  if (bytesEq(m.key, key)) { return m.value; }       // refused: m.key is const-rooted
}
```

`bytesEq` does not write, and nothing in the type says so. The author's fix is `const u8[] a` on
the parameter — reasonable, and it means annotating every read-only parameter in the repo.

**2. The same, for a funcref call.** *Unfixable* in user code. `Map<K, V>` takes its equality as
`fn[bool(K, K)]`, and a funcref type has no `const` to write:

```wac
i32 slotFor(const this, K k) {
  if (this.eq(e!.key, k)) { return i; }              // refused, and there is no way to allow it
}
```

**3. Treat an element of a const array as const** (which it is — it is reached through the array).
Makes the *existing* assignment rule refuse an accessor copying keys out of a const container into
a fresh local array, which is what `Map.keys()` does.

## What it would take

Const-ness has to be part of the type, not a property of the variable, so that a funcref can say
`fn[bool(const K, const K)]` and a parameter's read-only-ness travels with the signature. That is a
language change — and worth weighing against just documenting the hole, since deep const already
does not survive a value being returned from a function (the constness travels out through the call
rather than living in the type, which `tour.wac` documents as deliberate).

## Fixed along the way

One thing did come out of this: `isConst` on a variable meant two things at once — "the name cannot
be reassigned" and "the object must not be written through". A `match` arm's payload binding is the
first but not the second, and being treated as the second made
`total(a.at(i))` on a payload bound from a *non-const* subject an error. `VarInfo` now has both
flags, and a narrowing or arm binding inherits deep-constness from its subject rather than claiming
it. That is in `wacTypeCheck.ts` and covered by the existing recursive-enum tests, which is how it
surfaced.


## 2026-08-13, agent-b: measured, and a different answer proposed

The cost of the declared form, counted rather than estimated:

```
parameters in packages/*/src/*.wac                     8,295
  of reference type (struct, array, string)            4,996
  of those marked const today                             28
distinct funcref signatures                                94
  taking a reference-typed parameter                       64
```

So enforcement point 1 means **4,996 annotations**, and point 2 is impossible rather than merely
large — `fn[bool(K, K)]` has nowhere to write `const`.

`design/lang/0008` proposes asking the callee instead: compute which parameters a function writes
through, to a fixed point over the call graph, and refuse a const-rooted argument only where the
callee actually writes. Nothing is annotated, all three cases recorded above keep compiling, and the
reproduction is refused. The residue is the funcref call, which that note proposes stating in the
spec rather than annotating around.
