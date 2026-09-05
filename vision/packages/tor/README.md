# tor — measured, not rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/tor`: **16,291 lines** across `src/`, the largest in the tree after the
compiler. Nothing here rewrites it. Two files are written out —
[`src/verdict.wac`](src/verdict.wac), the type that carries the whole argument, and
[`src/onionaddr.wac`](src/onionaddr.wac), added later because it is the first consumer
[`@/packages/codec`](../codec/) has.

Same form as [`box`](../box/) and [`crypto`](../crypto/): a count and a proposal rather than a
package.

---

## Why this one, and why not a rewrite

Fifteen packages have been rewritten here and the largest original was 2,544 lines. `../README.md`
says the exercise is good at finding *"a rule that turns out to be unusable at scale"* — and it has
never been at scale. Sixteen thousand lines is where a rule that costs a little per site starts
costing.

Rewriting it would take a week and produce a sketch nobody would read. Counting it took an hour and
produced a number.

## What a failure is worth in the largest package in the tree

Across `packages/tor/src`:

| | |
|---|---:|
| lines | 16,291 |
| `trap` sites | 41 |
| result types carrying `bool ok;` | 13 |
| failure paths that collapse into one of those bits | **64** |
| failures that carry a **reason** | **1** |

Sixty-four places where the code knows exactly what went wrong and answers `false`.

**`parseExtend2` is the case to look at**, in `relaycircuit.wac` — 47 lines with eleven distinct
refusals, all `return bad;`:

    payload.len() < 1              a truncated cell
    n == 0                         no link specifiers
    at + 2 > payload.len()         a specifier header past the end
    at + 2 + length > …            a specifier body past the end
    length != 20                   a legacy identity the wrong size
    length != 32                   an Ed25519 identity the wrong size
    type == LS_IPV4 && length != 6 an IPv4 specifier the wrong size
    legacyCount > 1 || edCount > 1 a duplicated identity
    at + 4 > payload.len()         no handshake header
    at + hLen > payload.len()      a handshake past the end
                                   — and one more

Its header says why it matters that this is a *relay* refusing: *"a relay that could read it would be
able to impersonate the hop it is extending to."* A relay that refuses an EXTEND2 cannot tell a
truncated payload from a duplicated identity, and those are different facts about the peer — a bug,
an attack, or a version skew. Eleven of them arrive as one bit.

## The one that carries a reason is a sum type written by hand

`Verdict`, in `consensus.wac`:

```wac
export struct Verdict {
  bool ok;
  i32 goodSignatures;
  i32 needed;
  /** Empty when the document is current; otherwise why it is not. */
  string stale;
}
```

Four fields, and which two mean anything depends on which failure happened. `relayd.wac` knows that
and writes the discrimination out:

```wac
string why = v.stale != "" ? v.stale
                           : itoa(v.goodSignatures) + " good signature(s), " +
                             itoa(v.needed) + " needed";
```

`stale != ""` is a tag. The two integers are one variant's payload and the string is the other's.
Nothing checks that a reader looks at the matching pair, a third reason is a third field and a
longer ternary, and a caller that forgot the new branch would print a signature count for a document
that was never about signatures.

**So the demand is not hypothetical and it is not a matter of taste.** Somebody needed two failure
reasons kept apart, had no way to declare that, and built one out of a boolean and an emptiness
test. [`src/verdict.wac`](src/verdict.wac) is the same information as `Result<void, Invalid>` with
the compiler holding the correspondence, and it is shorter.

It also surfaces something the shipped struct hides: `goodSignatures` is meaningless when `ok` is
true and is only ever read on the failing path. **A field that means nothing in the success case is a
payload in the wrong place**, and the struct-with-a-flag shape is what let it sit there.

## The counter-evidence, which is the honest half

**Nobody has complained.** `packages/gzip`'s `issues/system/closed/0102` is a filed issue about
exactly this loss — a caller that cannot tell a broken disk from a corrupt archive — and its
resolution priced the fix at *"threading a status back through every symbol read"*. There is no
0102 for tor. Sixty-four sites, sixteen thousand lines, a working onion router, and not one issue
saying the bit was not enough.

Three readings, and they are not equally likely:

- **The reasons genuinely do not matter.** A relay that cannot parse a cell drops it, and which way
  it was malformed changes nothing it does next. This is the strongest case and it is real for
  perhaps half of the sixty-four.
- **They matter and nobody has hit it yet.** A relay with no diagnostics is fine until someone has
  to debug an interop failure against C tor, and then eleven refusals reading as one bit is exactly
  the wrong shape. `Verdict` exists because that moment arrived once.
- **They matter and the cost of carrying them stopped anybody trying.** Which is what 0102 says
  happened in `gzip`, in as many words, and is unprovable here because nobody wrote it down.

**The measurement supports the demand and not the harm.** Sixty-four is a real number about how
often the language's answer to failure is one bit; one filed issue is a real number about how often
that has cost anybody. Both belong in the argument and the packages README had only the first kind.

