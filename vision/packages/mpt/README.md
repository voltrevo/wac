# mpt — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/mpt`: 487 lines over two files, Merkle-Patricia proofs — the piece
that turns *"a provider told me"* into *"the state root I already verified commits to this"*. Only
`proof.wac` is rewritten; `account.wac` is the same shapes over four fields and its one measurement
is quoted below.

Chosen because it is the consumer [`@/packages/rlp`](../rlp/) argues about. That rewrite's central
claim — that `bytesOf`'s trap is in the wrong place — was made from a doc comment describing *this*
package's call sites, and the way to find out whether it holds is to write them.

---

## The two-bool result, and the README that argues for a sum

`Proved` is `(bool ok, bool present, u8[] value, string error)`, and the package's README defends
the two flags at length:

> `ok` and `present` are separate on purpose. A proof of absence — for a storage slot never written,
> or an account that does not exist — is a *valid* proof whose path ends before the key does … It is
> a different shape from an inclusion proof, and the half people skip. Conflating "the proof failed"
> with "there is nothing there" would make a broken proof look like an empty slot, **which is the
> more dangerous of the two.**

Every word is right, and it is an argument for a sum. Two bools are four states; one of them — not
`ok` and `present` — cannot happen, and `value` means something in exactly one of the three that
can. The README is asking a reader to hold a rule, and the rule is *do not confuse these two*, which
is the thing a sum makes unnecessary.

```wac
enum Proved { Present(Bytes value), Absent }
Result<Proved, ProofFault> verify(Bytes root, Bytes key, const Vec<Bytes> nodes)
```

A failure is the `Err` arm; what is left is two cases, and a caller cannot reach the value without
saying which case it is in. **Third package where the best-argued paragraph in the file is a
discipline the type could enforce**, after `datetime`'s leap seconds and `rlp`'s `bytesOf`.

## What `rlp`'s `Bytes? asBytes()` actually buys, measured

`bytesOf` traps for a list, so a caller has to ask `isList` first. `packages/mpt` does, at **all nine
of its calls** — the shipped code is correct. What it costs is nine hand-written guards:

- four inline `isList` checks in `proof.wac`;
- and in `account.wac`, a **separate loop over the four fields** whose only job is to reject a list.

That loop carries the bug it was written for:

> A list in any of them used to read as empty — which for the nonce and the balance means *zero*, an
> account that has never sent a transaction and holds nothing, from bytes committed to the state
> trie.

Here the guard **is** the unwrap. `slot(…)` calls `asBytes()`, gets a `Bytes?`, and there is no way
to reach the bytes without saying what happens when they are not bytes. The claim `rlp` made from
reading a doc comment holds when the call sites are written: not that the shipped code is wrong, but
that it pays a discipline per call and the type can pay it once.

## What else changed

**The `Walk` loses its error field** — eleven places set `string error` and four functions open with
`if (w.error != "") { return; }`. Third sticky-error struct replaced, after `rlp`'s `Cursor` and
`datetime`'s eighteen `return bad;`.

**`NotRlp` carries the other package's fault.** First union member here holding a union: a proof
failing *because* the RLP under it failed is a different event from a proof failing on its own
terms, and a caller that wants to say so has both halves. `@/packages/box`'s `gunzip` matched a
nested union by type; this composes one.

**The unused-node check becomes the same rule as `rlp`'s trailing bytes.** A node nobody walked is a
second claim in the same message, one layer up from an item nobody read.

## What could not be written

**`Absent` is returned from four places and means two things.** Three are *the key diverges from
this node's path*; the fourth is *the branch's own value slot is empty*. Both are sound proofs of
absence and they are not the same evidence — a run of divergence proofs from one peer and never a
value is a different pattern from empty slots, and an auditor might want to tell them apart.

Splitting it is one more arm. It is not written because nothing wants it yet, and it is here because
it is the **opposite** of the finding at the top: the shipped `Proved` collapsed three states into
four flags, and this rewrite collapses two kinds of absence into one arm. A sum is only as good as
the cases somebody chose, and choosing them is not something the shape does for you.

**A trie key is `u8[]` and every element is 0..15.** `nibbles` produces them, three places index a
seventeen-element branch by them, and nothing says so — `parts.get(nib)` above 15 reads off the end.
It cannot happen because the producer masks. Third package to want a refinement of an integer, after
`raster`'s colour and `ens`'s address; promoted there already.

**`descend` is elided and it is the one worth naming.** A child is either a 32-byte hash to fetch or
a node **inlined** because its encoding is under 32 bytes; the two paths reach `step` having
consumed a different number of nodes, so the node index in a fault can be wrong on the inline path
and nothing checks it. Elided because the logic is the shipped logic; named because a fault that
points at the wrong node is worse than one that points at none, and the index only became a field
when the errors became values.
