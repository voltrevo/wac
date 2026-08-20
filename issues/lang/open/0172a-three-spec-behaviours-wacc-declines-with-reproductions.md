# 0172a — three spec behaviours wacc declines: a generic struct with a base, an enum method naming a type late, and `is` against a non-ancestor

- **Status:** open — 2, 3 and 3b fixed 2026-08-20; only 1 remains
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

### Diagnosed to the line, and attempted — 2026-08-20

**The field count comes from a discarded token.** `emit.wac`'s instantiation pass registers the
instance's struct with

```wac
env.structNames[env.structCount] = inst;
env.structParentToks[env.structCount] = -1;      // <- the template's parent, thrown away
```

and `parentTok` **is bound by the enclosing `case StructDecl(nameTok, parentTok, …)` pattern** — it is
simply not used. `parentOf` then answers `""` for `Parented<i32>`, `inheritedCount` is 0, and
`fieldCountOf` says 1 for a struct that has two fields. Hence "2 of 1 fields" for a correct
construction. The ordinary declaration path a hundred lines below passes `parentTok` properly, which is
what makes the two comparable.

**I tried the one-line change and reverted it, because it is not the whole fix.** Carrying the token
makes `blocked()` return `""` — the count is right — and the emitter *still* drops the function, so the
failure moves from a decline naming its reason to the export-parity net saying only "`f` is not in the
module". The remaining work is the type section: an instantiation that now claims a parent has to be
emitted as a wasm subtype of it, and the pass that orders parents before children
(`emit.wac`, the `structParents` swap loop) runs over structs registered *before* the instantiation
pass appends to them.

So this is two pieces, and the second is the real one. Worth knowing before starting: the cheap half is
already understood, and doing only it makes the diagnostics worse for the same outcome.

**Two traps in the attempt, both worth repeating.** The same registration block appears twice, and the
second is `case EnumDecl(...)` — an enum has no parent, so `-1` is correct there and patching both sites
is wrong. wacc named it immediately (*"no parentTok in scope"*), which is the audit's own principle
paying for itself. And nothing in this repository writes a generic struct with a parent in a `.wac`
file — the only instance is the spec suite's own template string — so a grep over `.wac` sources reports
zero and is not evidence.

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

### Fixed — 2026-08-20

One arm. The declaration walk that registers every type a body can name had `case Func` and
`case StructDecl` and an `else: { }` that swallowed `EnumDecl` — so an enum method's body was never
walked, and a type it was the first to name was first named while emitting.

**This is the third time today the same omission has appeared in this file.** `declinedExport` had no
`EnumDecl` arm, which made it index another function's slot (`issues/lang/0170a`); the array walk beside
this one has an `EnumDecl` arm that registers variant *field* types and not method bodies. The shape to
distrust is `case Func` … `case StructDecl` … `else: { }`: enums have methods, so a walk that wants
bodies wants theirs. Worth a sweep of the remaining declaration walks in `emit.wac` for the same gap.

`spec/cases/0213` answers 10 — the match arm and both array reads contribute, so a wrong layout does not
pass as 10. 215 of 215 cases met, seed a fixed point, and the ledger went from eight entries to seven:
251 of 279 emitted whole (was 250) and **390 answers agreeing (was 389)**.

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

## 3 and 3b are fixed — 2026-08-20

Both were the same misreading in different places, and neither needed a new rule.

**3, `p is Q`:** `ref.test` cannot ask it — wasm wants the tested heap type inside the operand's own
hierarchy — so declining was the right conclusion from the wrong question. There is no instruction but
there is an answer: evaluate `left`, drop it, push the constant. `constantFalseIs` is the guard, narrow
on purpose: both sides must be known struct names, because an unknown left type is not evidence of
anything.

**3b, `p is Other`:** the parser was never wrong. `looksLikeTypeHere` decides type-or-value from the
spelling and the next token, and an upper-case name followed by `)` reads as a type — but whether
`Other` is a type or a variable is a question about *scope*, and the parser does not have scopes. So the
resolution moved to where the locals exist, and the emission is the `ref.eq` the value-on-the-right form
already used. `identityLocalName` returns `""` when a spelling is both a type and a local, so that
ambiguity still declines rather than being settled by whichever check ran first.

Both guards are one function consulted by the gate and the emitter, not two copies of a condition —
and I still wrote the left-must-be-a-reference check into only one of them before noticing.

**What it moved.** `specEmit`'s ledger went from ten to eight, and the ledger is what told me to update
it: *"2 known-unemittable case(s) emit now — take them out"*. Programs emitted whole went 248 → 250 and
agreeing answers went **380 → 389**. Those nine answers had never been compared, because a program that
does not emit has nothing to call — which is the point about declines hiding more than themselves.

Cases: `spec/cases/0211` (110 — `is` 0, `is not` 10, `is P` 100) and `0212` (101 — an aliased local is
identity, a same-contents different object is not). Each carries a term that a compiler answering a
blanket constant or a blanket true would fail rather than pass. 214 of 214 met; seed a fixed point.
