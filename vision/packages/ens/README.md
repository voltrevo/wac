# ens — the caller `packages/abi` never had

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

One file, and it is not an ENS rewrite. [`src/answer.wac`](src/answer.wac) reads what a resolver
answered, which is the half `packages/ens` says it needs `packages/abi` for and never wrote:

> A selector is the first four bytes of `keccak256` of the signature, and the arguments follow it in
> ABI encoding. Both of these take one `bytes32`, which is a static type, so the calldata is the
> selector and one word — **no `packages/abi` needed for the encoding, though the *answer* needs
> it.**

`packages/ens` builds three calls and stops. Nothing in it decodes a reply, and **`packages/abi` has
no callers at all** — a grep over `packages/` finds its own coverage ledger and one `wacc` probe. So
a package tested exhaustively against `npm:ethers` (thirty cases, both directions, a strictness table
measured against two real decoders) has never been *used*, and the shape of its API had never met a
caller until this file.

It is here rather than in [`@/packages/abi`](../abi/README.md) for the reason
[`@/packages/server/src/halfclose.wac`](../server/src/halfclose.wac) is where it is: **a seam is
demonstrated by the package on the other side of it.**

---

## Three lines of ceremony to say one type

```wac
Vec<AbiType> schema = Vec.create();
schema.push(Address);
Vec<Value> got = try decode(returned, schema);
```

That is how a caller spells `(address)`, because a `Vec` is built by pushing. The shipped package's
`i32[](T_UINT(), T_BYTES())` is one expression, and it is **the one thing the flat descriptor was
better at**: an array has a literal form and a `Vec` has not.

`Vec.of(Address)` is the missing piece and wac cannot declare it — a variadic static is not in
`spec/spec/grammar.md` and nothing in `../../GRAMMAR.md` proposes one. What `core` *could* offer is
`Vec<T> fromArray(T[] a)`, which `core/vec.wac` lists among the twelve members it left out because
nothing needed one, and which makes this `Vec.fromArray(AbiType[](Address))`: one expression, two
allocations, and still longer than the flat descriptor it replaced.

So the tree wins everywhere except at the literal. Whether that is worth a `Vec` literal, a variadic
static, or nothing at all is a question only the first caller can raise — which is the argument for
writing first callers, made by the one that found something the library could not.

## The answer is positional, and the caller feels it rather than reading about it

`got.get(0).asWord()!` — the `0` and the `asWord` are both restatements of the schema two lines
above, and neither is checked against it. For a two-member answer there are three restatements: the
index, the accessor, and the order the `push`es went in.

`abi/src/type.wac` argues this from the library's side and `abi/src/encode.wac` reaches it from the
encoder's. What the caller adds is that **the mistake is not exotic.** Pushing two members and
reading them back out of order is one transposed digit, it type-checks, and for
`(address, uint256)` it answers a plausible address and a plausible number. The decoder cannot catch
it, because it built the tree from the schema and there is nothing left to disagree with.

## A name collision found while demonstrating the other four

`EthAddress` is called that because `AbiType.Address` is in scope, and `schema.push(Address)` two
functions down would otherwise be the struct or the arm. Fifth collision of the kind, and the one
that settles what the rule is: it happened *while writing the demonstration of the other four*,
between a name this file declares and an arm of an enum it imports. `../../QUESTIONS.md` has it as
*bare variant names share one namespace per file*.

## What could not be written

**`EthAddress` is a `Bytes` of twenty and nothing says so.** `got.get(0).asWord()!.from(12)` is a
slice with a magic 12, and `Bytes` carries no length in its type — so `Address`, `Bytes32` and a
`contenthash` are one type as far as anything can check. Every ABI implementation in a language with
sized arrays writes `[u8; 20]`; the ask is smaller than dependent types and larger than anything on
the pages: a **fixed-length byte view**, which `Slice<T>` is one field away from, since `len` is
already there and is just not in the type.

The cost lands somewhere unusual. It is not that a wrong-length address is encoded — `writeBlob` pads
— it is that `readAddr` and `readContenthash` **return the same type**, so a caller can pass one
where the other is meant.

**And this file turned out to hold the strongest form of that request**, found on 2026-09-05 when the
ask was tested against every package that makes it. The other five want a *constructor* that checks
once instead of once per package — a real gain, and one that moves a check rather than removing it.
This one wants **arithmetic**: `from(12)` on a `Slice<u8, 32>` is statically a `Slice<u8, 20>`, so
the magic `12` is checked against both widths and there is no check left to move. The alternative in
the other five is *a check somewhere else*; here it is *nothing*. Two more packages have since asked for the same thing from other
directions, `@/packages/ssz`'s `Chunk` and `@/packages/bls`'s `Fp`, and it is one entry in
`../../QUESTIONS.md` rather than three.

**A schema and its answer are two values and nothing pairs them.** `decode(returned, schema)` hands
back a `Vec<Value>` whose shape is entirely determined by `schema`, and the caller then indexes it by
hand. A `Decoded` that carried the schema it was produced from could answer `addr()` rather than
`get(0).asWord()!` — which is a library design this file is too small to justify and is the shape the
positional problem above actually has.