## The v3 address, and the alphabet the RFC does not have

`onion_address = base32(PUBKEY | CHECKSUM | VERSION) + ".onion"`, and it is written **lowercase**.
RFC 4648 §6's alphabet is uppercase. So `packages/tor/src/onionaddr.wac` calls the codec's `encode`
and then **walks the result folding `A-Z` down**, five lines, and five more the other way in the
decoder.

`Alphabet.Base32Lower` is the codec's seventh variant and it did not exist until this file wanted it.
That is the **second** time that enum has had to encode what a caller does rather than what the RFC
says — `Base16Lower` was the first, because `hex.wac`'s `encode` is lowercase and its `encodeUpper`
is the RFC's. The codec's README predicted it one paragraph after making the decision, which is not
foresight so much as evidence that the case was already there to be found.

**And `u8[0]()` is the answer to four different questions.** The shipped `onionPubkey`'s doc names
them — *"wrong length, wrong version, bad base32, wrong checksum"* — and returns an empty array five
times in one function. The distinction a client acts on is buried in there: a **checksum mismatch is
a typo**, and is the one case where *check the address you pasted* is the right thing to tell a
person; the other three mean *that is not an onion address*.

`NotBase32 { CodecFault why; }` wraps rather than nests, for the reason
[`@/packages/lightclient`](../lightclient/) gives — second use of that shape, and the first outside
the package that argued for it.

### The first use of a control-flow arm

```wac
Bytes raw = match (decode(a.toBytes(), Alphabet.Base32Lower)) {
  Ok(b):    b,
  Err(why): return Err(NotBase32(why))
};
```

`arm_value = expr | "continue" | "break" | "return" , [ expr ]` — one of the ten constructs found on
the vetted pages that no rewrite had ever written, and this is its first use.

It is also a **partial** answer to `@/packages/lightclient`'s complaint that *"`try` cannot map, so
wrapping a callee's fault costs four lines"*. In an initialiser it costs one extra line, because the
value goes where the value goes. In a statement position — which is what `validate.wac` has, since it
is propagating rather than binding — it does not help at all. So the ask is still a `try` that maps,
and the construct that already exists covers half the cases.

## Path selection: an ordering that carries a security property

[`src/pathsel.wac`](src/pathsel.wac) is the fourth file taken from the 264 shipped sources nobody
predicted anything about, picked because its failures are unlike every other package's:

> if the handshake is wrong the circuit fails loudly. If path selection is wrong the circuit works
> perfectly and the anonymity is gone, so the failures here are the quiet kind.

**Four states of two booleans, decided by an ordered chain.** `positionWeight` tests
`isGuard && isExit`, then `isGuard`, then `isExit`, then neither — with a warning above it:

> The order of those four tests matters. A relay with both flags must take the "both" weight —
> checking Guard first and returning would give a Guard+Exit relay the guard-only weight, which is
> how exit capacity leaks into the guard position.

The hazard is real and the code is right. Four states of two booleans is a closed set the language
can hold, and a `match` over `Role { Both, GuardOnly, ExitOnly, Neither }` is exhaustive and
order-independent — **there is no first arm, so there is no wrong order to put the arms in.** One
enum and one classifying function, in the file where a silent wrong answer costs anonymity.

**And the positions are not an enum, deliberately.** *"Not an enum because the weights are indexed by
it and the arithmetic is clearer with a number."* That is
[`../../QUESTIONS.md`](../../QUESTIONS.md)'s *a closed set you cannot enumerate is a closed set you
cannot tabulate*, from the other side: four packages introduced an enum and could not count by it;
this one declined the enum in advance and carries `if (position < 0 || position > 2) { trap; }`
instead — the check an enum would not need.

**Tested 2026-09-05, and the cost it declined is smaller than the comment reads.** Of six packages
that introduced such an enum, only two want to index or count by one — this and
[`@/packages/git`](../git/)'s prompt — and both are answerable today by **putting the index on the
type that owns the table**. `Weights.at(Position, Role)` already has the shape: the `position * 4 +
role` arithmetic belongs to `Weights`, and one `match` per dimension inside it turns each enum into
its number **once**, not per call site. The trap this file carries instead is bigger than the `match`
it avoided.

**`i64` because `i32` fails invisibly in the attacker's favour.** *"a large relay's product overflows
32 bits — and the failure is silent, giving a negative weight that the chooser skips, which means the
biggest relays are never picked and nothing looks wrong."* The wrapping entry's sharpest witness:
everywhere else the consequence is a wrong number, here it is a **changed distribution**, invisible
to any test that checks a circuit works.

### And the property that matters is not reachable by a type

Everything above secures the arithmetic. What actually matters is that the *distribution* of chosen
paths matches every other client's, because a client that concentrates traffic differently *"is
itself distinguishing"* — checkable by simulation against a real consensus, not by a type, an
assertion or a unit test. Worth stating plainly because it bounds the method: this directory asks
*what could the type have said*, and here, for the load-bearing property, the answer is nothing.

## What could not be written

