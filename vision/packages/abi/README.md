# abi — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/abi`: one file, 559 lines, the contract ABI — how a call's arguments
become calldata and how returned bytes become values. Chosen because it is the first package here
whose subject is a **type described as data**, and because of what a grep turned up on the way in.

---

## It has no callers

`grep -rl "abi/src/abi.wac" packages/` finds three files: its own coverage ledger, a `wacc` source
probe, and its README. Nothing uses it.

The package that says it will is `packages/ens`, and it stops one step short:

> Both of these take one `bytes32`, which is a static type, so the calldata is the selector and one
> word — **no `packages/abi` needed for the encoding, though the *answer* needs it.**

It builds `resolver(bytes32)`, `addr(bytes32)` and `contenthash(bytes32)` and never decodes a reply.

So a package tested exhaustively against `npm:ethers` — thirty cases, both directions, a strictness
table measured against two real decoders and pinned so it fails if either changes its mind — has
never met a caller. [`@/packages/ens/src/answer.wac`](../ens/src/answer.wac) is that caller here, and
half of what this rewrite found came from writing it rather than from reading the package.

## A type described as data, and the data is an `i32[]`

The header calls it a design:

> ## Schema-driven, because a type is data
>
> A descriptor is an `i32[]` in prefix order — `T_ARRAY, T_STRING` is `string[]`, and
> `T_TUPLE, 2, T_UINT, T_BYTES` is `(uint256, bytes)`.

*Schema-driven* is right and is not what the flat array buys — **a tree is data too**. Three things
follow from writing it as one:

**`typeLen` disappears.** The shipped package exports
`i32 typeLen(i32[] schema, i32 at)` — *"How many `i32`s the descriptor at `at` occupies, so a walk
can step over a member"* — a recursive function whose whole job is recovering the tree from the flat
form. It is called from `isDynamic`, `headWords`, `tupleAt` and `decode`, once per member of every
tuple in each, and each call re-walks the subtree. Nothing here steps over anything.

**A malformed descriptor stops being possible.** `T_TUPLE, 5` followed by two members indexes past
the end; `T_ARRAY` at the end of the array reads a type that is not there. Both are traps on a
caller's typo, in a package whose entire subject is refusing malformed input carefully. A
`Vec<AbiType>` cannot say five and hold two.

**Nine `i32 T_X() { return n; }` become nine variants** — third time, after `regex`'s thirteen `OP_*`
and `tty`'s eight control characters. Worth one line here and no more, except for what sits eight
lines above them in the same file: **`Value` is already an enum with payloads.** The values were a
sum type and the types were integers in an array, and nothing in the file remarks on it.

## Typed faults, and here the argument is stronger than usual

The shipped decoder answers `(bool ok, Value[] items, string error)`. The usual objections apply and
one more does. This README's own table says these are **security** distinctions:

| an offset past the end of the payload | reading past a field's bounds is how this becomes a security bug |
| an offset pointing back into the head | aims one field at another's bytes, and reads as an ordinary empty value |

A client that wants to log *this peer sent an offset into the head* separately from *this response
was truncated* cannot: both arrive as prose, and they are not the same event.

And the package **already measured** that two real decoders disagree about two of the rules —
`test/strictness.test.ts` records that `cast` truncates a dirty address where `ethers` refuses, and
that both accept a `bool` of 2 where Solidity reverts. A union is the shape in which *"refuse
`DirtyAddress`, accept `NotABool`"* is a caller's line of code rather than a fork of the decoder.
That is the strongest argument for typed errors this exercise has produced, and it is stronger than
the one about printing.

## What could not be written

**A fifth name collision, in the file demonstrating the other four.** `answer.wac` declares an
address type and imports `AbiType`, whose arm is `Address`, so `schema.push(Address)` would be
either. It is `EthAddress` now. The five: `tty`'s `Effect.Line` against its own `struct Line`;
`rlp`'s `Item.Bytes` against `core`'s; this package's `AbiType.Blob` against its own `Value.Blob`;
and this one. Enough instances to state the rule rather than the symptom, which is in
[../../QUESTIONS.md](../../QUESTIONS.md): **bare variant names share one namespace per file**, so an
enum's arms are private only until a second enum comes into scope.

**Converting an index walk into a structure walk moved an allocation under an attacker's number.**
`Array(of)` decodes by building a `Vec<AbiType>` of `n` copies and reusing `tupleAt` — which is
right, since an array's elements *are* a tuple of identical members, and writing the two walks
separately is how the offset rule gets stated twice and diverges once. But `n` is a length word from
the calldata, and the first draft of `decode.wac` built the `Vec` before checking it: a 32-byte
message allocating two billion entries, in the package whose README says *"a malformed offset is not
an unusual input, it is an attack"*. The guard is four lines and had to be **added**. The shipped
version cannot have the bug, because its schema is an index it passes `n` times.

That is the finding, and it is not about the ABI: **a data structure has costs an index does not, and
the conversion does not point them out.** Nothing failed; the four lines were noticed by re-reading.

**The lazy form has no second pass, which is the other half of a finding from yesterday.** The fix
for the allocation is a `Repeat(AbiType of, i32 n)` view — something `tupleAt` can iterate that
answers one type `n` times — and that is a `gen<AbiType>`. `tupleAt` iterates its schema **twice**,
once to sum `headBytes` and once to walk, and a generator cannot be restarted.
`@/packages/server/src/halfclose.wac` found that a generator has no *start now, collect later*; this
one has no *iterate again*. Two properties an array has for free, in two packages, a day apart.

**The answer is positional and the schema is not.** `got.get(0).asWord()!` restates the schema twice
— the index and the accessor — and neither is checked against it. Pushing two members and reading
them out of order is one transposed digit, it type-checks, and for `(address, uint256)` it answers a
plausible address and a plausible number. The decoder cannot catch it because it built the tree
*from* the schema, so there is nothing left to disagree with.

Both halves of the package arrived at the same fix independently: `encode.wac` wants a `Typed`
holding a `Value` and its `AbiType` together so its five `v.asWord()!` assertions become one checked
constructor, and `decode` answering `Vec<Typed>` would put the schema in the answer where a caller
can read it. First thing in this exercise that the encoder and the decoder wanted without being told.

**`Vec` had no `get`, and which caller wanted it is the point.** `core/vec.wac` lists thirteen
absent members *"none of them for a reason, all of them because nothing here needed one"*, and nine
loops in seven files iterate a `Vec` without indexing one — which is `issues/lang/0322a`'s subject, a
counter that exists only to dereference. An ABI answer is the opposite case: a caller asks for member
1 because the schema said member 1, and there is no traversal. So the first demand came from the one
shape 0322a explicitly is not about. Added, with that written down.

**A `Vec` has no literal**, and it is the one thing the flat descriptor was better at.
`i32[](T_UINT(), T_BYTES())` is an expression; `Vec<AbiType> s = Vec.create(); s.push(Uint);
s.push(DynBytes);` is three statements. `Vec.of(Uint, DynBytes)` is a variadic static and wac has no
way to declare one; `Vec.fromArray(AbiType[](Uint, DynBytes))` is writable, allocates twice, and is
still longer than what it replaced.

**Nothing parses a signature.** A caller holds `"addr(bytes32)"` — it is what the selector is hashed
from, so it is already in the source — and then writes the type out a second time as a schema.
`AbiType.parse` is ordinary code and neither package has it in either shape. Not a language question,
and it is here because the flat descriptor made it look like one: *"a type is data"* reads as an
answer to *where does the type come from* and is not one.
