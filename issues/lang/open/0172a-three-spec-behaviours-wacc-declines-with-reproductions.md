# 0172a — three spec behaviours wacc declines: a generic struct with a base, an enum method naming a type late, and `is` against a non-ancestor

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** missing feature (three of them)
- **Symptom:** `wac check` is clean, `wac build` fails and names the function

## Why these three are together

`packages/wacc/test/specEmit.test.ts` now records which of the reference's accepted spec programs wacc
**declines**, rather than counting them (`issues/lang/0170a`). There are ten. Six are a nullable
primitive — `issues/lang/0171a` — and these are the other four, covering three distinct causes.

They are filed together because they were found by one measurement and each is a few lines, not because
they share a cause. Split this issue if two people take two of them.

Each reproduction below is **minimised from the spec case, then checked both ways**: `tools/check.ts`
(the reference) accepts it, and `wac build` declines it. The spec programs they came from are larger, so
these are new reductions rather than copies.

## 1. A generic struct with a base class — `§wac-generic-struct-9tkq4wm`

```wac
struct Base { i32 a; }
struct Parented<T> : Base { T v; }
export i32 f() { Parented<i32> p = Parented(1, 2); return p.v; }
```

    reference: OK
    wacc:      cannot emit — the exported function `f` is not in the module the emitter produced

The emitter's own reason, from `blocked()`, is **`a construction of Parented<i32> with 2 of 1 fields`**.
So it counts the instantiation's own field and not the inherited one: `Parented<i32>` has `a` from
`Base` and `v` of its own, and the construction correctly passes two. A non-generic subclass is fine —
`struct Sub : Base { i32 b; }` constructs with two — so this is inheritance **through an instantiation**,
where the field count is taken from the template rather than from the instantiated type.

`issues/lang/closed/0034-generics.md` is the generics work this sits on top of.

## 2. An enum method that names a type only while emitting — `§enum-methods-6vkq2wn`

```wac
struct Q { i32 v; }
i32 helper() { return 3; }
enum E {
  A(i32 v), B,
  i32 sum(const this) {
    Q[] qs = Q[2](fill: Q(helper()));
    i32 base = match (this) { case A(v): v, case B: 0 };
    return base + qs[0].v + qs[1].v;
  }
}
export i32 f() { return E.A(4).sum(); }
```

    reference: OK
    wacc:      cannot emit — a type this emitter names only while emitting

This one names its own cause, and the cause is structural rather than about enums. `emit.wac`'s type
section is written before the bodies, and `Q[]` is first reached from inside an enum method's body — so
the array type does not exist when it is needed. There is already a pre-pass for the analogous problem
with `fn[…]` pairs (`emit.wac:1219`, *"so none is first named while emitting"*); this is the same
constraint with no sweep covering it.

Narrowing worth having: the array is what does it. An enum method that only reads `this` is fine, and
`issues/lang/closed/0028-methods-on-enums.md` is the feature itself, which works.

## 3. `is` against a type that shares no ancestor — `§wac-is-undefined-type-6qbn3wr`

```wac
struct P { i32 x; }
struct Q { i32 y; }
export i32 f() { P p = P(1); return (p is Q) ? 1 : 0; }
```

    reference: warning: 'P is Q' is always false — the types share no ancestor, then OK
    wacc:      the same warning, then cannot emit — `f` is not in the module

Both compilers agree it is **always false** and say so in nearly the same words. The reference then
emits a constant `false`; wacc warns and declines, so the diagnostic is right and the code generation
for the case it has just diagnosed is missing. A program is refused for something both compilers call a
warning.

### 3b. …and the same shape for a local — `§wac-type-name-scope-8vqk3mn`

```wac
struct P { i32 x; }
export i32 f() { P p = P(1); P Other = p; return (p is Other) ? 1 : 0; }
```

    reference: OK
    wacc:      cannot emit — `f` is not in the module      ("a test for Other on a P")

`Other` is a **local holding a value**, not a type, so this is an identity test rather than a type test —
an upper-case local being legal is the point of the spec case. Filed with 3 because the emitter's reason
has the same shape, but it may well be a different fix: `issues/lang/open/0151` is about the reference
refusing an identity test the spec allows, so the two compilers disagree about this corner in *both*
directions and that is worth settling once. `issues/lang/closed/0022` and `closed/0048` are where the
`is`-against-an-unrelated-name and bare-type-name-scope rules came from.

## What is good about all four

They used to be silent: `wac build` wrote a module without `f` and exited 0. The export-parity check
from `0170a` is what turns each into the message above, and the tag-keyed ledger in
`specEmit.test.ts` is what will notice when one starts working — it fails with *"emit now — take them
out of KNOWN_UNEMITTABLE"*, which is the acceptance test for any fix here and is already in the suite.