**A digest, from `@/packages/crypto`.** This file names `@/packages/crypto/src/keccak.wac` and the
rewrite of that package covers `secret.wac` and nothing else — as do
[`@/packages/tls`](../tls/), which names three unwritten crypto files, and
[`@/packages/ssz`](../ssz/), which names `sha256.wac`. Three packages want a hash from a package that
has not got one, which is a fact about where this exercise spent its attention rather than about the
language.

**A `Slice` cannot concatenate and cannot compare**, which is correct: a join allocates and a view
owns nothing to allocate into. So the address body is a `Buf` and the checksum comparison is two
`get`s, and both are the type doing its job. `core/slice.wac`'s rule is *"added when the fifth
appeared rather than the second"* — this is the first `eq` and the second `concat`, so: not yet.

**The address and the key are the same thing and are two types here.** rend-spec-v3's whole point is
that `onion_address` *is* the identity key, so `Bytes` and `string` being distinct means the program
holds two spellings of one value with nothing saying they correspond. A round trip is the only
relation and it is a test rather than a type — and this is the case where a value type would be
*wrong*: the string is what a person types and the bytes are what a protocol sends, and collapsing
them would lose which one is on the wire.

**How wide an error set gets at this scale, which is the question I came to ask and did not answer.**
The plan was to find out whether `try`'s membership rule survives sixteen thousand lines — whether a
`connectRelay` at the bottom and a `bootstrap` at the top end up with a fifty-member union in every
signature between them. It is unanswerable from this tree, because **there are no error values to
propagate.** You cannot measure how a union composes across twelve layers when eleven of them return
a boolean.

That is a finding about the exercise rather than about tor: *the scale test needs a codebase that
already types its failures*, and this repository does not have one. Answering it means writing the
propagation, which is the rewrite this file declines.

**Whether a relay should carry reasons at all** is a security question and not mine. A refusal that
says *why* is a refusal that tells a prober which of eleven checks it failed, and an onion router is
the one program in this tree where that is a real consideration rather than a hypothetical one. The
answer is probably "log it, never send it", which is a distinction `Result` does not make and the
type would need a convention around. Nothing in `vision/` discusses a fault that is safe to record
and unsafe to return.

**`trap` at 41 sites went uncounted against anything.** Whether those are the *right* 41 — a trap
being correct where a program genuinely cannot continue, per `Result.orTrap`'s comment — needs
reading all of them, and reading 41 trap sites in an onion router to classify them is a day's work
with no instrument behind it.

**One struct with two phases, and the split found a boundary nobody had drawn.** Added with
[`src/directory.wac`](src/directory.wac). The shipped `Relay` carries seven consensus fields plus
three from a separate document, marked *"Empty until a microdescriptor is matched up"* — so between
`parseConsensus` and `attachMicrodescriptors` every relay in the array has an empty `ntorOnionKey`,
and **a relay in that phase cannot build a circuit**, with only a doc comment saying so. Sixth phase
error here fixed by giving each phase a type, and the first where the wrong phase is a security
property rather than a wrong answer.

The useful part was unplanned. `src/pathsel.wac` imported `Relay` and now imports **`Listed`**,
because `weighted` and `roleOf` read bandwidth and flags and nothing in the file reads a key. The
ntor requirement stops at the circuit builder instead of spreading through path selection — **the
smaller type turned out to be the one most callers wanted**, and nobody could know which until the
two were separate.

**`null` means two different things, one assignment apart.** `parsePolicy` returns `ExitPolicy?`
where null is *could not read this line*; `Relay.exitPolicy` is `ExitPolicy?` where absent is
**reject everything**, documented as a domain fact — *"a missing summary is a reject-all and tor
reads it that way."* Assigning one to the other is a type error nowhere. The direction happens to be
safe and nothing says the safety was noticed, in a file otherwise scrupulous about exactly this:
*"the safe direction differs by polarity and there is no single conservative default."* An author
thinking that carefully about a dropped **entry** had nowhere to write what a dropped **line** means,
because both are spelled `null`.

**Two identities, two lengths, one type.** `identity` is 20 bytes of SHA-1-over-RSA; `ed25519Identity`
is a different key; both are `u8[]`, and the comment carries the guard rail — *"computing it over the
RSA digest gives a complete, consistent ring that no service has ever published to."* A ring nobody
publishes to is a failure with no error in it. **A length in the type would not catch this**: each
value is the right length for itself, and what is wanted is a distinct type per meaning. Same shape
as `fmt`'s `FixedBig<40>` vs `FixedBig<160>`, and the second instance today.

**A closed set of ten spelled as string literals, where the default answer is unsafe.**
`hasFlag(r, "BadEXit")` compiles and answers false, and false for `BadExit` means *fine to exit
through*. Ten call sites over five flags — small, and not the point: every other stringly-typed
lookup found today fails towards a visible wrong answer, and this one fails towards using a relay
the authorities marked hostile. Third *closed set spelled as an open type* today, after `case.wac`'s
`which: i32` and `percent.wac`'s `set: i32`.
