# quic — the endpoint, as the consumer `Net` was not shaped for

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/quic`: 3,279 lines. One file is written out —
[`src/endpoint.wac`](src/endpoint.wac) — and it is a shape rather than an implementation.

---

## Why this one

`Files` was the first consumer of a projection and found it short by two methods. `Net` had one
consumer, [`../server`](../server/), which calls `sys.net.listen(7000)` and nothing else. A
projection with one consumer has the shape that consumer needed.

`vision/std`'s `Net` is:

```wac
export struct Net {
  async Result<Listener, NotGranted> listen(this, i32 port);
  async Result<Socket, NotGranted> connect(this, string host, i32 port);
}
```

Two methods of the host's nine, and both are streams.

## The file it is a rewrite of says why that is wrong, in a paragraph the rewrite dropped

`std/platform.wac`, on its datagram capabilities:

> Every field above this is *stream* — `connect`, `listen`, `accept`, `recv`, `send` — and QUIC needs
> none of them. A QUIC server answers many peers from one socket, and a connection is identified by
> its connection id rather than by an address, so a peer may legitimately move mid-connection. A
> connected socket represents neither: not one socket for many peers, and not one peer at changing
> addresses.

That is `design/system/0007`. **`Files` was short by two methods; `Net` is short by a shape** — and
that is the worse of the two, because a missing method is an omission and a missing shape is a
design you cannot extend into. `Endpoint` is not a `Socket`: every read answers a peer as well as
bytes, every write names one, and there is no `accept` because there is no handshake.

## What this does *not* argue

**Not an eighth projection.** The grant is one and the shipped file is right about why:

> a program that may open a TCP connection may send a UDP packet, and one that may not may do
> neither. A second grant would be a second question with the same answer.

So `Net` as a **capability** is correct. What was assembled from one consumer is its **interface** —
a projection is a value with an API, and the API came from the caller that happened to exist. The
finding is about how the projections were built, not about whether to have them.

## And it met a decision, which nothing had

`Router` keys connections by connection id — a byte string in the packet header, which is what makes
a peer's address changeable. `Map<Bytes, Connection>` will not do, because
[`../../DECISIONS.md`](../../DECISIONS.md) settles that **references are comparable but not
hashable**: a moving collector invalidates anything derived from an address, wasm GC has no header to
stash a lazy hash in, and *"a type that wants to be a hash key carries the field itself."*

So the id is hashed to a `u64` and the map is keyed on that. This is the first place in nineteen
subjects where that decision has cost anything, which is worth recording either way: a decision whose
consequences nobody has met is a decision nobody has tested.

## The seam between two specifications, and a digest that does not know what it digested

[`src/keys.wac`](src/keys.wac) is where QUIC stops deriving its own secrets and starts using TLS's.
The shipped file describes itself exactly — *"The join between the two specifications is one
sentence … This file is the sentence."* — and warns about the quietest failure in the package:

> A transcript that included the framing would produce keys that are perfectly well-formed and that
> no peer shares, which decrypts as noise and **looks exactly like a wrong Diffie-Hellman.**

The hazard is the argument. `handshakeKeys(u8[] dhe, u8[] transcript, bool isServer)` takes the hash
of every handshake message, and **every wrong value is 32 bytes and is a real digest of something** —
so [`@/packages/crypto`](../crypto/)'s `Digest32`, whose guarantee is *32 bytes because a hash
produced it*, cannot refuse one. `Digest32<Transcript>` could, with `Transcript.of(messages)` the
only way to make one.

That is the same request [`@/packages/ssz`](../ssz/) made about roots and was declined on — `sha256`
cannot know a `T`. **The objection stands and the prices differ**: in `ssz` a mismatched root
compares `false`, which a test sees; here it is a connection nobody can decrypt, indistinguishable
from a failed key exchange.

### And a `secret` loses its qualifier at a package boundary

[`@/packages/tls`](../tls/)'s key schedule is this directory's `secret` consumer, and its finding was
that `secret` has no return position, so eleven functions re-declare it on the way in. This file is
the same absence one layer out: the traffic secret is derived in `tls`, is `secret` there, crosses to
`quic` as a return value, and arrives as a plain `Bytes`.

Eleven functions inside one package is a nuisance. **A package boundary is where the re-declaration
is a different author** — and it changes what the qualifier would have to be, since inside one file a
checker could plausibly infer the taint, and across a package the only thing that carries it is the
signature.

## What could not be written

**The connection state machine**, which is 3,000 of the 3,279 lines and would have said nothing about
`Net` that the first twenty do not. Choosing the file that stresses the proposal over the package
that contains it is what [`../tor`](../tor/) and [`../tls`](../tls/) did, for the same reason.

**Whether `bind` belongs on `Net` or on a `Datagrams` beside it.** `NetWithDatagrams` here is a
sketch of the first, and the argument for the second is that a program which binds a UDP socket
usually does not also dial TCP — so the narrowing that justifies the projections would justify
splitting again. The argument against is that the *grant* does not split, and a projection whose
boundary does not follow a grant boundary is a convention rather than a guarantee. Not decidable from
this package, and it is the same question one level down from *why seven*.

**What a `Peer` is when the peer moves.** `Received` carries the address a datagram arrived from,
which is right, and a QUIC connection deliberately survives that address changing. So a `Connection`
holds a *current* peer that the router updates, and nothing in the type says the field is expected to
change under you. `const` would be wrong and there is no spelling for *this is deliberately mutable
and shared*. Filed as an observation rather than a proposal, since every language has this and most
of them say nothing about it either.
