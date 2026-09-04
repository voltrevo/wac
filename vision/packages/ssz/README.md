# ssz — a representation chosen for a boundary that no longer exists

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/ssz`: Ethereum's SimpleSerialize, 799 lines, checked against 2,233 of
Ethereum's own vectors. It is correct and its README is unusually good about *why* — four invariants
listed *"because they are where implementations go wrong"*. This rewrite changes two things: what a
type is, and what a proof answers.

- [`src/type.wac`](src/type.wac) — the descriptor as a type
- [`src/chunk.wac`](src/chunk.wac) — `Chunk` and `Gindex`
- [`src/proof.wac`](src/proof.wac) — one branch check where there are two, answering a `Result`
- [`src/root.wac`](src/root.wac) — `hash_tree_root` driven by the type
- [`src/fault.wac`](src/fault.wac) — the eight refusals

---

## The flat table's reason is in the file, and it expired on 2026-08-17

`packages/ssz/src/container.wac` describes a type as four `i32`s in a flat table and says why:

> A type is four `i32`s in a flat table, `stride 4`, so the whole thing crosses the JS boundary as an
> `i32[]` and needs no struct marshalling

**Nothing crosses that boundary.** The tests were TypeScript until commit `71f8299c` — *"ssz: the
whole package to wac, on a shared fixture loader"*, 2026-08-17 — six `*_wac.test.ts` files calling
`sszHashTreeRoot(types: Int32Array, fields: Int32Array, root: number, data: Uint8Array)`. They are
deleted, the only `.ts` left in the package is a SHA-256 oracle that speaks hex lines, and no `.ts`
anywhere in the repository mentions `KIND_`.

This is not a criticism of the file. It was right when it was written, and it is findable *only*
because the header states its reason — which is the argument for stating reasons, made by the one
file that did. What it shows is general: **a shape adopted for a boundary outlives the boundary,
because nothing links the two.** The nearest thing this directory has to a check is
`../../QUESTIONS.md`'s entry on *"this exists because the language cannot"* being a claim about
causation, which was right eleven times in seventeen. A claim about a boundary is the same kind of
claim and nothing tests it either.

And it is the other half of a question raised the same day.
[`@/packages/raster/src/frame.wac`](../raster/src/frame.wac) found that a capability signature is the
last place a value type reaches, because marshalling is per scalar. Here the boundary reached the
other way and chose the representation of a type *behind* it, three files deep, for a program that no
longer has the boundary.

## `isValidMerkleBranch` takes its own argument twice

```
bool isValidMerkleBranch(u8[] leaf, u8[] branch, i32 depth, u64 index, u8[] root)
bool isValidNormalizedMerkleBranch(u8[] leaf, u8[] branch, u64 gindex, u8[] root)
```

A generalized index holds the depth and the path in one number — the depth is the position of the
leading bit, the path is every bit below. The first function takes them apart and needs them to
agree, and its first statement after the size checks is
`if (branch.len() != depth * CHUNK) { return false; }`, a guard that exists only because the caller
can pass a depth the branch does not have. The second takes the one number, splits it with
`floorLog2` and `subtreeIndex`, and calls the first.

So the package already holds both forms, and **the newer one is the older one with the pair put back
together.** `Gindex` is that number with the two projections as methods, and then there is one
function: the surplus-leading-zeros rule that justified a second function is a property of the
branch's length against the index's depth, checkable inside.

## `false` was answering six questions, one of which is a security property

`isValidMerkleBranch` returns `false` for a leaf that is not 32 bytes, a root that is not 32 bytes, a
branch that is not `depth` chunks, and a fold that lands somewhere else. The normalized one adds a
branch too short for the index, and **a surplus that is not zero** — which its own comment describes
as the rule that stops a prover attaching an unrelated subtree, and which returns the same `false` as
a caller who passed a 31-byte leaf.

One of the six is the answer to the question the function is for. The other five are the caller
having made a mistake, and a light client that cannot tell them apart logs *"invalid proof"* when its
own slicing is off by a chunk. Two of the six stop existing here because a `Chunk` is 32 bytes by
construction; the rest are variants of `ProofFault`.

## What could not be written

**A length in a type.** `Chunk` is a struct wrapping a `Bytes` whose length was checked once. If a
slice could carry its length in its type — `Slice<u8, 32>` — `Chunk` would be a typedef and
`Chunk.of` would be a cast the compiler checks.

*(Half of this was fixed the same day and from the other end.* This file had an
`unchecked(Bytes) -> Chunk` whose comment declared the length check away because `sha256` answered
`u8[]`. [`@/packages/crypto/src/digest.wac`](../crypto/src/digest.wac) was written afterwards and
`sha256` answers a `Digest32`, so the wrapper, its comment and the declaring-away are gone and
`Chunk.ofDigest` is infallible beside a `Chunk.of` that is not. **Three lines of prose replaced by
one word in a signature, in a package that owned neither end of it** — which is the argument for
rewriting a stack rather than a package, arriving for the second time in two days.*)

`@/packages/ens/src/answer.wac` asks for the same thing in the same words — *"`Bytes` carries no
length in its type — so `Address`, `Bytes32` and a `contenthash` are one type as far as anything can
check"* — and names the shape: **a fixed-length byte view**, which `Slice<T>` is one field away from,
since `len` is already there and is just not in the type. `@/packages/bls`'s `Fp` is `u32[] limbs`
for a field element that is always the same width, which is the same absence at a different element
type. Two packages arriving independently, and this is the third.

**A root has no type in it.** A `Chunk` from a `BeaconState` and one from a `SyncCommittee` compare
`false` rather than failing to type-check. `Root<T>` is the standard answer and vision has generics;
it is unwritten because the `Chunk` comes out of `sha256`, which cannot know a `T`. Same boundary,
third appearance in one package.

**`Uint(i32 bytes)` admits `Uint(3)`.** SSZ has six widths and the payload is an unconstrained
integer, which is the flat table's `param` field with a name on it. Six variants would fix it and
read badly; a refinement of an integer would fix it and does not exist.

**A descriptor is still written by hand and nothing checks it against a struct.** Nine light-client
containers are nine `SszType` values. What would remove the duplication is asking a struct for its
fields, which the language cannot do. `@/packages/abi/src/type.wac` reaches the same wall from the
other side — *"wac has no reflection and no macro, so the choice is a"* hand-written descriptor —
and `@/packages/wactest` asks the neighbouring question about reflecting on an *export* table.
Three packages, two of them wanting the field list and one the export list, and nothing collects
them.
