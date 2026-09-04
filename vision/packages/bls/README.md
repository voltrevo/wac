# bls — one file rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/bls`: 4,051 lines of source over the BLS12-381 field, the tower, the
curves and the pairing. **One file** — `fp.wac`, the base field — and the reason it is worth one file
is that the arithmetic is not the subject. None of it changes.

Picked because it should be the package where this exercise's proposals **lose**: a pairing is 20,000
field multiplications and every idiom here has an allocation in it. It turned out to be the one where
the cost could be settled from numbers the repository already had.

---

## A whole package arranged around a failure a type would prevent

`fp.wac`'s header:

> **The form is not visible in the API and must not leak.** … **The cost of getting this wrong is an
> implementation that passes every internal consistency check and disagrees with every test vector**,
> which is the failure this whole package is arranged to avoid.

Every value in that file is a `u32[]`. Including:

- `fromMont(a)` at three call sites, each producing a **non-Montgomery** `u32[12]` that then lives
  beside the Montgomery ones;
- `fpHalf()`, documented *"1/2, in Montgomery form"*;
- and the local `half` inside `fpIsLexicographicallyLarger`, which is `(p−1)/2` in **normal** form —
  four lines from a `fromMont` and in the same file as `fpHalf`.

**Two constants called half, both twelve `u32` limbs, one in the form and one not.** Either is
assignable wherever the other is and `fpMul` takes both. Seventh instance of the pattern this
directory has been collecting — the best-argued paragraph in a file being a rule the type could hold
— and the one with the worst failure mode, because the header names it: an implementation that is
internally consistent and wrong against every vector.

## The cost objection, bounded by two existing numbers

A field element is on a pairing's hot path, so the objection is allocation. Neither number needed
measuring again:

| | |
|---|---|
| `packages/bls/README.md` | **7.9 ms** per verification, *"order 20,000 field multiplications"* → **≈395 ns** per field multiply |
| [`../../bench/slicecost.wac`](../../bench/slicecost.wac) | a fresh **three**-field struct is **2.6 ns**, v8 host, *"one `struct.new` … on a bump allocator"* |

A `struct Fp` has one field, so 2.6 ns is an **upper bound**. Against 395 ns that is **0.7% of a
field multiply** — and every one of those multiplies already allocates a `u32[12]`, 48 bytes and a
header, so the wrapper roughly doubles the object *count* and adds a fraction of the bytes.

Under one percent, to make *is this value in Montgomery form* something the compiler knows. Stated
with numbers rather than argued, and worth noting as a method: **the bench written for a slice
answered a question about a field element**, because both reduce to the cost of one `struct.new`.
A cost measured once bounds every proposal of the same shape.

## Five infinity guards, one observable, and the author proved it by deletion

[`src/verify.wac`](src/verify.wac) was added after counting the tree's `bool` verifications — 17 of
them collapsing 106 refusals, four of the seventeen in this package. What makes `bls` the one worth
writing is that its author already did the experiment this directory usually only argues for:

> Refused outright — but **not** because the Ethereum fixtures require it, which is what this said
> before somebody deleted the line and watched them all still pass. … The **one** infinity guard in
> this file that a test can see is `aggregatePubkeys`'s … All three stay: defence in depth is the
> point, and now the comments say which is load-bearing.

The reason no test can see the others is arithmetic: `pk = O` reduces the identity to
`e(−G₁, sig) == 1`, which holds only for `sig = O`, and the infinity-*signature* guard answers first.

**Name the refusals and four of the five become observable.** Delete `verify`'s `g1IsInfinity(pk)`
and an infinity key reaches the pairing, which fails: `Err(DoesNotVerify)` where it was
`Err(InfinityPublicKey)`. Two different answers, so a test can catch the mutation — a test that
asserts *which* refusal, which a `bool` gives no way to write.

It does not make the guards *necessary*. Four of the five stay arithmetically redundant; what changes
is that removing one has to remove a test with it rather than passing quietly, which is the whole of
what [`@/packages/lightclient`](../lightclient/) means by *rots unnoticed*.

### Four entry points, four refusal sets, and no way to compare them

`verify`, `fastAggregateVerify`, `aggregateVerify` and `batchVerify` refuse in 3, 3, 9 and 9 places.
`fastAggregateVerify` does not check that the *aggregate* is infinity where `verify` checks its
single key — and it is safe, because two valid keys summing to infinity still cannot verify:
`e(O, H(m)) = 1` leaves `e(−G₁, sig) == 1`, needing `sig = O`, which is already refused. Checked, not
a bug — and the reasoning spans three functions and an algebraic identity, which is the shape
[`@/packages/zstd`](../zstd/) found in a `Buf`.

## What could not be written

**The wrapper stops at the bottom layer.** `fp2.wac` holds two `u32[]`, `g1.wac` three, and the tower
passes limb arrays down — so `fp2Mul(a0, a1, b0, b1)` takes four arrays and nothing says which pairs
with which, which is a *larger* confusion than the one this file prevents. Not written because it is
the whole package rather than one file, and because **the cost estimate does not carry**: a `G2`
point is three `Fp2`s and so six `Fp`s, taking the object count per point from 6 to 16, and 0.7%
would have to be re-derived. That re-derivation is the honest next step and it needs a measurement,
not an argument.

**`const struct` and an in-place kernel are in tension.** Wrapping what `montMul` allocates costs one
`struct.new` — the figure above. An in-place kernel, `montMulInto(out, a, b)`, which is what a
serious implementation eventually wants, cannot write into a `const struct`'s array without a way to
say *this is mine until I hand it over*. `issues/lang/0331a` is the same boundary approached from
aliasing; this is it approached from allocation, and neither has an answer.

**Nothing in the type says twelve.** `Fp.limbs` is a `u32[]`, every operation assumes `LIMBS == 12`,
and a nine-limb array type-checks in and reads past its end on the first multiply. One of six
packages to
want a fixed-length array — after `ens`'s address, `raster`'s tile and `mpt`'s nibbles — and the
first where the missing bound is *inside* the type rather than on a parameter.
